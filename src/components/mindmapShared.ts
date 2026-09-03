import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import structuredData from "@/data/structured_data.json";

/* ============ 常量（与列表图共用，已锁定） ============ */
// 可见课程硬上限 = 全展开培养方案后的「课程(叶)节点」总数（同一门课跨课组出现计多次）。
// 由下方 computePerfMax() 动态计算，保证拉满滑块即可看全整个培养方案。
export const PERF_MAX = computePerfMax();
export const USER_MAX_DEFAULT = 60; // 用户默认上限
export const MIN_MAX = 20; // 用户下限
export const STORAGE_KEY = "oc_mindmap_v1"; // 树状图专用：仅持久化固定(pinned)与用户上限(userMax)，展开态随组件卸载刷新

/* ============ 数据形态 ============ */
export type Level = "root" | "class" | "module" | "basis" | "group" | "course" | "custom";
export interface TreeNode {
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

/** 全展开培养方案后的课程(叶)节点总数 = 各课组 course_ids 长度之和（含跨组重复） */
function computePerfMax(): number {
    const data = structuredData as unknown as RawData;
    let total = 0;
    data.group_courses.forEach((g) => (total += g.course_ids.length));
    return total;
}

/** 仅培养方案（不含基础通识/自定义）的全部课程(叶)节点总数 = 各「非基础课组」course_ids 之和 */
function computeMainSchemeCourses(): number {
    const data = structuredData as unknown as RawData;
    const basisIds = new Set(data.course_groups.filter((g) => g.module_id === null).map((g) => g.group_id));
    let total = 0;
    data.group_courses.forEach((g) => {
        if (!basisIds.has(g.group_id)) total += g.course_ids.length;
    });
    return total;
}
// 把滑块设定为该值，恰好只展开培养方案部分（基础通识会被预算挡在门外）
export const MAIN_SCHEME_COURSES = computeMainSchemeCourses();

export function classTagOf(moduleId: number): string {
    if (moduleId >= 1 && moduleId <= 3) return "Ⅰ类";
    if (moduleId >= 4 && moduleId <= 8) return "Ⅱ类";
    if (moduleId >= 9 && moduleId <= 13) return "Ⅲ类";
    return "";
}

export function classIdOf(moduleId: number): string {
    if (moduleId >= 1 && moduleId <= 3) return "class1";
    if (moduleId >= 4 && moduleId <= 8) return "class2";
    if (moduleId >= 9 && moduleId <= 13) return "class3";
    return "";
}

// 展开给定节点及其到根节点的完整祖先链（用于固定/收起时确保路径可见）。
// 关键：ancestors 仅记录「直接父」所在层级，必须沿链一直向上补到根，否则固定节点会被错误收起。
export function expandWithAncestors(ids: Iterable<string>, nodes: Map<string, {ancestors: string[]}>): Set<string> {
    const set = new Set<string>();
    for (const id of ids) {
        const seen = new Set<string>();
        let cur: string | null = id;
        while (cur !== null) {
            if (!nodes.has(cur) || seen.has(cur)) break;
            const node = nodes.get(cur);
            if (!node) break;
            seen.add(cur);
            set.add(cur);
            cur = node.ancestors.length ? node.ancestors[node.ancestors.length - 1] : null;
        }
    }
    return set;
}

/* ============ 构建树（纯函数，组件内 useMemo 调用，绝不可在模块顶层调用 Hook） ============ */
export function buildMindMapTree() {
    const data = structuredData as unknown as RawData;
    const courseById = new Map<string, RawCourse>(data.courses.map((c) => [c.course_id, c]));
    const groupCoursesMap = new Map<number, string[]>(data.group_courses.map((g) => [g.group_id, g.course_ids]));
    const courseGroupCount = new Map<string, number>();
    data.group_courses.forEach((g) => {
        g.course_ids.forEach((cid) => courseGroupCount.set(cid, (courseGroupCount.get(cid) ?? 0) + 1));
    });

    // 课组总学分：与「学位评定」totalCreditsInGroup 完全同口径——组内课程按 course_id 去重后学分求和，缺失学分记 0
    const groupCredits = new Map<number, number>();
    data.group_courses.forEach((g) => {
        let sum = 0;
        new Set(g.course_ids).forEach((cid) => (sum += courseById.get(cid)?.credits ?? 0));
        groupCredits.set(g.group_id, Number(sum.toFixed(1)));
    });

    const nodes = new Map<string, TreeNode>();
    const allCourseMeta: {id: string; ancestors: string[]}[] = [];
    const rootChildren: string[] = [];
    const forestRoots: string[] = [];

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

    // 13 个正式模块：先挂到 I/II/III 类节点下，再由分类节点挂到主根
    const class1Id = "class1";
    const class2Id = "class2";
    const class3Id = "class3";
    const classIds = [class1Id, class2Id, class3Id];
    const classMeta: {id: string; label: string}[] = [
        {id: class1Id, label: "I 类"},
        {id: class2Id, label: "II 类"},
        {id: class3Id, label: "III 类"},
    ];

    const classChildren = new Map<string, string[]>();
    classIds.forEach((id) => classChildren.set(id, []));

    data.modules
        .filter((m) => m.module_id !== 14)
        .forEach((m) => {
            const mid = `m${m.module_id}`;
            const groups = data.course_groups.filter((g) => g.module_id === m.module_id);
            const childIds = groups.map((g) => addGroup(mid, g, [mid]));
            const clsId = classIdOf(m.module_id);
            nodes.set(mid, {
                id: mid,
                label: `模块${m.module_id} · ${m.name}`,
                sub: `${groups.length} 课组`,
                level: "module",
                childIds,
                classTag: classTagOf(m.module_id),
                ancestors: [clsId],
            });
            classChildren.get(clsId)!.push(mid);
        });

    classMeta.forEach(({id, label}) => {
        nodes.set(id, {
            id,
            label,
            level: "class",
            childIds: classChildren.get(id) ?? [],
            ancestors: ["__root_main__"],
        });
        // 列表图仍把模块直接挂在根下，分类节点只服务于树状图
    });

    const mainRootId = "__root_main__";
    nodes.set(mainRootId, {
        id: mainRootId,
        label: "笃实书院培养方案",
        level: "root",
        childIds: classIds,
        ancestors: [],
    });
    forestRoots.push(mainRootId);

    // 列表图维持原结构：13 个模块平铺 + 基础通识 + 自定义
    data.modules
        .filter((m) => m.module_id !== 14)
        .forEach((m) => rootChildren.push(`m${m.module_id}`));

    // 基础/通识课组（module_id === null）—— 在树状图中作为独立顶层根
    const basisGroups = data.course_groups.filter((g) => g.module_id === null);
    const bid = "basis";
    if (basisGroups.length) {
        const childIds = basisGroups.map((g) => addGroup(bid, g, [bid]));
        nodes.set(bid, {id: bid, label: "基础与通识", sub: `${basisGroups.length} 课组`, level: "basis", childIds, ancestors: []});
        rootChildren.push(bid);
        forestRoots.push(bid);
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
    forestRoots.push(customId);

    return {nodes, rootChildren, forestRoots, allCourseMeta, courseGroupCount, groupCredits};
}

/* ============ 搜索索引（列表图与树状图共用，返回统一树节点 id） ============ */
export type SearchType = "course" | "module" | "group";
export type SearchScope = "all" | "main" | "basis";
export const SCOPE_OPTIONS: {value: SearchScope; label: string}[] = [
    {value: "all", label: "全部"},
    {value: "main", label: "培养方案"},
    {value: "basis", label: "基础通识"},
];
export interface SearchHit {
    type: SearchType;
    id: string; // 统一节点 id（mX-gY-cZ 体系，列表图与树状图一致）
    label: string; // 命中项显示名
    sub?: string; // 副信息
    groupId?: number;
    moduleId?: number | null;
    courseId?: string;
}

// 文本级搜索目标：按 label 去重后的建议项；选定后解析为全部同名节点
export interface SearchTarget {
    label: string; // 匹配到的文本（如「计算机图形学基础」）
    type: SearchType;
    count: number; // 该文本在范围内出现的次数（同名节点数）
    ids: string[]; // 范围内所有同名节点的 id
    sub?: string; // 代表副信息
}
export interface SearchIndex {
    hits: SearchHit[];
}
export function buildSearchIndex(): SearchIndex {
    const data = structuredData as unknown as RawData;
    const courseById = new Map<string, RawCourse>(data.courses.map((c) => [c.course_id, c]));
    const groupById = new Map<number, RawGroup>(data.course_groups.map((g) => [g.group_id, g]));
    const prefixOf = (moduleId: number | null) => (moduleId != null ? `m${moduleId}` : "basis");

    const hits: SearchHit[] = [];

    // 课程（按课组出现次数独立节点）
    data.group_courses.forEach((g) => {
        const grp = groupById.get(g.group_id);
        const mid = grp?.module_id ?? null;
        const prefix = prefixOf(mid);
        g.course_ids.forEach((cid) => {
            const c = courseById.get(cid);
            if (!c) return;
            hits.push({
                type: "course",
                id: `${prefix}-g${g.group_id}-c${cid}`,
                label: c.name,
                sub: grp?.name,
                groupId: g.group_id,
                moduleId: mid,
                courseId: cid,
            });
        });
    });

    // 模块
    data.modules
        .filter((m) => m.module_id !== 14)
        .forEach((m) => {
            hits.push({
                type: "module",
                id: `m${m.module_id}`,
                label: `模块${m.module_id} · ${m.name}`,
                moduleId: m.module_id,
            });
        });

    // 课组
    data.course_groups.forEach((g) => {
        hits.push({
            type: "group",
            id: `${prefixOf(g.module_id)}-g${g.group_id}`,
            label: g.name,
            sub: g.module_id != null ? `模块${g.module_id}` : "基础与通识",
            groupId: g.group_id,
            moduleId: g.module_id,
        });
    });

    return {hits};
}

function hitScope(hit: SearchHit): "main" | "basis" {
    if (hit.type === "course") return hit.moduleId == null ? "basis" : "main";
    if (hit.type === "module") return "main";
    // group
    return hit.moduleId == null ? "basis" : "main";
}

// 文本级建议：输入关键词后，返回「去重后的目标文本」列表（每个 label 只出现一次），
// 每个目标携带其在范围内全部同名节点的 id，供选定后一次性框出/展开。
export function searchTargets(index: SearchIndex, query: string, scope: SearchScope): SearchTarget[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const matched = index.hits.filter((h) => {
        if (scope !== "all" && hitScope(h) !== scope) return false;
        return h.label.toLowerCase().includes(q);
    });
    const byLabel = new Map<string, SearchTarget>();
    for (const h of matched) {
        const exist = byLabel.get(h.label);
        if (!exist) {
            byLabel.set(h.label, {label: h.label, type: h.type, count: 1, ids: [h.id], sub: h.sub});
        } else {
            exist.count += 1;
            exist.ids.push(h.id);
        }
    }
    return [...byLabel.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-Hans"));
}

/* ============ 持久化（仅保存固定与用户上限；展开态随组件卸载自动刷新） ============ */
interface Persist {
    pinned: string[];
    userMax: number;
}
function loadPersist(): Persist {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {pinned: [], userMax: USER_MAX_DEFAULT};
        const p = JSON.parse(raw);
        return {
            pinned: Array.isArray(p.pinned) ? p.pinned.filter((x: unknown) => typeof x === "string") : [],
            userMax: typeof p.userMax === "number" ? Math.min(PERF_MAX, Math.max(MIN_MAX, p.userMax)) : USER_MAX_DEFAULT,
        };
    } catch {
        return {pinned: [], userMax: USER_MAX_DEFAULT};
    }
}

/* ============ 共享状态/预算逻辑（列表图与树状图共用，保证交互模型一致） ============ */
export function useMindMapState() {
    const {nodes, rootChildren, forestRoots, allCourseMeta, courseGroupCount, groupCredits} = useMemo(buildMindMapTree, []);

    const init = useMemo(() => {
        const p = loadPersist();
        // 树状图默认展开：主根、基础通识根、I/II/III 类，使用户进入即见模块
        const defaults = new Set(["__root_main__", "basis", "class1", "class2", "class3"]);
        // 固定的节点及其到根节点的完整祖先链必须展开，否则钉住的课组不可见
        const pinAncestors = expandWithAncestors(p.pinned, nodes);
        return {
            pinned: new Set(p.pinned),
            userMax: p.userMax,
            expanded: new Set([...defaults, ...pinAncestors]),
        };
    }, []);

    const [expanded, setExpanded] = useState<Set<string>>(init.expanded);
    const [sessionHistory, setSessionHistory] = useState<Set<string>>(new Set());
    const [pinned, setPinned] = useState<Set<string>>(init.pinned);
    const [userMax, setUserMax] = useState<number>(init.userMax);
    const [selected, setSelected] = useState<string | null>(null);
    const lastAccess = useRef<Map<string, number>>(new Map());

    // 只持久化固定与用户上限；展开态（含手动历史）随组件卸载自动刷新
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({pinned: [...pinned], userMax}));
    }, [pinned, userMax]);

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
            const node = nodes.get(id);
            const wasOpen = expanded.has(id);
            let next = new Set(expanded);
            if (wasOpen) {
                if (pinned.has(id)) return;
                next.delete(id);
            } else {
                next.add(id);
                lastAccess.current.set(id, Date.now());
                if (node?.level === "group") next = enforce(next, userMax, pinned);
            }
            setExpanded(next);
            // 记录用户手动展开/收起操作；被收起的节点从历史中移除
            setSessionHistory((prev) => {
                const hist = new Set(prev);
                if (wasOpen) hist.delete(id);
                else hist.add(id);
                return hist;
            });
        },
        [enforce, expanded, userMax, pinned],
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
                nextExp = enforce(nextExp, userMax, nextPinned);
            }
            setPinned(nextPinned);
            setExpanded(nextExp);
        },
        [expanded, pinned, userMax, enforce],
    );

    const expandAll = useCallback(() => {
        const next = new Set<string>();
        // 先展开所有骨架节点（根 / 类 / 模块 / 基础通识），它们不消耗课程预算
        nodes.forEach((n) => {
            if (n.level === "root" || n.level === "class" || n.level === "module" || n.level === "basis") {
                next.add(n.id);
            }
        });

        // 收集所有课组并按优先级排序：固定 > 手动历史 > 从上到下（原始插入顺序即视觉顺序）
        const groups: string[] = [];
        nodes.forEach((n) => {
            if (n.level === "group") groups.push(n.id);
        });
        groups.sort((a, b) => {
            const aPin = pinned.has(a) ? -1 : 0;
            const bPin = pinned.has(b) ? -1 : 0;
            if (aPin !== bPin) return aPin - bPin;
            const aHist = sessionHistory.has(a) ? -1 : 0;
            const bHist = sessionHistory.has(b) ? -1 : 0;
            if (aHist !== bHist) return aHist - bHist;
            return 0; // 稳定排序保留原始（从上到下）顺序
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
    }, [countVisible, nodes, pinned, sessionHistory, userMax]);

    const collapseAll = useCallback(() => {
        setExpanded(new Set());
        setSessionHistory(new Set());
        setPinned(new Set());
    }, []);

    // 仅收起未固定节点；保留固定节点及其到根节点的完整祖先链
    const collapseAllSoft = useCallback(() => {
        setExpanded(expandWithAncestors(pinned, nodes));
        setSessionHistory(new Set());
    }, [pinned, nodes]);

    const resetView = useCallback(() => {
        setExpanded(new Set());
        setSessionHistory(new Set());
        setPinned(new Set());
        setUserMax(USER_MAX_DEFAULT);
        setSelected(null);
    }, []);

    const onMaxChange = useCallback(
        (v: number) => {
            const nv = Math.min(PERF_MAX, Math.max(MIN_MAX, v));
            setUserMax(nv);
            setExpanded((exp) => enforce(exp, nv, pinned));
        },
        [enforce, pinned],
    );

    const visibleCount = useMemo(() => countVisible(expanded), [expanded, countVisible]);

    return {
        nodes,
        rootChildren,
        forestRoots,
        allCourseMeta,
        courseGroupCount,
        groupCredits,
        expanded,
        setExpanded,
        pinned,
        userMax,
        setUserMax,
        selected,
        setSelected,
        visibleCount,
        countVisible,
        toggleExpand,
        togglePin,
        expandAll,
        collapseAll,
        collapseAllSoft,
        resetView,
        onMaxChange,
    };
}

/* ============ 关系图数据层（聚焦式二分网络 / focus+context bipartite） ============
 * 设计目标：用户要的是「王者荣耀式英雄关系网」——课程↔课组的网状关系，
 * 但全局一次性铺开 124 门课 × 26 课组会糊成面条。
 * 解法：只把「跨组课程」放进网络（单组课不进图，省噪声），任意时刻只渲染与焦点相关的局部邻域：
 *   - 关系1（课程在哪些课组）：点课程 → ≤6 条边辐射，规模被硬上界锁死；
 *   - 关系2（多课组共同课）：勾选课组 → 只画「被 ≥N 个所选课组共享」的课程（默认 N=2），
 *     配合「对比课组上限 K」双保险，保证同时画出的连线数可控、不复杂。
 * 范围：仅培养方案课组（module_id != null），基础与通识（module_id === null）排除。
 */
export type RelClass = "Ⅰ类" | "Ⅱ类" | "Ⅲ类";
export interface GroupRel {
    groupId: number;
    name: string;
    moduleId: number;
    classTag: RelClass;
    totalCredits: number;
    courseIds: string[]; // 组内全部课程（按 course_id 去重）
}
export interface CourseRel {
    courseId: string;
    name: string;
    credits: number;
    groupIds: number[]; // 所属培养方案课组（已排除基础通识）
    groupCount: number; // = groupIds.length
    classTag: RelClass; // 主类：取首个所属课组的类
}
export interface RelationIndex {
    crossCourses: CourseRel[]; // 跨组课（≥2 组），按 groupCount 降序、再按名称
    groups: GroupRel[]; // 培养方案课组（26 个）
    groupById: Map<number, GroupRel>;
    courseById: Map<string, CourseRel>; // 仅跨组课
}

export function buildRelationIndex(): RelationIndex {
    const data = structuredData as unknown as RawData;
    const courseMeta = new Map<string, RawCourse>(data.courses.map((c) => [c.course_id, c]));

    // 仅培养方案课组（module_id != null）
    const tpGroups = data.course_groups.filter((g) => g.module_id != null);

    // 课组总学分：与「学位评定」totalCreditsInGroup 同口径（去重后求和，缺失记 0）
    const gcredits = new Map<number, number>();
    data.group_courses.forEach((g) => {
        let sum = 0;
        new Set(g.course_ids).forEach((cid) => (sum += courseMeta.get(cid)?.credits ?? 0));
        gcredits.set(g.group_id, Number(sum.toFixed(1)));
    });

    const groups: GroupRel[] = tpGroups.map((g) => ({
        groupId: g.group_id,
        name: g.name,
        moduleId: g.module_id as number,
        classTag: classTagOf(g.module_id as number) as RelClass,
        totalCredits: gcredits.get(g.group_id) ?? 0,
        courseIds: [...new Set(data.group_courses.find((x) => x.group_id === g.group_id)?.course_ids ?? [])],
    }));
    const groupById = new Map<number, GroupRel>(groups.map((g) => [g.groupId, g]));

    // 课程 → 所属培养方案课组（去重、保序）
    const courseToGroups = new Map<string, number[]>();
    groups.forEach((g) => {
        g.courseIds.forEach((cid) => {
            const arr = courseToGroups.get(cid);
            if (arr) arr.push(g.groupId);
            else courseToGroups.set(cid, [g.groupId]);
        });
    });

    const crossCourses: CourseRel[] = [];
    courseToGroups.forEach((gids, cid) => {
        if (gids.length < 2) return; // 单组课不进关系图
        const meta = courseMeta.get(cid);
        const cls = classTagOf(groupById.get(gids[0])!.moduleId);
        crossCourses.push({
            courseId: cid,
            name: meta?.name ?? cid,
            credits: meta?.credits ?? 0,
            groupIds: gids,
            groupCount: gids.length,
            classTag: cls as RelClass,
        });
    });
    crossCourses.sort((a, b) => b.groupCount - a.groupCount || a.name.localeCompare(b.name, "zh-Hans"));

    const courseById = new Map<string, CourseRel>(crossCourses.map((c) => [c.courseId, c]));
    return {crossCourses, groups, groupById, courseById};
}

/** 关系2：给定所选课组与「共享下限 N」，返回被 ≥N 个所选课组同时包含的课程（默认 N=2） */
export function sharedCoursesOf(
    idx: RelationIndex,
    selectedGroupIds: number[],
    minShared: number,
): CourseRel[] {
    if (selectedGroupIds.length < 2) return [];
    const sel = new Set(selectedGroupIds);
    const res: CourseRel[] = [];
    idx.courseById.forEach((c) => {
        const hit = c.groupIds.filter((g) => sel.has(g)).length;
        if (hit >= minShared) res.push(c);
    });
    // 命中课组数多的排前，便于在「超出显示上限」时优先保留核心课程
    res.sort((a, b) => b.groupIds.filter((g) => sel.has(g)).length - a.groupIds.filter((g) => sel.has(g)).length || a.name.localeCompare(b.name, "zh-Hans"));
    return res;
}
