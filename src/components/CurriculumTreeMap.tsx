import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {getSchemeData} from "@/data/schemeStore";
import {ATTR_LABELS, ATTR_LABELS_EN} from "../utils/recommend";
import {useAppTheme} from "../theme/ThemeContext";
import {useLocale} from "../i18n/LocaleContext";
import {useMindMapState, PERF_MAX, MIN_MAX, MAIN_SCHEME_COURSES, buildSearchIndex, searchTargets, SCOPE_OPTIONS} from "./mindmapShared";
import type {SearchScope, SearchHit, SearchTarget} from "./mindmapShared";
import {SearchScopeSelect} from "./SearchScopeSelect";


/* ============ 布局常量 ============ */
const BASE_NODE_W = 196;
const BASE_NODE_H = 30;
const BASE_H_GAP = 72; // 层间水平间距
const BASE_V_GAP = 10; // 节点间垂直间距
const BASE_ROOT_V_GAP = 28; // 森林中各根节点树之间的垂直间距

interface Pos {
    x: number;
    y: number;
}

// 按像素宽度截断文本（粗略估算：中文≈fontSize，英文≈0.55*fontSize）
function fitText(text: string, maxWidth: number, fontSize: number): string {
    let w = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const charW = code > 127 ? fontSize : fontSize * 0.55;
        if (w + charW > maxWidth) return text.slice(0, i - 1) + "…";
        w += charW;
    }
    return text;
}

