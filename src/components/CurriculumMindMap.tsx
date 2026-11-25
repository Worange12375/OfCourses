import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {getSchemeData} from "@/data/schemeStore";
import {ATTR_LABELS, ATTR_LABELS_EN} from "../utils/recommend";
import {useAppTheme} from "../theme/ThemeContext";
import {useLocale} from "../i18n/LocaleContext";
import {PERF_MAX, MIN_MAX, USER_MAX_DEFAULT, MAIN_SCHEME_COURSES, buildSearchIndex, searchTargets, expandWithAncestors, EN_COURSES, EN_MODULES, EN_GROUPS} from "./mindmapShared";
import type {SearchScope, SearchHit, SearchTarget} from "./mindmapShared";
import {SCOPE_OPTIONS} from "./mindmapShared";
import {SearchScopeSelect} from "./SearchScopeSelect";

/** 简易占位符替换：t(key) 中 {xxx} → params[xxx] */
export const tf = (t: (k: string) => string, key: string, params: Record<string, string | number>): string =>
    t(key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));


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

type Level = "module" | "basis" | "group" | "course" | "custom";
interface TreeNode {
    id: string;
    label: string;
    labelEn?: string; // 英文名（courses_en.json；缺失时回退 label）
    sub?: string;
    subEn?: string; // 副信息英文（如 "4 cr"）
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

export const CurriculumMindMap = ({mobile}: {mobile?: boolean}) => {
    const {theme} = useAppTheme();
    const {t, locale} = useLocale();
    const zh = locale === "zh";
    const tf = (key: string, params: Record<string, string | number>) =>
        t(key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
    const isDark = theme === "dark";
    const data = getSchemeData() as unknown as RawData;
    const courseAttrKeyById = useMemo(() => new Map<string, string>(
        ((data.courses as unknown as Array<{ course_id: string; course_attr?: string | null }>)
            .map((c): [string, string] => [c.course_id, c.course_attr ?? ""])
            .filter(([, key]) => !!key))
    ), [data]);

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
                labelEn: EN_COURSES[courseId],
                sub: c?.credits != null ? `${c.credits} 学分` : undefined,
                subEn: c?.credits != null ? `${c.credits} cr` : undefined,
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
                labelEn: EN_GROUPS[g.group_code],
                sub: `${courseIds.length} 门 · 共 ${credits} 学分`,
                subEn: `${courseIds.length} courses · ${credits} cr`,
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
                    labelEn: `Module ${m.module_id} · ${EN_MODULES[String(m.module_id)] ?? m.name}`,
                    sub: `${groups.length} 课组`,
                    subEn: `${groups.length} groups`,
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
            nodes.set(bid, {id: bid, label: "基础与通识", labelEn: "Foundations & General", sub: `${basisGroups.length} 课组`, subEn: `${basisGroups.length} groups`, level: "basis", childIds, ancestors: []});
            rootChildren.push(bid);
        }

        // 模块14 自定义：仅示意，不展开
        const customId = "m14";
        nodes.set(customId, {
            id: customId,
            label: "模块14 · 自定义",
            labelEn: "Module 14 · Custom",
            sub: "（学生自定义选课方案）",
            subEn: "(Student-defined plan)",
            level: "custom",
            childIds: [],
            ancestors: [],
        });
        rootChildren.push(customId);

        return {nodes, rootChildren, allCourseMeta, courseGroupCount};
    }, [data]);

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
    // 其他范围的搜索发现：当前范围（交叉模块/基础通识）搜索时，同时检索另一范围，
    // 在结果列表末尾提示「在 XX 中还发现 N 项」，点击切换范围（防误设范围后搜不到）
    const [otherScopeInfo, setOtherScopeInfo] = useState<{scope: "main" | "basis"; count: number} | null>(null);
    const [confirmExpand, setConfirmExpand] = useState<{needed: number; base: Set<string>} | null>(null);
    const [showCollapseConfirm, setShowCollapseConfirm] = useState(false);
    // 移动端搜索态布局：searchEditing=true 编辑态（下拉+输入+候选列表）；选定目标后转结果态（单行摘要），
    // 重新输入或点 ✎ 回编辑态。toolbarTempOpen=搜索态下工具栏摘要条临时展开。
    const [searchEditing, setSearchEditing] = useState(true);
    const [toolbarTempOpen, setToolbarTempOpen] = useState(false);
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
            setSearchEditing(true);
            const targets = searchTargets(searchIndex, q, scope);
            setTargetList(targets);
            setSelectedTarget(null);
            setSearchResults([]);
            setSearchActiveId(null);
            if (resetCursor) setSearchCursor(0);
            // 同步检索另一范围（仅当限定了单一范围时），供「在 XX 中还发现 N 项」引导
            if (scope !== "all" && q.trim()) {
                const other: "main" | "basis" = scope === "main" ? "basis" : "main";
                const n = searchTargets(searchIndex, q, other).length;
                setOtherScopeInfo(n > 0 ? {scope: other, count: n} : null);
            } else {
                setOtherScopeInfo(null);
            }
            if (!q.trim()) {
                restoreSnapshot();
                setSearchInfo("");
                return;
            }
            if (targets.length === 0) {
                setSearchInfo(t("mindmap.noMatches"));
                return;
            }
            setSearchInfo(tf("mindmap.foundTargets", {n: targets.length}));
        },
        [searchIndex, restoreSnapshot, t, zh],
    );

    const selectTarget = useCallback(
        (target: SearchTarget) => {
            setSelectedTarget(target);
            setSearchEditing(false); // 已选定结果 → 移动端搜索区折叠为单行摘要
            const hits = target.ids.map((id) => hitById.get(id)).filter((h): h is SearchHit => Boolean(h));
            setSearchResults(hits);
            setSearchCursor(0);
            if (!hits.length) {
                setSearchActiveId(null);
                setSearchInfo(t("mindmap.targetNoExpand"));
                return;
            }
            expandHits(hits);
            setSearchInfo(`${tf("mindmap.matchCount", {n: hits.length})}${zh ? "，" : ", "}${tf("mindmap.position", {i: 1, n: hits.length})}`);
        },
        [hitById, expandHits, t, zh],
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
            setSearchInfo(tf("mindmap.expandedAll", {n: searchResults.length}));
        } else {
            setConfirmExpand({needed, base});
        }
    }, [searchResults, expanded, nodes, countVisible, userMax, setExpanded, t, zh]);

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
                ? tf("mindmap.limitNotExpanded", {max: userMax, n: notShown})
                : tf("mindmap.expandedAll", {n: searchResults.length}),
        );
        setConfirmExpand(null);
    }, [searchResults, expanded, nodes, countVisible, userMax, setExpanded, t, zh]);

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
        setOtherScopeInfo(null);
        setSearchEditing(true);
        setToolbarTempOpen(false);
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
                style={{paddingLeft: `${depth * (mobile ? 10 : 14) + 6}px`}}
                onClick={() => {
                    if (isCustom) return;
                    if (isCourse) setSelected(id);
                    else toggleExpand(id);
                }}
                title={zh ? n.sub : (n.subEn ?? n.sub)}
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
                <span className={`truncate ${isCourse ? (isDark ? "text-white/80" : "text-gray-700") : "font-medium " + textNormal} ${mobile ? "text-[11px]" : "text-[12px]"}`}>
                    {zh ? n.label : (n.labelEn ?? n.label)}
                </span>
                {/* 类标签 */}
                {n.classTag && <span className={`text-[9px] px-1 rounded ${accent} ${isDark ? "bg-white/5" : "bg-[rgba(134,59,255,0.08)]"}`}>{zh ? n.classTag : {["Ⅰ类"]: "Class I", ["Ⅱ类"]: "Class II", ["Ⅲ类"]: "Class III"}[n.classTag] ?? n.classTag}</span>}
                {/* 副信息：课组额外强调组内总学分（与学位评定同口径） */}
                {n.level === "group" ? (
                    <span className={`text-[10px] ml-auto whitespace-nowrap ${textFaint}`}>
                        {n.courseCount} {zh ? "门" : "courses"} · <span className={accent}>{zh ? `共 ${n.groupCredits ?? 0} 学分` : `${n.groupCredits ?? 0} cr`}</span>
                    </span>
                ) : (
                    n.sub && <span className={`text-[10px] ml-auto whitespace-nowrap ${textFaint}`}>{zh ? n.sub : (n.subEn ?? n.sub)}</span>
                )}
                {/* 固定按钮（课组/模块） */}
                {(n.level === "group" || n.level === "module") && (
                    <button
                        className={`text-[11px] px-1 rounded ${isPin ? pinActive : textFaint} ${hoverBg}`}
                        title={isPin ? t("mindmap.pinOff") : t("mindmap.pinOn")}
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
                    <div className={`border-l ${guideLine} ${mobile ? "ml-2" : "ml-3"}`} style={{paddingLeft: 0}}>
                        {n.childIds.map((cid) => renderNode(cid, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    const selNode = selected ? nodes.get(selected) : null;
    const selCourse = selNode?.courseId ? data.courses.find((c) => c.course_id === selNode.courseId) : null;
    const scopeLabel = (() => {
        const o = SCOPE_OPTIONS.find((s) => s.value === searchScope);
        return o ? (zh && o.label ? o.label : (o.labelEn ?? o.label)) : "";
    })();
    // 移动端搜索激活：搜索区结果态 + 工具栏摘要条（桌面端与非搜索态保持常驻）
    const searchOnMobile = mobile && searchQuery.trim().length > 0;
    const searchResultMode = searchOnMobile && !!selectedTarget && !searchEditing;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* 搜索条（列表上侧常驻；移动端选定结果后折叠为单行摘要，点 ✎ 重新编辑） */}
            <div className={`shrink-0 border-b ${borderCls} px-3 py-2 space-y-2`}>
                {searchResultMode ? (
                    <div className="flex flex-col gap-1">
                        {/* 行 1：范围 + 目标名（整行可点，展开编辑态） */}
                        <button
                            onClick={() => setSearchEditing(true)}
                            title={t("mindmap.editSearch")}
                            className={`flex w-full items-center rounded border px-2 py-1 text-left ${borderCls} ${hoverBg}`}
                        >
                            <span className={`min-w-0 flex-1 truncate text-[11px] ${textNormal}`}>
                                🔍 {scopeLabel} · {zh ? (selectedTarget.label) : (selectedTarget.labelEn ?? selectedTarget.label)}
                            </span>
                        </button>
                        {/* 行 2：进度 + 导航 + 清除 */}
                        <div className="flex items-center justify-between">
                            <span className={`text-[10px] ${textMuted}`}>{tf("mindmap.position", {i: searchCursor + 1, n: searchResults.length})}</span>
                            <div className="flex gap-1">
                                <button onClick={gotoPrev} className={listSearchBtnCls}>{t("mindmap.prev")}</button>
                                <button onClick={gotoNext} className={listSearchBtnCls}>{t("mindmap.next")}</button>
                                <button onClick={closeSearch} title={t("mindmap.clearSearch")} className={`px-2 py-0.5 text-[11px] rounded border ${borderCls} ${textMuted} ${hoverBg}`}>✕</button>
                            </div>
                        </div>
                    </div>
                ) : (
                <>
                <div className={`gap-1.5 ${mobile ? "flex flex-col" : "flex"}`}>
                    <SearchScopeSelect value={searchScope} onChange={onScopeChange} isDark={isDark} />
                    <input
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); runSearch(searchScope, e.target.value); }}
                        placeholder={t("mindmap.searchPlaceholder")}
                        className={`flex-1 min-w-0 rounded border px-2 py-1 text-[11px] outline-none ${borderCls} ${isDark ? "bg-white/5 text-white/90 placeholder-white/30" : "bg-white text-gray-800 placeholder-gray-400"}`}
                    />
                    {searchQuery && (
                        <button onClick={closeSearch} className={`px-2 py-0.5 text-[11px] rounded border ${borderCls} ${textMuted} ${hoverBg}`}>✕</button>
                    )}
                </div>
                {targetList.length > 0 && (
                    <div className={`max-h-40 overflow-auto rounded border ${borderCls} divide-y ${listDivider}`}>
                        {targetList.map((tg) => (
                            <button
                                key={tg.label}
                                onClick={() => selectTarget(tg)}
                                className={`w-full text-left px-2 py-1 text-[11px] ${selectedTarget?.label === tg.label ? (isDark ? "bg-[#863bff]/25 text-white" : "bg-[#863bff]/10 text-[#863bff]") : (isDark ? "text-white/80 hover:bg-white/5" : "text-gray-700 hover:bg-gray-100")}`}
                            >
                                <span className="block truncate">{zh ? tg.label : (tg.labelEn ?? tg.label)}</span>
                                <span className={`block text-[9px] ${textMuted}`}>{tg.count > 1 ? tf("mindmap.sameNameCount", {n: tg.count}) : t("mindmap.oneMatch")}</span>
                            </button>
                        ))}
                    </div>
                )}
                {otherScopeInfo && (() => {
                    const other = SCOPE_OPTIONS.find((s) => s.value === otherScopeInfo.scope);
                    const otherLabel = other ? (zh ? other.label : (other.labelEn ?? other.label)) : "";
                    return (
                        <button
                            onClick={() => onScopeChange(otherScopeInfo.scope)}
                            className={`w-full text-left rounded border px-2 py-1 text-[10px] ${borderCls} ${isDark ? "text-blue-300/80 hover:bg-white/5" : "text-blue-600 hover:bg-blue-50"}`}
                        >
                            {tf("mindmap.otherScopeHint", {scope: otherLabel, n: otherScopeInfo.count})}
                        </button>
                    );
                })()}
                {selectedTarget && searchResults.length > 0 && (
                    <div className={`flex items-center justify-between text-[10px] ${textMuted} ${mobile ? "flex-wrap gap-y-1" : ""}`}>
                        <span>{tf("mindmap.position", {i: searchCursor + 1, n: searchResults.length})}</span>
                        <div className="flex gap-1">
                            <button onClick={gotoPrev} className={listSearchBtnCls}>{t("mindmap.prev")}</button>
                            <button onClick={gotoNext} className={listSearchBtnCls}>{t("mindmap.next")}</button>
                            <button onClick={expandAllMatches} className={`rounded border px-2 py-0.5 ${borderCls} ${textMuted} ${hoverBg}`}>{t("mindmap.expandMatchesBtn")}</button>
                        </div>
                    </div>
                )}
                {searchInfo && (
                    <div className={`text-[10px] ${searchInfo.includes("未展开") || searchInfo.includes("not expanded") ? "text-orange-500" : textMuted}`}>{searchInfo}</div>
                )}
                </>
                )}
            </div>

            {/* 工具栏（移动端搜索激活时收成一行摘要条，点击临时展开） */}
            {searchOnMobile && !toolbarTempOpen ? (
                <div className={`shrink-0 border-b ${borderCls} px-3 py-1.5`}>
                    <button
                        onClick={() => setToolbarTempOpen(true)}
                        className={`flex w-full items-center justify-between rounded border px-2 py-1 ${borderCls} ${hoverBg}`}
                    >
                        <span className={`text-[11px] ${textMuted}`}>
                            {tf("mindmap.limitShort", {max: userMax})} · {tf("mindmap.shownShort", {shown: visibleCount, max: userMax})}
                            {pinned.size > 0 && ` · ${tf("mindmap.pinnedSuffix", {n: pinned.size})}`}
                        </span>
                        <span className={`text-[10px] ${textMuted}`}>{t("mindmap.expandTray")}</span>
                    </button>
                </div>
            ) : (
            <div className={`shrink-0 border-b ${borderCls} px-3 py-2 space-y-2`}>
                <div className="flex items-center justify-between">
                    <span className={`text-[11px] ${textMuted}`}>{t("mindmap.visibleLimit")}</span>
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
                        title={tf("mindmap.purpleTick", {n: MAIN_SCHEME_COURSES})}
                    />
                </div>
                <div className={`text-[10px] ${visibleCount > userMax ? "text-orange-500" : textMuted}`}>
                    {tf("mindmap.shownCourses", {shown: visibleCount, max: userMax})}
                    {pinned.size > 0 && ` · ${tf("mindmap.pinnedSuffix", {n: pinned.size})}`}
                </div>
                <div className="flex gap-1">
                    <button onClick={expandAll} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>
                        {t("mindmap.expandAll")}
                    </button>
                    <button onClick={handleCollapseClick} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>
                        {t("mindmap.collapseAll")}
                    </button>
                    <button onClick={resetView} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>
                        {t("mindmap.reset")}
                    </button>
                </div>
                {searchOnMobile && (
                    <button
                        onClick={() => setToolbarTempOpen(false)}
                        className={`w-full rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}
                    >
                        {t("mindmap.collapseTray")}
                    </button>
                )}
            </div>
            )}

            {/* 树 */}
            <div className="min-h-0 flex-1 overflow-auto py-2">
                {rootChildren.map((cid) => renderNode(cid, 0))}
            </div>

            {/* 选中课程详情 */}
            {selCourse && (
                <div className={`shrink-0 border-t ${borderCls} px-3 py-2 text-[11px] ${textNormal}`}>
                    <div className="font-medium">{zh ? selCourse.name : (selNode?.labelEn ?? selCourse.name)}</div>
                    <div className={`mt-0.5 ${textMuted}`}>
                        {selCourse.credits != null ? `${selCourse.credits} ${t("mindmap.creditUnit")}` : t("mindmap.creditMissing")}
                        {selCourse.module_type ? ` · ${selCourse.module_type}` : ""}
                        {(() => {
                            const ak = courseAttrKeyById.get(selCourse.course_id);
                            return ak ? ` · ${zh ? (ATTR_LABELS[ak] ?? ak) : (ATTR_LABELS_EN[ak] ?? ak)}` : "";
                        })()}
                        {courseGroupCount.get(selCourse.course_id) ? ` · ${tf("mindmap.appearsInGroups", {n: courseGroupCount.get(selCourse.course_id) ?? 0})}` : ""}
                    </div>
                </div>
            )}

            {/* 展开全部匹配：超上限确认弹窗 */}
            {confirmExpand && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.45)"}} onClick={() => setConfirmExpand(null)}>
                    <div className={`w-80 rounded-xl border px-5 py-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`} onClick={(e) => e.stopPropagation()}>
                        <div className={`text-sm font-semibold mb-2 ${textNormal}`}>{t("mindmap.expandMatchesTitle")}</div>
                        <div className={`text-[12px] mb-4 ${textMuted}`}>{tf("mindmap.expandMatchesDesc", {needed: confirmExpand.needed, max: userMax})}</div>
                        <div className="flex flex-col gap-2">
                            <button onClick={() => { setUserMax(Math.max(userMax, confirmExpand.needed)); setExpanded(confirmExpand.base); setSearchActiveId(searchResults[searchResults.length - 1]?.id ?? null); setSearchInfo(tf("mindmap.expandedAll", {n: searchResults.length})); setConfirmExpand(null); }} className={`rounded px-3 py-2 text-[12px] font-medium ${isDark ? "bg-[#863bff]/25 text-white hover:bg-[#863bff]/35" : "bg-[#863bff]/10 text-[#863bff] hover:bg-[#863bff]/20"}`}>{tf("mindmap.raiseLimitTo", {n: confirmExpand.needed})}</button>
                            <button onClick={expandWithinLimit} className={`rounded px-3 py-2 text-[12px] ${isDark ? "bg-white/10 text-white/85 hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>{tf("mindmap.expandWithin", {max: userMax})}</button>
                            <button onClick={() => setConfirmExpand(null)} className={`rounded px-3 py-2 text-[12px] ${textMuted} ${hoverBg}`}>{t("mindmap.cancel")}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 收起全部：固定节点确认弹窗 */}
            {showCollapseConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.45)"}} onClick={() => setShowCollapseConfirm(false)}>
                    <div className={`w-80 rounded-xl border px-5 py-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`} onClick={(e) => e.stopPropagation()}>
                        <div className={`text-sm font-semibold mb-2 ${textNormal}`}>{t("mindmap.collapseAll")}</div>
                        <div className={`text-[12px] mb-4 ${textMuted}`}>{tf("mindmap.collapseDesc", {n: pinned.size})}</div>
                        <div className="flex flex-col gap-2">
                            <button onClick={() => { collapseAll(); setShowCollapseConfirm(false); }} className={`rounded px-3 py-2 text-[12px] font-medium ${isDark ? "bg-red-500/20 text-red-200 hover:bg-red-500/30" : "bg-red-50 text-red-600 hover:bg-red-100"}`}>{tf("mindmap.collapsePinned", {n: pinned.size})}</button>
                            <button onClick={() => { collapseAllSoft(); setShowCollapseConfirm(false); }} className={`rounded px-3 py-2 text-[12px] ${isDark ? "bg-white/10 text-white/85 hover:bg-white/15" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>{t("mindmap.collapseSoft")}</button>
                            <button onClick={() => setShowCollapseConfirm(false)} className={`rounded px-3 py-2 text-[12px] ${textMuted} ${hoverBg}`}>{t("mindmap.cancel")}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
