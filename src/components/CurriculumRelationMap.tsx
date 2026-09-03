import {useState, useMemo, useEffect, useRef} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {
  buildRelationIndex,
  sharedCoursesOf,
  type RelClass,
  type GroupRel,
} from "./mindmapShared";

/* ============ 关系图：聚焦式二分网络 ============
 * 视图模型（对应你最初的两个需求）：
 *   关系1 —— 课程存在于哪些课组：左侧选课程 → 右侧以该课为中心、其所属 ≤6 课组环绕辐射（边数硬上限 6）。
 *   关系2 —— 多课组共同课：左侧勾选若干课组 → 右侧只画「被 ≥N 个所选课组共享」的课程（默认 N=2）。
 * 复杂度上限（你提的「线不要太多」）双保险：
 *   - 对比课组上限 K（2–6，默认 4）：限制可同时勾选的课组数，避免「勾 26 个」爆炸。
 *   - 共享课组数 ≥ N（2–K，默认 2）：只画被足够多课组共享的课程，N 调大 → 连线骤减。
 * 范围：仅培养方案课组，基础与通识已排除（其跨组数为 0，画进来只是噪声）。
 *
 * 画布交互（2026-09-03 新增）：
 *   - 以当前实现尺寸为缩放最小值（scale ≥ 1），滚轮以光标为锚放大/缩小，按住拖拽平移。
 *   - 右上角浮动控件提供 ＋/－/复位；当前内容场景切换时自动复位到 scale=1。
 */

const STORAGE_KEY = "oc_relation_v1";
const DISPLAY_CAP = 20; // 课组交集模式：右侧最多同时绘制的课程数（超出则按命中课组数取前 N 并提示）
const MIN_SCALE = 1; // 当前实现尺寸即最小缩放
const MAX_SCALE = 4;
const WHEEL_STEP = 1.12;
const BTN_STEP = 1.2;
const DRAG_THRESHOLD = 3; // 像素，超过则判定为拖拽而非点击

interface Persist {
  mode: "course" | "group";
  minShared: number;
  maxGroups: number;
  selectedGroupIds: number[];
}
function loadPersist(): Persist {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {mode: "course", minShared: 2, maxGroups: 4, selectedGroupIds: []};
    const p = JSON.parse(raw);
    const mode: "course" | "group" = p.mode === "group" ? "group" : "course";
    const maxGroups = typeof p.maxGroups === "number" ? Math.min(6, Math.max(2, p.maxGroups)) : 4;
    const minShared = typeof p.minShared === "number" ? Math.min(maxGroups, Math.max(2, p.minShared)) : 2;
    const selectedGroupIds = Array.isArray(p.selectedGroupIds)
      ? p.selectedGroupIds.filter((x: unknown) => typeof x === "number").slice(0, maxGroups)
      : [];
    return {mode, minShared, maxGroups, selectedGroupIds};
  } catch {
    return {mode: "course", minShared: 2, maxGroups: 4, selectedGroupIds: []};
  }
}

