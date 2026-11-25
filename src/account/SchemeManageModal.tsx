/**
 * 方案管理浮窗（2026-11-14 重构）
 *
 * 由工作台历史记录栏「方案管理」按钮打开，固定尺寸（PC 680×560 / 移动端近全屏底部抽屉）。
 * 内容分两段：
 *   1. 云端方案（区分同步状态）：当前归属 + 列表（切换/重命名/删除）+ 「存当前为方案」
 *   2. 本地备份（靠下对齐）：导出 + 导入（文件选择后在本浮窗内预览并确认合并/覆盖）
 * 颜色规范：蓝底蓝字（推荐 ON 同款）/ 紫底另色字（「已规划」同款）/ 默认灰（「清除」同款）。
 * 首次绑定选择弹窗与乐观锁冲突弹窗也由本组件渲染。
 */

import {useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useAccount, type SyncState} from "./AccountContext";
import {AccountError} from "../api/account";
import {AccountButton} from "./AccountButton";

interface Props {
    open: boolean;
    onClose: () => void;
    onExport: () => void;
    mobile: boolean;
    /* 导入链路（状态与文件句柄由 Workspace 持有，本浮窗内展示） */
    importPreview: string | null;
    hasPending: boolean;
    onPickFile: () => void;
    onConfirmMerge: () => void;
    onConfirmOverwrite: () => void;
    onCancelImport: () => void;
}

const syncLabel = (state: SyncState, lastSyncTs: number | null, zh: boolean): {text: string; tone: "ok" | "warn" | "muted"} => {
    switch (state) {
        case "syncing": return {text: zh ? "云同步中…" : "Syncing…", tone: "ok"};
        case "saved": {
            const t = lastSyncTs ? new Date(lastSyncTs).toLocaleTimeString(zh ? "zh-CN" : "en-US", {hour: "2-digit", minute: "2-digit"}) : "";
            return {text: zh ? `已同步 ${t}` : `Synced ${t}`, tone: "ok"};
        }
        case "conflict": return {text: zh ? "发现冲突" : "Conflict", tone: "warn"};
        case "error": return {text: zh ? "同步失败，将重试" : "Sync failed, retrying", tone: "warn"};
        case "idle": return {text: zh ? "自动同步已开启" : "Auto-sync on", tone: "ok"};
        default: return {text: zh ? "未开启云同步" : "Cloud sync off", tone: "muted"};
    }
};

