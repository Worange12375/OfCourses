import {createPortal} from "react-dom";
import {useEffect, useMemo, useRef, useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";

// 站内消息（公告）：与投票组件同源约定 —— 生产环境由 nginx 把 /vote 反代到 FastAPI，
// 本地开发（vite）没有后端时静默降级（无红点、面板提示不可用），不阻塞页面。
// 已读判定基于浏览器 localStorage（无账号系统），清除站点数据会重置已读状态。
const API_BASE = "/vote";
const READ_KEY = "oc_read_msgs";
const FRESH_MS = 7 * 24 * 3600 * 1000; // 7 天内视为"新"消息

export interface SiteMessage {
  id: number;
  category: string; // notice = 网站声明 | update = 网站更新
  title: string;
  body: string;
  pinned: boolean;
  ts: number; // 秒级时间戳
}

const loadReadIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(READ_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
};

export const SiteMail = ({variant = "desktop"}: {variant?: "desktop" | "mobile"}) => {
  const {locale} = useLocale();
  const {theme} = useAppTheme();
  const isDark = theme === "dark";
  const zh = locale === "zh";

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SiteMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 新/老用户判定（对用户不可见）：首次打开网页 = 新用户，之后 = 老用户。
  // 判定结果随消息请求发给服务端做受众过滤；拉取成功后才把本设备标记为“已使用过”。
  const [firstOpen] = useState(() => {
    try {
      return !localStorage.getItem("oc_seen");
    } catch {
      return false; // localStorage 不可用时按老用户处理，避免误投新用户邮件
    }
  });

  // 拉取消息列表（失败降级，不报错崩溃）
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/messages?first_open=${firstOpen ? 1 : 0}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!alive) return;
        setMessages(Array.isArray(d?.messages) ? d.messages : []);
        try {
          localStorage.setItem("oc_seen", "1"); // 本次打开已完成，之后视为老用户
        } catch {
          /* 忽略 */
        }
      })
      .catch(() => {
        if (!alive) return;
        setMessages([]);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [firstOpen]);

  // 已读集合持久化到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(READ_KEY, JSON.stringify([...readIds]));
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, [readIds]);

  // 桌面端：点击外部 / Esc 关闭
  useEffect(() => {
    if (!open || variant !== "desktop") return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, variant]);

  const unread = useMemo(
    () => (messages ?? []).filter((m) => !readIds.has(String(m.id))).length,
    [messages, readIds],
  );

  const markRead = (id: number) =>
    setReadIds((prev) => {
      if (prev.has(String(id))) return prev;
      const next = new Set(prev);
      next.add(String(id));
      return next;
    });

  const markAllRead = () => setReadIds(new Set((messages ?? []).map((m) => String(m.id))));

  const toggleOpen = () => {
    setOpen((o) => !o);
    setExpandedId(null);
  };

  const catLabel = (c: string) =>
    c === "update" ? (zh ? "网站更新" : "Update") : zh ? "网站声明" : "Notice";

  const catCls = (c: string) =>
    c === "update"
      ? isDark
        ? "bg-green-500/15 text-green-300"
        : "bg-green-100 text-green-700"
      : isDark
        ? "bg-blue-500/15 text-blue-300"
        : "bg-blue-100 text-blue-700";

  const fmtDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString(zh ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const panelText = isDark ? "text-white/90" : "text-gray-800";
  const panelMuted = isDark ? "text-white/45" : "text-gray-500";
  const panelBg = isDark ? "bg-[#1a1a24] border-white/10" : "bg-white border-gray-200";
  const listMaxH = variant === "desktop" ? "max-h-96" : "max-h-[55vh]";

  const iconBtn = (
    <button
      onClick={toggleOpen}
      aria-label={zh ? "站内消息" : "Messages"}
      title={zh ? "站内消息" : "Messages"}
      className={`relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-none transition-all duration-300 ${
        isDark
          ? "bg-white/10 text-white/80 hover:bg-white/20"
          : "bg-[rgba(0,0,0,0.06)] text-gray-500 hover:bg-[rgba(0,0,0,0.1)]"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-10 6L2 7" />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold leading-none text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );

  const panel = (
    <>
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
        <span className={`text-xs font-semibold ${panelText}`}>
          {zh ? "站内消息" : "Messages"}
          {messages && unread > 0 && (
            <span className={`ml-1.5 font-normal ${panelMuted}`}>
              {zh ? `${unread} 条未读` : `${unread} unread`}
            </span>
          )}
        </span>
        {messages && messages.length > 0 && unread > 0 && (
          <button
            onClick={markAllRead}
            className={`cursor-pointer border-none bg-transparent text-[11px] ${
              isDark ? "text-blue-300 hover:text-blue-200" : "text-blue-600 hover:text-blue-500"
            }`}
          >
            {zh ? "全部已读" : "Mark all read"}
          </button>
        )}
      </div>
      <div className={`overflow-y-auto px-1.5 pb-2 ${listMaxH}`}>
        {messages === null && (
          <div className={`px-2 py-6 text-center text-xs ${panelMuted}`}>
            {zh ? "加载中…" : "Loading…"}
          </div>
        )}
        {messages !== null && messages.length === 0 && (
          <div className={`px-2 py-6 text-center text-xs ${panelMuted}`}>
            {failed ? (zh ? "消息暂时无法加载" : "Messages unavailable") : zh ? "暂无消息" : "No messages"}
          </div>
        )}
        {messages !== null &&
          messages.map((m) => {
            const isUnread = !readIds.has(String(m.id));
            const isFresh = Date.now() - m.ts * 1000 < FRESH_MS;
            const isOpen = expandedId === m.id;
            return (
              <div
                key={m.id}
                className={`mb-1 rounded-lg px-2.5 py-2 transition-colors ${
                  isUnread ? (isDark ? "bg-white/[0.06]" : "bg-blue-50/70") : ""
                }`}
              >
                <button
                  onClick={() => {
                    setExpandedId(isOpen ? null : m.id);
                    markRead(m.id);
                  }}
                  className="flex w-full cursor-pointer items-start justify-between gap-2 border-none bg-transparent p-0 text-left"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${catCls(m.category)}`}>
                      {catLabel(m.category)}
                    </span>
                    {isFresh && (
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${
                          isDark ? "bg-red-500/20 text-red-300" : "bg-red-100 text-red-600"
                        }`}
                      >
                        {zh ? "新" : "NEW"}
                      </span>
                    )}
                    <span className={`truncate text-xs font-medium ${isUnread ? panelText : panelMuted}`}>
                      {m.title}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`text-[10px] ${panelMuted}`}>{fmtDate(m.ts)}</span>
                    {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                  </span>
                </button>
                {isOpen && (
                  <div
                    className={`mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed ${
                      isDark ? "text-white/70" : "text-gray-600"
                    }`}
                  >
                    {m.body}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </>
  );

  if (variant === "mobile") {
    return (
      <>
        {iconBtn}
        {/* 顶栏使用 backdrop-blur，会把内部 fixed 定位困在头部盒子里；
            因此移动端面板必须用 portal 渲染到 body，才能正确铺满全屏 */}
        {open &&
          createPortal(
            <div
              className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
              onClick={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
              }}
            >
              <div
                className={`w-full rounded-t-2xl px-3 pb-[env(safe-area-inset-bottom)] pt-2 ${
                  isDark ? "bg-[#1a1a22] text-white" : "bg-white text-gray-800"
                }`}
              >
                <div
                  className="mx-auto mb-1 mt-1 h-1 w-10 rounded-full"
                  style={{background: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)"}}
                />
                {panel}
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      {iconBtn}
      {open && (
        <div className={`absolute left-0 top-9 z-50 w-80 overflow-hidden rounded-xl border shadow-lg ${panelBg}`}>
          {panel}
        </div>
      )}
    </div>
  );
};
