import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import structuredData from "@/data/structured_data.json";
import {useAppTheme} from "../theme/ThemeContext";
import {useMindMapState, PERF_MAX, MIN_MAX, MAIN_SCHEME_COURSES, buildSearchIndex, searchTargets} from "./mindmapShared";
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

    const data = structuredData as unknown as {courses: {course_id: string; name: string; credits: number | null; module_type: string | null}[]};

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
            if (!q.trim()) {
                setSearchInfo("");
                return;
            }
            if (targets.length === 0) {
                setSearchInfo("无匹配目标");
                return;
            }
            setSearchInfo(`找到 ${targets.length} 个目标文本，点击即可定位`);
        },
        [searchIndex],
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
        // 仅关闭搜索浮窗与清除搜索高亮/游标，保持树状图 expanded 结构不变
        setSearchActiveId(null);
        setSearchResults([]);
        setSelectedTarget(null);
        setTargetList([]);
        setSearchQuery("");
        setSearchCursor(0);
        setSearchInfo("");
        setConfirmExpand(null);
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
    const resetViewBox = useCallback(() => {
        setTx(16);
        setTy(16);
        setScale(1);
    }, []);

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

    // 触摸平移（移动端）：与鼠标拖拽逻辑一致，并防止误触节点
    const onTouchStart = (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!t) return;
        dragging.current = {x: t.clientX, y: t.clientY, tx, ty, moved: false};
        touchMovedRef.current = false;
    };
    const onTouchMove = (e: React.TouchEvent) => {
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
    const onTouchEnd = () => {
        dragging.current = null;
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
                    <button onClick={expandAll} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>展开全部</button>
                    <button onClick={handleCollapseClick} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>收起全部</button>
                    <button onClick={resetView} className={`flex-1 rounded border px-1 py-0.5 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>重置</button>
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
                            const displayLabel = fitText(n.label, maxTextW, labelFontSize);

                            return (
                                <g key={id} transform={`translate(${p.x},${p.y})`} style={{cursor: "pointer"}} onClick={onClick}>
                                    <title>{n.label}{n.sub ? ` · ${n.sub}` : ""}</title>
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
                                            {isCourse ? n.sub : `${n.groupCredits ?? 0} 学分`}
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

                {/* 缩放控制 + 搜索入口（右下角） */}
                <div className={`absolute bottom-3 right-3 flex flex-col items-center gap-1 ${isDark ? "text-white/80" : "text-gray-700"}`}>
                    {!mobile && (
                        <button
                            onClick={() => setKeysEnabled((v) => !v)}
                            title={keysEnabled ? "方向键平移：已开启（点击关闭）" : "方向键平移：已关闭（点击开启）"}
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
                        title="搜索导图"
                        className={`h-7 w-7 rounded border text-[13px] ${borderCls} ${hoverBg} ${isDark ? "bg-[#1a1a22]" : "bg-white"}`}
                    >🔍</button>
                    <span className={`text-[10px] ${textMuted}`}>{Math.round(scale * 100)}%</span>
                    <button
                        onClick={() => setScale((s) => clampScale(s * 1.15))}
                        className={`h-7 w-7 rounded border text-sm ${borderCls} ${hoverBg} ${isDark ? "bg-[#1a1a22]" : "bg-white"}`}
                    >＋</button>
                    <button
                        onClick={() => setScale((s) => clampScale(s / 1.15))}
                        className={`h-7 w-7 rounded border text-sm ${borderCls} ${hoverBg} ${isDark ? "bg-[#1a1a22]" : "bg-white"}`}
                    >－</button>
                    <button
                        onClick={resetViewBox}
                        className={`h-7 w-7 rounded border text-[10px] ${borderCls} ${hoverBg} ${isDark ? "bg-[#1a1a22]" : "bg-white"}`}
                        title="复位视图"
                    >⟳</button>
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
                            <span className={`text-[11px] font-medium ${textNormal}`}>搜索导图</span>
                            <button onClick={closeSearch} className={`text-[12px] ${textMuted} hover:opacity-70`}>✕</button>
                        </div>
                        <div className="p-2.5 space-y-2">
                            <div className="flex gap-1.5">
                                <SearchScopeSelect value={searchScope} onChange={onScopeChange} isDark={isDark} />
                                <input
                                    value={searchQuery}
                                    onChange={(e) => { setSearchQuery(e.target.value); runSearch(searchScope, e.target.value); }}
                                    placeholder="输入关键词…"
                                    className={`flex-1 min-w-0 rounded border px-2 py-1 text-[11px] outline-none ${borderCls} ${isDark ? "bg-white/5 text-white/90 placeholder-white/30" : "bg-white text-gray-800 placeholder-gray-400"}`}
                                />
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
                                        <button onClick={gotoPrev} className={searchBtnCls}>上一个</button>
                                        <button onClick={gotoNext} className={searchBtnCls}>下一个</button>
                                    </div>
                                </div>
                            )}
                            {selectedTarget && searchResults.length > 0 && (
                                <button onClick={expandAllMatches} className={`w-full rounded border px-2 py-1 text-[10px] ${borderCls} ${textMuted} ${hoverBg}`}>展开全部匹配</button>
                            )}
                            {searchInfo && (
                                <div className={`text-[10px] ${searchInfo.includes("未展开") ? "text-orange-500" : textMuted}`}>{searchInfo}</div>
                            )}
                        </div>
                    </div>
                )}
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
        </div>
    );
};
