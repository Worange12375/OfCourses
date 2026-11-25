/**
 * 账号上下文 + 云端方案同步引擎（2026-11-14 P2 前端）
 *
 * 边界（用户定稿）：游客体验零降级，登录只做加法。
 * 同步语义：云端每套方案 = 一份完整工作台快照（oc_history + oc_custom）；
 * 本地只有一份「当前激活方案」；改动轮询检测自动上传（乐观锁）；
 * 切换方案 = 写入本地快照后刷新页面（工作台 state 在挂载时从 localStorage 初始化）。
 */

import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {
    AccountError, deleteScheme as apiDeleteScheme, fetchMe, listSchemes, login as apiLogin,
    logout as apiLogout, register as apiRegister, renameScheme as apiRenameScheme, saveScheme,
    schemeDetail, verifyCode as apiVerifyCode, requestCode as apiRequestCode, updateProfile as apiUpdateProfile,
    resetPassword as apiResetPassword,
    type AccountUser, type SchemeMeta,
} from "../api/account";

/** 从邮箱前缀推断年级：取末两位数字且落在 20~30 → 20XX 级（如 wutc24 → 2024）。不匹配返回 null */
export const detectCohortFromPrefix = (prefix: string): string | null => {
    const m = prefix.match(/(\d{2})(?!.*\d)/);
    if (!m) return null;
    const n = Number(m[1]);
    return n >= 20 && n <= 30 ? `20${m[1]}` : null;
};

/** 解析用户有效年级：'auto' → 由前缀推断；'20XX' → 手动；'' → 未设置（null） */
export const resolveCohort = (user: AccountUser | null): string | null => {
    if (!user) return null;
    if (user.cohort === "auto") return detectCohortFromPrefix(user.prefix);
    if (/^20\d{2}$/.test(user.cohort)) return user.cohort;
    return null;
};

/* ---------- 本地快照工具 ---------- */
const HISTORY_KEY = "oc_history";
const CUSTOM_KEY = "oc_custom";
const SCHEME_ID_KEY = "oc_scheme_id";
const SCHEME_PICK_DISMISS_KEY = "oc_scheme_pick_dismiss"; // 本会话内跳过云端选择（用户点了「继续用本地」）

export const localSnapshot = (): string =>
    JSON.stringify({
        h: JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}"),
        c: JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "{}"),
    });

export const applySnapshot = (data: string) => {
    const parsed = JSON.parse(data) as {h?: unknown; c?: unknown};
    localStorage.setItem(HISTORY_KEY, JSON.stringify(parsed.h ?? {}));
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(parsed.c ?? {}));
};

const loadCurrentSchemeId = (): number | null => {
    const v = Number(localStorage.getItem(SCHEME_ID_KEY) ?? "0");
    return Number.isInteger(v) && v > 0 ? v : null;
};

export type SyncState = "off" | "idle" | "syncing" | "saved" | "conflict" | "error";
export type PickReason = "multiple" | "resume";

interface AccountContextValue {
    user: AccountUser | null;
    authReady: boolean; // 首次会话探测完成
    authModalOpen: boolean;
    openAuthModal: () => void;
    closeAuthModal: () => void;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, regToken: string, password: string, nickname: string) => Promise<void>;
    requestCode: (email: string, captchaId: string, captchaAnswer: string) => Promise<{expires_in: number; dev_code?: string}>;
    verifyCode: (email: string, code: string) => Promise<string>;
    logout: () => Promise<void>;
    updateProfile: (patch: {nickname?: string; cohort?: string}) => Promise<void>;
    /* 云端方案 */
    schemes: SchemeMeta[];
    currentSchemeId: number | null;
    currentSchemeName: string | null;
    syncState: SyncState;
    lastSyncTs: number | null;
    conflictServerTs: number | null;
    pendingPick: PickReason | null;
    dismissPick: () => void;
    pickScheme: (id: number) => Promise<void>;
    fetchSchemeData: (id: number) => Promise<string | null>;  // 读取云端方案快照原文（不切换当前方案；失败返回 null）
    createScheme: (name: string, data?: string) => Promise<void>;  // 默认新建空白方案
    duplicateScheme: (id: number) => Promise<void>;                // 复制云端方案为新方案（不切换）
    removeScheme: (id: number) => Promise<void>;
    rename: (id: number, name: string) => Promise<void>;
    resolveConflict: (direction: "local" | "cloud") => Promise<void>;
    refreshSchemes: () => Promise<void>;
    /* 脏标与工作台刷新 */
    dirtyHistory: boolean;                                  // 历史记录有未同步到云端方案的改动
    workspaceVersion: number;                               // 变更时 Workspace 需重挂载（替代整页 reload）
    resetPassword: (email: string, regToken: string, newPassword: string) => Promise<void>;
    effectiveCohort: string | null;                         // 解析后的年级（'auto' 已按前缀推断）
}

