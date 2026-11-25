/**
 * 导航栏账号入口：未登录显示「登录」按钮；已登录显示昵称 + 下拉
 * （资料设置：昵称/字班；登出）。移动端使用 compact 变体（仅文字按钮）。
 */

import {useEffect, useRef, useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useAccount, detectCohortFromPrefix} from "./AccountContext";

const COHORTS = ["2024", "2025", "2026"] as const;
const COHORT_ZH: Record<string, string> = {"2024": "四", "2025": "五", "2026": "六", "2027": "七"};
// 中文用字班习惯（四字班）；英文按官方数字标注（2024），按钮等紧凑位置天然即缩写
const cohortLabel = (c: string, zh: boolean) => {
    if (!zh) return c;
    const n = COHORT_ZH[c];
    return n ? `${n}字班` : `${c}级`;
};
const NICK_MAX = 10; // 昵称软上限：超过才提示并禁用保存

export const AccountButton = ({compact}: {compact?: boolean}) => {
    const {locale} = useLocale();
    const {theme} = useAppTheme();
    const isDark = theme === "dark";
    const {user, authReady, openAuthModal, logout, updateProfile} = useAccount();
    const [open, setOpen] = useState(false);
    const [nick, setNick] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [confirmCohort, setConfirmCohort] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const zh = locale === "zh";
    const nickTooLong = nick.length > NICK_MAX;
    // 自动年级：cohort='auto' 时按前缀推断出的展示文案（如「自动（四字班）」）
    const autoCohort = user ? detectCohortFromPrefix(user.prefix) : null;
    const autoCohortLabel = autoCohort
        ? zh ? `自动（${cohortLabel(autoCohort, zh)}）` : `Auto (${cohortLabel(autoCohort, zh)})`
        : zh ? "自动识别" : "Auto";

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    useEffect(() => {
        if (user) setNick(user.nickname);
    }, [user?.nickname, user]);

    const saveProfile = async (patch: {nickname?: string; cohort?: string}) => {
        setSaving(true);
        try {
            await updateProfile(patch);
            setSaved(true);
            window.setTimeout(() => setSaved(false), 1500);
        } finally {
            setSaving(false);
        }
    };

    /** 手动切换年级：确认后保存并整页刷新（刷新前记录滚动位置，入口处恢复，保持用户所在页面位置） */
    const switchCohort = async (c: string) => {
        setConfirmCohort(null);
        try {
            sessionStorage.setItem("oc_scroll_restore", String(window.scrollY));
        } catch { /* 隐私模式等场景忽略 */ }
        await saveProfile({cohort: c});
        window.location.reload();
    };

    if (!authReady) return null;

    if (!user) {
        return (
            <button
                onClick={openAuthModal}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isDark
                        ? "border-[#863bff]/50 bg-[#863bff]/15 text-[#c4a8ff] hover:bg-[#863bff]/25"
                        : "border-[#863bff]/40 bg-[#863bff]/10 text-[#863bff] hover:bg-[#863bff]/20"
                }`}
            >
                {compact ? (zh ? "登录" : "Sign in") : (zh ? "登录 / 注册" : "Sign in")}
            </button>
        );
    }

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((o) => !o)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 transition-colors ${
                    isDark ? "border-white/15 bg-white/5 hover:bg-white/10" : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
            >
                <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{background: "#863bff"}}
                >
                    {user.prefix.slice(0, 1).toUpperCase()}
                </span>
                <span className={`max-w-24 truncate text-xs font-medium ${isDark ? "text-white/85" : "text-gray-700"}`}>
                    {user.prefix}
                </span>
                <span className={`text-[8px] leading-none ${isDark ? "text-white/40" : "text-gray-400"}`}>▾</span>
            </button>
            {open && (
                <div
                    className={`absolute right-0 top-full z-[70] mt-1.5 w-64 rounded-xl border p-3 shadow-xl ${
                        isDark ? "border-white/10 bg-[#1e1e2a]" : "border-gray-200 bg-white"
                    }`}
                >
                    <div className={`mb-0.5 text-sm font-semibold ${isDark ? "text-white/90" : "text-gray-800"}`}>{user.prefix}</div>
                    <div className={`mb-3 text-[11px] ${isDark ? "text-white/40" : "text-gray-400"}`}>
                        {zh ? "邮箱仅用于登录验证，不会公开展示" : "Email is private, used for sign-in only"}
                    </div>

                    {/* 昵称（社交场景显示；隐式上限 10 字，超出才提示并禁用保存） */}
                    <div className="mb-2">
                        <span className={`mb-1 block text-[11px] font-medium ${isDark ? "text-white/60" : "text-gray-500"}`}>
                            {zh ? "昵称" : "Nickname"}
                        </span>
                        <div className="flex gap-1.5">
                            <input
                                value={nick}
                                onChange={(e) => setNick(e.target.value)}
                                className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs outline-none ${
                                    nickTooLong
                                        ? "border-red-400/70"
                                        : isDark ? "border-white/10 bg-white/5 text-white/90" : "border-gray-200 bg-white text-gray-800"
                                }`}
                            />
                            <button
                                onClick={() => saveProfile({nickname: nick})}
                                disabled={saving || nickTooLong || nick === user.nickname}
                                className={`cursor-pointer rounded-lg border-none px-2.5 text-xs font-medium transition-colors ${
                                    isDark ? "bg-[#863bff]/30 text-[#d8c4ff] hover:bg-[#863bff]/45" : "bg-[#863bff]/10 text-[#863bff] hover:bg-[#863bff]/20"
                                } ${saving || nickTooLong || nick === user.nickname ? "opacity-40" : ""}`}
                            >
                                {zh ? "保存" : "Save"}
                            </button>
                        </div>
                        {nickTooLong && (
                            <div className="mt-1 text-[10px] text-red-400">
                                {zh ? `昵称最多 ${NICK_MAX} 个字符` : `Max ${NICK_MAX} characters`}
                            </div>
                        )}
                    </div>

                    {/* 年级：自动（按邮箱前缀推断，前缀尾数无年级时等效不设）+ 手动字班 */}
                    <div className="mb-2">
                        <span className={`mb-1 block text-[11px] font-medium ${isDark ? "text-white/60" : "text-gray-500"}`}>
                            {zh ? "年级" : "Cohort"}
                        </span>
                        <button
                            onClick={() => saveProfile({cohort: "auto"})}
                            className={`mb-1 w-full cursor-pointer rounded-md border px-1 py-1 text-[11px] transition-colors ${
                                user.cohort === "auto"
                                    ? "border-[#863bff]/60 bg-[#863bff]/15 text-[#863bff] font-medium"
                                    : isDark
                                        ? "border-white/10 text-white/60 hover:bg-white/5"
                                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                            }`}
                        >
                            {autoCohortLabel}
                        </button>
                        <div className="flex gap-1">
                            {COHORTS.map((c) => (
                                <button
                                    key={c}
                                    onClick={() => {
                                        if (user.cohort !== c) setConfirmCohort(c);
                                    }}
                                    className={`flex-1 cursor-pointer rounded-md border px-1 py-1 text-[11px] transition-colors ${
                                        user.cohort === c
                                            ? "border-[#863bff]/60 bg-[#863bff]/15 text-[#863bff] font-medium"
                                            : isDark
                                                ? "border-white/10 text-white/60 hover:bg-white/5"
                                                : "border-gray-200 text-gray-600 hover:bg-gray-50"
                                    }`}
                                >
                                    {cohortLabel(c, zh)}
                                </button>
                            ))}
                        </div>
                        {confirmCohort && (
                            <div className={`mt-1.5 rounded-lg border p-2 ${
                                isDark ? "border-[#863bff]/40 bg-[#863bff]/10" : "border-[#863bff]/30 bg-[#863bff]/5"
                            }`}>
                                <div className={`text-[11px] ${isDark ? "text-white/80" : "text-gray-700"}`}>
                                    {zh
                                        ? `切换到 ${cohortLabel(confirmCohort, zh)}培养方案？页面将刷新以加载新方案。`
                                        : `Switch to the ${cohortLabel(confirmCohort, false)} cohort scheme? The page will reload.`}
                                </div>
                                <div className="mt-1.5 flex gap-1.5">
                                    <button
                                        onClick={() => switchCohort(confirmCohort)}
                                        className="cursor-pointer rounded-md border-none bg-[#863bff] px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
                                    >
                                        {zh ? "确认切换" : "Confirm"}
                                    </button>
                                    <button
                                        onClick={() => setConfirmCohort(null)}
                                        className={`cursor-pointer rounded-md border px-2.5 py-1 text-[11px] ${
                                            isDark ? "border-white/15 text-white/60 hover:bg-white/5" : "border-gray-200 text-gray-500 hover:bg-gray-50"
                                        }`}
                                    >
                                        {zh ? "取消" : "Cancel"}
                                    </button>
                                </div>
                            </div>
                        )}
                        {saved && (
                            <div className="mt-1 text-[10px] text-emerald-500">{zh ? "已保存 ✓" : "Saved ✓"}</div>
                        )}
                    </div>

                    <button
                        onClick={() => { logout(); setOpen(false); }}
                        className={`w-full cursor-pointer rounded-lg border-none px-2 py-1.5 text-xs transition-colors ${
                            isDark ? "bg-white/5 text-white/60 hover:bg-white/10" : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                        }`}
                    >
                        {zh ? "退出登录" : "Sign out"}
                    </button>
                </div>
            )}
        </div>
    );
};
