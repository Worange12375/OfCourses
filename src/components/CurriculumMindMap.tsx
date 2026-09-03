import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import structuredData from "@/data/structured_data.json";
import {useAppTheme} from "../theme/ThemeContext";
import {PERF_MAX, MIN_MAX, USER_MAX_DEFAULT, MAIN_SCHEME_COURSES, buildSearchIndex, searchTargets, expandWithAncestors} from "./mindmapShared";
import type {SearchScope, SearchHit, SearchTarget} from "./mindmapShared";
import {SearchScopeSelect} from "./SearchScopeSelect";

/* ============ 常量（与树状图共用，PERF_MAX 由共享层动态给出） ============ */
const STORAGE_KEY = "oc_mindmap_v1";

/* ============ 数据形态 ============ */
interface RawCourse {
    course_id: string;
    name: string;
    credits: number | null;
    module_type: string | null;
}
interface RawModule {
    module_id: number;
    name: string;
    description: string | null;
}
interface RawGroup {
    group_id: number;
    module_id: number | null;
    group_code: string;
    name: string;
}
interface RawGroupCourses {
    group_id: number;
    course_ids: string[];
}
interface RawData {
    courses: RawCourse[];
    modules: RawModule[];
    course_groups: RawGroup[];
    group_courses: RawGroupCourses[];
}
const data = structuredData as unknown as RawData;

type Level = "module" | "basis" | "group" | "course" | "custom";
interface TreeNode {
    id: string;
    label: string;
    sub?: string;
    level: Level;
    childIds: string[];
    courseCount?: number;
    groupCredits?: number; // 仅 group 级：组内课程总学分（与「学位评定」同口径）
    classTag?: string;
    courseId?: string; // 仅 course 级
    ancestors: string[]; // 自根到父（不含自身），用于可见性判定
}

function classTagOf(moduleId: number): string {
    if (moduleId >= 1 && moduleId <= 3) return "Ⅰ类";
    if (moduleId >= 4 && moduleId <= 8) return "Ⅱ类";
    if (moduleId >= 9 && moduleId <= 13) return "Ⅲ类";
    return "";
}

/* 树在组件内部构建（见下方组件中的 useMemo），不可在模块顶层调用 Hook */

/* ============ 持久化 ============ */
interface Persist {
    expanded: string[];
    pinned: string[];
    userMax: number;
}
function loadPersist(): Persist {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {expanded: [], pinned: [], userMax: USER_MAX_DEFAULT};
        const p = JSON.parse(raw);
        return {
            expanded: Array.isArray(p.expanded) ? p.expanded.filter((x: unknown) => typeof x === "string") : [],
            pinned: Array.isArray(p.pinned) ? p.pinned.filter((x: unknown) => typeof x === "string") : [],
            userMax: typeof p.userMax === "number" ? Math.min(PERF_MAX, Math.max(MIN_MAX, p.userMax)) : USER_MAX_DEFAULT,
        };
    } catch {
        return {expanded: [], pinned: [], userMax: USER_MAX_DEFAULT};
    }
}