const AccountContext = createContext<AccountContextValue | null>(null);

export const useAccount = (): AccountContextValue => {
    const ctx = useContext(AccountContext);
    if (!ctx) throw new Error("useAccount must be used within AccountProvider");
    return ctx;
};

export const AccountProvider = ({children}: {children: ReactNode}) => {
    const {locale} = useLocale();
    const zh = locale === "zh";
    // 云方案默认名（新建/兜底/副本命名），按界面语言生成
    const defaultSchemeName = () => (zh ? "默认方案" : "Default plan");
    const [user, setUser] = useState<AccountUser | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [authModalOpen, setAuthModalOpen] = useState(false);

    /* 云端方案状态 */
    const [schemes, setSchemes] = useState<SchemeMeta[]>([]);
    const [currentSchemeId, setCurrentSchemeId] = useState<number | null>(null);
    const [syncState, setSyncState] = useState<SyncState>("off");
    const [lastSyncTs, setLastSyncTs] = useState<number | null>(null);
    const [conflictServerTs, setConflictServerTs] = useState<number | null>(null);
    const [pendingPick, setPendingPick] = useState<PickReason | null>(null);
    const [dirtyHistory, setDirtyHistory] = useState(false);
    const [workspaceVersion, setWorkspaceVersion] = useState(0);

    const lastSyncedSnapshot = useRef<string>(localSnapshot());
    const currentSchemeRef = useRef<number | null>(null);
    currentSchemeRef.current = currentSchemeId;
    const savingRef = useRef(false);
    const baseUpdatedRef = useRef<number>(0); // 当前方案的乐观锁基准版本（服务端 updated_at）

    /* ---- 首次会话探测 ---- */
    useEffect(() => {
        let alive = true;
        fetchMe()
            .then((u) => {
                if (alive) setUser(u);
            })
            .catch(() => undefined)
            .finally(() => {
                if (alive) setAuthReady(true);
            });
        return () => {
            alive = false;
        };
    }, []);

    /* ---- 登录后：加载方案列表并决定绑定方式 ---- */
    const bindAfterLogin = useCallback(async (u: AccountUser) => {
        setUser(u);
        const {schemes: list} = await listSchemes();
        setSchemes(list);
        const storedId = loadCurrentSchemeId();
        const resumed = storedId && list.find((s) => s.id === storedId);
        if (resumed) {
            setCurrentSchemeId(resumed.id);
            const detail = await schemeDetail(resumed.id);
            baseUpdatedRef.current = detail.updated_at;
            lastSyncedSnapshot.current = detail.data === localSnapshot() ? detail.data : localSnapshot();
            setSyncState("idle");
            return;
        }
        if (list.length === 0) {
            // 云端为空 → 本地数据上传为第一套方案
            const snap = localSnapshot();
            const first = zh ? `${u.nickname} 的方案` : `${u.nickname}'s plan`;
            const r = await saveScheme(first, snap);
            setSchemes([{id: r.id, name: first, updated_at: r.updated_at}]);
            setCurrentSchemeId(r.id);
            localStorage.setItem(SCHEME_ID_KEY, String(r.id));
            baseUpdatedRef.current = r.updated_at;
            lastSyncedSnapshot.current = snap;
            setSyncState("saved");
            setLastSyncTs(Date.now());
            return;
        }
        // 云端有方案且本地没有匹配的当前方案 → 让用户选择（弹窗由 SchemeSyncPanel 渲染）
        if (!sessionStorage.getItem(SCHEME_PICK_DISMISS_KEY)) setPendingPick("multiple");
        setSyncState("idle");
    }, []);

    useEffect(() => {
        if (!user) return;
        bindAfterLogin(user).catch(() => setSyncState("error"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.email]);

    /* ---- 自动同步循环：轮询本地快照变化（4s；与本地保存节奏解耦，不侵入 Workspace） ---- */
    useEffect(() => {
        if (!user || !currentSchemeId || pendingPick) return;
        const timer = window.setInterval(async () => {
            if (savingRef.current || conflictServerTs !== null) return;
            const snap = localSnapshot();
            if (snap === lastSyncedSnapshot.current) return;
            savingRef.current = true;
            setSyncState("syncing");
            try {
                const meta = schemes.find((s) => s.id === currentSchemeId);
                const r = await saveScheme(meta?.name ?? defaultSchemeName(), snap, baseUpdatedRef.current);
                lastSyncedSnapshot.current = snap;
                baseUpdatedRef.current = r.updated_at;
                setSyncState("saved");
                setLastSyncTs(Date.now());
                // 更新本地列表里的 updated_at
                setSchemes((prev) => prev.map((s) => (s.id === currentSchemeId ? {...s, updated_at: r.updated_at} : s)));
            } catch (e) {
                if (e instanceof Error && e.message === "conflict") {
                    setSyncState("conflict");
                    const ce = e as Error & {serverUpdatedAt?: number};
                    setConflictServerTs(Number((ce as {serverUpdatedAt?: number}).serverUpdatedAt ?? 0));
                } else {
                    setSyncState("error");
                }
            } finally {
                savingRef.current = false;
            }
        }, 4000);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, currentSchemeId, pendingPick, schemes, lastSyncTs, conflictServerTs]);

    /* ---- 认证动作 ---- */
    const openAuthModal = useCallback(() => setAuthModalOpen(true), []);
    const closeAuthModal = useCallback(() => setAuthModalOpen(false), []);

    const login = useCallback(
        async (email: string, password: string) => {
            await apiLogin(email, password);
            const u = await fetchMe();
            setAuthModalOpen(false);
            sessionStorage.removeItem(SCHEME_PICK_DISMISS_KEY);
            await bindAfterLogin(u);
        },
        [bindAfterLogin],
    );

    const register = useCallback(
        async (email: string, regToken: string, password: string, nickname: string) => {
            const r = await apiRegister(email, regToken, password, nickname);
            const u = await fetchMe();
            setAuthModalOpen(false);
            sessionStorage.removeItem(SCHEME_PICK_DISMISS_KEY);
            // 新注册用户：云端为空 → 走 bindAfterLogin 自动建「第一套方案」
            if (!r) return;
            await bindAfterLogin(u);
        },
        [bindAfterLogin],
    );

    const requestCode = useCallback(async (email: string, captchaId: string, captchaAnswer: string) => {
        const r = await apiRequestCode(email, captchaId, captchaAnswer);
        return {expires_in: r.expires_in, dev_code: r.dev_code};
    }, []);

    const verifyCode = useCallback(async (email: string, code: string) => {
        const r = await apiVerifyCode(email, code);
        return r.reg_token;
    }, []);

    const logout = useCallback(async () => {
        await apiLogout();
        setUser(null);
        setSchemes([]);
        setCurrentSchemeId(null);
        setSyncState("off");
        setLastSyncTs(null);
        setConflictServerTs(null);
        setPendingPick(null);
        baseUpdatedRef.current = 0;
        localStorage.removeItem(SCHEME_ID_KEY);
    }, []);

    const updateProfile = useCallback(
        async (patch: {nickname?: string; cohort?: string}) => {
            const u = await apiUpdateProfile(patch);
            setUser(u);
        },
        [],
    );

    /* ---- 方案操作 ---- */
    const refreshSchemes = useCallback(async () => {
        if (!user) return;
        const {schemes: list} = await listSchemes();
        setSchemes(list);
    }, [user]);

    const EMPTY_SNAPSHOT = JSON.stringify({h: {}, c: {}});

    /** 只读拉取云端方案快照原文（不做任何本地状态切换；供学位评定「导入云端方案」等只读场景） */
    const fetchSchemeData = useCallback(async (id: number): Promise<string | null> => {
        try {
            const detail = await schemeDetail(id);
            return detail.data;
        } catch {
            return null;
        }
    }, []);

    const pickScheme = useCallback(async (id: number) => {
        const detail = await schemeDetail(id);
        const local = localSnapshot();
        // 本地与目标方案不一致：把本地先保回它原来挂的云端方案（best-effort），再应用目标方案
        const prevId = currentSchemeRef.current;
        if (prevId && prevId !== id && local !== lastSyncedSnapshot.current) {
            const meta = schemes.find((s) => s.id === prevId);
            await saveScheme(meta?.name ?? defaultSchemeName(), local, 0).catch(() => undefined);
        }
        applySnapshot(detail.data);
        localStorage.setItem(SCHEME_ID_KEY, String(id));
        setCurrentSchemeId(id);
        baseUpdatedRef.current = detail.updated_at;
        lastSyncedSnapshot.current = detail.data;
        setPendingPick(null);
        sessionStorage.removeItem(SCHEME_PICK_DISMISS_KEY);
        setSyncState("idle");
        setDirtyHistory(false);
        // 工作台 state 在挂载时从 localStorage 初始化 → 仅重挂载工作台（不再整页刷新跳回主页）
        setWorkspaceVersion((v) => v + 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [schemes]);

    /** 新建方案：默认空白（与当前数据无关）；创建后自动切换到它。
     *  切换前把本地未同步改动保回原挂的云端方案（与 pickScheme 同一保护逻辑）。 */
    const createScheme = useCallback(
        async (name: string, data: string = EMPTY_SNAPSHOT) => {
            const prevId = currentSchemeRef.current;
            const local = localSnapshot();
            if (data === EMPTY_SNAPSHOT && prevId && local !== lastSyncedSnapshot.current) {
                const meta = schemes.find((s) => s.id === prevId);
                await saveScheme(meta?.name ?? defaultSchemeName(), local, 0).catch(() => undefined);
            }
            const r = await saveScheme(name, data, 0);
            applySnapshot(data);
            localStorage.setItem(SCHEME_ID_KEY, String(r.id));
            setSchemes((prev) => [{id: r.id, name, updated_at: r.updated_at}, ...prev]);
            setCurrentSchemeId(r.id);
            baseUpdatedRef.current = r.updated_at;
            lastSyncedSnapshot.current = data;
            setSyncState("saved");
            setLastSyncTs(Date.now());
            setPendingPick(null);
            setDirtyHistory(false);
            setWorkspaceVersion((v) => v + 1);
        },
        [schemes],
    );

    /** 复制云端方案为新方案（命名「XX（副本）」，重名自动加序号）；不切换，留在当前方案。 */
    const duplicateScheme = useCallback(
        async (id: number) => {
            const src = schemes.find((s) => s.id === id);
            const detail = await schemeDetail(id);
            const base = src?.name ?? (zh ? "方案" : "Plan");
            let name = zh ? `${base}（副本）` : `${base} (copy)`;
            for (let i = 2; i <= 9; i++) {
                try {
                    const r = await saveScheme(name, detail.data, 0);
                    setSchemes((prev) => [{id: r.id, name, updated_at: r.updated_at}, ...prev]);
                    return;
                } catch (e) {
                    if (e instanceof AccountError && e.detail === "name_taken") {
                        name = zh ? `${base}（副本${i}）` : `${base} (copy ${i})`;
                        continue;
                    }
                    throw e;
                }
            }
            throw new AccountError("name_taken", 409);
        },
        [schemes],
    );

    const removeScheme = useCallback(
        async (id: number) => {
            await apiDeleteScheme(id);
            const next = schemes.filter((s) => s.id !== id);
            setSchemes(next);
            if (currentSchemeId === id) {
                localStorage.removeItem(SCHEME_ID_KEY);
                setCurrentSchemeId(null);
                setSyncState(user && next.length > 0 ? "idle" : "off");
                if (user && next.length > 0) setPendingPick("multiple");
            }
        },
        [schemes, currentSchemeId, user],
    );

    const rename = useCallback(
        async (id: number, name: string) => {
            await apiRenameScheme(id, name);
            setSchemes((prev) => prev.map((s) => (s.id === id ? {...s, name} : s)));
        },
        [],
    );

    const dismissPick = useCallback(() => {
        setPendingPick(null);
        sessionStorage.setItem(SCHEME_PICK_DISMISS_KEY, "1");
    }, []);

    const resolveConflict = useCallback(
        async (direction: "local" | "cloud") => {
            const id = currentSchemeRef.current;
            if (!id) return;
            if (direction === "local") {
                // 用本地覆盖云端（base=0 强推）
                const meta = schemes.find((s) => s.id === id);
                const snap = localSnapshot();
                const r = await saveScheme(meta?.name ?? defaultSchemeName(), snap, 0);
                lastSyncedSnapshot.current = snap;
                baseUpdatedRef.current = r.updated_at;
                setSchemes((prev) => prev.map((s) => (s.id === id ? {...s, updated_at: r.updated_at} : s)));
                setSyncState("saved");
                setLastSyncTs(Date.now());
            } else {
                const detail = await schemeDetail(id);
                applySnapshot(detail.data);
                lastSyncedSnapshot.current = detail.data;
                baseUpdatedRef.current = detail.updated_at;
                setSyncState("saved");
                setWorkspaceVersion((v) => v + 1);
                return;
            }
            setConflictServerTs(null);
        },
        [schemes],
    );

    const currentSchemeName = useMemo(
        () => schemes.find((s) => s.id === currentSchemeId)?.name ?? null,
        [schemes, currentSchemeId],
    );

    /* ---- 脏标：历史记录（oc_history）与云端当前方案快照不一致即视为有未同步改动 ----
     * 轻量轮询（1.5s）读 localStorage 比较，与工作台内部实现完全解耦。 */
    useEffect(() => {
        const timer = window.setInterval(() => {
            try {
                const hist = localStorage.getItem(HISTORY_KEY) ?? "{}";
                let syncedHist: unknown = null;
                try {
                    syncedHist = JSON.parse(lastSyncedSnapshot.current).h;
                } catch {
                    syncedHist = null;
                }
                const same = JSON.stringify(JSON.parse(hist)) === JSON.stringify(syncedHist ?? {});
                setDirtyHistory(!same);
            } catch {
                /* 忽略解析异常 */
            }
        }, 1500);
        return () => window.clearInterval(timer);
    }, []);

    /* ---- 脏标时拦截页面关闭/刷新（浏览器原生提示） ---- */
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (!dirtyHistory) return;
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [dirtyHistory]);

    const resetPassword = useCallback(
        async (email: string, regToken: string, newPassword: string) => {
            await apiResetPassword(email, regToken, newPassword);
            const u = await fetchMe();
            setAuthModalOpen(false);
            sessionStorage.removeItem(SCHEME_PICK_DISMISS_KEY);
            await bindAfterLogin(u);
        },
        [bindAfterLogin],
    );

    const effectiveCohort = useMemo(() => resolveCohort(user), [user]);

    const value = useMemo<AccountContextValue>(
        () => ({
            user, authReady, authModalOpen, openAuthModal, closeAuthModal,
            login, register, requestCode, verifyCode, logout, updateProfile,
            schemes, currentSchemeId, currentSchemeName, syncState, lastSyncTs,
            conflictServerTs, pendingPick, dismissPick, pickScheme, fetchSchemeData, createScheme, duplicateScheme,
            removeScheme, rename, resolveConflict, refreshSchemes,
            dirtyHistory, workspaceVersion, resetPassword, effectiveCohort,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [user, authReady, authModalOpen, schemes, currentSchemeId, currentSchemeName, syncState, lastSyncTs, conflictServerTs, pendingPick, dirtyHistory, workspaceVersion, effectiveCohort],
    );

    return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
};

export {AccountError};
