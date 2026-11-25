/**
 * 云端方案同步面板（嵌入工作台预选区上方）：
 * - 未登录：一行低调提示「登录后可云端保存方案」
 * - 已登录：当前方案名 + 同步状态 + 方案列表管理（切换/新建/重命名/删除）
 * - 首次绑定选择弹窗（云端有多套方案时）
 * - 乐观锁冲突弹窗（用我的 / 用云端的）
 */

import {useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useAccount} from "./AccountContext";
import {AccountButton} from "./AccountButton";

export const SchemeSyncPanel = () => {
    const {locale} = useLocale();
    const {theme} = useAppTheme();
    const isDark = theme === "dark";
    const {
        user, authReady, schemes, currentSchemeId, currentSchemeName, syncState, lastSyncTs,
        conflictServerTs, pendingPick, dismissPick, pickScheme, createScheme, removeScheme, rename, resolveConflict,
    } = useAccount();
    const zh = locale === "zh";
    const [panelOpen, setPanelOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [renameVal, setRenameVal] = useState("");

    if (!authReady) return null;

    /* ---------- 未登录：一行提示 ---------- */
    if (!user) {
        return (
            <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                isDark ? "border-white/10 bg-white/[0.03] text-white/50" : "border-gray-200 bg-white text-gray-500"
            }`}>
                <span>
                    {zh
                        ? "☁ 云端方案保存：登录后你的选课方案可跨设备同步"
                        : "☁ Cloud sync: sign in to keep your plans across devices"}
                </span>
                <AccountButton compact />
            </div>
        );
    }

    const syncText = (() => {
        if (!currentSchemeId) return zh ? "未选择云端方案" : "No cloud plan selected";
        switch (syncState) {
            case "syncing": return zh ? "同步中…" : "Syncing…";
            case "saved": return lastSyncTs ? (zh ? `已同步 ${new Date(lastSyncTs).toLocaleTimeString(zh ? "zh-CN" : "en-US", {hour: "2-digit", minute: "2-digit"})}` : `Synced ${new Date(lastSyncTs).toLocaleTimeString("en-US", {hour: "2-digit", minute: "2-digit"})}`) : (zh ? "已同步" : "Synced");
            case "conflict": return zh ? "发现同步冲突" : "Sync conflict";
            case "error": return zh ? "同步失败（将自动重试）" : "Sync failed (will retry)";
            default: return zh ? "自动同步已开启" : "Auto-sync on";
        }
    })();
    const syncColor =
        syncState === "conflict" || syncState === "error"
            ? "text-orange-500"
            : syncState === "saved"
                ? "text-emerald-500"
                : isDark ? "text-white/50" : "text-gray-500";

    /* ---------- 已登录 ---------- */
    return (
        <div
            className={`rounded-lg border ${isDark ? "border-white/10 bg-white/[0.03]" : "border-gray-200 bg-white"}`}
        >
            <button
                onClick={() => setPanelOpen((o) => !o)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 border-none bg-transparent px-3 py-1.5 text-left"
            >
                <span className={`flex min-w-0 items-center gap-1.5 text-xs ${isDark ? "text-white/70" : "text-gray-600"}`}>
                    <span className="text-[11px]">☁</span>
                    <span className="truncate font-medium">{currentSchemeName ?? (zh ? "未选择云端方案" : "No cloud plan")}</span>
                    <span className={`shrink-0 text-[10px] ${syncColor}`}>· {syncText}</span>
                </span>
                <span className={`shrink-0 text-[10px] ${isDark ? "text-white/40" : "text-gray-400"}`}>
                    {panelOpen ? "▴" : `▾ ${zh ? "管理" : "Manage"}`}
                </span>
            </button>

            {panelOpen && (
                <div className="border-t px-3 py-2" style={{borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}}>
                    {/* 方案列表 */}
                    <div className="space-y-1">
                        {schemes.length === 0 && (
                            <div className={`py-2 text-center text-[11px] ${isDark ? "text-white/40" : "text-gray-400"}`}>
                                {zh ? "还没有云端方案" : "No cloud plans yet"}
                            </div>
                        )}
                        {schemes.map((s) => {
                            const active = s.id === currentSchemeId;
                            const renaming = renamingId === s.id;
                            return (
                                <div key={s.id} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
                                    active
                                        ? isDark ? "border-[#863bff]/50 bg-[#863bff]/10" : "border-[#863bff]/40 bg-[#863bff]/5"
                                        : isDark ? "border-white/10" : "border-gray-200"
                                }`}>
                                    {renaming ? (
                                        <>
                                            <input
                                                autoFocus
                                                value={renameVal}
                                                onChange={(e) => setRenameVal(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" && renameVal.trim()) {
                                                        rename(s.id, renameVal.trim()).then(() => setRenamingId(null));
                                                    }
                                                    if (e.key === "Escape") setRenamingId(null);
                                                }}
                                                className={`min-w-0 flex-1 rounded border px-1.5 py-0.5 text-xs outline-none ${
                                                    isDark ? "border-white/10 bg-white/5 text-white/90" : "border-gray-200 bg-white text-gray-800"
                                                }`}
                                            />
                                            <button
                                                onClick={() => rename(s.id, renameVal.trim()).then(() => setRenamingId(null))}
                                                className="cursor-pointer border-none bg-transparent text-[11px] text-[#863bff]"
                                            >{zh ? "确定" : "OK"}</button>
                                            <button
                                                onClick={() => setRenamingId(null)}
                                                className={`cursor-pointer border-none bg-transparent text-[11px] ${isDark ? "text-white/40" : "text-gray-400"}`}
                                            >{zh ? "取消" : "Cancel"}</button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => { if (!active) pickScheme(s.id); }}
                                                disabled={active}
                                                className={`min-w-0 flex-1 cursor-pointer border-none bg-transparent text-left text-xs ${
                                                    active
                                                        ? "font-medium text-[#863bff]"
                                                        : isDark ? "text-white/80 hover:text-white" : "text-gray-700 hover:text-gray-900"
                                                }`}
                                                title={active ? (zh ? "当前方案" : "Current plan") : (zh ? "切换到此方案（当前数据会先保存）" : "Switch to this plan")}
                                            >
                                                <span className="truncate">{s.name}</span>
                                                {active && <span className="ml-1 text-[9px]">{zh ? "当前" : "active"}</span>}
                                            </button>
                                            <span className={`shrink-0 text-[9px] ${isDark ? "text-white/30" : "text-gray-400"}`}>
                                                {new Date(s.updated_at * 1000).toLocaleDateString(zh ? "zh-CN" : "en-US")}
                                            </span>
                                            <button
                                                onClick={() => { setRenamingId(s.id); setRenameVal(s.name); }}
                                                className={`shrink-0 cursor-pointer border-none bg-transparent text-[10px] ${isDark ? "text-white/40 hover:text-white/80" : "text-gray-400 hover:text-gray-700"}`}
                                                title={zh ? "重命名" : "Rename"}
                                            >✎</button>
                                            <button
                                                onClick={() => { if (window.confirm(zh ? `确定删除「${s.name}」？云端数据不可恢复。` : `Delete "${s.name}"? Cloud data cannot be recovered.`)) removeScheme(s.id); }}
                                                className={`shrink-0 cursor-pointer border-none bg-transparent text-[10px] ${isDark ? "text-red-400/60 hover:text-red-400" : "text-red-400/70 hover:text-red-500"}`}
                                                title={zh ? "删除" : "Delete"}
                                            >✕</button>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* 新建方案 */}
                    <div className="mt-2 flex gap-1.5">
                        <input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder={zh ? "新方案名称，如「保研冲刺」" : "New plan name"}
                            className={`min-w-0 flex-1 rounded-md border px-2 py-1 text-xs outline-none ${
                                isDark ? "border-white/10 bg-white/5 text-white/90 placeholder-white/30" : "border-gray-200 bg-white text-gray-800 placeholder-gray-400"
                            }`}
                        />
                        <button
                            disabled={creating || !newName.trim()}
                            onClick={() => {
                                setCreating(true);
                                createScheme(newName.trim())
                                    .then(() => setNewName(""))
                                    .finally(() => setCreating(false));
                            }}
                            className={`shrink-0 cursor-pointer rounded-md border-none px-2.5 py-1 text-xs font-medium transition-colors ${
                                isDark ? "bg-[#863bff]/25 text-[#d8c4ff] hover:bg-[#863bff]/40" : "bg-[#863bff]/10 text-[#863bff] hover:bg-[#863bff]/20"
                            } ${creating || !newName.trim() ? "opacity-40" : ""}`}
                        >
                            {zh ? "存为方案" : "Save as plan"}
                        </button>
                    </div>
                    <div className={`mt-1.5 text-[10px] leading-relaxed ${isDark ? "text-white/35" : "text-gray-400"}`}>
                        {zh
                            ? "「存为方案」会把当前工作台的全部数据（历史 + 预选 + 自定义课程）存为一套新方案；切换方案时当前数据会先自动保存。"
                            : "\"Save as plan\" stores your entire workspace (history + staging + custom courses); switching auto-saves current data first."}
                    </div>
                </div>
            )}

            {/* 首次绑定选择弹窗（云端有多套方案） */}
            {pendingPick && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{background: "rgba(0,0,0,0.45)"}} onClick={dismissPick}>
                    <div
                        className={`w-[340px] max-w-[92vw] rounded-2xl border p-4 shadow-2xl ${isDark ? "border-white/10 bg-[#1e1e2a]" : "border-gray-200 bg-white"}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={`mb-1 text-sm font-semibold ${isDark ? "text-white/90" : "text-gray-800"}`}>
                            {zh ? "选择要使用的云端方案" : "Choose a cloud plan"}
                        </div>
                        <div className={`mb-3 text-xs leading-relaxed ${isDark ? "text-white/50" : "text-gray-500"}`}>
                            {zh
                                ? "检测到你的账号下已有云端方案。选择一套加载到本设备；当前本地的数据（若有）会先自动保存到它原来对应的云端方案。"
                                : "Your account has cloud plans. Pick one to load on this device; current local data will be saved to its own cloud plan first."}
                        </div>
                        <div className="mb-3 space-y-1">
                            {schemes.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => pickScheme(s.id)}
                                    className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                                        isDark ? "border-white/10 text-white/80 hover:bg-white/5" : "border-gray-200 text-gray-700 hover:bg-gray-50"
                                    }`}
                                >
                                    <span className="font-medium">{s.name}</span>
                                    <span className={`ml-2 text-[10px] ${isDark ? "text-white/35" : "text-gray-400"}`}>
                                        {new Date(s.updated_at * 1000).toLocaleString(zh ? "zh-CN" : "en-US")}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={dismissPick}
                            className={`w-full cursor-pointer rounded-lg border-none py-1.5 text-xs ${isDark ? "bg-white/5 text-white/60 hover:bg-white/10" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}
                        >
                            {zh ? "暂不选择，继续用本地数据" : "Keep using local data"}
                        </button>
                    </div>
                </div>
            )}

            {/* 冲突弹窗 */}
            {conflictServerTs !== null && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{background: "rgba(0,0,0,0.45)"}}>
                    <div className={`w-[320px] max-w-[92vw] rounded-2xl border p-4 shadow-2xl ${isDark ? "border-white/10 bg-[#1e1e2a]" : "border-gray-200 bg-white"}`}>
                        <div className={`mb-1 text-sm font-semibold ${isDark ? "text-white/90" : "text-gray-800"}`}>
                            {zh ? "云端方案有更新" : "Cloud plan changed"}
                        </div>
                        <div className={`mb-3 text-xs leading-relaxed ${isDark ? "text-white/50" : "text-gray-500"}`}>
                            {zh
                                ? `这台设备上的数据与云端版本（${new Date(conflictServerTs * 1000).toLocaleString(zh ? "zh-CN" : "en-US")}）不一致，可能是在另一台设备上修改的。保留哪一边？`
                                : `Local data differs from the cloud version (${new Date(conflictServerTs * 1000).toLocaleString("en-US")}), possibly edited on another device. Which side wins?`}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => resolveConflict("cloud")}
                                className={`flex-1 cursor-pointer rounded-lg border py-1.5 text-xs transition-colors ${
                                    isDark ? "border-white/10 text-white/80 hover:bg-white/5" : "border-gray-200 text-gray-700 hover:bg-gray-50"
                                }`}
                            >
                                {zh ? "用云端的" : "Use cloud"}
                            </button>
                            <button
                                onClick={() => resolveConflict("local")}
                                className="flex-1 cursor-pointer rounded-lg border-none bg-[#863bff] py-1.5 text-xs font-medium text-white hover:opacity-90"
                            >
                                {zh ? "用本机的" : "Use local"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
