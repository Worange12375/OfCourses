/**
 * 课程评价页签（ToolsPage "review"）——知乎式布局（用户定稿 2026-11-16 第二轮）：
 * 顶栏不分栏：左侧「课程评价」标题，右侧依次 消息 / 我的评价 / 实名与昵称（与账号系统互通）。
 * 主体双栏（PC 优先）：左栏 = 搜索栏 + 首字母索引 + 推荐评价流（无限滚动）；
 * 右栏 = 「我要评价」（顶置，弹窗发布）+ 热度排行榜（月榜/年榜 前10）+ 规则说明（固定最底）。
 * 先审后显；互动五档（不实用与其余互斥）；举报 ⋯ 行内；筛选页提供取消筛选。
 * 后端：/vote/reviews/init /feed /list /board /mine /messages /react /report、POST /vote/reviews、DELETE /vote/reviews/{id}
 */
import {type ReactNode, useCallback, useEffect, useRef, useState} from "react";
import {useAccount} from "@/account/AccountContext";

export interface ReviewTopic {
    id: number;
    source: string;   // official | custom
    course_id: number | null;
    name: string;
    initial: string;
    review_count: number;
}

export interface ReviewItem {
    id: number;
    topic_id: number;
    content: string;
    sign: string;             // real | nick
    status: string;           // pending | approved | rejected | deleted_user | removed_admin | removed_report
    author_name: string;
    ts: number;
    approved_at: number;
    topic: {id: number; name: string; source: string; course_id: number | null};
    reactions: Record<string, number>;
    mine: string[];
    hot: number;
    own?: boolean;
    reject_note?: string | null;
}

interface RvMsg {
    id: number;
    kind: string;      // system 公告/私信 | event 事件通知
    title: string;
    content: string;
    ts: number;
    read: boolean;
}

const PAGE_SIZE = 20;

const REACTIONS: Array<{key: string; zh: string; en: string; icon: "like" | "useful" | "watch" | "doubt" | "unuseful"}> = [
    {key: "like", zh: "赞", en: "Like", icon: "like"},
    {key: "useful", zh: "实用！", en: "Useful!", icon: "useful"},
    {key: "watch", zh: "观望中", en: "Watching", icon: "watch"},
    {key: "doubt", zh: "真的吗？", en: "Really?", icon: "doubt"},
    {key: "unuseful", zh: "不实用", en: "Not useful", icon: "unuseful"},
];