export const CurriculumTreeMap = ({mobile}: {mobile?: boolean}) => {
    const {theme} = useAppTheme();
    const isDark = theme === "dark";
    const {t, locale} = useLocale();
    const zh = locale === "zh";
    const tf = (key: string, params: Record<string, string | number>) =>
        t(key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));

    // 移动端缩小节点尺寸，避免三层层级超出屏幕
    const mNodeW = mobile ? 130 : BASE_NODE_W;
    const mNodeH = mobile ? 24 : BASE_NODE_H;
    const mHGap = mobile ? 32 : BASE_H_GAP;
    const mVGap = mobile ? 7 : BASE_V_GAP;
    const mRootVGap = mobile ? 16 : BASE_ROOT_V_GAP;
    const fontSize = mobile ? 9 : 10;
    const labelFontSize = mobile ? 10 : 11;

    const {
        nodes,
        forestRoots,
        courseGroupCount,
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
    } = useMindMapState();

    const data = getSchemeData() as unknown as {courses: {course_id: string; name: string; credits: number | null; module_type: string | null}[]};
    const courseAttrKeyById = useMemo(() => new Map<string, string>(
        ((data.courses as unknown as Array<{ course_id: string; course_attr?: string | null }>)
            .map((c): [string, string] => [c.course_id, c.course_attr ?? ""])
            .filter(([, key]) => !!key))
    ), [data]);

    /* ============ 搜索（范围选择 + 文本目标：输入关键词列出去重后的目标文本，选定后解析为全部同名节点并一并框出） ============ */
    const searchIndex = useMemo(buildSearchIndex, []);
    const hitById = useMemo(() => new Map(searchIndex.hits.map((h) => [h.id, h])), [searchIndex]);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchScope, setSearchScope] = useState<SearchScope>("main");
    const [searchQuery, setSearchQuery] = useState("");
    const [targetList, setTargetList] = useState<SearchTarget[]>([]); // 去重后的目标文本
    const [selectedTarget, setSelectedTarget] = useState<SearchTarget | null>(null);
    const [searchResults, setSearchResults] = useState<SearchHit[]>([]); // 选定目标解析出的全部同名节点
    const [searchCursor, setSearchCursor] = useState(0);
    const [searchActiveId, setSearchActiveId] = useState<string | null>(null); // 当前游标节点（更强高亮）
    const searchHighlightSet = useMemo(() => new Set(searchResults.map((h) => h.id)), [searchResults]);
    const [searchInfo, setSearchInfo] = useState("");
    // 其他范围的搜索发现：限定单一范围搜索时同步检索另一范围，列表末尾提示可切换（与列表图一致）
    const [otherScopeInfo, setOtherScopeInfo] = useState<{scope: "main" | "basis"; count: number} | null>(null);
    const [confirmExpand, setConfirmExpand] = useState<{needed: number; base: Set<string>} | null>(null);
    const [showCollapseConfirm, setShowCollapseConfirm] = useState(false);
    const expandSnapshot = useRef<Set<string> | null>(null);

    // 展开一组目标节点（全部框出），并定位当前游标节点
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
            // 同步检索另一范围（仅当限定了单一范围时），供「在 XX 中还发现 N 项」引导
            if (scope !== "all" && q.trim()) {
                const other: "main" | "basis" = scope === "main" ? "basis" : "main";
                const n = searchTargets(searchIndex, q, other).length;
                setOtherScopeInfo(n > 0 ? {scope: other, count: n} : null);
            } else {
                setOtherScopeInfo(null);
            }
            if (!q.trim()) {
                setSearchInfo("");
                return;
            }
            if (targets.length === 0) {
                setSearchInfo(t("mindmap.noMatches"));
                return;
            }
            setSearchInfo(tf("mindmap.foundTargets", {n: targets.length}));
        },
        [searchIndex, t, zh],
    );

    // 选定一个文本目标 → 解析为全部同名节点并框出（可能有多个）
    const selectTarget = useCallback(
        (target: SearchTarget) => {
            setSelectedTarget(target);
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
        // 仅关闭搜索浮窗与清除搜索高亮/游标，保持树状图 expanded 结构不变
        setSearchActiveId(null);
        setSearchResults([]);
        setSelectedTarget(null);
        setTargetList([]);
        setSearchQuery("");
        setSearchCursor(0);
        setSearchInfo("");
        setConfirmExpand(null);
        setOtherScopeInfo(null);
        setSearchOpen(false);
    }, []);

    // 切换范围时，用当前关键词重新检索
    const onScopeChange = useCallback(
        (scope: SearchScope) => {
            setSearchScope(scope);
            runSearch(scope, searchQuery, true);
        },
        [runSearch, searchQuery],
    );

    const handleCollapseClick = useCallback(() => {
        if (pinned.size > 0) setShowCollapseConfirm(true);
        else collapseAll();
    }, [pinned.size, collapseAll]);

    // 搜索浮窗拖拽（限制在导图容器内）
    const [popupPos, setPopupPos] = useState<{x: number; y: number} | null>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{sx: number; sy: number; ox: number; oy: number} | null>(null);
    const onPopupHeaderDown = (e: React.MouseEvent) => {
        const init = popupPos ?? {x: 16, y: 16};
        dragRef.current = {sx: e.clientX, sy: e.clientY, ox: init.x, oy: init.y};
        e.preventDefault();
        e.stopPropagation(); // 拖浮窗时不要平移画布
    };
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragRef.current) return;
            const cont = containerRef.current;
            if (!cont) return;
            const rect = cont.getBoundingClientRect();
            const pw = popupRef.current?.offsetWidth ?? 264;
            const ph = popupRef.current?.offsetHeight ?? 220;
            let nx = dragRef.current.ox + (e.clientX - dragRef.current.sx);
            let ny = dragRef.current.oy + (e.clientY - dragRef.current.sy);
            nx = Math.max(0, Math.min(rect.width - pw, nx));
            ny = Math.max(0, Math.min(rect.height - ph, ny));
            setPopupPos({x: nx, y: ny});
        };
        const onUp = () => {
            dragRef.current = null;
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, []);

    /* ============ 计算布局（森林横向树，tidy 递归） ============ */
    const {positions, contentW, contentH} = useMemo(() => {
        const pos = new Map<string, Pos>();
        let cursorY = 0;

        const layout = (id: string, depth: number): number => {
            const n = nodes.get(id);
            if (!n) return cursorY;
            const x = depth * (mNodeW + mHGap);
            const isOpen = expanded.has(id);
            const hasChildren = n.childIds.length > 0;
            if (!hasChildren || !isOpen) {
                pos.set(id, {x, y: cursorY});
                cursorY += mNodeH + mVGap;
                return cursorY - (mNodeH + mVGap) / 2;
            }
            const childCenters: number[] = [];
            for (const cid of n.childIds) childCenters.push(layout(cid, depth + 1));
            const cy = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
            pos.set(id, {x, y: cy - mNodeH / 2});
            return cy;
        };

        for (const rootId of forestRoots) {
            layout(rootId, 0);
            cursorY += mRootVGap;
        }

        const maxX = [...pos.values()].reduce((m, p) => Math.max(m, p.x), 0);
        return {
            positions: pos,
            contentW: maxX + mNodeW + 32,
            contentH: Math.max(cursorY - mRootVGap, mNodeH),
        };
    }, [nodes, forestRoots, expanded]);

    /* ============ 平移 / 缩放 ============ */
    const containerRef = useRef<HTMLDivElement>(null);
    const [tx, setTx] = useState(16);
    const [ty, setTy] = useState(16);
    const [scale, setScale] = useState(1);
    const [keysEnabled, setKeysEnabled] = useState(false);
    const dragging = useRef<{x: number; y: number; tx: number; ty: number; moved?: boolean} | null>(null);
    const touchMovedRef = useRef(false);

    const clampScale = (s: number) => Math.min(2.5, Math.max(0.3, s));
    const pendingRootReset = useRef(false);

    // 复位视口：将主根节点定位到视口左侧约 1/3、垂直居中，确保复位后必见根节点
    const centerOnRoot = useCallback(() => {
        const cont = containerRef.current;
        const p = positions.get(forestRoots[0]) ?? {x: 0, y: 0};
        const s = 1;
        const W = cont?.clientWidth ?? 0;
        const H = cont?.clientHeight ?? 0;
        setScale(s);
        setTx(Math.max(16, W * 0.3 - (p.x + mNodeW / 2) * s));
        setTy(H / 2 - (p.y + mNodeH / 2) * s);
    }, [positions, forestRoots]);

    const resetViewBox = useCallback(() => {
        pendingRootReset.current = false;
        centerOnRoot();
    }, [centerOnRoot]);

    // 「重置」（清空展开/固定/上限）后布局会重算，待新布局渲染完成再把视口移回根节点
    const handleResetAll = useCallback(() => {
        pendingRootReset.current = true;
        resetView();
    }, [resetView]);
    useEffect(() => {
        if (!pendingRootReset.current) return;
        pendingRootReset.current = false;
        centerOnRoot();
    }, [positions, centerOnRoot]);

    // 滚轮缩放（以光标为中心），用原生非 passive 监听以便 preventDefault
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            setScale((prev) => {
                const ns = clampScale(prev * factor);
                const wx = (mx - tx) / prev;
                const wy = (my - ty) / prev;
                setTx(mx - wx * ns);
                setTy(my - wy * ns);
                return ns;
            });
        };
        el.addEventListener("wheel", onWheel, {passive: false});
        return () => el.removeEventListener("wheel", onWheel);
    }, [tx, ty]);

    const onMouseDown = (e: React.MouseEvent) => {
        dragging.current = {x: e.clientX, y: e.clientY, tx, ty};
    };
    const onMouseMove = (e: React.MouseEvent) => {
        if (!dragging.current) return;
        setTx(dragging.current.tx + (e.clientX - dragging.current.x));
        setTy(dragging.current.ty + (e.clientY - dragging.current.y));
    };
    const onMouseUp = () => {
        dragging.current = null;
    };

    // 触摸：单指平移 + 双指捏合缩放（以两指中点为中心，移动端）
    const pinchRef = useRef<{d0: number; s0: number; tx0: number; ty0: number} | null>(null);
    const onTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length >= 2) {
            // 双指按下：记录初始距离与视口，进入捏合缩放模式（停止单指平移）
            const a = e.touches[0];
            const b = e.touches[1];
            pinchRef.current = {
                d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                s0: scale,
                tx0: tx,
                ty0: ty,
            };
            dragging.current = null;
            return;
        }
        const t = e.touches[0];
        if (!t) return;
        dragging.current = {x: t.clientX, y: t.clientY, tx, ty, moved: false};
        touchMovedRef.current = false;
    };
    const onTouchMove = (e: React.TouchEvent) => {
        // 双指捏合：以两指中点为缩放中心
        if (e.touches.length >= 2 && pinchRef.current) {
            const el = containerRef.current;
            if (!el) return;
            const a = e.touches[0];
            const b = e.touches[1];
            const rect = el.getBoundingClientRect();
            const midX = (a.clientX + b.clientX) / 2 - rect.left;
            const midY = (a.clientY + b.clientY) / 2 - rect.top;
            const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            const {d0, s0, tx0, ty0} = pinchRef.current;
            if (d0 <= 0) return;
            const ns = clampScale(s0 * (d / d0));
            const wx = (midX - tx0) / s0;
            const wy = (midY - ty0) / s0;
            setScale(ns);
            setTx(midX - wx * ns);
            setTy(midY - wy * ns);
            touchMovedRef.current = true;
            e.preventDefault();
            return;
        }
        if (!dragging.current) return;
        const t = e.touches[0];
        if (!t) return;
        const dx = t.clientX - dragging.current.x;
        const dy = t.clientY - dragging.current.y;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
            dragging.current.moved = true;
            touchMovedRef.current = true;
        }
        setTx(dragging.current.tx + dx);
        setTy(dragging.current.ty + dy);
        e.preventDefault(); // 阻止浏览器默认滚动/缩放
    };
    const onTouchEnd = (e: React.TouchEvent) => {
        if (e.touches.length < 2) pinchRef.current = null;
        if (e.touches.length === 1) {
            // 双指抬剩一指：无缝衔接为单指平移
            const t = e.touches[0];
            dragging.current = {x: t.clientX, y: t.clientY, tx, ty, moved: true};
            touchMovedRef.current = true;
        } else if (e.touches.length === 0) {
            dragging.current = null;
        }
    };

    // 方向键平移视口（开关控制；开启时拦截方向键，关闭不响应；输入框内不触发）
    useEffect(() => {
        if (!keysEnabled) return;
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            const tag = el?.tagName?.toLowerCase();
            if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
            const step = e.shiftKey ? 120 : 40;
            let handled = true;
            switch (e.key) {
                case "ArrowUp": setTy((v) => v + step); break;
                case "ArrowDown": setTy((v) => v - step); break;
                case "ArrowLeft": setTx((v) => v + step); break;
                case "ArrowRight": setTx((v) => v - step); break;
                default: handled = false;
            }
            if (handled) e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [keysEnabled]);

    // 搜索定位：将当前游标节点居中到视口 3/4 宽、2/3 高处（含节点框长度补偿，使框中心落在目标点）
    const scaleRef = useRef(scale);
    scaleRef.current = scale;
    useEffect(() => {
        if (!searchActiveId) return;
        const p = positions.get(searchActiveId);
        const cont = containerRef.current;
        if (!p || !cont) return;
        const W = cont.clientWidth;
        const H = cont.clientHeight;
        if (!W || !H) return;
        const cx = p.x + mNodeW / 2;
        const cy = p.y + mNodeH / 2;
        const s = scaleRef.current;
        setTx(W * 0.75 - cx * s);
        setTy(H * 0.667 - cy * s);
    }, [searchActiveId, positions]);

    /* ============ 样式 ============ */
    const textMuted = isDark ? "text-white/50" : "text-gray-500";
    const textNormal = isDark ? "text-white/90" : "text-gray-800";
    const borderCls = isDark ? "border-white/10" : "border-gray-200";
    const listDivider = isDark ? "divide-white/10" : "divide-gray-200";
    const hoverBg = isDark ? "hover:bg-white/5" : "hover:bg-gray-100";

    const fillOf = (level: string): {fill: string; stroke: string; text: string} => {
        if (isDark) {
            switch (level) {
                case "root": return {fill: "rgba(134,59,255,0.28)", stroke: "rgba(134,59,255,0.65)", text: "#f0e6ff"};
                case "class": return {fill: "rgba(167,139,250,0.22)", stroke: "rgba(167,139,250,0.55)", text: "#e9d5ff"};
                case "module": return {fill: "rgba(134,59,255,0.16)", stroke: "rgba(134,59,255,0.45)", text: "#d8c4ff"};
                case "basis": return {fill: "rgba(45,212,191,0.16)", stroke: "rgba(45,212,191,0.45)", text: "#9ff0e4"};
                case "group": return {fill: "rgba(59,130,246,0.16)", stroke: "rgba(59,130,246,0.45)", text: "#bcd4ff"};
                case "course": return {fill: "rgba(255,255,255,0.06)", stroke: "rgba(255,255,255,0.14)", text: "rgba(255,255,255,0.88)"};
                default: return {fill: "rgba(255,255,255,0.04)", stroke: "rgba(255,255,255,0.1)", text: "rgba(255,255,255,0.55)"};
            }
        }
        switch (level) {
            case "root": return {fill: "#e0d4ff", stroke: "#a78bfa", text: "#4c1d95"};
            case "class": return {fill: "#f3e8ff", stroke: "#d8b4fe", text: "#6b21a8"};
            case "module": return {fill: "#ede9fe", stroke: "#c4b5fd", text: "#5b21b6"};
            case "basis": return {fill: "#ccfbf1", stroke: "#5eead4", text: "#0f766e"};
            case "group": return {fill: "#dbeafe", stroke: "#93c5fd", text: "#1e40af"};
            case "course": return {fill: "#f3f4f6", stroke: "#d1d5db", text: "#374151"};
            default: return {fill: "#e5e7eb", stroke: "#cbd5e1", text: "#64748b"};
        }
    };
    const edgeColor = isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.16)";
    const searchBtnCls = isDark
        ? "rounded px-2 py-0.5 text-[10px] border border-white/10 text-white/70 hover:bg-white/10"
        : "rounded px-2 py-0.5 text-[10px] border border-gray-200 text-gray-600 hover:bg-gray-100";

    const selNode = selected ? nodes.get(selected) : null;
    const selCourse = selNode?.courseId ? data.courses.find((c) => c.course_id === selNode.courseId) : null;

    /* ============ 连线（先画边，节点覆盖其上） ============ */
    const edges: string[] = [];
    positions.forEach((p, id) => {
        const n = nodes.get(id);
        if (!n) return;
        // 仅当该节点处于展开状态才向下画边（折叠的根/内部节点均不画）
        if (!expanded.has(id) || n.childIds.length === 0) return;
        const px = p.x + mNodeW;
        const py = p.y + mNodeH / 2;
        for (const cid of n.childIds) {
            const cp = positions.get(cid);
            if (!cp) continue;
            const cx = cp.x;
            const cy = cp.y + mNodeH / 2;
            const midX = (px + cx) / 2;
            edges.push(`M${px},${py} C${midX},${py} ${midX},${cy} ${cx},${cy}`);
        }
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* 工具栏（与列表图一致：上限滑块 + 操作） */}
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
                    <button onClick={expandAll} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>{t("mindmap.expandAll")}</button>
                    <button onClick={handleCollapseClick} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>{t("mindmap.collapseAll")}</button>
                    <button onClick={handleResetAll} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>{t("mindmap.reset")}</button>
                </div>
            </div>

            {/* 画布 */}
            <div
                ref={containerRef}
                className={`relative min-h-0 flex-1 overflow-hidden ${isDark ? "bg-[#0e0e14]" : "bg-gray-50"}`}
                style={{cursor: dragging.current ? "grabbing" : "grab", touchAction: "none"}}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
            >
                <svg
                    width={contentW}
                    height={contentH}
                    style={{display: "block", overflow: "visible"}}
                >
                    <g transform={`translate(${tx},${ty}) scale(${scale})`}>
                        {/* 边 */}
                        {edges.map((d, i) => (
                            <path key={`e${i}`} d={d} fill="none" stroke={edgeColor} strokeWidth={1.2} />
                        ))}
                        {/* 节点 */}
                        {[...positions.entries()].map(([id, p]) => {
                            const n = nodes.get(id);
                            if (!n) return null;
                            const isOpen = expanded.has(id);
                            const isPin = pinned.has(id);
                            const hasChildren = n.childIds.length > 0;
                            const isCourse = n.level === "course";
                            const isGroup = n.level === "group";
                            const isRoot = n.level === "root";
                            const c = fillOf(n.level);
                            const isHi = searchHighlightSet.has(id);
                            const isActive = searchActiveId === id;
                            const onClick = () => {
                                if (touchMovedRef.current) return; // 拖动画布后不误触节点
                                if (isCourse) setSelected(id);
                                else toggleExpand(id);
                            };

                            // 文字布局：左侧箭头(8)；pin 在节点框内右下角；课程学分在右侧中部
                            const showPin = (n.level === "class" || n.level === "module" || n.level === "basis" || n.level === "group");
                            const textStart = hasChildren ? 22 : 12;
                            const textEnd = (isCourse && n.sub) || isGroup ? mNodeW - 42 : mNodeW - 12;
                            const maxTextW = Math.max(60, textEnd - textStart);
                            const nodeLabel = zh ? n.label : (n.labelEn ?? n.label);
                            const displayLabel = fitText(nodeLabel, maxTextW, labelFontSize);

                            return (
                                <g key={id} transform={`translate(${p.x},${p.y})`} style={{cursor: "pointer"}} onClick={onClick}>
                                    <title>{nodeLabel}{n.sub ? ` · ${zh ? n.sub : (n.subEn ?? n.sub)}` : ""}</title>
                                    <rect
                                        width={mNodeW}
                                        height={mNodeH}
                                        rx={isHi ? 8 : 6}
                                        fill={isHi ? (isActive ? (isDark ? "rgba(134,59,255,0.24)" : "rgba(134,59,255,0.14)") : (isDark ? "rgba(251,191,36,0.20)" : "rgba(217,119,6,0.12)")) : c.fill}
                                        stroke={isHi ? (isActive ? "#863bff" : (isDark ? "#fbbf24" : "#d97706")) : c.stroke}
                                        strokeWidth={isHi ? (isActive ? 3 : 2.5) : (isRoot ? 1.5 : 1)}
                                        strokeDasharray={n.level === "custom" ? "4 3" : undefined}
                                    />
                                    {/* 展开箭头 */}
                                    {hasChildren && (
                                        <text x={8} y={mNodeH / 2 + 4} fontSize={fontSize} fill={c.text} style={{userSelect: "none"}}>
                                            {isOpen ? "▾" : "▸"}
                                        </text>
                                    )}
                                    {/* 名称 */}
                                    <text
                                        x={textStart}
                                        y={mNodeH / 2 + 4}
                                        fontSize={labelFontSize}
                                        fill={c.text}
                                        style={{userSelect: "none"}}
                                        fontWeight={isRoot || n.level === "class" || n.level === "module" || n.level === "basis" ? 600 : 400}
                                    >
                                        {displayLabel}
                                    </text>
                                    {/* 右侧学分标注：课程 = 本课学分；课组 = 组内课程总学分（与学位评定同口径） */}
                                    {((isCourse && n.sub) || isGroup) && (
                                        <text
                                            x={mNodeW - 8}
                                            y={mNodeH / 2 + 4}
                                            fontSize={mobile ? 8 : 9}
                                            fill={c.text}
                                            opacity={isGroup ? 0.85 : 0.7}
                                            textAnchor="end"
                                            fontWeight={isGroup ? 600 : 400}
                                            style={{userSelect: "none"}}
                                        >
                                            {isCourse ? (zh ? n.sub : (n.subEn ?? n.sub)) : `${n.groupCredits ?? 0} ${t("mindmap.creditUnit")}`}
                                        </text>
                                    )}
                                    {/* 固定按钮：置于节点框内右上角 */}
                                    {showPin && (
                                        <text
                                            x={mNodeW - 6}
                                            y={mobile ? 9 : 11}
                                            fontSize={fontSize}
                                            textAnchor="end"
                                            fill={isPin ? (isDark ? "#fcd34d" : "#d97706") : c.text}
                                            opacity={isPin ? 1 : 0.55}
                                            style={{userSelect: "none", pointerEvents: "all"}}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                togglePin(id);
                                            }}
                                        >
                                            {isPin ? "📌" : "📍"}
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                    </g>
                </svg>

                {/* 缩放控制 + 搜索入口（右下角）；复位为纵向胶囊按钮（文字竖排） */}
                <div className={`absolute bottom-3 right-3 flex flex-col items-center gap-1 ${isDark ? "text-white/80" : "text-gray-700"}`}>
                    {!mobile && (
                        <button
                            onClick={() => setKeysEnabled((v) => !v)}
                            title={keysEnabled ? t("mindmap.keysOn") : t("mindmap.keysOff")}
                            className={`h-7 w-7 rounded border text-[12px] transition-colors ${
                                keysEnabled
                                    ? isDark
                                        ? "bg-[#863bff] text-white border-[#863bff] shadow-[0_0_0_3px_rgba(134,59,255,0.45)]"
                                        : "bg-[#863bff] text-white border-[#863bff] shadow-[0_0_0_3px_rgba(134,59,255,0.35)]"
                                    : `${borderCls} ${hoverBg} ${isDark ? "bg-[#1a1a22] text-white/80" : "bg-white text-gray-700"}`
                            }`}
                        >⌨</button>
                    )}
                    <button
                        onClick={() => setSearchOpen((o) => !o)}
                        title={t("mindmap.searchPopup")}
                        className={`h-7 w-7 rounded border text-[13px] ${borderCls} ${hoverBg} ${isDark ? "bg-[#1a1a22]" : "bg-white"}`}
                    >🔍</button>
                    <button
                        onClick={() => setScale((s) => clampScale(s * 1.15))}
                        className={`h-7 w-7 rounded border text-sm ${borderCls} ${hoverBg} ${isDark ? "bg-[#1a1a22]" : "bg-white"}`}
                    >＋</button>
                    <button
                        onClick={() => setScale((s) => clampScale(s / 1.15))}
                        className={`h-7 w-7 rounded border text-sm ${borderCls} ${hoverBg} ${isDark ? "bg-[#1a1a22]" : "bg-white"}`}
                    >－</button>
                    <span className={`text-[10px] ${textMuted}`}>{Math.round(scale * 100)}%</span>
                    <button
                        onClick={resetViewBox}
                        title={t("mindmap.resetView")}
                        className={`flex w-7 flex-col items-center rounded-full border shadow-sm transition-colors ${
                            mobile ? "py-2.5" : "py-2"
                        } ${
                            isDark
                                ? "border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25"
                                : "border-blue-500/40 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"
                        }`}
                    >
                        <span className="text-[12px] leading-none">⟳</span>
                        <span className="mt-1 text-[10px] leading-none [writing-mode:vertical-rl] tracking-[0.2em]">{t("mindmap.resetView")}</span>
                    </button>
                </div>

                {/* 搜索浮窗（可在导图区域内拖拽） */}
                {searchOpen && (
                    <div
                        ref={popupRef}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchMove={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => e.stopPropagation()}
                        className={`absolute z-40 rounded-lg border shadow-xl ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"} ${mobile ? "left-2 top-2 w-1/2" : "w-[264px]"}`}
                        style={mobile ? undefined : {left: popupPos?.x ?? 16, top: popupPos?.y ?? 16}}
                    >
                        <div
                            className={`flex items-center justify-between px-2.5 py-1.5 cursor-move rounded-t-lg ${isDark ? "bg-white/5" : "bg-gray-100"}`}
                            onMouseDown={onPopupHeaderDown}
                        >
                            <span className={`text-[11px] font-medium ${textNormal}`}>{t("mindmap.searchPopup")}</span>
                            <button onClick={closeSearch} className={`text-[12px] ${textMuted} hover:opacity-70`}>✕</button>
                        </div>
                        <div className="p-2.5 space-y-2">
                            <div className="flex gap-1.5">
                                <SearchScopeSelect value={searchScope} onChange={onScopeChange} isDark={isDark} />
                                <input
                                    value={searchQuery}
                                    onChange={(e) => { setSearchQuery(e.target.value); runSearch(searchScope, e.target.value); }}
                                    placeholder={t("mindmap.searchPlaceholder")}
                                    className={`flex-1 min-w-0 rounded border px-2 py-1 text-[11px] outline-none ${borderCls} ${isDark ? "bg-white/5 text-white/90 placeholder-white/30" : "bg-white text-gray-800 placeholder-gray-400"}`}
                                />
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
                                <div className={`flex items-center justify-between text-[10px] ${textMuted}`}>
                                    <span>{tf("mindmap.position", {i: searchCursor + 1, n: searchResults.length})}</span>
                                    <div className="flex gap-1">
                                        <button onClick={gotoPrev} className={searchBtnCls}>{t("mindmap.prev")}</button>
                                        <button onClick={gotoNext} className={searchBtnCls}>{t("mindmap.next")}</button>
                                    </div>
                                </div>
                            )}
                            {selectedTarget && searchResults.length > 0 && (
                                <button onClick={expandAllMatches} className={`w-full rounded border px-2 py-1 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>{t("mindmap.expandMatchesBtn")}</button>
                            )}
                            {searchInfo && (
                                <div className={`text-[10px] ${searchInfo.includes("未展开") || searchInfo.includes("not expanded") ? "text-orange-500" : textMuted}`}>{searchInfo}</div>
                            )}
                        </div>
                    </div>
                )}
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
        </div>
    );
};