const CLASS_ORDER: RelClass[] = ["Ⅰ类", "Ⅱ类", "Ⅲ类"];
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export function CurriculumRelationMap() {
  const {locale} = useLocale();
  const {theme} = useAppTheme();
  const isDark = theme === "dark";
  const zh = locale === "zh";

  const idx = useMemo(() => buildRelationIndex(), []);
  const init = useMemo(loadPersist, []);

  const [mode, setMode] = useState<"course" | "group">(init.mode);
  const [minShared, setMinShared] = useState<number>(init.minShared);
  const [maxGroups, setMaxGroups] = useState<number>(init.maxGroups);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>(init.selectedGroupIds);

  const [focusCourseId, setFocusCourseId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<"all" | RelClass>("all");

  // ---------- 画布缩放 / 平移状态 ----------
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  // 实时引用，供原生 wheel 监听读取最新值
  const scaleRef = useRef(scale); scaleRef.current = scale;
  const txRef = useRef(tx); txRef.current = tx;
  const tyRef = useRef(ty); tyRef.current = ty;
  const movedRef = useRef(false); // 拖拽判定：True 时抑制节点点击
  const dragStart = useRef<{vx: number; vy: number; tx: number; ty: number} | null>(null);

  // 持久化：仅存偏好与轻量选择，展开/聚焦态不污染其它视图的 oc_mindmap_v1
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({mode, minShared, maxGroups, selectedGroupIds}));
  }, [mode, minShared, maxGroups, selectedGroupIds]);

  // 场景切换（模式 / 聚焦课程 / 已选课组集）时复位缩放，避免内容变化后视图错位
  useEffect(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, [mode, focusCourseId, selectedGroupIds]);

  // ---------- 坐标转换：屏幕(client) → SVG viewBox 用户坐标 ----------
  const clientToVB = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return {x: 0, y: 0};
    const ctm = svg.getScreenCTM();
    if (!ctm) return {x: 0, y: 0};
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const r = pt.matrixTransform(ctm.inverse());
    return {x: r.x, y: r.y};
  };

  // 以 viewBox 中某点为锚缩放（保持该点屏幕位置不动）
  const zoomAround = (anchorX: number, anchorY: number, nextScale: number) => {
    const s1 = scaleRef.current;
    const s2 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    if (s2 === s1) return;
    const t1x = txRef.current, t1y = tyRef.current;
    const ratio = s2 / s1;
    const tx2 = anchorX - (anchorX - t1x) * ratio;
    const ty2 = anchorY - (anchorY - t1y) * ratio;
    setScale(s2);
    setTx(tx2);
    setTy(ty2);
  };

  // 滚轮缩放：以光标为锚（原生监听以保证 preventDefault 生效，非 passive）
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const {x: vx, y: vy} = clientToVB(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      zoomAround(vx, vy, scaleRef.current * factor);
    };
    svg.addEventListener("wheel", onWheel, {passive: false});
    return () => svg.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 浮动控件 ＋/－（以画布中心为锚）
  const zoomByButton = (factor: number) => zoomAround(W / 2, H / 2, scaleRef.current * factor);
  const resetZoom = () => { setScale(1); setTx(0); setTy(0); };

  // ---------- 拖拽平移 ----------
  const onDown = (e: React.MouseEvent) => {
    const {x: vx, y: vy} = clientToVB(e.clientX, e.clientY);
    dragStart.current = {vx, vy, tx: txRef.current, ty: tyRef.current};
    movedRef.current = false;
    setDragging(true);
  };
  const onMove = (e: React.MouseEvent) => {
    const d = dragStart.current;
    if (!d) return;
    const {x: vx, y: vy} = clientToVB(e.clientX, e.clientY);
    if (Math.hypot(vx - d.vx, vy - d.vy) > DRAG_THRESHOLD) movedRef.current = true;
    setTx(d.tx + (vx - d.vx));
    setTy(d.ty + (vy - d.vy));
  };
  const onUp = () => { dragStart.current = null; setDragging(false); };

  const palette: Record<RelClass, {stroke: string; fill: string; text: string; soft: string}> = isDark
    ? {
        "Ⅰ类": {stroke: "#818cf8", fill: "#312e81", text: "#c7d2fe", soft: "rgba(129,140,248,0.22)"},
        "Ⅱ类": {stroke: "#2dd4bf", fill: "#134e4a", text: "#99f6e4", soft: "rgba(45,212,191,0.22)"},
        "Ⅲ类": {stroke: "#fbbf24", fill: "#78350f", text: "#fde68a", soft: "rgba(251,191,36,0.22)"},
      }
    : {
        "Ⅰ类": {stroke: "#4f46e5", fill: "#eef2ff", text: "#3730a3", soft: "rgba(79,70,229,0.10)"},
        "Ⅱ类": {stroke: "#0d9488", fill: "#ecfdf5", text: "#0f766e", soft: "rgba(13,148,136,0.10)"},
        "Ⅲ类": {stroke: "#d97706", fill: "#fffbeb", text: "#b45309", soft: "rgba(217,119,6,0.10)"},
      };

  const focusCourse = focusCourseId ? idx.courseById.get(focusCourseId) ?? null : null;
  const selSet = useMemo(() => new Set(selectedGroupIds), [selectedGroupIds]);
  const shared = useMemo(
    () => sharedCoursesOf(idx, selectedGroupIds, minShared),
    [idx, selectedGroupIds, minShared],
  );

  // ---------- 颜色/文案 ----------
  const muted = isDark ? "text-white/50" : "text-gray-500";
  const panelBg = isDark ? "bg-[#16161f]" : "bg-gray-50";
  const borderCls = isDark ? "border-white/10" : "border-gray-200";
  const chipOn = isDark ? "bg-white/10 text-white border-white/20" : "bg-[#863bff]/10 text-[#863bff] border-[#863bff]/30";
  const chipOff = isDark ? "border-white/10 text-white/55 hover:text-white/85" : "border-gray-200 text-gray-500 hover:text-gray-800";
  const accent = isDark ? "#c4a3ff" : "#863bff";

  // ---------- 左侧列表 ----------
  const filteredCourses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return idx.crossCourses.filter((c) => {
      if (classFilter !== "all" && c.classTag !== classFilter) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [idx, search, classFilter]);

  const groupsByClass = useMemo(() => {
    const map: Record<RelClass, GroupRel[]> = {"Ⅰ类": [], "Ⅱ类": [], "Ⅲ类": []};
    idx.groups.forEach((g) => map[g.classTag].push(g));
    CLASS_ORDER.forEach((c) => map[c].sort((a, b) => a.groupId - b.groupId));
    return map;
  }, [idx]);

  const toggleGroup = (gid: number) => {
    if (selSet.has(gid)) {
      setSelectedGroupIds((prev) => prev.filter((x) => x !== gid));
    } else {
      if (selSet.size >= maxGroups) return; // 命中上限，忽略（UI 会提示）
      setSelectedGroupIds((prev) => [...prev, gid]);
    }
  };

  const resetView = () => {
    setFocusCourseId(null);
    setSelectedGroupIds([]);
    setSearch("");
    resetZoom();
  };

  // ---------- 右侧 SVG 内容（不含 <svg> 外壳，统一由外层包裹以实现缩放） ----------
  const W = 760;
  const H = 540;
  let innerSVG: React.ReactNode = null;
  let placeholder: React.ReactNode = null;

  if (mode === "course") {
    if (!focusCourse) {
      // 入口：35 门跨组课作为节点（无连线，避免面条），点击聚焦
      const N = idx.crossCourses.length;
      const R = 210;
      const cx = 380;
      const cy = 250;
      const nodes = idx.crossCourses.map((c, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
        return {c, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a)};
      });
      innerSVG = (
        <>
          {nodes.map(({c, x, y}) => {
            const col = palette[c.classTag];
            return (
              <g key={c.courseId} className="cursor-pointer" onClick={() => { if (movedRef.current) return; setFocusCourseId(c.courseId); }}>
                <title>{`${c.name}（×${c.groupCount}组）`}</title>
                <circle cx={x} cy={y} r={c.groupCount >= 5 ? 11 : c.groupCount >= 3 ? 9 : 7} fill={col.fill} stroke={col.stroke} strokeWidth={2} />
                <circle cx={x} cy={y} r={2.5} fill={col.stroke} />
              </g>
            );
          })}
          <text x={cx} y={cy + R + 34} textAnchor="middle" fontSize={13} fill={isDark ? "rgba(255,255,255,0.6)" : "#6b7280"}>
            {zh ? "点击任意课程，查看其所属课组（共 " + N + " 门跨组课）" : `Click a course to see its groups (${N} cross-group courses)`}
          </text>
        </>
      );
    } else {
      // 聚焦：课程为中心，所属课组环绕辐射（≤6 边）
      const c = focusCourse;
      const n = c.groupIds.length;
      const cx = 380;
      const cy = 270;
      const R = 200;
      const gNodes = c.groupIds.map((gid, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        return {gid, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a)};
      });
      innerSVG = (
        <>
          {/* 连线（中心→课组），长度受 n≤6 硬上界 */}
          {gNodes.map(({gid, x, y}) => {
            const col = palette[idx.groupById.get(gid)!.classTag];
            return <line key={"l" + gid} x1={cx} y1={cy} x2={x} y2={y} stroke={col.stroke} strokeWidth={2} opacity={0.55} />;
          })}
          {/* 课组节点 */}
          {gNodes.map(({gid, x, y}) => {
            const g = idx.groupById.get(gid)!;
            const col = palette[g.classTag];
            const w = 180;
            const h = 36;
            return (
              <g key={"g" + gid}>
                <title>{`${g.name}（模块${g.moduleId} · 共 ${g.totalCredits} 学分）`}</title>
                <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={8} fill={col.fill} stroke={col.stroke} strokeWidth={1.5} />
                <text x={x} y={y - 3} textAnchor="middle" fontSize={12} fontWeight={600} fill={col.text}>{trunc(g.name, 11)}</text>
                <text x={x} y={y + 12} textAnchor="middle" fontSize={10} fill={col.text} opacity={0.75}>模块{g.moduleId} · {g.totalCredits}学分</text>
              </g>
            );
          })}
          {/* 中心课程节点 */}
          <g>
            <rect x={cx - 95} y={cy - 26} width={190} height={52} rx={12} fill={isDark ? "#1f1f2e" : "#ffffff"} stroke={accent} strokeWidth={2.5} />
            <text x={cx} y={cy - 4} textAnchor="middle" fontSize={14} fontWeight={700} fill={isDark ? "#fff" : "#1f2937"}>{trunc(c.name, 12)}</text>
            <text x={cx} y={cy + 14} textAnchor="middle" fontSize={11} fill={accent}>{c.credits} 学分 · 跨 {c.groupCount} 个课组</text>
          </g>
        </>
      );
    }
  } else {
    // 关系2：课组交集二分网络
    if (selectedGroupIds.length < 2) {
      placeholder = (
        <div className={`flex h-full flex-col items-center justify-center gap-2 px-6 text-center ${muted}`}>
          <div className="text-sm">{zh ? "勾选 2 个及以上课组" : "Select 2+ groups"}</div>
          <div className="text-xs">{zh ? `在左侧勾选课组（上限 ${maxGroups} 个），这里会画出它们的共同课程` : `Pick groups on the left (max ${maxGroups}) to see shared courses`}</div>
        </div>
      );
    } else {
      const cap = Math.min(shared.length, DISPLAY_CAP);
      const shown = shared.slice(0, cap);
      const gy0 = 70;
      const gy1 = 470;
      const n = selectedGroupIds.length;
      const gPos = selectedGroupIds.map((gid, i) => ({gid, x: 150, y: n === 1 ? 270 : gy0 + ((gy1 - gy0) * i) / (n - 1)}));
      const cy0 = 60;
      const cy1 = 480;
      const cPos = shown.map((c, i) => ({c, x: 610, y: cap === 1 ? 270 : cy0 + ((cy1 - cy0) * i) / (cap - 1)}));
      const gPosMap = new Map(gPos.map((p) => [p.gid, p]));
      // 统计边数
      let edgeCount = 0;
      cPos.forEach(({c}) => c.groupIds.forEach((g) => { if (selSet.has(g)) edgeCount++; }));

      innerSVG = (
        <>
          {/* 连线（课组→共同课程），颜色取所属课组的类色 */}
          {cPos.map(({c, x, y}) =>
            c.groupIds.map((gid) => {
              if (!selSet.has(gid)) return null;
              const gp = gPosMap.get(gid)!;
              const col = palette[idx.groupById.get(gid)!.classTag];
              return <line key={`${c.courseId}-${gid}`} x1={gp.x} y1={gp.y} x2={x} y2={y} stroke={col.stroke} strokeWidth={1.6} opacity={0.5} />;
            }),
          )}
          {/* 课组节点（左列） */}
          {gPos.map(({gid, x, y}) => {
            const g = idx.groupById.get(gid)!;
            const col = palette[g.classTag];
            const w = 180;
            const h = 34;
            return (
              <g key={"g" + gid}>
                <title>{`${g.name}（模块${g.moduleId} · 共 ${g.totalCredits} 学分）`}</title>
                <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={8} fill={col.fill} stroke={col.stroke} strokeWidth={1.5} />
                <text x={x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill={col.text}>{trunc(g.name, 11)}</text>
              </g>
            );
          })}
          {/* 共同课程节点（右列） */}
          {cPos.map(({c, x, y}) => {
            const col = palette[c.classTag];
            const hit = c.groupIds.filter((g) => selSet.has(g)).length;
            const w = 158;
            const h = 32;
            return (
              <g key={"c" + c.courseId}>
                <title>{`${c.name}（被 ${hit} 个所选课组共享）`}</title>
                <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={8} fill={col.fill} stroke={col.stroke} strokeWidth={1.5} />
                <text x={x} y={y + 4} textAnchor="middle" fontSize={11.5} fill={col.text}>{trunc(c.name, 11)} <tspan fontSize={10} opacity={0.7}>×{hit}</tspan></text>
              </g>
            );
          })}
          {/* 角标：当前连线数 */}
          <text x={W - 12} y={22} textAnchor="end" fontSize={11} fill={isDark ? "rgba(255,255,255,0.6)" : "#6b7280"}>
            {zh ? `连线 ${edgeCount} 条` : `${edgeCount} edges`}
          </text>
          {shared.length > cap && (
            <text x={W - 12} y={40} textAnchor="end" fontSize={10} fill={isDark ? "rgba(255,255,255,0.45)" : "#9ca3af"}>
              {zh ? `（共 ${shared.length} 门，已显示前 ${cap} 门；调高「共享课组数≥」可精简）` : `(of ${shared.length}, showing top ${cap}; raise “shared≥” to thin)`}
            </text>
          )}
        </>
      );
    }
  }

  const showZoom = placeholder === null;

  // ---------- 渲染 ----------
  return (
    <div className="flex min-h-0 flex-1 w-full">
      {/* 左侧：入口 / 课组选择器 */}
      <div className={`flex w-60 shrink-0 flex-col border-r ${borderCls} ${panelBg}`}>
        {/* 模式切换 */}
        <div className="flex gap-1 p-2">
          {(["course", "group"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${active ? chipOn : chipOff}`}
              >
                {m === "course" ? (zh ? "课程视角" : "Course") : (zh ? "课组视角" : "Group")}
              </button>
            );
          })}
        </div>

        {mode === "course" ? (
          <>
            <div className="px-2 pb-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={zh ? "搜索课程…" : "Search course…"}
                className={`w-full rounded-md border px-2 py-1 text-xs outline-none ${borderCls} ${isDark ? "bg-white/5 text-white/90 placeholder-white/30" : "bg-white text-gray-800 placeholder-gray-400"}`}
              />
            </div>
            <div className="flex gap-1 px-2 pb-2">
              {(["all", "Ⅰ类", "Ⅱ类", "Ⅲ类"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setClassFilter(f)}
                  className={`flex-1 rounded-md border px-1 py-1 text-[10px] transition-colors ${classFilter === f ? chipOn : chipOff}`}
                >
                  {f === "all" ? (zh ? "全部" : "All") : f}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {filteredCourses.map((c) => {
                const col = palette[c.classTag];
                const active = focusCourseId === c.courseId;
                return (
                  <button
                    key={c.courseId}
                    onClick={() => setFocusCourseId(c.courseId)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                      active ? (isDark ? "border-white/30 bg-white/10" : "border-[#863bff]/40 bg-[#863bff]/5") : borderCls + " " + (isDark ? "hover:bg-white/5" : "hover:bg-gray-100")
                    }`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{background: col.stroke}} />
                    <span className={`flex-1 truncate text-[11px] ${isDark ? "text-white/85" : "text-gray-700"}`}>{c.name}</span>
                    <span className="shrink-0 text-[10px]" style={{color: col.stroke}}>×{c.groupCount}</span>
                  </button>
                );
              })}
              {filteredCourses.length === 0 && <div className={`px-2 py-3 text-center text-[11px] ${muted}`}>{zh ? "无匹配课程" : "No match"}</div>}
            </div>
          </>
        ) : (
          <>
            {/* 上限控制 */}
            <div className="px-3 py-2 text-[11px]">
              <div className="mb-1 flex items-center justify-between">
                <span className={muted}>{zh ? "对比课组上限 K" : "Max groups K"}</span>
                <span style={{color: accent}} className="font-medium">{maxGroups}</span>
              </div>
              <input type="range" min={2} max={6} step={1} value={maxGroups} onChange={(e) => {
                const v = Number(e.target.value);
                setMaxGroups(v);
                setMinShared((m) => Math.min(m, v));
                setSelectedGroupIds((prev) => prev.slice(0, v));
              }} className="w-full accent-[#863bff]" />
              <div className="mb-1 mt-3 flex items-center justify-between">
                <span className={muted}>{zh ? "共享课组数 ≥ N" : "Shared by ≥ N"}</span>
                <span style={{color: accent}} className="font-medium">{minShared}</span>
              </div>
              <input type="range" min={2} max={maxGroups} step={1} value={minShared} onChange={(e) => setMinShared(Number(e.target.value))} className="w-full accent-[#863bff]" />
            </div>
            <div className="flex items-center justify-between px-3 pb-1 text-[10px]">
              <span className={muted}>{zh ? `已选 ${selectedGroupIds.length}/${maxGroups}` : `Selected ${selectedGroupIds.length}/${maxGroups}`}</span>
              <span className={muted}>{zh ? `共同课 ${shared.length} 门` : `${shared.length} shared`}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {CLASS_ORDER.map((cls) => (
                <div key={cls} className="mb-2">
                  <div className={`mb-1 px-1 text-[10px] font-semibold ${muted}`}>{cls}</div>
                  <div className="flex flex-wrap gap-1">
                    {groupsByClass[cls].map((g) => {
                      const on = selSet.has(g.groupId);
                      const col = palette[cls];
                      const disabled = !on && selSet.size >= maxGroups;
                      return (
                        <button
                          key={g.groupId}
                          onClick={() => toggleGroup(g.groupId)}
                          disabled={disabled}
                          title={`${g.name}（模块${g.moduleId}）`}
                          className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                            on ? "" : disabled ? (isDark ? "opacity-30 border-white/10 text-white/40" : "opacity-30 border-gray-200 text-gray-400") : chipOff
                          }`}
                          style={on ? {borderColor: col.stroke, background: col.soft, color: col.text} : undefined}
                        >
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 底部：重置 + 图例 */}
        <div className={`flex items-center justify-between border-t px-3 py-1.5 ${borderCls}`}>
          <button onClick={resetView} className={`rounded px-2 py-0.5 text-[10px] border ${chipOff}`}>{zh ? "重置" : "Reset"}</button>
          <div className="flex items-center gap-2">
            {CLASS_ORDER.map((cls) => (
              <span key={cls} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{background: palette[cls].stroke}} />
                <span className={`text-[9px] ${muted}`}>{cls}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧：可缩放 / 平移的 SVG 网络 */}
      <div className="relative flex-1 min-w-0">
        {placeholder ?? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-full select-none"
            preserveAspectRatio="xMidYMid meet"
            style={{cursor: dragging ? "grabbing" : "grab"}}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
          >
            <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
              {innerSVG}
            </g>
          </svg>
        )}

        {/* 缩放控件（仅在画布显示时） */}
        {showZoom && (
          <div className={`absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border px-1.5 py-1 shadow-sm backdrop-blur ${borderCls} ${isDark ? "bg-[#16161f]/85" : "bg-white/85"}`}>
            <button
              onClick={() => zoomByButton(1 / BTN_STEP)}
              className={`flex h-6 w-6 items-center justify-center rounded text-sm font-bold ${chipOff}`}
              title={zh ? "缩小" : "Zoom out"}
            >
              −
            </button>
            <span className={`w-10 text-center text-[10px] tabular-nums ${muted}`}>{Math.round(scale * 100)}%</span>
            <button
              onClick={() => zoomByButton(BTN_STEP)}
              className={`flex h-6 w-6 items-center justify-center rounded text-sm font-bold ${chipOff}`}
              title={zh ? "放大" : "Zoom in"}
            >
              ＋
            </button>
            <button
              onClick={resetZoom}
              className={`flex h-6 items-center rounded px-1.5 text-[10px] font-medium ${chipOff}`}
              title={zh ? "复位视图" : "Reset view"}
            >
              {zh ? "复位" : "Fit"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
