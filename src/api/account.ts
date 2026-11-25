/**
 * 账号系统 API 客户端（对接 server/vote/accounts.py）
 * 同源部署：生产 nginx 把 /vote/ 反代到后端，本地 dev 由 vite 代理，cookie 天然同源。
 */

export interface AccountUser {
    email: string;
    prefix: string;
    nickname: string;
    cohort: string;
    created_ts: number;
    last_nick_change?: number;  // 上次昵称修改时间（秒）；昵称每天最多修改一次（后端强制）
}

export interface SchemeMeta {
    id: number;
    name: string;
    updated_at: number;
}

export class AccountError extends Error {
    detail: unknown;       // 后端 detail 原样保留（可能是字符串，也可能是 FastAPI 422 的数组）
    status: number;
    extra: Record<string, unknown>;
    constructor(detail: unknown, status: number, extra: Record<string, unknown> = {}) {
        super(typeof detail === "string" ? detail : "validation_error");
        this.detail = detail;
        this.status = status;
        this.extra = extra;
    }
}

async function req<T = Record<string, unknown>>(url: string, body?: unknown, method = "POST"): Promise<T> {
    let resp: Response;
    try {
        resp = await fetch(url, {
            method,
            headers: body !== undefined ? {"Content-Type": "application/json"} : undefined,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            credentials: "same-origin",
        });
    } catch {
        throw new AccountError("network_error", 0);
    }
    let data: Record<string, unknown> = {};
    try {
        data = await resp.json();
    } catch {
        /* 非 JSON 响应（如 502 HTML）按空对象处理 */
    }
    if (!resp.ok) {
        throw new AccountError(data.detail ?? `http_${resp.status}`, resp.status, data);
    }
    return data as T;
}

/* ---------- 认证 ---------- */
export const requestCode = (email: string, captchaId: string, captchaAnswer: string) =>
    req<{ok: true; expires_in: number; dev_code?: string}>("/vote/account/code", {
        email, captcha_id: captchaId, captcha_answer: captchaAnswer,
    });
export const verifyCode = (email: string, code: string) =>
    req<{ok: true; reg_token: string; expires_in: number}>("/vote/account/verify", {email, code});
export const register = (email: string, regToken: string, password: string, nickname: string) =>
    req<{ok: true; nickname: string}>("/vote/account/register", {email, reg_token: regToken, password, nickname});
export const login = (email: string, password: string) => req<{ok: true}>("/vote/account/login", {email, password});
export const logout = () => req<{ok: true}>("/vote/account/logout", {});
export const fetchMe = () => req<AccountUser>("/vote/account/me", undefined, "GET");
export const updateProfile = (patch: {nickname?: string; cohort?: string}) =>
    req<AccountUser>("/vote/account/profile", patch);
export const resetPassword = (email: string, regToken: string, newPassword: string) =>
    req<{ok: true}>("/vote/account/password/reset", {email, reg_token: regToken, new_password: newPassword});

/* ---------- 云端方案 ---------- */
export const listSchemes = () => req<{schemes: SchemeMeta[]}>("/vote/account/schemes", undefined, "GET");
export const saveScheme = (name: string, data: string, baseUpdatedAt = 0) =>
    req<{ok: true; id: number; updated_at: number}>("/vote/account/schemes/save", {
        name, data, base_updated_at: baseUpdatedAt,
    }).catch((e: unknown) => {
        // 乐观锁冲突：把服务器版本带给调用方
        if (e instanceof AccountError && e.detail === "conflict") {
            throw new SchemeConflict(Number(e.extra.server_updated_at ?? 0));
        }
        throw e;
    });
export class SchemeConflict extends Error {
    serverUpdatedAt: number;
    constructor(serverUpdatedAt: number) {
        super("conflict");
        this.serverUpdatedAt = serverUpdatedAt;
    }
}
export const schemeDetail = (id: number) =>
    req<{id: number; name: string; data: string; updated_at: number}>(`/vote/account/schemes/detail?id=${id}`, undefined, "GET");
export const deleteScheme = (id: number) => req<{ok: true}>("/vote/account/schemes/delete", {id});
export const renameScheme = (id: number, name: string) => req<{ok: true}>("/vote/account/schemes/rename", {id, name});