const ReactionIcon = ({kind}: {kind: typeof REACTIONS[number]["icon"]}) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind === "like" && <><path d="M7 10v11" /><path d="M15 5.9 14 10h5.2a2 2 0 0 1 1.9 2.6l-2.1 6.8a2 2 0 0 1-1.9 1.4H7" /><path d="M7 10 11 3a2 2 0 0 1 3.8.9v2" /><path d="M3 10h4v11H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" /></>}
        {kind === "useful" && <><path d="m12 3 1.8 5.2 5.2 1.8-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></>}
        {kind === "watch" && <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>}
        {kind === "doubt" && <><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.6 1.3c-.7 1-2.2 1.2-2.2 2.7" /><path d="M12 16.5h.01" /></>}
        {kind === "unuseful" && <><path d="M7 14V3" /><path d="m15 18 1-4H10a2 2 0 0 1-1.9-2.6l2.1-6.8A2 2 0 0 1 12.1 3H19" /><path d="M17 14 13 21a2 2 0 0 1-3.8-.9v-2" /><path d="M21 14h-4V3h4a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1Z" /></>}
    </svg>
);

const RULES_ZH =
    "本评价社区初衷是为了让大家能有一个平台，能向大家推荐一下自己上过的好课，帮助后来的同学能有更好的课程选择。" +
    "请大家理性友善，允许有自己的一些主观积极感受，但同时真实客观地呈现课程的情况。" +
    "当然我们也接受大家的一些小吐槽、避雷帖，但请一定注意就事论事，不要人身攻击、泄露他人隐私、影响他人名誉。" +
    "本平台的所有评价都会经过一次人工审核，因此实际发布时间会有所延迟。也欢迎大家与已有评价进行积极互动。希望大家共同维护良好的平台秩序！";
const RULES_EN =
    "This community exists so everyone can recommend courses they have taken and help others choose better. " +
    "Be rational and friendly: subjective positive impressions are welcome, but present courses truthfully and objectively. " +
    "Small rants and warning posts are accepted too — argue the case, never attack individuals, leak privacy, or harm reputations. " +
    "All reviews pass a manual moderation before publication, so posting appears with a delay. Interactions with existing reviews are encouraged. Let's keep the community healthy together!";

const fmtTime = (ts: number): string => {
    const d = new Date(ts * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function rvGet<T>(url: string): Promise<T> {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String((data as {detail?: string}).detail ?? `http_${res.status}`));
    return data as T;
}

async function rvSend<T>(url: string, method: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
        method,
        headers: body !== undefined ? {"Content-Type": "application/json"} : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String((data as {detail?: string}).detail ?? `http_${res.status}`));
    return data as T;
}

export default function CourseReviews({locale, isDark, mobile = false}: {locale: "zh" | "en"; isDark: boolean; mobile?: boolean}) {
    const zh = locale === "zh";
    const mobileLayout = mobile;
    const {user, openAuthModal, updateProfile} = useAccount();

    /* 数据 */
    const [topics, setTopics] = useState<ReviewTopic[]>([]);
    const [letters, setLetters] = useState<string[]>([]);
    const [initReady, setInitReady] = useState(false);

    /* 筛选态：query（搜索）/ letter（首字母）/ activeTopic（进入某条目） */
    const [query, setQuery] = useState("");
    const [letter, setLetter] = useState<string | null>(null);
    const [activeTopic, setActiveTopic] = useState<ReviewTopic | null>(null);

    /* 推荐评价流（左栏主体，无限滚动） */
    const [feed, setFeed] = useState<ReviewItem[]>([]);
    const [feedTotal, setFeedTotal] = useState(0);
    const [feedSort, setFeedSort] = useState<"time" | "hot">("time");
    const [feedLoading, setFeedLoading] = useState(false);

    /* 条目内列表（筛选结果页） */
    const [topicItems, setTopicItems] = useState<ReviewItem[]>([]);
    const [topicTotal, setTopicTotal] = useState(0);
    const [topicSort, setTopicSort] = useState<"time" | "hot">("time");
    const [topicLoading, setTopicLoading] = useState(false);

    /* 热度排行榜（右栏） */
    const [boardPeriod, setBoardPeriod] = useState<"month" | "year">("month");
    const [board, setBoard] = useState<ReviewItem[] | null>(null);
    const [boardLoading, setBoardLoading] = useState(false);
    const boardRequestRef = useRef(0);
    const [boardTickerIndex, setBoardTickerIndex] = useState(0);
    const [boardTickerJump, setBoardTickerJump] = useState(false);

    /* 站内消息 */
    const [msgs, setMsgs] = useState<RvMsg[] | null>(null);
    const [unread, setUnread] = useState(0);
    const [msgLoading, setMsgLoading] = useState(false);
    const [msgError, setMsgError] = useState<string | null>(null);

    /* 弹窗：发布 / 我的评价 */
    const [composeOpen, setComposeOpen] = useState(false);
    const [mine, setMine] = useState<ReviewItem[] | null>(null);
    const [mineLoading, setMineLoading] = useState(false);
    const [mineError, setMineError] = useState<string | null>(null);
    const [detailPanel, setDetailPanel] = useState<"mine" | "messages" | "rules" | null>(null);
    const [detailPanelVisible, setDetailPanelVisible] = useState(false);
    const detailPanelCloseTimer = useRef<number | null>(null);

    const openDetailPanel = (panel: "mine" | "messages" | "rules") => {
        if (detailPanelCloseTimer.current !== null) window.clearTimeout(detailPanelCloseTimer.current);
        setDetailPanel(panel);
        setDetailPanelVisible(false);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => setDetailPanelVisible(true)));
    };
    const closeDetailPanel = () => {
        setDetailPanelVisible(false);
        if (detailPanelCloseTimer.current !== null) window.clearTimeout(detailPanelCloseTimer.current);
        detailPanelCloseTimer.current = window.setTimeout(() => {
            setDetailPanel(null);
            detailPanelCloseTimer.current = null;
        }, 300);
    };
    useEffect(() => () => {
        if (detailPanelCloseTimer.current !== null) window.clearTimeout(detailPanelCloseTimer.current);
    }, []);

    /* 身份面板（实名与昵称） */
    const [idOpen, setIdOpen] = useState(false);
    const [nickInput, setNickInput] = useState("");
    const [nickMsg, setNickMsg] = useState<string | null>(null);
    const [nickSaving, setNickSaving] = useState(false);

    /* 发布表单 */
    const [pickQuery, setPickQuery] = useState("");
    const [picked, setPicked] = useState<{type: "existing"; topic: ReviewTopic} | {type: "new"; name: string} | null>(null);
    const [content, setContent] = useState("");
    const [sign, setSign] = useState<"real" | "nick">("nick");
    const [submitting, setSubmitting] = useState(false);
    const [confirmSubmit, setConfirmSubmit] = useState(false);
    const [confirmCancel, setConfirmCancel] = useState(false);

    /* 举报 / 删除行内操作（⋯ 小浮窗 + 举报弹窗） */
    const [menuFor, setMenuFor] = useState<number | null>(null);
    const [deleteFor, setDeleteFor] = useState<number | null>(null);
    const [reportModal, setReportModal] = useState<{rid: number; name: string} | null>(null);
    const [reportReason, setReportReason] = useState("");
    const [reportSubmitting, setReportSubmitting] = useState(false);
    const [reportModalMsg, setReportModalMsg] = useState<string | null>(null);

    /* 就地提示（无全局浮条）：卡片级 / 发布弹窗内 / 列表加载失败 */
    const [inline, setInline] = useState<{rid: number; text: string; ok: boolean} | null>(null);
    const [formMsg, setFormMsg] = useState<{text: string; ok: boolean} | null>(null);
    const [feedError, setFeedError] = useState<string | null>(null);
    const [topicError, setTopicError] = useState<string | null>(null);
    const inlineToast = useCallback((rid: number, text: string, ok = false) => {
        setInline({rid, text, ok});
        window.setTimeout(() => setInline((cur) => (cur && cur.rid === rid ? null : cur)), 4000);
    }, []);

    /* —— 数据加载 —— */
    const loadInit = useCallback(async () => {
        try {
            const d = await rvGet<{topics: ReviewTopic[]; letters: string[]}>("/vote/reviews/init");
            setTopics(d.topics);
            setLetters(d.letters);
        } catch (e) {
            setFeedError(zh ? `课程条目加载失败：${(e as Error).message}` : `Failed to load topics: ${(e as Error).message}`);
        } finally {
            setInitReady(true);
        }
    }, [zh]);

    const loadFeed = useCallback(async (sort: "time" | "hot", reset = true, offset = 0) => {
        setFeedLoading(true);
        setFeedError(null);
        try {
            const d = await rvGet<{items: ReviewItem[]; total: number}>(`/vote/reviews/feed?sort=${sort}&limit=${PAGE_SIZE}&offset=${offset}`);
            setFeed((prev) => (reset ? d.items : [...prev, ...d.items]));
            setFeedTotal(d.total);
        } catch (e) {
            setFeedError(zh ? `评价流加载失败：${(e as Error).message}` : `Failed to load feed: ${(e as Error).message}`);
        } finally {
            setFeedLoading(false);
        }
    }, [zh]);

    const loadTopic = useCallback(async (id: number, sort: "time" | "hot", reset = true, offset = 0) => {
        setTopicLoading(true);
        setTopicError(null);
        try {
            const d = await rvGet<{items: ReviewItem[]; total: number}>(`/vote/reviews/list?topic_id=${id}&sort=${sort}&limit=${PAGE_SIZE}&offset=${offset}`);
            setTopicItems((prev) => (reset ? d.items : [...prev, ...d.items]));
            setTopicTotal(d.total);
        } catch (e) {
            setTopicError(zh ? `评价加载失败：${(e as Error).message}` : `Failed to load reviews: ${(e as Error).message}`);
        } finally {
            setTopicLoading(false);
        }
    }, [zh]);

    const loadBoard = useCallback(async (period: "month" | "year") => {
        const requestId = ++boardRequestRef.current;
        setBoardLoading(true);
        setBoard(null);
        try {
            const d = await rvGet<{items: ReviewItem[]}>(`/vote/reviews/board?period=${period}`);
            if (requestId === boardRequestRef.current) setBoard(d.items);
        } catch {
            if (requestId === boardRequestRef.current) setBoard(null);
        } finally {
            if (requestId === boardRequestRef.current) setBoardLoading(false);
        }
    }, []);

    const loadMine = useCallback(async () => {
        setMineLoading(true);
        setMineError(null);
        try {
            const d = await rvGet<{items: ReviewItem[]}>("/vote/reviews/mine");
            setMine(d.items);
        } catch (e) {
            setMine(null);
            setMineError((e as Error).message);
        } finally {
            setMineLoading(false);
        }
    }, []);

    const loadMsgs = useCallback(async () => {
        if (!user) { setMsgs(null); setUnread(0); return; }
        setMsgLoading(true);
        setMsgError(null);
        try {
            const d = await rvGet<{items: RvMsg[]; unread: number}>("/vote/reviews/messages");
            setMsgs(d.items);
            setUnread(d.unread);
        } catch (e) {
            setMsgs(null);
            setMsgError((e as Error).message);
        } finally {
            setMsgLoading(false);
        }
    }, [user]);

    useEffect(() => { loadInit(); loadFeed("time"); }, [loadInit, loadFeed]);
    useEffect(() => { loadBoard(boardPeriod); }, [loadBoard, boardPeriod]);
    useEffect(() => {
        const count = Math.min(board?.length ?? 0, 5);
        if (count < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const timer = window.setInterval(() => setBoardTickerIndex((i) => i + 1), 3200);
        return () => window.clearInterval(timer);
    }, [board]);
    useEffect(() => {
        const count = Math.min(board?.length ?? 0, 5);
        if (count < 2 || boardTickerIndex < count) return;
        const timer = window.setTimeout(() => {
            setBoardTickerJump(true);
            setBoardTickerIndex(0);
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => setBoardTickerJump(false)));
        }, 520);
        return () => window.clearTimeout(timer);
    }, [board, boardTickerIndex]);
    useEffect(() => {
        if (user) { loadMine(); loadMsgs(); } else { setMine(null); setMsgs(null); setUnread(0); }
    }, [user, loadMine, loadMsgs]);

    /* 进入条目时加载其列表 */
    useEffect(() => {
        if (activeTopic) loadTopic(activeTopic.id, topicSort);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTopic]);

    /* ⋯ 浮窗：点击外部关闭（业内惯例的轻量菜单行为） */
    useEffect(() => {
        if (menuFor === null) return;
        const onDoc = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (!t.closest("[data-rv-menu]")) setMenuFor(null);
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [menuFor]);

    /* 无限滚动（知乎/B站式翻动更新）：列表底部哨兵进入视口 → 追加下一页 */
    const feedSentinelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = feedSentinelRef.current;
        if (!el) return;
        const ob = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !feedLoading && feed.length < feedTotal) {
                loadFeed(feedSort, false, feed.length);
            }
        }, {rootMargin: "240px"});
        ob.observe(el);
        return () => ob.disconnect();
    }, [feed, feedLoading, feedTotal, feedSort, loadFeed]);

    const topicSentinelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = topicSentinelRef.current;
        if (!el || !activeTopic) return;
        const ob = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !topicLoading && topicItems.length < topicTotal) {
                loadTopic(activeTopic.id, topicSort, false, topicItems.length);
            }
        }, {rootMargin: "240px"});
        ob.observe(el);
        return () => ob.disconnect();
    }, [activeTopic, topicItems, topicLoading, topicTotal, topicSort, loadTopic]);

    /* —— 互动 —— */
    const patchItem = useCallback((id: number, reactions: Record<string, number>, mineArr: string[]) => {
        const patch = (list: ReviewItem[]) => list.map((it) => (it.id === id ? {...it, reactions, mine: mineArr} : it));
        setFeed(patch);
        setTopicItems(patch);
        setBoard((prev) => (prev ? patch(prev) : prev));
        setMine((prev) => (prev ? patch(prev) : prev));
    }, []);

    const toggleReact = useCallback(async (item: ReviewItem, key: string) => {
        if (!user) { openAuthModal(); return; }
        const on = !item.mine.includes(key);
        try {
            const d = await rvSend<{reactions: Record<string, number>; mine: string[]}>("/vote/reviews/react", "POST",
                {review_id: item.id, type: key, on});
            patchItem(item.id, d.reactions, d.mine);
            setInline(null);
        } catch (e) {
            inlineToast(item.id, (e as Error).message);
        }
    }, [user, openAuthModal, patchItem, inlineToast]);

    /* —— 举报（⋯ 浮窗 → 举报弹窗，一人一帖一次） —— */
    const submitReport = useCallback(async () => {
        if (!reportModal) return;
        if (!user) { openAuthModal(); return; }
        setReportSubmitting(true);
        setReportModalMsg(null);
        try {
            await rvSend("/vote/reviews/report", "POST", {review_id: reportModal.rid, reason: reportReason.trim()});
            setReportModal(null);
            setReportReason("");
            inlineToast(reportModal.rid, zh ? "举报已提交，感谢反馈" : "Report submitted. Thank you.", true);
        } catch (e) {
            setReportModalMsg((e as Error).message);
        } finally {
            setReportSubmitting(false);
        }
    }, [user, openAuthModal, reportModal, reportReason, inlineToast, zh]);

    /* —— 删除自己的评价 —— */
    const submitDelete = useCallback(async (reviewId: number) => {
        try {
            await rvSend(`/vote/reviews/${reviewId}`, "DELETE");
            setDeleteFor(null);
            inlineToast(reviewId, zh ? "已删除" : "Deleted", true);
            loadFeed(feedSort);
            if (activeTopic) loadTopic(activeTopic.id, topicSort);
            loadMine();
        } catch (e) {
            inlineToast(reviewId, (e as Error).message);
        }
    }, [feedSort, topicSort, activeTopic, loadFeed, loadTopic, loadMine, inlineToast, zh]);

    /* —— 发布 —— */
    const openCompose = (topic?: ReviewTopic) => {
        if (!user) { openAuthModal(); return; }
        if (topic) { setPicked({type: "existing", topic}); setPickQuery(topic.name); }
        setConfirmSubmit(false);
        setConfirmCancel(false);
        setFormMsg(null);
        setComposeOpen(true);
    };

    const closeCompose = () => {
        setComposeOpen(false);
        setConfirmSubmit(false);
        setConfirmCancel(false);
        setFormMsg(null);
    };

    const doSubmit = useCallback(async () => {
        if (content.trim().length < 5) {
            setFormMsg({text: zh ? "评价内容太短（至少 5 字）" : "Content too short (min 5 chars)", ok: false});
            setConfirmSubmit(false);
            return;
        }
        setSubmitting(true);
        setFormMsg(null);
        try {
            const body = picked?.type === "existing"
                ? {content: content.trim(), topic_id: picked.topic.id, sign}
                : {content: content.trim(), new_name: (picked?.type === "new" ? picked.name : "").trim(), sign};
            const d = await rvSend<{detail: string}>("/vote/reviews", "POST", body);
            setContent("");
            setPicked(null);
            setPickQuery("");
            setConfirmSubmit(false);
            setFormMsg({text: d.detail || (zh ? "已提交，审核通过后展示" : "Submitted for review"), ok: true});
            loadMine();
            loadFeed(feedSort);
        } catch (e) {
            setFormMsg({text: (e as Error).message, ok: false});
            setConfirmSubmit(false);
        } finally {
            setSubmitting(false);
        }
    }, [content, picked, sign, zh, loadMine, loadFeed, feedSort]);

    /* —— 消息已读 —— */
    const markRead = useCallback(async (id: number | null) => {
        try {
            await rvSend("/vote/reviews/messages/read", "POST", id === null ? {} : {id});
            loadMsgs();
        } catch {
            /* 静默 */
        }
    }, [loadMsgs]);

    /* —— 昵称修改（每天一次，后端强制） —— */
    const saveNick = useCallback(async () => {
        setNickSaving(true);
        setNickMsg(null);
        try {
            await updateProfile({nickname: nickInput.trim()});
            setNickMsg(zh ? "已更新" : "Updated");
        } catch (e) {
            const m = (e as Error).message;
            setNickMsg(m === "nickname_daily_limit"
                ? (zh ? "昵称每天只能修改一次，明天再来吧" : "Nickname can be changed once per day")
                : m);
        } finally {
            setNickSaving(false);
        }
    }, [nickInput, updateProfile, zh]);

    const nickLocked = !!user && (Date.now() / 1000 - (user.last_nick_change ?? 0) < 86400);

    /* —— 派生列表 —— */
    const kw = query.trim().toLowerCase();
    const searchedTopics = kw ? topics.filter((t) => t.name.toLowerCase().includes(kw)) : [];
    const letterTopics = !kw && letter
        ? topics.filter((t) => t.initial === letter && t.review_count > 0)
        : [];
    const filterActive = Boolean(activeTopic || kw || letter);

    /* —— 样式令牌 —— */
    const borderCls = isDark ? "border-white/10" : "border-gray-200";
    const textMain = isDark ? "text-gray-100" : "text-gray-800";
    const textSub = isDark ? "text-gray-400" : "text-gray-500";
    const cardBg = isDark ? "bg-white/[0.03]" : "bg-gray-50";
    const inputCls = `w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors ${borderCls} ${
        isDark ? "bg-white/5 text-gray-100 placeholder:text-gray-500 focus:border-blue-400/60" : "bg-white text-gray-800 placeholder:text-gray-400 focus:border-blue-400"
    }`;
    const pillBase = "rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer select-none";
    const pillIdle = `${pillBase} ${borderCls} ${isDark ? "text-gray-300 hover:bg-white/10" : "text-gray-600 hover:bg-gray-100"}`;
    const pillOn = `${pillBase} border-blue-400 bg-blue-500/15 text-blue-500 dark:text-blue-300 font-medium`;
    const btnMain = "cursor-pointer rounded-md border-none bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50";
    const btnGhost = `rounded-md border px-3 py-1.5 text-xs transition-colors ${borderCls} ${
        isDark ? "text-gray-300 hover:bg-white/10" : "text-gray-600 hover:bg-gray-100"
    }`;

    /* —— 评价卡 —— */
    const renderCard = (item: ReviewItem, opts: {showStatus?: boolean} = {}) => (
        <div key={item.id} className={`rounded-lg border p-3 ${borderCls} ${cardBg}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button
                    className={`order-1 max-w-[55%] truncate rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors sm:max-w-[50%] ${borderCls} ${
                        isDark ? "text-blue-300 hover:bg-white/10" : "text-blue-600 hover:bg-blue-50"
                    }`}
                    onClick={() => { setActiveTopic(topics.find((t) => t.id === item.topic_id) ?? (item.topic as unknown as ReviewTopic)); }}
                    title={item.topic.name}
                >
                    {item.topic.name}
                </button>
                <span className={`order-2 min-w-0 flex-1 truncate text-[11px] ${textSub}`}>
                    {item.author_name || (zh ? "同学" : "Student")}
                    {item.sign === "real" ? (zh ? " · 实名" : " · real") : ""}
                </span>
                {user && (
                    <span className={`order-3 shrink-0 ${mobileLayout ? "" : "sm:order-4"}`}>
                        {item.own ? (
                            deleteFor === item.id ? (
                                <span className="flex items-center gap-1">
                                    <button className="text-[11px] text-red-500 hover:underline" onClick={() => submitDelete(item.id)}>
                                        {zh ? "确认删除" : "Confirm"}
                                    </button>
                                    <button className={`text-[11px] ${textSub}`} onClick={() => setDeleteFor(null)}>
                                        {zh ? "取消" : "Cancel"}
                                    </button>
                                </span>
                            ) : (
                                <button className={`text-[11px] hover:underline ${textSub}`} onClick={() => setDeleteFor(item.id)}>
                                    {zh ? "删除" : "Delete"}
                                </button>
                            )
                        ) : (
                            <span className="relative inline-block" data-rv-menu>
                                <button
                                    className={`text-[15px] leading-none ${textSub} hover:opacity-70`}
                                    onClick={() => setMenuFor(menuFor === item.id ? null : item.id)}
                                    title={zh ? "更多" : "More"}
                                >⋯</button>
                                {menuFor === item.id && (
                                    <span className={`absolute right-0 top-5 z-30 block rounded-md border py-1 shadow-lg ${borderCls} ${
                                        isDark ? "bg-gray-900" : "bg-white"
                                    }`}>
                                        <button
                                            className={`block w-full whitespace-nowrap px-3 py-1.5 text-left text-xs hover:bg-blue-500/10 ${
                                                isDark ? "text-gray-200" : "text-gray-700"
                                            }`}
                                            onClick={() => {
                                                setMenuFor(null);
                                                setReportReason("");
                                                setReportModalMsg(null);
                                                setReportModal({rid: item.id, name: item.topic.name});
                                            }}
                                        >
                                            🚩 {zh ? "举报" : "Report"}
                                        </button>
                                    </span>
                                )}
                            </span>
                        )}
                    </span>
                )}
                <span className={`order-4 basis-full text-right text-[10px] ${textSub} ${mobileLayout ? "" : "sm:order-3 sm:basis-auto sm:text-[11px]"}`}>
                    {fmtTime(item.approved_at || item.ts)}
                </span>
            </div>

            {opts.showStatus && (
                <div className="mt-1.5">
                    {item.status === "pending" && (
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${isDark ? "bg-yellow-500/15 text-yellow-300" : "bg-yellow-100 text-yellow-700"}`}>
                            {zh ? "待审核" : "Pending review"}
                        </span>
                    )}
                    {item.status === "rejected" && (
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${isDark ? "bg-red-500/15 text-red-300" : "bg-red-100 text-red-700"}`}>
                            {zh ? "未通过" : "Rejected"}
                            {item.reject_note ? ` · ${item.reject_note}` : ""}
                        </span>
                    )}
                    {item.status !== "approved" && item.status !== "pending" && item.status !== "rejected" && (
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${textSub} ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
                            {zh ? "已删除/下架" : "Removed"}
                        </span>
                    )}
                </div>
            )}

            <p className={`mt-2 whitespace-pre-wrap text-[13px] leading-relaxed ${isDark ? "text-gray-200" : "text-gray-700"}`}>
                {item.content}
            </p>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {REACTIONS.map((r) => {
                    const active = item.mine.includes(r.key);
                    return (
                        <button
                            key={r.key}
                            onClick={() => toggleReact(item, r.key)}
                            aria-label={zh ? r.zh : r.en}
                            aria-pressed={active}
                            className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors ${mobileLayout ? "" : "sm:min-h-0 sm:px-2 sm:py-1 sm:text-[11px]"} ${
                                active
                                    ? "border-blue-400/60 bg-blue-500/10 text-blue-500 dark:text-blue-300 font-medium"
                                    : `${borderCls} ${isDark ? "text-gray-400 hover:border-white/20 hover:bg-white/10" : "text-gray-500 hover:border-gray-300 hover:bg-gray-100"}`
                            }`}
                        >
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${active ? "bg-blue-500/10" : isDark ? "bg-white/5" : "bg-gray-100"}`}>
                                <ReactionIcon kind={r.icon} />
                            </span>
                            <span className="whitespace-nowrap">{zh ? r.zh : r.en}</span>
                            {(item.reactions[r.key] ?? 0) > 0 && <span className="tabular-nums">{item.reactions[r.key]}</span>}
                        </button>
                    );
                })}
            </div>

            {/* 就地提示（互动/举报/删除的结果与错误） */}
            {inline && inline.rid === item.id && (
                <div className={`mt-2 rounded-md border px-2.5 py-1.5 text-[11px] ${borderCls} ${
                    inline.ok
                        ? (isDark ? "bg-green-500/10 text-green-300" : "bg-green-50 text-green-700")
                        : (isDark ? "bg-red-500/10 text-red-300" : "bg-red-50 text-red-700")
                }`}>
                    {inline.text}
                </div>
            )}
        </div>
    );

    /* —— 发布弹窗 —— */
    const renderComposeModal = () => {
        const pickKw = pickQuery.trim().toLowerCase();
        const pickMatches = pickKw ? topics.filter((t) => t.name.toLowerCase().includes(pickKw)).slice(0, 8) : [];
        const normPick = (s: string) => s.toLowerCase().replace(/\s+/g, "");
        const exactHit = pickKw !== "" && topics.some((t) => normPick(t.name) === normPick(pickKw));

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
                 onClick={() => { if (formMsg?.ok) { closeCompose(); return; } if (!confirmSubmit && !confirmCancel) setConfirmCancel(true); }}>
                <div className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border p-4 shadow-2xl ${borderCls} ${
                    isDark ? "bg-gray-900" : "bg-white"
                }`}
                     onClick={(e) => e.stopPropagation()}>
                    <div className="mb-3 flex items-center">
                        <span className={`text-sm font-semibold ${textMain}`}>{zh ? "发表评价" : "Write a review"}</span>
                        <button className={`ml-auto text-lg leading-none ${textSub} hover:opacity-70`}
                                onClick={() => { if (formMsg?.ok) { closeCompose(); return; } if (!confirmSubmit) setConfirmCancel(true); }}
                                title={zh ? "关闭" : "Close"}>✕</button>
                    </div>

                    {confirmCancel ? (
                        <div className="py-6">
                            <p className={`mb-4 text-center text-sm ${textMain}`}>
                                {zh ? "确定要放弃编辑吗？" : "Discard this draft?"}
                            </p>
                            <div className="flex justify-center gap-3">
                                <button className={btnMain} onClick={closeCompose}>{zh ? "放弃" : "Discard"}</button>
                                <button className={btnGhost} onClick={() => setConfirmCancel(false)}>{zh ? "继续编辑" : "Keep editing"}</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* 课程选择 */}
                            <div className="relative">
                                <input
                                    className={inputCls}
                                    value={pickQuery}
                                    onChange={(e) => { setPickQuery(e.target.value); setPicked(null); }}
                                    placeholder={zh ? "这里输入课程名，尽量选择已有课程条目哦！" : "Type a course name here; pick an existing topic if possible!"}
                                />
                                {picked && (
                                    <div className="mt-1.5 flex items-center gap-2">
                                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${borderCls} ${isDark ? "text-blue-300" : "text-blue-600"}`}>
                                            {picked.type === "existing" ? picked.topic.name : `${zh ? "新条目" : "New"}「${picked.name}」`}
                                        </span>
                                        <button className={`text-[11px] ${textSub} hover:underline`}
                                                onClick={() => { setPicked(null); setPickQuery(""); }}>
                                            {zh ? "重选" : "Change"}
                                        </button>
                                    </div>
                                )}
                                {!picked && pickKw && (
                                    <div className={`absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border shadow-lg ${borderCls} ${
                                        isDark ? "bg-gray-900" : "bg-white"
                                    }`}>
                                        {pickMatches.map((t) => (
                                            <button key={t.id}
                                                    className={`block w-full px-3 py-2 text-left text-xs hover:bg-blue-500/10 ${
                                                        isDark ? "text-gray-200" : "text-gray-700"
                                                    }`}
                                                    onClick={() => { setPicked({type: "existing", topic: t}); setPickQuery(t.name); }}>
                                                {t.name}
                                                <span className={`ml-1.5 text-[10px] ${textSub}`}>{t.review_count} {zh ? "条" : "reviews"}</span>
                                            </button>
                                        ))}
                                        {!exactHit && (
                                            <button className={`block w-full px-3 py-2 text-left text-xs hover:bg-blue-500/10 ${
                                                isDark ? "text-gray-300" : "text-gray-600"
                                            }`}
                                                    onClick={() => setPicked({type: "new", name: pickQuery.trim()})}>
                                                {zh ? `创建新条目「${pickQuery.trim()}」` : `Create new topic "${pickQuery.trim()}"`}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 正文 */}
                            <textarea
                                className={`mt-3 ${inputCls} min-h-[110px] resize-y`}
                                value={content}
                                onChange={(e) => setContent(e.target.value.slice(0, 2000))}
                                maxLength={2000}
                                placeholder={zh
                                    ? "可以从考核与签到、给分情况、任务量、授课质量等方面进行评价，友善发言，不能损害他人名誉哦 ~"
                                    : "Cover assessment, grading, workload, teaching quality... Be friendly; no harm to anyone's reputation."}
                            />
                            <div className={`mt-0.5 text-right text-[10px] ${textSub}`}>{content.length}/2000</div>

                            {/* 署名 */}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={`text-[11px] ${textSub}`}>{zh ? "署名" : "Sign as"}</span>
                                {(["real", "nick"] as const).map((s) => (
                                    <button key={s}
                                            className={sign === s ? pillOn : pillIdle}
                                            onClick={() => setSign(s)}>
                                        {s === "real"
                                            ? (zh ? `实名（${user?.prefix ?? "-"}）` : `Real (${user?.prefix ?? "-"})`)
                                            : (zh ? `昵称（${user?.nickname ?? "-"}）` : `Nickname (${user?.nickname ?? "-"})`)}
                                    </button>
                                ))}
                            </div>

                            {/* 社区规范 */}
                            <p className={`mt-2 text-[11px] leading-relaxed ${textSub}`}>
                                {zh
                                    ? "请友善交流：不发布与课程无关的内容、广告引流，不针对具体教师个人发表负面评价（审核不通过将不予展示，驳回意见可在“我的评价”查看）。所有评价审核通过后才会公开。"
                                    : "Be respectful: no off-topic content or ads, no negative remarks targeting specific individuals. All reviews are shown only after approval; rejection reasons appear in \"My reviews\"."}
                            </p>

                            {/* 底部按钮（防呆） */}
                            <div className="mt-3">
                                {formMsg && (
                                    <div className={`mb-2 rounded-md border px-3 py-2 text-xs ${borderCls} ${
                                        formMsg.ok
                                            ? (isDark ? "bg-green-500/10 text-green-300" : "bg-green-50 text-green-700")
                                            : (isDark ? "bg-red-500/10 text-red-300" : "bg-red-50 text-red-700")
                                    }`}>
                                        {formMsg.text}
                                    </div>
                                )}
                                {confirmSubmit ? (
                                    <div className={`rounded-md border p-3 ${borderCls}`}>
                                        <p className={`mb-2 text-center text-sm ${textMain}`}>
                                            {zh ? "确定要提交评价吗？" : "Submit this review?"}
                                        </p>
                                        <div className="flex justify-center gap-3">
                                            <button className={btnMain} disabled={submitting} onClick={doSubmit}>
                                                {submitting ? (zh ? "提交中…" : "Submitting…") : (zh ? "确定提交" : "Confirm")}
                                            </button>
                                            <button className={btnGhost} disabled={submitting} onClick={() => setConfirmSubmit(false)}>
                                                {zh ? "再想想" : "Not yet"}
                                            </button>
                                        </div>
                                    </div>
                                ) : formMsg?.ok ? (
                                    /* 提交成功：就地显示结果，由用户点「完成」关闭 */
                                    <div className="flex justify-center">
                                        <button className={btnMain} onClick={closeCompose}>{zh ? "完成" : "Done"}</button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <button className={btnMain} onClick={() => setConfirmSubmit(true)}>
                                            {zh ? "提交" : "Submit"}
                                        </button>
                                        <button className={btnGhost} onClick={() => setConfirmCancel(true)}>
                                            {zh ? "取消" : "Cancel"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    };

    /* —— 举报弹窗（⋯ 浮窗进入；一人一帖一次，理由可选） —— */
    const renderReportModal = () => (
        reportModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
                 onClick={() => setReportModal(null)}>
                <div className={`w-full max-w-sm rounded-xl border p-4 shadow-2xl ${borderCls} ${
                    isDark ? "bg-gray-900" : "bg-white"
                }`}
                     onClick={(e) => e.stopPropagation()}>
                    <div className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {zh ? "举报这条评价" : "Report this review"}
                    </div>
                    <p className={`mb-3 text-[11px] ${textSub}`}>
                        {zh ? `课程：${reportModal.name} · 举报后由管理员复核处理` : `Topic: ${reportModal.name} · Moderators will review`}
                    </p>
                    <textarea
                        className={`${inputCls} min-h-[72px] resize-y`}
                        value={reportReason}
                        onChange={(e) => setReportReason(e.target.value)}
                        maxLength={500}
                        placeholder={zh ? "举报理由（可选）：如广告引流、无关内容、人身攻击等" : "Reason (optional): ads, off-topic, personal attacks..."}
                    />
                    {reportModalMsg && (
                        <div className={`mt-2 rounded-md border px-2.5 py-1.5 text-[11px] ${borderCls} ${
                            isDark ? "bg-red-500/10 text-red-300" : "bg-red-50 text-red-700"
                        }`}>
                            {reportModalMsg}
                        </div>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                        <button className={btnMain} disabled={reportSubmitting} onClick={submitReport}>
                            {reportSubmitting ? (zh ? "提交中…" : "Submitting…") : (zh ? "提交举报" : "Submit")}
                        </button>
                        <button className={btnGhost} disabled={reportSubmitting}
                                onClick={() => { setReportModal(null); setReportReason(""); setReportModalMsg(null); }}>
                            {zh ? "取消" : "Cancel"}
                        </button>
                        <span className={`ml-auto text-[10px] ${textSub}`}>{reportReason.length}/500</span>
                    </div>
                </div>
            </div>
        )
    );

    /* —— 统一详情抽屉：移动端从底部滑出，桌面端居中弹窗 —— */
    const renderDetailDrawer = (content: ReactNode, label: string) => (
        <div className={`fixed inset-0 z-50 flex ${mobileLayout ? "items-end" : "items-center justify-center px-4 py-6"}`}>
            <button type="button" aria-label={zh ? "关闭详情" : "Close details"}
                    className={`absolute inset-0 bg-black/55 transition-opacity duration-300 ${detailPanelVisible ? "opacity-100" : "opacity-0"}`}
                    onClick={closeDetailPanel} />
            <div role="dialog" aria-modal="true" aria-label={label}
                 className={`relative z-10 flex w-full flex-col overflow-hidden border shadow-2xl transition-all duration-300 ease-out ${
                     mobileLayout
                         ? `max-h-[92dvh] rounded-t-3xl border-b-0 ${detailPanelVisible ? "translate-y-0" : "translate-y-full"}`
                         : `max-h-[86vh] max-w-2xl rounded-2xl ${detailPanelVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.98] opacity-0"}`
                 } ${borderCls} ${isDark ? "bg-gray-900" : "bg-white"}`}>
                {mobileLayout && (
                    <div className={`flex shrink-0 justify-center pt-2.5 ${isDark ? "bg-gray-900" : "bg-white"}`} aria-hidden="true">
                        <span className={`h-1 w-10 rounded-full ${isDark ? "bg-white/20" : "bg-gray-300"}`} />
                    </div>
                )}
                {content}
            </div>
        </div>
    );

    /* —— 我的评价详情 —— */
    const renderMineModal = () => {
        const pending = mine?.filter((it) => it.status === "pending").length ?? 0;
        const published = mine?.filter((it) => it.status === "approved").length ?? 0;
        const needsAttention = mine?.filter((it) => it.status === "rejected").length ?? 0;
        return renderDetailDrawer(
            <>
                <header className={`shrink-0 border-b px-4 pb-4 pt-3 ${borderCls} ${isDark ? "bg-gradient-to-br from-blue-500/15 via-indigo-500/10 to-gray-900" : "bg-gradient-to-br from-blue-50 via-indigo-50 to-white"}`}>
                    <div className="flex items-start gap-3">
                        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isDark ? "bg-blue-400/15 text-blue-200" : "bg-white text-blue-600 shadow-sm"}`}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M4 5v16.5A2.5 2.5 0 0 1 6.5 19H20M8 7h8M8 11h8" />
                            </svg>
                        </span>
                        <div className="min-w-0 flex-1">
                            <span className={`text-[9px] font-bold uppercase tracking-[0.18em] ${isDark ? "text-blue-200/70" : "text-blue-600/70"}`}>{zh ? "课程评价档案" : "COURSE JOURNAL"}</span>
                            <h2 className={`mt-0.5 text-lg font-bold leading-tight ${textMain}`}>{zh ? "我的评价" : "My reviews"}</h2>
                            <p className={`mt-1 text-[11px] ${textSub}`}>{zh ? "查看发布记录与审核进度" : "Your submissions and review status"}</p>
                        </div>
                        <button className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${isDark ? "text-white/60 hover:bg-white/10" : "text-gray-500 hover:bg-black/5"}`}
                                aria-label={zh ? "关闭我的评价" : "Close my reviews"} onClick={closeDetailPanel}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m18 6-12 12M6 6l12 12" /></svg>
                        </button>
                    </div>
                </header>
                <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 ${mobileLayout ? "pb-[calc(1rem+env(safe-area-inset-bottom))]" : ""}`}>
                    {mine && mine.length > 0 && (
                        <>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    {label: zh ? "全部评价" : "All", count: mine.length, tone: isDark ? "bg-white/5" : "bg-gray-50"},
                                    {label: zh ? "已发布" : "Published", count: published, tone: isDark ? "bg-emerald-400/10" : "bg-emerald-50"},
                                    {label: zh ? "审核中" : "Pending", count: pending, tone: isDark ? "bg-amber-400/10" : "bg-amber-50"},
                                ].map((stat) => (
                                    <div key={stat.label} className={`rounded-xl border px-2.5 py-2 ${borderCls} ${stat.tone}`}>
                                        <div className={`text-[10px] ${textSub}`}>{stat.label}</div>
                                        <div className={`mt-0.5 text-lg font-bold tabular-nums ${textMain}`}>{stat.count}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="mb-2 mt-5 flex items-center gap-2">
                                <h3 className={`text-sm font-semibold ${textMain}`}>{zh ? "评价记录" : "Review history"}</h3>
                                {needsAttention > 0 && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-500">{zh ? `${needsAttention} 条需留意` : `${needsAttention} need attention`}</span>}
                                <span className={`ml-auto text-[10px] ${textSub}`}>{zh ? "按时间排列" : "Most recent first"}</span>
                            </div>
                        </>
                    )}
                    {mineLoading && !mine && (
                        <div className={`rounded-2xl border px-4 py-12 text-center ${borderCls} ${cardBg}`}>
                            <span className="mx-auto mb-3 block h-6 w-6 animate-spin rounded-full border-2 border-blue-500/25 border-t-blue-500" />
                            <p className={`text-xs ${textSub}`}>{zh ? "正在整理你的评价记录…" : "Loading your review history…"}</p>
                        </div>
                    )}
                    {mineError && !mine && (
                        <div className={`rounded-2xl border px-4 py-7 text-center ${borderCls} ${cardBg}`}>
                            <p className={`text-sm font-semibold ${textMain}`}>{zh ? "暂时无法加载评价记录" : "Reviews could not be loaded"}</p>
                            <p className={`mt-1 text-xs ${textSub}`}>{zh ? "请检查网络后重试。" : "Check your connection and try again."}</p>
                            <button className={`${btnGhost} mt-3`} onClick={loadMine}>{zh ? "重新加载" : "Retry"}</button>
                        </div>
                    )}
                    {mine && mine.length === 0 && (
                        <div className={`overflow-hidden rounded-2xl border ${borderCls} ${cardBg}`}>
                            <div className={`flex h-24 items-center justify-center ${isDark ? "bg-gradient-to-br from-blue-500/15 to-indigo-500/5" : "bg-gradient-to-br from-blue-100 to-indigo-50"}`}>
                                <span className={`flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm ${isDark ? "bg-gray-900 text-blue-300" : "bg-white text-blue-600"}`}>
                                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M8 8h8M8 12h5" />
                                    </svg>
                                </span>
                            </div>
                            <div className="px-5 py-5 text-center">
                                <p className={`text-sm font-semibold ${textMain}`}>{zh ? "你的评价档案还是空的" : "Your review journal is empty"}</p>
                                <p className={`mx-auto mt-1.5 max-w-xs text-xs leading-relaxed ${textSub}`}>
                                    {zh ? "写下真实的课程体验。发布后可以在这里查看审核进度和评价记录。" : "Share your course experience, then follow its review status here."}
                                </p>
                                <button className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500"
                                        onClick={() => { closeDetailPanel(); window.setTimeout(() => openCompose(), 300); }}>
                                    {zh ? "发表第一条评价" : "Write your first review"}
                                    <span aria-hidden="true">→</span>
                                </button>
                            </div>
                        </div>
                    )}
                    {mine && mine.length > 0 && (
                        <div className="flex flex-col gap-2.5">
                            {mine.map((it) => renderCard(it, {showStatus: true}))}
                        </div>
                    )}
                </div>
            </>, zh ? "我的评价" : "My reviews",
        );
    };

    /* —— 消息详情 —— */
    const renderMessagesModal = () => renderDetailDrawer(
        <>
            <header className={`flex shrink-0 items-center gap-3 border-b px-4 py-3 ${borderCls} ${isDark ? "bg-gradient-to-r from-indigo-500/10 to-transparent" : "bg-gradient-to-r from-indigo-50 to-white"}`}>
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isDark ? "bg-indigo-400/15 text-indigo-200" : "bg-white text-indigo-600 shadow-sm"}`}>
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></svg>
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className={`text-base font-bold ${textMain}`}>{zh ? "消息中心" : "Messages"}</h2>
                    <p className={`mt-0.5 text-[11px] ${textSub}`}>{unread > 0 ? (zh ? `${unread} 条未读消息` : `${unread} unread`) : (zh ? "你已读完所有消息" : "You're all caught up")}</p>
                </div>
                {unread > 0 && <button className={`${btnGhost} shrink-0`} onClick={() => markRead(null)}>{zh ? "全部已读" : "Mark all read"}</button>}
                <button className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${isDark ? "text-white/60 hover:bg-white/10" : "text-gray-500 hover:bg-black/5"}`} aria-label={zh ? "关闭消息" : "Close messages"} onClick={closeDetailPanel}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m18 6-12 12M6 6l12 12" /></svg>
                </button>
            </header>
            <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${mobileLayout ? "pb-[calc(1rem+env(safe-area-inset-bottom))]" : ""}`}>
                {msgLoading && !msgs && <div className={`rounded-2xl border px-4 py-12 text-center text-xs ${borderCls} ${textSub}`}>{zh ? "正在加载消息…" : "Loading messages…"}</div>}
                {msgError && !msgs && (
                    <div className={`rounded-2xl border px-4 py-7 text-center ${borderCls} ${cardBg}`}>
                        <p className={`text-sm font-semibold ${textMain}`}>{zh ? "消息暂时无法加载" : "Messages could not be loaded"}</p>
                        <button className={`${btnGhost} mt-3`} onClick={loadMsgs}>{zh ? "重试" : "Retry"}</button>
                    </div>
                )}
                {msgs && msgs.length === 0 && (
                    <div className={`rounded-2xl border px-5 py-10 text-center ${borderCls} ${cardBg}`}>
                        <span className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${isDark ? "bg-indigo-400/10 text-indigo-300" : "bg-indigo-50 text-indigo-600"}`}>
                            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></svg>
                        </span>
                        <p className={`text-sm font-semibold ${textMain}`}>{zh ? "暂时没有新消息" : "No messages yet"}</p>
                        <p className={`mt-1 text-xs ${textSub}`}>{zh ? "课程评价和账号相关通知会显示在这里。" : "Course review and account updates will appear here."}</p>
                    </div>
                )}
                {msgs && msgs.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                        {msgs.map((m) => (
                            <article key={m.id} className={`rounded-2xl border p-3.5 ${borderCls} ${m.read ? cardBg : isDark ? "bg-blue-500/[0.07]" : "bg-blue-50/70"}`}>
                                <div className="flex items-start gap-2.5">
                                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${m.read ? (isDark ? "bg-white/15" : "bg-gray-300") : "bg-blue-500"}`} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <h3 className={`min-w-0 flex-1 text-sm font-semibold ${textMain}`}>{m.title}</h3>
                                            <span className={`rounded-full px-2 py-0.5 text-[9px] ${isDark ? "bg-white/5 text-white/50" : "bg-white/80 text-gray-500"}`}>{m.kind === "event" ? (zh ? "课程动态" : "Activity") : (zh ? "站内消息" : "Message")}</span>
                                        </div>
                                        <time className={`mt-1 block text-[10px] ${textSub}`}>{fmtTime(m.ts)}</time>
                                        {m.content && <p className={`mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed ${textSub}`}>{m.content}</p>}
                                        {!m.read && <button className={`mt-2 text-[11px] font-medium ${isDark ? "text-blue-300" : "text-blue-600"}`} onClick={() => markRead(m.id)}>{zh ? "标为已读" : "Mark as read"}</button>}
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </div>
        </>, zh ? "消息中心" : "Messages",
    );

    /* —— 规则说明弹窗 —— */
    const renderRulesModal = () => renderDetailDrawer(
        <>
            <header className={`flex shrink-0 items-center gap-3 border-b px-4 py-3 ${borderCls} ${isDark ? "bg-gradient-to-r from-amber-500/10 to-transparent" : "bg-gradient-to-r from-amber-50 to-white"}`}>
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isDark ? "bg-amber-400/15 text-amber-200" : "bg-white text-amber-600 shadow-sm"}`}>
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className={`text-base font-bold ${textMain}`}>{zh ? "课程评价 · 规则说明" : "Course Reviews · Rules"}</h2>
                    <p className={`mt-0.5 text-[11px] ${textSub}`}>{zh ? "发布前请了解社区约定" : "Community guidelines"}</p>
                </div>
                <button className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${isDark ? "text-white/60 hover:bg-white/10" : "text-gray-500 hover:bg-black/5"}`} aria-label={zh ? "关闭规则说明" : "Close rules"} onClick={closeDetailPanel}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m18 6-12 12M6 6l12 12" /></svg>
                </button>
            </header>
            <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${mobileLayout ? "pb-[calc(1rem+env(safe-area-inset-bottom))]" : ""}`}>
                <div className={`rounded-2xl border p-4 ${borderCls} ${cardBg}`}>
                    <div className="mb-3 flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        <span className={`text-xs font-semibold ${textMain}`}>{zh ? "友善交流，真实分享" : "Be kind and share honestly"}</span>
                    </div>
                    <div className={`text-sm leading-7 ${textMain}`}>{renderRulesText()}</div>
                </div>
            </div>
        </>, zh ? "课程评价规则说明" : "Course review rules",
    );

    /* —— 顶栏：标题 + 消息 / 我的评价 / 身份（昵称直接展示，风格对齐 Navbar/AccountButton） —— */
    const navBtn = `cursor-pointer rounded-lg border-none px-2 py-1 text-xs font-medium transition-all duration-200 ${mobileLayout ? "" : "sm:px-3 sm:py-1.5 sm:text-sm"} ${
        isDark ? "text-gray-400 hover:bg-white/10 hover:text-gray-200" : "text-gray-500 hover:bg-[rgba(0,0,0,0.04)] hover:text-gray-700"
    }`;
    const dropPanel = `absolute right-0 top-full z-30 mt-1.5 rounded-xl border p-3 shadow-xl ${borderCls} ${
        isDark ? "bg-gray-900" : "bg-white"
    }`;

    const renderTopBar = () => (
        <div className={`relative mb-3 flex flex-wrap items-center gap-y-2 border-b pb-3 ${mobileLayout ? "" : "sm:mb-4"} ${borderCls}`}>
            <span className={`shrink-0 text-sm font-semibold ${textMain}`}>{zh ? "课程评价" : "Course Reviews"}</span>

            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1 sm:gap-2">
                {/* 消息（铃铛 + 未读角标） */}
                {user && (
                    <button className={`${navBtn} relative`} onClick={() => {
                        loadMsgs();
                        setIdOpen(false);
                        openDetailPanel("messages");
                    }}>
                        <span className="relative inline-flex items-center gap-1">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                            {zh ? "消息" : "Inbox"}
                            {unread > 0 && <span className="absolute -right-3 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">{unread > 99 ? "99+" : unread}</span>}
                        </span>
                    </button>
                )}

                {/* 我的评价 */}
                {user && (
                    <button className={navBtn}
                            onClick={() => { loadMine(); setIdOpen(false); openDetailPanel("mine"); }}>
                        {zh ? "我的评价" : "My reviews"}
                    </button>
                )}

                {/* 身份：直接展示 昵称 + 实名前缀（头像风格同 AccountButton），点击展开设置 */}
                {user ? (
                    <div className="relative">
                        <button
                            onClick={() => { setIdOpen((v) => !v); }}
                            className={`flex cursor-pointer items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 transition-colors ${
                                isDark ? "border-white/15 bg-white/5 hover:bg-white/10" : "border-gray-200 bg-white hover:bg-gray-50"
                            }`}
                        >
                            <span
                                className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                                style={{background: "#863bff"}}
                            >
                                {user.nickname.slice(0, 1).toUpperCase()}
                            </span>
                                <span className={`truncate text-xs font-medium ${mobileLayout ? "max-w-20" : "max-w-20 sm:max-w-24"} ${isDark ? "text-white/85" : "text-gray-700"}`}>
                                {user.nickname}
                            </span>
                            {!mobileLayout && <span className={`hidden max-w-20 truncate text-[10px] sm:inline ${textSub}`}>{user.prefix}</span>}
                            <span className={`text-[8px] leading-none ${textSub}`}>▾</span>
                        </button>
                        {idOpen && (
                            <div className={`${dropPanel} z-40 w-72 max-w-[calc(100vw-2rem)]`}>
                                <div className={`mb-0.5 text-sm font-semibold ${textMain}`}>{user.nickname}</div>
                                <div className={`mb-3 text-[11px] ${textSub}`}>
                                    {zh ? `实名：${user.prefix}（邮箱前缀，不可修改）` : `Real name: ${user.prefix} (email prefix)`}
                                </div>
                                <div className="mb-1">
                                    <span className={`mb-1 block text-[11px] font-medium ${textSub}`}>
                                        {zh ? `昵称（每天最多修改一次${nickLocked ? "，今日已修改" : ""}）` : `Nickname (once per day${nickLocked ? ", changed today" : ""})`}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                        <input
                                            className={inputCls}
                                            value={nickInput}
                                            onChange={(e) => setNickInput(e.target.value)}
                                            maxLength={24}
                                            placeholder={user.nickname}
                                            disabled={nickLocked}
                                        />
                                        <button className={btnMain} disabled={nickSaving || nickLocked || !nickInput.trim()}
                                                onClick={saveNick}>
                                            {zh ? "保存" : "Save"}
                                        </button>
                                    </div>
                                    {nickMsg && (
                                        <div className={`mt-1 text-[11px] ${
                                            nickMsg === "已更新" || nickMsg === "Updated" ? "text-green-500" : "text-red-500"
                                        }`}>{nickMsg}</div>
                                    )}
                                </div>
                                <p className={`mt-2 border-t pt-2 text-[10px] leading-relaxed ${textSub} ${borderCls}`}>
                                    {zh ? "发布评价时可选择以实名或昵称署名；审核时管理员同时可见你的实名与昵称。"
                                        : "Reviews can be signed with your real name or nickname; moderators see both."}
                                </p>
                            </div>
                        )}
                    </div>
                ) : (
                    <button
                        onClick={openAuthModal}
                        className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                            isDark
                                ? "border-[#863bff]/50 bg-[#863bff]/15 text-[#c4a8ff] hover:bg-[#863bff]/25"
                                : "border-[#863bff]/40 bg-[#863bff]/10 text-[#863bff] hover:bg-[#863bff]/20"
                        }`}
                    >
                        {zh ? "登录 / 注册" : "Sign in"}
                    </button>
                )}
            </div>
        </div>
    );

    /* —— 左栏：搜索 + 首字母索引 —— */
    const renderSearchBlock = () => (
        <>
            <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <input
                        className={`${inputCls} pr-10`}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={zh ? "搜索课程名，进入对应评价" : "Search a course to see its reviews"}
                    />
                    <svg className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${textSub}`} width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
                    </svg>
                </div>
                {query && <button className={pillIdle} onClick={() => setQuery("")}>✕</button>}
            </div>

            {/* 搜索结果（课程条目） */}
            {kw && (
                <div className={`rounded-lg border p-2 ${borderCls}`}>
                    <div className={`mb-1 px-1 text-[11px] ${textSub}`}>
                        {zh ? `找到 ${searchedTopics.length} 个课程条目` : `${searchedTopics.length} topic(s)`}
                    </div>
                    {searchedTopics.length === 0 && (
                        <div className={`px-1 py-2 text-xs ${textSub}`}>
                            {zh
                                ? "没有匹配的条目。想评价这门课？点右栏“我要评价”，提交时会自动创建新条目。"
                                : "No match. Use \"Write a review\" on the right; a new topic will be created automatically."}
                        </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                        {searchedTopics.map((t) => (
                            <button key={t.id}
                                    className={`${pillIdle} inline-flex items-center gap-1`}
                                    onClick={() => setActiveTopic(t)}>
                                {t.name}
                                <span className="tabular-nums opacity-70">{t.review_count}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 首字母索引（仅收录评价数 ≥1 的条目） */}
            {!kw && letters.length > 0 && (
                <div className={`rounded-lg border p-3 ${borderCls}`}>
                    <div className={`mb-2 text-[11px] font-medium ${textSub}`}>
                        {zh ? "按首字母快速检索" : "Browse by initial"}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {letters.map((l) => (
                            <button key={l}
                                    className={letter === l ? pillOn : pillIdle}
                                    onClick={() => setLetter(letter === l ? null : l)}>
                                {l}
                            </button>
                        ))}
                    </div>
                    {letter && (
                        <div className={`mt-2 flex flex-wrap gap-1.5 border-t pt-2 ${borderCls}`}>
                            {letterTopics.length === 0 && <span className={`text-xs ${textSub}`}>…</span>}
                            {letterTopics.map((t) => (
                                <button key={t.id}
                                        className={`${pillIdle} inline-flex items-center gap-1`}
                                        onClick={() => setActiveTopic(t)}>
                                    {t.name}
                                    <span className="tabular-nums opacity-70">{t.review_count}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    );

    /* —— 排序 tabs + 刷新 —— */
    // reload 接收目标排序：先 setState 再用旧闭包值会导致「切热门实际加载旧排序」，必须显式传参
    const sortTabs = (sort: "time" | "hot", setSort: (s: "time" | "hot") => void,
                      reload: (s: "time" | "hot") => void, loading: boolean) => (
        <div className="flex items-center gap-2">
            {(["time", "hot"] as const).map((s) => (
                <button key={s}
                        className={sort === s ? pillOn : pillIdle}
                        onClick={() => { setSort(s); reload(s); }}>
                    {s === "time" ? (zh ? "最新" : "Latest") : (zh ? "热门" : "Hot")}
                </button>
            ))}
            <button className={pillIdle} disabled={loading} onClick={() => reload(sort)}>
                ↻ {zh ? "刷新" : "Refresh"}
            </button>
        </div>
    );

    const renderBoardPeriodTabs = () => (
        <div className="ml-auto flex gap-1.5">
            {(["month", "year"] as const).map((p) => (
                <button key={p}
                        className={boardPeriod === p ? pillOn : pillIdle}
                        onClick={() => setBoardPeriod(p)}>
                    {p === "month" ? (zh ? "月榜" : "Month") : (zh ? "年榜" : "Year")}
                </button>
            ))}
        </div>
    );

    const renderBoardItems = () => (boardLoading && !board ? (
        <div className={`py-3 text-center text-[11px] ${textSub}`}>
            {zh ? "排行榜加载中…" : "Loading rankings…"}
        </div>
    ) : !board || board.length === 0 ? (
        <div className={`py-3 text-center text-[11px] ${textSub}`}>
            {zh
                ? `${boardPeriod === "month" ? "近 30 天" : "近一年"}暂无已发布的评价`
                : "No published reviews in this window"}
        </div>
    ) : (
        <ol className="flex flex-col gap-1">
            {board.map((it, i) => (
                <li key={it.id}>
                    <button
                        className={`flex min-h-9 w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors ${mobileLayout ? "" : "sm:min-h-0 sm:py-1"} ${
                            isDark ? "hover:bg-white/5" : "hover:bg-gray-100"
                        }`}
                        onClick={() => setActiveTopic(topics.find((t) => t.id === it.topic_id) ?? (it.topic as unknown as ReviewTopic))}
                    >
                        <span className={`mt-0.5 w-4 shrink-0 text-center text-xs font-semibold ${
                            i < 3 ? "text-orange-500" : textSub
                        }`}>{i + 1}</span>
                        <span className="min-w-0 flex-1">
                            <span className={`block truncate text-xs ${textMain}`}>
                                {it.content.replace(/\s+/g, " ").slice(0, 30)}
                            </span>
                            <span className={`block truncate text-[10px] ${textSub}`}>
                                {it.topic.name} · {it.author_name}
                            </span>
                        </span>
                    </button>
                </li>
            ))}
        </ol>
    ));

    const renderRulesText = () => (
        <p className={`text-[11px] leading-relaxed ${textSub}`}>{zh ? RULES_ZH : RULES_EN}</p>
    );

    const renderBoardTicker = () => {
        if (!board || board.length === 0) {
            return (
                <span className={`block truncate text-[11px] ${textSub}`}>
                    {!board && boardLoading
                        ? (zh ? "排行榜加载中…" : "Loading rankings…")
                        : !board
                            ? (zh ? "排行榜暂时无法加载" : "Rankings unavailable")
                        : (zh ? "暂时还没有评价上榜" : "No reviews ranked yet")}
                </span>
            );
        }
        const items = board.slice(0, 5);
        const tickerIndex = Math.min(boardTickerIndex, items.length);
        return (
            <div role="region" className="h-5 min-w-0 flex-1 overflow-hidden" aria-label={zh ? "热度榜热门评价轮播" : "Rotating popular reviews"} aria-live="off">
                <div className={`will-change-transform ${boardTickerJump ? "transition-none" : "transition-transform duration-500 ease-in-out motion-reduce:transition-none"}`}
                     style={{transform: `translateY(-${tickerIndex * 1.25}rem)`}}>
                    {[...items, items[0]].map((it, i) => (
                        <div key={`${it.id}-${i}`} aria-hidden={i === items.length || undefined} className="flex h-5 min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px]">
                            <span className={`shrink-0 font-bold ${i < 3 ? "text-orange-400" : textSub}`}>#{i + 1}</span>
                            <span className={`shrink-0 font-medium ${textMain}`}>{it.topic.name}</span>
                            <span className={`min-w-0 truncate ${textSub}`}>{it.content.replace(/\s+/g, " ").slice(0, 30)}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderWriteButton = () => mobileLayout ? (
        <button
            className="group flex min-h-[68px] w-full items-center gap-2 rounded-xl border border-blue-300/25 bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2.5 text-left text-white shadow-md shadow-blue-950/15 transition hover:from-blue-500 hover:to-indigo-500 active:scale-[0.99]"
            onClick={() => openCompose(activeTopic ?? undefined)}
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
                </svg>
            </span>
            <span className="min-w-0 flex-1">
                <span className="block whitespace-nowrap text-xs font-semibold">{zh ? "我要评价" : "Write a review"}</span>
                <span className="mt-0.5 block truncate text-[10px] text-blue-100/90">
                    {zh ? "分享课程体验，帮同学选课" : "Share your experience and help others"}
                </span>
            </span>
        </button>
    ) : (
        <button className={`${btnMain} min-h-10 w-full py-2.5 text-sm`} onClick={() => openCompose(activeTopic ?? undefined)}>
            {zh ? "我要评价" : "Write a review"}
        </button>
    );

    const renderRulesButton = () => (
        <button className={`group flex w-full items-center gap-2.5 rounded-xl border px-3 text-left transition-colors ${mobileLayout ? "min-h-[68px]" : "min-h-10 py-2"} ${borderCls} ${
            isDark ? "bg-white/[0.03] hover:bg-white/[0.07]" : "bg-white hover:bg-amber-50"
        }`} onClick={() => { setIdOpen(false); openDetailPanel("rules"); }}>
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isDark ? "bg-amber-400/10 text-amber-300" : "bg-amber-50 text-amber-600"}`}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>
            </span>
            <span className="min-w-0 flex-1">
                <span className={`block truncate text-xs font-semibold ${textMain}`}>{zh ? "规则说明" : "Guidelines"}</span>
                <span className={`mt-0.5 block truncate text-[10px] ${textSub}`}>{zh ? "发布前了解社区约定" : "Before you post"}</span>
            </span>
            <svg className={`shrink-0 transition-transform group-hover:translate-x-0.5 ${textSub}`} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
    );

    const renderEmptyFeed = (topicSpecific = false) => (
        <div className={`rounded-2xl border border-dashed px-5 py-7 text-center ${borderCls} ${cardBg}`}>
            <span className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl ${isDark ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-600"}`}>
                <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
                </svg>
            </span>
            <p className={`text-sm font-semibold ${textMain}`}>
                {topicSpecific
                    ? (zh ? "这门课程还没有评价" : "No reviews for this course yet")
                    : (zh ? "这里还没有已发布的评价" : "No published reviews yet")}
            </p>
            <p className={`mx-auto mt-1.5 max-w-sm text-xs leading-relaxed ${textSub}`}>
                {topicSpecific
                    ? (zh ? "分享你的真实体验，成为第一位帮助同学了解这门课的人。" : "Share your experience and help others learn about this course.")
                    : (zh ? "课程评价通过审核后会显示在这里。你可以写下第一条，为同学选课提供参考。" : "Approved reviews appear here. Share the first one to help others choose courses.")}
            </p>
            {topicSpecific && (
                <button className="mt-4 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
                        onClick={() => openCompose(activeTopic ?? undefined)}>
                    {zh ? "写下第一条" : "Write the first review"}
                    <span aria-hidden="true">→</span>
                </button>
            )}
        </div>
    );

    /* —— PC 右栏 —— */
    const renderRightCol = () => (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
                <div className={filterActive ? "col-span-2" : ""}>{renderWriteButton()}</div>
                {!filterActive && renderRulesButton()}
            </div>

            {/* 热度排行榜（月榜/年榜 前 10） */}
            {!filterActive && (
                <div className={`rounded-lg border p-3 ${borderCls}`}>
                    <div className="mb-2 flex items-center">
                        <span className={`text-xs font-semibold ${textMain}`}>{zh ? "热度排行榜" : "Top rankings"}</span>
                        {renderBoardPeriodTabs()}
                    </div>
                    {renderBoardItems()}
                </div>
            )}
        </div>
    );

    /* —— 移动端快捷操作与折叠辅助信息 —— */
    const renderMobileExtras = () => (
        <div className={`flex flex-col gap-2 ${mobileLayout ? "" : "lg:hidden"}`}>
            <div className="grid grid-cols-2 gap-2">
                <div className={filterActive ? "col-span-2" : ""}>{renderWriteButton()}</div>
                {!filterActive && renderRulesButton()}
            </div>
            {!filterActive && (
                <details className={`overflow-hidden rounded-xl border ${borderCls} ${cardBg}`}>
                        <summary className={`flex cursor-pointer list-none marker:hidden items-center gap-2.5 px-3 py-2.5 ${textMain}`}>
                            <svg className="shrink-0 text-amber-500" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z" /><path d="M7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4" />
                            </svg>
                            <span className="shrink-0 text-xs font-semibold">{zh ? "热度榜" : "Rankings"}</span>
                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ${isDark ? "bg-white/10 text-white/60" : "bg-gray-100 text-gray-500"}`}>
                                {boardPeriod === "month" ? (zh ? "月榜" : "Month") : (zh ? "年榜" : "Year")}
                            </span>
                            {renderBoardTicker()}
                            <svg className={`shrink-0 ${isDark ? "text-white/50" : "text-gray-400"}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m6 9 6 6 6-6" />
                            </svg>
                        </summary>
                        <div className={`border-t p-3 ${borderCls}`}>
                            <div className="mb-2 flex items-center">{renderBoardPeriodTabs()}</div>
                            {renderBoardItems()}
                        </div>
                    </details>
            )}
        </div>
    );

    /* —— 页面主体 —— */
    return (
        <div className="min-w-0">
            {renderTopBar()}

            {/* 顶栏下拉面板打开时的透明遮罩（点击空白收起） */}
            {idOpen && (
                <div className="fixed inset-0 z-20" onClick={() => setIdOpen(false)} />
            )}

            <div className={`grid min-w-0 grid-cols-1 gap-3 ${mobileLayout ? "" : "lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-4"}`}>
                {/* 左栏：内容主体 */}
                <div className="flex min-w-0 flex-col gap-3">
                    {renderMobileExtras()}
                    {activeTopic ? (
                        <>
                            {/* 筛选头 + 取消筛选 */}
                            <div className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 ${borderCls}`}>
                                <span className={`text-xs ${textSub}`}>{zh ? "当前筛选" : "Filter"}</span>
                                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${borderCls} ${textMain}`}>
                                    {activeTopic.name}
                                </span>
                                <button className={`${pillIdle} ml-auto`}
                                        onClick={() => {
                                            setActiveTopic(null);
                                            setQuery("");
                                            setLetter(null);
                                            setTopicItems([]);
                                            setTopicTotal(0);
                                            setTopicError(null);
                                        }}>
                                    ✕ {zh ? "取消筛选" : "Clear filter"}
                                </button>
                            </div>

                            {sortTabs(topicSort, setTopicSort, (s) => loadTopic(activeTopic.id, s), topicLoading)}

                            {topicLoading && topicItems.length === 0 && <div className={`py-6 text-center text-xs ${textSub}`}>…</div>}
                            {topicError && (
                                <div className={`rounded-lg border px-3 py-2 text-xs ${borderCls} ${
                                    isDark ? "bg-red-500/10 text-red-300" : "bg-red-50 text-red-700"
                                }`}>
                                    {topicError}
                                    <button className={`ml-2 underline`} onClick={() => loadTopic(activeTopic.id, topicSort)}>
                                        {zh ? "重试" : "Retry"}
                                    </button>
                                </div>
                            )}
                            {!topicLoading && !topicError && topicItems.length === 0 && (
                                renderEmptyFeed(true)
                            )}
                            <div className="flex flex-col gap-2.5">
                                {topicItems.map((it) => renderCard(it))}
                            </div>
                            <div ref={topicSentinelRef} />
                        </>
                    ) : (
                        <>
                            {renderSearchBlock()}
                            {sortTabs(feedSort, setFeedSort, (s) => loadFeed(s), feedLoading)}
                            {feedLoading && feed.length === 0 && <div className={`py-6 text-center text-xs ${textSub}`}>…</div>}
                            {feedError && (
                                <div className={`rounded-lg border px-3 py-2 text-xs ${borderCls} ${
                                    isDark ? "bg-red-500/10 text-red-300" : "bg-red-50 text-red-700"
                                }`}>
                                    {feedError}
                                    <button className={`ml-2 underline`} onClick={() => loadFeed(feedSort)}>
                                        {zh ? "重试" : "Retry"}
                                    </button>
                                </div>
                            )}
                            {initReady && !feedLoading && !feedError && feed.length === 0 && (
                                renderEmptyFeed()
                            )}
                            <div className="flex flex-col gap-2.5">
                                {feed.map((it) => renderCard(it))}
                            </div>
                            <div ref={feedSentinelRef} />
                        </>
                    )}
                </div>

                {/* 右栏：辅助信息 */}
                <div className={mobileLayout ? "hidden" : "hidden min-w-0 lg:block"}>
                    {renderRightCol()}
                </div>
            </div>

            {/* 弹窗 */}
            {composeOpen && renderComposeModal()}
            {detailPanel === "mine" && renderMineModal()}
            {detailPanel === "messages" && renderMessagesModal()}
            {detailPanel === "rules" && renderRulesModal()}
            {renderReportModal()}
        </div>
    );
}