export const SchemeManageModal = ({open, onClose, onExport, mobile, importPreview, hasPending, onPickFile, onConfirmMerge, onConfirmOverwrite, onCancelImport}: Props) => {
    const {locale} = useLocale();
    const {theme} = useAppTheme();
    const isDark = theme === "dark";
    const {
        user, authReady, schemes, currentSchemeId, currentSchemeName, syncState, lastSyncTs,
        conflictServerTs, pendingPick, dismissPick, pickScheme, createScheme, duplicateScheme, removeScheme, rename,
        resolveConflict, dirtyHistory,
    } = useAccount();
    const zh = locale === "zh";
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
    const [actionErr, setActionErr] = useState("");
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [renameVal, setRenameVal] = useState("");

    const handleCreate = async () => {
        if (!newName.trim() || creating) return;
        setCreating(true);
        setActionErr("");
        try {
            await createScheme(newName.trim());
            setNewName("");
        } catch (e) {
            setActionErr(e instanceof AccountError && e.detail === "name_taken"
                ? (zh ? "方案名已被使用，换一个名字" : "Plan name already in use")
                : (zh ? "创建失败，请重试" : "Failed to create, retry"));
        } finally {
            setCreating(false);
        }
    };

    const handleDuplicate = async (id: number) => {
        if (duplicatingId !== null) return;
        setDuplicatingId(id);
        setActionErr("");
        try {
            await duplicateScheme(id);
        } catch (e) {
            setActionErr(e instanceof AccountError && e.detail === "name_taken"
                ? (zh ? "副本命名冲突，请重试" : "Duplicate name conflict, retry")
                : (zh ? "复制失败，请重试" : "Failed to duplicate, retry"));
        } finally {
            setDuplicatingId(null);
        }
    };

    if (!open || !authReady) return null;

    const st = syncLabel(syncState, lastSyncTs, zh);
    const toneCls = st.tone === "ok"
        ? (isDark ? "text-blue-300" : "text-blue-600")
        : st.tone === "warn"
            ? "text-orange-500"
            : (isDark ? "text-white/40" : "text-gray-400");

    /* 未绑定任何云端方案时的归属说明 */
    const ownership = !user
        ? (zh ? "本地方案（未登录，仅存本机）" : "Local plan (not signed in)")
        : currentSchemeId
            ? `${zh ? "云端方案" : "Cloud"} · ${currentSchemeName ?? ""}`
            : (zh ? "新建方案（尚未保存到云端）" : "New plan (not saved to cloud yet)");

    /* ---------- 移动端：底部抽屉 ---------- */
    if (mobile) {
        return (
            <>
                <div className="fixed inset-0 z-[75] bg-black/50" onClick={onClose} />
                <div
                    className={`fixed inset-x-0 bottom-0 z-[76] flex h-[85vh] flex-col rounded-t-2xl border-t shadow-2xl ${
                        isDark ? "border-white/10 bg-[#1e1e2a]" : "border-gray-200 bg-white"
                    }`}
                >
                    <div className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}}>
                        <span className={`text-sm font-semibold ${isDark ? "text-white/90" : "text-gray-800"}`}>{zh ? "方案管理" : "Manage Plans"}</span>
                        <button onClick={onClose} className={`cursor-pointer border-none bg-transparent text-base leading-none ${isDark ? "text-white/50" : "text-gray-400"}`}>✕</button>
                    </div>
                    <div className="flex-1 overflow-auto p-4">
                        <SchemeBody />
                    </div>
                </div>
                <PickAndConflict />
            </>
        );
    }

    /* ---------- PC：固定尺寸浮窗 ---------- */
    return (
        <>
            <div className="fixed inset-0 z-[75] flex items-center justify-center" style={{background: "rgba(0,0,0,0.45)"}} onClick={onClose}>
                <div
                    className={`flex w-[680px] max-w-[94vw] flex-col rounded-2xl border shadow-2xl ${isDark ? "border-white/10 bg-[#1e1e2a]" : "border-gray-200 bg-white"}`}
                    style={{height: 560, maxHeight: "86vh"}}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}}>
                        <div>
                            <span className={`text-sm font-semibold ${isDark ? "text-white/90" : "text-gray-800"}`}>{zh ? "方案管理" : "Manage Plans"}</span>
                            <span className={`ml-3 text-xs ${toneCls}`}>{st.text}</span>
                        </div>
                        <button onClick={onClose} className={`cursor-pointer border-none bg-transparent text-base leading-none ${isDark ? "text-white/50 hover:text-white" : "text-gray-400 hover:text-gray-700"}`}>✕</button>
                    </div>
                    <div className="flex-1 overflow-auto p-5">
                        <SchemeBody />
                    </div>
                </div>
            </div>
            <PickAndConflict />
        </>
    );

    /* ---------- 内容主体（PC/移动共用；本地备份块 mt-auto 靠下对齐） ---------- */
    function SchemeBody() {
        return (
            <div className="flex h-full min-h-0 flex-col gap-4">
                {/* 归属状态卡 */}
                <div className={`rounded-xl border px-3 py-2.5 ${isDark ? "border-white/10 bg-white/[0.03]" : "border-gray-200 bg-gray-50"}`}>
                    <div className={`text-[10px] uppercase tracking-wide ${isDark ? "text-white/40" : "text-gray-400"}`}>
                        {zh ? "当前归属" : "Current plan"}
                    </div>
                    <div className={`mt-0.5 text-sm font-medium ${isDark ? "text-white/90" : "text-gray-800"}`}>{ownership}</div>
                    <div className={`mt-0.5 flex items-center gap-2 text-[11px] ${toneCls}`}>
                        <span>☁ {st.text}</span>
                        {dirtyHistory && (
                            <span className={isDark ? "text-purple-300" : "text-[#863bff]"}>
                                {zh ? "· 有未保存的改动" : "· unsaved changes"}
                            </span>
                        )}
                    </div>
                </div>

                {/* 云端方案区 */}
                {user ? (
                    <div>
                        <div className={`mb-1.5 text-xs font-semibold ${isDark ? "text-white/70" : "text-gray-600"}`}>
                            {zh ? "云端方案" : "Cloud plans"}
                        </div>
                        <div className="space-y-1">
                            {schemes.length === 0 && (
                                <div className={`rounded-md border px-2 py-2 text-center text-[11px] ${isDark ? "border-white/10 text-white/40" : "border-gray-200 text-gray-400"}`}>
                                    {zh ? "云端还没有方案，把当前工作台「存为方案」即可开始" : "No cloud plans yet — save your workspace as one"}
                                </div>
                            )}
                            {schemes.map((s) => {
                                const active = s.id === currentSchemeId;
                                const renaming = renamingId === s.id;
                                return (
                                    <div key={s.id} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
                                        active
                                            ? isDark ? "border-blue-500/40 bg-blue-500/10" : "border-blue-500/40 bg-blue-500/10"
                                            : isDark ? "border-white/10" : "border-gray-200"
                                    }`}>
                                        {renaming ? (
                                            <>
                                                <input
                                                    autoFocus
                                                    value={renameVal}
                                                    onChange={(e) => setRenameVal(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter" && renameVal.trim()) rename(s.id, renameVal.trim()).then(() => setRenamingId(null));
                                                        if (e.key === "Escape") setRenamingId(null);
                                                    }}
                                                    className={`min-w-0 flex-1 rounded border px-1.5 py-0.5 text-xs outline-none ${
                                                        isDark ? "border-white/10 bg-white/5 text-white/90" : "border-gray-200 bg-white text-gray-800"
                                                    }`}
                                                />
                                                <button
                                                    onClick={() => rename(s.id, renameVal.trim()).then(() => setRenamingId(null))}
                                                    className={`cursor-pointer rounded border px-2 py-0.5 text-[11px] font-medium ${
                                                        isDark ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-blue-500/40 bg-blue-500/10 text-blue-600"
                                                    }`}
                                                >{zh ? "确定" : "OK"}</button>
                                                <button
                                                    onClick={() => setRenamingId(null)}
                                                    className={`cursor-pointer rounded border px-2 py-0.5 text-[11px] ${isDark ? "border-white/10 text-white/50" : "border-gray-200 text-gray-500"}`}
                                                >{zh ? "取消" : "Cancel"}</button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => { if (!active) pickScheme(s.id); }}
                                                    disabled={active}
                                                    className={`min-w-0 flex-1 cursor-pointer border-none bg-transparent text-left text-xs ${
                                                        active
                                                            ? `font-medium ${isDark ? "text-blue-300" : "text-blue-600"}`
                                                            : isDark ? "text-white/80 hover:text-white" : "text-gray-700 hover:text-gray-900"
                                                    }`}
                                                    title={active ? (zh ? "当前方案" : "Current") : (zh ? "切换到此方案（当前数据先自动保存）" : "Switch (current data saved first)")}
                                                >
                                                    <span className="truncate">{s.name}</span>
                                                    {active && <span className={`ml-1.5 text-[9px] ${isDark ? "text-blue-300/70" : "text-blue-600/70"}`}>{zh ? "当前" : "active"}</span>}
                                                </button>
                                                <span className={`shrink-0 text-[9px] ${isDark ? "text-white/30" : "text-gray-400"}`}>
                                                    {new Date(s.updated_at * 1000).toLocaleDateString(zh ? "zh-CN" : "en-US")}
                                                </span>
                                                <button
                                                    onClick={() => handleDuplicate(s.id)}
                                                    disabled={duplicatingId !== null}
                                                    className={`shrink-0 cursor-pointer border-none bg-transparent text-[10px] ${isDark ? "text-white/40 hover:text-white/80" : "text-gray-400 hover:text-gray-700"} ${duplicatingId === s.id ? "opacity-40" : ""}`}
                                                    title={zh ? "复制为新方案（含当前内容）" : "Duplicate as new plan"}
                                                >⧉</button>
                                                <button
                                                    onClick={() => { setRenamingId(s.id); setRenameVal(s.name); }}
                                                    className={`shrink-0 cursor-pointer border-none bg-transparent text-[10px] ${isDark ? "text-white/40 hover:text-white/80" : "text-gray-400 hover:text-gray-700"}`}
                                                    title={zh ? "重命名" : "Rename"}
                                                >✎</button>
                                                <button
                                                    onClick={() => { if (window.confirm(zh ? `确定删除「${s.name}」？云端数据不可恢复。` : `Delete "${s.name}"? Cannot be recovered.`)) removeScheme(s.id); }}
                                                    className={`shrink-0 cursor-pointer border-none bg-transparent text-[10px] ${isDark ? "text-red-400/60 hover:text-red-400" : "text-red-400/70 hover:text-red-500"}`}
                                                    title={zh ? "删除" : "Delete"}
                                                >✕</button>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {/* 新建空白方案 */}
                        <div className="mt-2 flex gap-1.5">
                            <input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                                placeholder={zh ? "新方案名称，如「保研冲刺」（空白开始）" : "New plan name (starts empty)"}
                                className={`min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none ${
                                    isDark ? "border-white/10 bg-white/5 text-white/90 placeholder-white/30" : "border-gray-200 bg-white text-gray-800 placeholder-gray-400"
                                }`}
                            />
                            <button
                                disabled={creating || !newName.trim()}
                                onClick={handleCreate}
                                className={`shrink-0 cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                    isDark ? "border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25" : "border-blue-500/40 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"
                                } ${creating || !newName.trim() ? "opacity-40" : ""}`}
                            >
                                {zh ? "新建空白方案" : "New blank plan"}
                            </button>
                        </div>
                        {actionErr && <div className="mt-1.5 text-[10px] text-red-400">{actionErr}</div>}
                    </div>
                ) : (
                    <div className={`rounded-xl border px-3 py-3 text-xs leading-relaxed ${isDark ? "border-white/10 text-white/50" : "border-gray-200 text-gray-500"}`}>
                        {zh ? "登录后可以把当前方案保存到云端，跨设备同步、多套方案自由切换。" : "Sign in to save plans to the cloud and sync across devices."}
                        <div className="mt-2"><AccountButton compact /></div>
                    </div>
                )}

                {/* 本地备份：导入 / 导出（浮窗内容不足一屏时靠下对齐） */}
                <div className="mt-auto">
                    <div className={`mb-1.5 text-xs font-semibold ${isDark ? "text-white/70" : "text-gray-600"}`}>
                        {zh ? "本地备份（JSON 文件）" : "Local backup (JSON)"}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onExport}
                            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                isDark ? "border-white/10 text-white/70 hover:bg-white/5" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                            }`}
                        >
                            {zh ? "导出到文件" : "Export"}
                        </button>
                        <button
                            onClick={onPickFile}
                            disabled={hasPending}
                            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                isDark ? "border-white/10 text-white/70 hover:bg-white/5" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                            } ${hasPending ? "opacity-40" : ""}`}
                        >
                            {zh ? "从文件导入" : "Import"}
                        </button>
                    </div>
                    {/* 导入预览与确认（选择文件后就地展示，不再跳出旧弹窗） */}
                    {importPreview && (
                        <div className={`mt-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${
                            isDark ? "border-white/10 bg-white/[0.03] text-white/70" : "border-gray-200 bg-gray-50 text-gray-600"
                        }`}>
                            <pre className="whitespace-pre-wrap font-sans">{importPreview}</pre>
                            {hasPending && (
                                <>
                                    <div className={`mt-1 ${isDark ? "text-white/40" : "text-gray-400"}`}>
                                        {zh ? "合并=与现有数据按学期并集；覆盖=以文件内容完全替换。" : "Merge unions by semester; Overwrite replaces everything."}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <button
                                            onClick={onConfirmMerge}
                                            className={`cursor-pointer rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                                                isDark ? "border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25" : "border-blue-500/40 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"
                                            }`}
                                        >
                                            {zh ? "合并导入" : "Merge"}
                                        </button>
                                        <button
                                            onClick={onConfirmOverwrite}
                                            className={`cursor-pointer rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                                                isDark ? "border-white/10 text-white/70 hover:bg-white/5" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                                            }`}
                                        >
                                            {zh ? "覆盖导入" : "Overwrite"}
                                        </button>
                                        <button
                                            onClick={onCancelImport}
                                            className={`cursor-pointer rounded-lg border-none bg-transparent px-2 py-1 text-xs ${isDark ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600"}`}
                                        >
                                            {zh ? "取消" : "Cancel"}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    <div className={`mt-1.5 text-[10px] leading-relaxed ${isDark ? "text-white/35" : "text-gray-400"}`}>
                        {zh
                            ? "导出包含全部学期的历史记录与自定义课程；导入时可选与现有数据合并或覆盖。"
                            : "Export includes all semesters and custom courses; import can merge or overwrite."}
                    </div>
                </div>
            </div>
        );
    }

    /* ---------- 首次绑定选择 + 冲突弹窗（自 SchemeSyncPanel 迁移） ---------- */
    function PickAndConflict() {
        return (
            <>
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
                                    : "Pick a cloud plan to load; current local data will be saved to its own cloud plan first."}
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
                {conflictServerTs !== null && (
                    <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{background: "rgba(0,0,0,0.45)"}}>
                        <div className={`w-[320px] max-w-[92vw] rounded-2xl border p-4 shadow-2xl ${isDark ? "border-white/10 bg-[#1e1e2a]" : "border-gray-200 bg-white"}`}>
                            <div className={`mb-1 text-sm font-semibold ${isDark ? "text-white/90" : "text-gray-800"}`}>
                                {zh ? "云端方案有更新" : "Cloud plan changed"}
                            </div>
                            <div className={`mb-3 text-xs leading-relaxed ${isDark ? "text-white/50" : "text-gray-500"}`}>
                                {zh
                                    ? `这台设备上的数据与云端版本（${new Date(conflictServerTs * 1000).toLocaleString(zh ? "zh-CN" : "en-US")}）不一致，可能是在另一台设备上修改的。保留哪一边？`
                                    : `Local data differs from the cloud version. Which side wins?`}
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
            </>
        );
    }
};