export const CurriculumMindMap = () => {
    const {theme} = useAppTheme();
    const isDark = theme === "dark";

    /* ============ 构建树（一次，模块级聚合；课程级用路径独立节点，跨组重复各自独立） ============ */
    const {nodes, rootChildren, allCourseMeta, courseGroupCount} = useMemo(() => {
        const courseById = new Map<string, RawCourse>(data.courses.map((c) => [c.course_id, c]));
        const groupCoursesMap = new Map<number, string[]>(data.group_courses.map((g) => [g.group_id, g.course_ids]));
        const courseGroupCount = new Map<string, number>();
        data.group_courses.forEach((g) => {
            g.course_ids.forEach((cid) => courseGroupCount.set(cid, (courseGroupCount.get(cid) ?? 0) + 1));
        });

        // 课组总学分：与「学位评定」totalCreditsInGroup 同口径——组内课程按 course_id 去重后学分求和
        const groupCredits = new Map<number, number>();
        data.group_courses.forEach((g) => {
            let sum = 0;
            new Set(g.course_ids).forEach((cid) => (sum += courseById.get(cid)?.credits ?? 0));
            groupCredits.set(g.group_id, Number(sum.toFixed(1)));
        });

        const nodes = new Map<string, TreeNode>();
        const allCourseMeta: {id: string; ancestors: string[]}[] = [];
        const rootChildren: string[] = [];

        const addCourse = (parentId: string, courseId: string, ancestors: string[]): string => {
            const c = courseById.get(courseId);
            const cid = `${parentId}-c${courseId}`;
            nodes.set(cid, {
                id: cid,
                label: c?.name ?? courseId,
                sub: c?.credits != null ? `${c.credits} 学分` : undefined,
                level: "course",
                childIds: [],
                courseId,
                ancestors,
            });
            allCourseMeta.push({id: cid, ancestors});
            return cid;
        };
        const addGroup = (parentId: string, g: RawGroup, ancestors: string[]): string => {
            const gid = `${parentId}-g${g.group_id}`;
            const courseIds = groupCoursesMap.get(g.group_id) ?? [];
            const childIds = courseIds.map((cid) => addCourse(gid, cid, [...ancestors, gid]));
            const credits = groupCredits.get(g.group_id) ?? 0;
            nodes.set(gid, {
                id: gid,
                label: g.name,
                sub: `${courseIds.length} 门 · 共 ${credits} 学分`,
                level: "group",
                childIds,
                courseCount: courseIds.length,
                groupCredits: credits,
                ancestors,
            });
            return gid;
        };

        // 13 个正式模块（各 2 课组）
        data.modules
            .filter((m) => m.module_id !== 14)
            .forEach((m) => {
                const mid = `m${m.module_id}`;
                const groups = data.course_groups.filter((g) => g.module_id === m.module_id);
                const childIds = groups.map((g) => addGroup(mid, g, [mid]));
                nodes.set(mid, {
                    id: mid,
                    label: `模块${m.module_id} · ${m.name}`,
                    sub: `${groups.length} 课组`,
                    level: "module",
                    childIds,
                    classTag: classTagOf(m.module_id),
                    ancestors: [],
                });
                rootChildren.push(mid);
            });

        // 基础/通识课组（module_id === null）
        const basisGroups = data.course_groups.filter((g) => g.module_id === null);
        if (basisGroups.length) {
            const bid = "basis";
            const childIds = basisGroups.map((g) => addGroup(bid, g, [bid]));
            nodes.set(bid, {id: bid, label: "基础与通识", sub: `${basisGroups.length} 课组`, level: "basis", childIds, ancestors: []});
            rootChildren.push(bid);
        }

        // 模块14 自定义：仅示意，不展开
        const customId = "m14";
        nodes.set(customId, {
            id: customId,
            label: "模块14 · 自定义",
            sub: "（学生自定义选课方案）",
            level: "custom",
            childIds: [],
            ancestors: [],
        });
        rootChildren.push(customId);

        return {nodes, rootChildren, allCourseMeta, courseGroupCount};
    }, []);

    const init = useMemo(loadPersist, []);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(init.expanded));
    const [pinned, setPinned] = useState<Set<string>>(() => new Set(init.pinned));
    const [userMax, setUserMax] = useState<number>(init.userMax);
    const [selected, setSelected] = useState<string | null>(null);
    const lastAccess = useRef<Map<string, number>>(new Map());

    // 持久化
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({expanded: [...expanded], pinned: [...pinned], userMax}));
    }, [expanded, pinned, userMax]);

    const countVisible = useCallback(
        (exp: Set<string>) => allCourseMeta.filter((m) => m.ancestors.every((a) => exp.has(a))).length,
        [],
    );

    // LRU 整组回收：超过上限时，收起「最久未操作的未钉住课组」，直到回到预算内
    const enforce = useCallback(
        (exp: Set<string>, max: number, pin: Set<string>): Set<string> => {
            let count = countVisible(exp);
            if (count <= max) return exp;
            const groups = [...exp].filter((id) => nodes.get(id)?.level === "group" && !pin.has(id));
            groups.sort((a, b) => (lastAccess.current.get(a) ?? 0) - (lastAccess.current.get(b) ?? 0));
            const res = new Set(exp);
            for (const gid of groups) {
                if (count <= max) break;
                res.delete(gid);
                count = countVisible(res);
            }
            return res;
        },
        [countVisible],
    );

    const toggleExpand = useCallback(
        (id: string) => {
            setExpanded((prev) => {
                const node = nodes.get(id);
                if (prev.has(id)) {
                    // 已展开：若该节点已固定（强制展开），不允许收起
                    if (pinned.has(id)) return prev;
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                }
                const next = new Set(prev);
                next.add(id);
                lastAccess.current.set(id, Date.now());
                // 仅当展开的是「课组」（会新增可见叶节点）时才触发预算回收
                if (node?.level === "group") return enforce(next, userMax, pinned);
                return next;
            });
        },
        [enforce, userMax, pinned],
    );

    const togglePin = useCallback(
        (id: string) => {
            const willPin = !pinned.has(id);
            const nextPinned = new Set(pinned);
            if (willPin) nextPinned.add(id);
            else nextPinned.delete(id);

            let nextExp = expanded;
            if (willPin && !expanded.has(id)) {
                nextExp = new Set(expanded);
                nextExp.add(id);
                lastAccess.current.set(id, Date.now());
            }
            const node = nodes.get(id);
            if (willPin && node?.level === "group") {
                // 固定课组时，确保它不被预算回收（纳入最新钉住集合）
                nextExp = enforce(nextExp, userMax, nextPinned);
            }
            setPinned(nextPinned);
            setExpanded(nextExp);
        },
        [expanded, pinned, userMax, enforce],
    );

    const expandAll = useCallback(() => {
        const next = new Set<string>();
        // 骨架：模块 / 基础通识（不消耗课程预算）
        nodes.forEach((n) => {
            if (n.level === "module" || n.level === "basis") next.add(n.id);
        });
        // 课组按「从上到下」视觉顺序（nodes 插入序即视觉序）逐一展开，受预算约束时停止
        const groups: string[] = [];
        nodes.forEach((n) => {
            if (n.level === "group") groups.push(n.id);
        });
        let t = Date.now();
        for (const gid of groups) {
            if (pinned.has(gid)) {
                next.add(gid);
                lastAccess.current.set(gid, t++);
                continue;
            }
            const trial = new Set(next);
            trial.add(gid);
            if (countVisible(trial) <= userMax) {
                next.add(gid);
                lastAccess.current.set(gid, t++);
            } else {
                break;
            }
        }
        setExpanded(next);
    }, [countVisible, nodes, pinned, userMax]);

    const collapseAll = useCallback(() => {
        setExpanded(new Set());
        setPinned(new Set());
    }, []);

    const resetView = useCallback(() => {
        setExpanded(new Set());
        setPinned(new Set());
        setUserMax(USER_MAX_DEFAULT);
        setSelected(null);
    }, []);

    // 仅收起未固定节点；保留固定节点及其到根节点的完整祖先链
    const collapseAllSoft = useCallback(() => {
        setExpanded(expandWithAncestors(pinned, nodes));
    }, [pinned, nodes]);

    const handleCollapseClick = useCallback(() => {
        if (pinned.size > 0) setShowCollapseConfirm(true);
        else collapseAll();
    }, [pinned.size, collapseAll]);

    const onMaxChange = useCallback(
        (v: number) => {
            const nv = Math.min(PERF_MAX, Math.max(MIN_MAX, v));
            setUserMax(nv);
            setExpanded((exp) => enforce(exp, nv, pinned));
        },
        [enforce, pinned],
    );

    const visibleCount = useMemo(() => countVisible(expanded), [expanded, countVisible]);

    /* ============ 搜索（范围选择 + 文本目标：输入关键词列出去重后的目标文本，选定后解析为全部同名节点并一并框出） ============ */
    const searchIndex = useMemo(buildSearchIndex, []);
    const hitById = useMemo(() => new Map(searchIndex.hits.map((h) => [h.id, h])), [searchIndex]);
    const [searchScope, setSearchScope] = useState<SearchScope>("main");
    const [searchQuery, setSearchQuery] = useState("");
    const [targetList, setTargetList] = useState<SearchTarget[]>([]);
    const [selectedTarget, setSelectedTarget] = useState<SearchTarget | null>(null);
    const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
    const [searchCursor, setSearchCursor] = useState(0);
    const [searchActiveId, setSearchActiveId] = useState<string | null>(null);
    const searchHighlightSet = useMemo(() => new Set(searchResults.map((h) => h.id)), [searchResults]);
    const [searchInfo, setSearchInfo] = useState("");
    const [confirmExpand, setConfirmExpand] = useState<{needed: number; base: Set<string>} | null>(null);
    const [showCollapseConfirm, setShowCollapseConfirm] = useState(false);
    const expandSnapshot = useRef<Set<string> | null>(null);

    const restoreSnapshot = useCallback(() => {
        if (expandSnapshot.current) {
            setExpanded(new Set(expandSnapshot.current));
            expandSnapshot.current = null;
        }
    }, [setExpanded]);

    const expandHits = useCallback(
        (hits: SearchHit[]) => {
            if (!expandSnapshot.current) expandSnapshot.current = new Set(expanded);
            const base = new Set(expandSnapshot.current);
            hits.forEach((h) => {
                const node = nodes.get(h.id);
                if (!node) return;
                base.add(h.id);
                node.ancestors.forEach((a) => base.add(a));
            });
            setExpanded(base);
            setSearchActiveId(hits[0]?.id ?? null);
        },
        [expanded, nodes, setExpanded],
    );

    const runSearch = useCallback(
        (scope: SearchScope, q: string, resetCursor = true) => {
            const targets = searchTargets(searchIndex, q, scope);
            setTargetList(targets);
            setSelectedTarget(null);
            setSearchResults([]);
            setSearchActiveId(null);
            if (resetCursor) setSearchCursor(0);
            if (!q.trim()) {
                restoreSnapshot();
                setSearchInfo("");
                return;
            }
            if (targets.length === 0) {
                setSearchInfo("无匹配目标");
                return;
            }
            setSearchInfo(`找到 ${targets.length} 个目标文本，点击即可定位`);
        },
        [searchIndex, restoreSnapshot],
    );

    const selectTarget = useCallback(
        (target: SearchTarget) => {
            setSelectedTarget(target);
            const hits = target.ids.map((id) => hitById.get(id)).filter((h): h is SearchHit => Boolean(h));
            setSearchResults(hits);
            setSearchCursor(0);
            if (!hits.length) {
                setSearchActiveId(null);
                setSearchInfo("该目标无可展开节点");
                return;
            }
            expandHits(hits);
            setSearchInfo(`共 ${hits.length} 处同名匹配，第 1 / ${hits.length} 项`);
        },
        [hitById, expandHits],
    );

    const gotoNext = useCallback(() => {
        if (!searchResults.length) return;
        const n = (searchCursor + 1) % searchResults.length;
        setSearchCursor(n);
        setSearchActiveId(searchResults[n].id);
    }, [searchResults, searchCursor]);

    const gotoPrev = useCallback(() => {
        if (!searchResults.length) return;
        const n = (searchCursor - 1 + searchResults.length) % searchResults.length;
        setSearchCursor(n);
        setSearchActiveId(searchResults[n].id);
    }, [searchResults, searchCursor]);

    const expandAllMatches = useCallback(() => {
        if (!searchResults.length) return;
        const base = expandSnapshot.current ? new Set(expandSnapshot.current) : new Set(expanded);
        searchResults.forEach((h) => {
            const node = nodes.get(h.id);
            if (!node) return;
            base.add(h.id);
            node.ancestors.forEach((a) => base.add(a));
        });
        const needed = countVisible(base);
        if (needed <= userMax) {
            setExpanded(base);
            setSearchActiveId(searchResults[searchResults.length - 1].id);
            setSearchInfo(`已展开全部 ${searchResults.length} 个匹配结果`);
        } else {
            setConfirmExpand({needed, base});
        }
    }, [searchResults, expanded, nodes, countVisible, userMax, setExpanded]);

    const expandWithinLimit = useCallback(() => {
        if (!searchResults.length) return;
        let base = expandSnapshot.current ? new Set(expandSnapshot.current) : new Set(expanded);
        let shown = 0;
        for (const h of searchResults) {
            const node = nodes.get(h.id);
            if (!node) continue;
            const trial = new Set(base);
            trial.add(h.id);
            node.ancestors.forEach((a) => trial.add(a));
            if (countVisible(trial) <= userMax) {
                base = trial;
                shown++;
            } else break;
        }
        setExpanded(base);
        setSearchActiveId(shown > 0 ? searchResults[shown - 1].id : null);
        const notShown = searchResults.length - shown;
        setSearchInfo(
            notShown > 0
                ? `受上限（${userMax}）约束，还有 ${notShown} 个匹配结果未展开`
                : `已展开全部 ${searchResults.length} 个匹配结果`,
        );
        setConfirmExpand(null);
    }, [searchResults, expanded, nodes, countVisible, userMax, setExpanded]);

    const closeSearch = useCallback(() => {
        restoreSnapshot();
        setSearchActiveId(null);
        setSearchResults([]);
        setSelectedTarget(null);
        setTargetList([]);
        setSearchQuery("");
        setSearchCursor(0);
        setSearchInfo("");
        setConfirmExpand(null);
    }, [restoreSnapshot]);

    const onScopeChange = useCallback(
        (scope: SearchScope) => {
            setSearchScope(scope);
            runSearch(scope, searchQuery, true);
        },
        [runSearch, searchQuery],
    );

    // 命中行滚动到可见
    useEffect(() => {
        if (!searchActiveId) return;
        const el = document.getElementById(`hl-${searchActiveId}`);
        el?.scrollIntoView({block: "center", behavior: "smooth"});
    }, [searchActiveId, expanded]);

    /* ============ 样式 ============ */
    const textMuted = isDark ? "text-white/50" : "text-gray-500";
    const listSearchBtnCls = isDark
        ? "rounded px-2 py-0.5 text-[10px] border border-white/10 text-white/70 hover:bg-white/10"
        : "rounded px-2 py-0.5 text-[10px] border border-gray-200 text-gray-600 hover:bg-gray-100";
    const textNormal = isDark ? "text-white/90" : "text-gray-800";
    const textFaint = isDark ? "text-white/40" : "text-gray-400";
    const borderCls = isDark ? "border-white/10" : "border-gray-200";
    const listDivider = isDark ? "divide-white/10" : "divide-gray-200";
    const hoverBg = isDark ? "hover:bg-white/5" : "hover:bg-gray-100";
    const guideLine = isDark ? "border-white/10" : "border-gray-200";
    const accent = isDark ? "text-blue-300" : "text-[#863bff]";
    const pinActive = isDark ? "text-yellow-300" : "text-yellow-600";

    /* ============ 递归渲染 ============ */
    const renderNode = (id: string, depth: number): React.ReactNode => {
        const n = nodes.get(id);
        if (!n) return null;
        const isOpen = expanded.has(id);
        const isPin = pinned.has(id);
        const hasChildren = n.childIds.length > 0;
        const isCourse = n.level === "course";
        const isCustom = n.level === "custom";
        const isHi = searchHighlightSet.has(id);
        const isActive = searchActiveId === id;

        const row = (
            <div
                id={`hl-${id}`}
                className={`group flex items-center gap-1.5 rounded-md px-1.5 py-1 cursor-pointer select-none ${hoverBg} ${
                    isCourse && selected === id ? (isDark ? "bg-white/10" : "bg-gray-100") : ""
                } ${isHi ? (isActive ? (isDark ? "bg-[#863bff]/25 ring-2 ring-[#863bff]" : "bg-[#863bff]/10 ring-2 ring-[#863bff]") : (isDark ? "bg-yellow-400/20 ring-1 ring-yellow-400" : "bg-yellow-100 ring-1 ring-yellow-400")) : ""}`}
                style={{paddingLeft: `${depth * 14 + 6}px`}}
                onClick={() => {
                    if (isCustom) return;
                    if (isCourse) setSelected(id);
                    else toggleExpand(id);
                }}
                title={n.sub}
            >
                {/* 展开箭头 / 占位 */}
                {hasChildren ? (
                    <span className={`text-[10px] w-3 inline-block ${textFaint}`}>{isOpen ? "▾" : "▸"}</span>
                ) : (
                    <span className="w-3 inline-block" />
                )}
                {/* 图标 */}
                <span className={`text-[11px] ${isCourse ? (isDark ? "text-white/70" : "text-gray-600") : textNormal}`}>
                    {isCourse ? "•" : n.level === "group" ? "▣" : n.level === "basis" ? "❖" : "▢"}
                </span>
                {/* 名称 */}
                <span className={`text-[12px] truncate ${isCourse ? (isDark ? "text-white/80" : "text-gray-700") : "font-medium " + textNormal}`}>
                    {n.label}
                </span>
                {/* 类标签 */}
                {n.classTag && <span className={`text-[9px] px-1 rounded ${accent} ${isDark ? "bg-white/5" : "bg-[rgba(134,59,255,0.08)]"}`}>{n.classTag}</span>}
                {/* 副信息：课组额外强调组内总学分（与学位评定同口径） */}
                {n.level === "group" ? (
                    <span className={`text-[10px] ml-auto whitespace-nowrap ${textFaint}`}>
                        {n.courseCount} 门 · <span className={accent}>共 {n.groupCredits ?? 0} 学分</span>
                    </span>
                ) : (
                    n.sub && <span className={`text-[10px] ml-auto whitespace-nowrap ${textFaint}`}>{n.sub}</span>
                )}
                {/* 固定按钮（课组/模块） */}
                {(n.level === "group" || n.level === "module") && (
                    <button
                        className={`text-[11px] px-1 rounded ${isPin ? pinActive : textFaint} ${hoverBg}`}
                        title={isPin ? "取消固定" : "固定（常驻展开，不被回收）"}
                        onClick={(e) => {
                            e.stopPropagation();
                            togglePin(id);
                        }}
                    >
                        {isPin ? "📌" : "📍"}
                    </button>
                )}
            </div>
        );

        return (
            <div key={id}>
                {row}
                {hasChildren && isOpen && (
                    <div className={`ml-3 border-l ${guideLine}`} style={{paddingLeft: 0}}>
                        {n.childIds.map((cid) => renderNode(cid, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    const selNode = selected ? nodes.get(selected) : null;
    const selCourse = selNode?.courseId ? data.courses.find((c) => c.course_id === selNode.courseId) : null;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* 搜索条（列表上侧常驻） */}
            <div className={`shrink-0 border-b ${borderCls} px-3 py-2 space-y-2`}>
                <div className="flex gap-1.5">
                    <SearchScopeSelect value={searchScope} onChange={onScopeChange} isDark={isDark} />
                    <input
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); runSearch(searchScope, e.target.value); }}
                        placeholder="输入关键词，查找课程/模块/课组…"
                        className={`flex-1 min-w-0 rounded border px-2 py-1 text-[11px] outline-none ${borderCls} ${isDark ? "bg-white/5 text-white/90 placeholder-white/30" : "bg-white text-gray-800 placeholder-gray-400"}`}
                    />
                    {searchQuery && (
                        <button onClick={closeSearch} className={`px-2 py-0.5 text-[11px] rounded border ${borderCls} ${textMuted} ${hoverBg}`}>✕</button>
                    )}
                </div>
                {targetList.length > 0 && (
                    <div className={`max-h-40 overflow-auto rounded border ${borderCls} divide-y ${listDivider}`}>
                        {targetList.map((t) => (
                            <button
                                key={t.label}
                                onClick={() => selectTarget(t)}
                                className={`w-full text-left px-2 py-1 text-[11px] ${selectedTarget?.label === t.label ? (isDark ? "bg-[#863bff]/25 text-white" : "bg-[#863bff]/10 text-[#863bff]") : (isDark ? "text-white/80 hover:bg-white/5" : "text-gray-700 hover:bg-gray-100")}`}
                            >
                                <span className="block truncate">{t.label}</span>
                                <span className={`block text-[9px] ${textMuted}`}>{t.count > 1 ? `共 ${t.count} 处同名` : "1 处匹配"}</span>
                            </button>
                        ))}
                    </div>
                )}
                {selectedTarget && searchResults.length > 0 && (
                    <div className={`flex items-center justify-between text-[10px] ${textMuted}`}>
                        <span>第 {searchCursor + 1} / {searchResults.length} 处</span>
                        <div className="flex gap-1">
                            <button onClick={gotoPrev} className={listSearchBtnCls}>上一个</button>
                            <button onClick={gotoNext} className={listSearchBtnCls}>下一个</button>
                            <button onClick={expandAllMatches} className={`rounded border px-2 py-0.5 ${borderCls} ${textMuted} ${hoverBg}`}>展开全部</button>
                        </div>
                    </div>
                )}
                {searchInfo && (
                    <div className={`text-[10px] ${searchInfo.includes("未展开") ? "text-orange-500" : textMuted}`}>{searchInfo}</div>
                )}
            </div>

            {/* 工具栏 */}
            <div className={`shrink-0 border-b ${borderCls} px-3 py-2 space-y-2`}>
                <div className="flex items-center justify-between">
                    <span className={`text-[11px] ${textMuted}`}>同时可见课程上限</span>
                    <span className={`text-[11px] font-medium ${textNormal}`}>{userMax}</span>
                </div>
                <div className="relative">
                    <input
                        type="range"
                        min={MIN_MAX}
                        max={PERF_MAX}
                        value={userMax}
                        onChange={(e) => onMaxChange(parseInt(e.target.value, 10))}
                        className="w-full accent-[#863bff]"
                    />
                    <div
                        className="pointer-events-none absolute top-0 h-4 w-px bg-[#863bff]"
                        style={{left: `${((MAIN_SCHEME_COURSES - 1 - MIN_MAX) / (PERF_MAX - MIN_MAX)) * 100}%`}}
                        title={`紫色刻度 = ${MAIN_SCHEME_COURSES}：设为此值可恰好只展开培养方案全部课程`}
                    />
                </div>
                <div className={`text-[10px] ${visibleCount > userMax ? "text-orange-500" : textMuted}`}>
                    已显示课程 {visibleCount} / {userMax}
                    {pinned.size > 0 && ` · 已固定 ${pinned.size}`}
                </div>
                <div className="flex gap-1">
                    <button onClick={expandAll} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>
                        展开全部
                    </button>
                    <button onClick={handleCollapseClick} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>
                        收起全部
                    </button>
                    <button onClick={resetView} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>
                        重置
                    </button>
                </div>
            </div>

            {/* 树 */}
            <div className="min-h-0 flex-1 overflow-auto py-2">
                {rootChildren.map((cid) => renderNode(cid, 0))}
            </div>

            {/* 选中课程详情 */}
            {selCourse && (
                <div className={`shrink-0 border-t ${borderCls} px-3 py-2 text-[11px] ${textNormal}`}>
                    <div className="font-medium">{selCourse.name}</div>
                    <div className={`mt-0.5 ${textMuted}`}>
                        {selCourse.credits != null ? `${selCourse.credits} 学分` : "学分未标注"}
                        {selCourse.module_type ? ` · ${selCourse.module_type}` : ""}
                        {courseGroupCount.get(selCourse.course_id) ? ` · 出现于 ${courseGroupCount.get(selCourse.course_id)} 个课组` : ""}
                    </div>
                </div>
            )}

            {/* 展开全部匹配：超上限确认弹窗 */}
            {confirmExpand && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.45)"}} onClick={() => setConfirmExpand(null)}>
                    <div className={`w-80 rounded-xl border px-5 py-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`} onClick={(e) => e.stopPropagation()}>
                        <div className={`text-sm font-semibold mb-2 ${textNormal}`}>展开全部匹配</div>
                        <div className={`text-[12px] mb-4 ${textMuted}`}>全部展开共需显示 {confirmExpand.needed} 门课程，超出当前上限 {userMax}。是否临时扩大上限以展开全部？</div>
                        <div className="flex flex-col gap-2">
                            <button onClick={() => { setUserMax(Math.max(userMax, confirmExpand.needed)); setExpanded(confirmExpand.base); setSearchActiveId(searchResults[searchResults.length - 1]?.id ?? null); setSearchInfo(`已展开全部 ${searchResults.length} 个匹配结果`); setConfirmExpand(null); }} className={`rounded px-3 py-2 text-[12px] font-medium ${isDark ? "bg-[#863bff]/25 text-white hover:bg-[#863bff]/35" : "bg-[#863bff]/10 text-[#863bff] hover:bg-[#863bff]/20"}`}>扩大上限至 {confirmExpand.needed}</button>
                            <button onClick={expandWithinLimit} className={`rounded px-3 py-2 text-[12px] ${isDark ? "bg-white/10 text-white/85 hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>仅展开上限内（{userMax}）</button>
                            <button onClick={() => setConfirmExpand(null)} className={`rounded px-3 py-2 text-[12px] ${textMuted} ${hoverBg}`}>取消</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 收起全部：固定节点确认弹窗 */}
            {showCollapseConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.45)"}} onClick={() => setShowCollapseConfirm(false)}>
                    <div className={`w-80 rounded-xl border px-5 py-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`} onClick={(e) => e.stopPropagation()}>
                        <div className={`text-sm font-semibold mb-2 ${textNormal}`}>收起全部</div>
                        <div className={`text-[12px] mb-4 ${textMuted}`}>你已固定 {pinned.size} 个节点。收起时是否一并收起这些固定节点？</div>
                        <div className="flex flex-col gap-2">
                            <button onClick={() => { collapseAll(); setShowCollapseConfirm(false); }} className={`rounded px-3 py-2 text-[12px] font-medium ${isDark ? "bg-red-500/20 text-red-200 hover:bg-red-500/30" : "bg-red-50 text-red-600 hover:bg-red-100"}`}>一并收起固定（{pinned.size}）</button>
                            <button onClick={() => { collapseAllSoft(); setShowCollapseConfirm(false); }} className={`rounded px-3 py-2 text-[12px] ${isDark ? "bg-white/10 text-white/85 hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>仅收起未固定</button>
                            <button onClick={() => setShowCollapseConfirm(false)} className={`rounded px-3 py-2 text-[12px] ${textMuted} ${hoverBg}`}>取消</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
