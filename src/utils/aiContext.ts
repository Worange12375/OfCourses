// AI 助手个人上下文：把工作台的选课历史（oc_history / oc_custom 或上传 JSON）
// 整理成紧凑文本，随提问发给模型做个性化分析。
// 数据只在用户浏览器本地生成，随单次请求发给模型，服务器不落库。
// 课组/轨道索引按年级惰性构建（ensureBuilt 模式，同 degreeEval.ts），切换年级自动重建。

import {getSchemeData, getSchemeYear, type SchemeData} from "@/data/schemeStore";

type History = Record<string, string[]>;
type Custom = Record<string, Array<{ id: string; name: string; credits: number; property?: string }>>;

export interface AiUserData {
  history: History;
  custom: Custom;
  text: string;       // 发送给模型的上下文文本
  semesters: number;  // 学期数
  courses: number;    // 课程门数（含自定义）
  credits: number;    // 总学分（含自定义）
}

export const AI_CTX_KEY = "oc_ai_ctx_v1"; // 手动上传的个人数据（覆盖工作台自动读取）

const HISTORY_KEY = "oc_history";
const CUSTOM_KEY = "oc_custom";

interface CourseRow { id: string; name: string; credits: number; }

// —— 课程索引（与 ToolsPage 同源，读当前年级 structured_data）——
interface SdCourse { course_id: string; name: string; credits: number; }
interface SdGroup { group_id: number; group_code: string; name: string; module_id: number | null; }
interface SdTrack { track_code: string; name: string; total_credits_required: number; description: string; }
interface SdGroupReq { track_code: string; group_id: number; is_main: boolean; }

interface AiIndexes {
  tracks: SdTrack[];
  groupReqs: SdGroupReq[];
  courseMap: Map<string, CourseRow>;
  groupName: Map<number, string>;
  courseGroupLabels: Map<string, string[]>;
  groupInfo: Map<number, { ids: string[]; credits: number }>;
}

function buildIndexes(data: SchemeData): AiIndexes {
  const courses = data.courses as unknown as SdCourse[];
  const groups = data.course_groups as unknown as SdGroup[];
  const tracks = data.degree_tracks as unknown as SdTrack[];
  const groupReqs = data.degree_group_requirements as unknown as SdGroupReq[];
  const groupCourses = data.group_courses as unknown as Array<{ group_id: number; course_ids: string[] }>;

  const courseMap = new Map<string, CourseRow>();
  for (const c of courses) courseMap.set(c.course_id, { id: c.course_id, name: c.name, credits: c.credits });

  const groupName = new Map<number, string>();
  for (const g of groups) groupName.set(g.group_id, g.name);

  /** 课程 → 所属课组标签（模块N·A/B课组（组名） 或 组名[group_code]），退课影响分析用 */
  const courseGroupLabels = new Map<string, string[]>();
  for (const gc of groupCourses) {
    const g = groups.find((x) => x.group_id === gc.group_id);
    if (!g) continue;
    const label = g.module_id !== null
      ? `模块${g.module_id}·${g.group_code.endsWith("A") ? "A" : g.group_code.endsWith("B") ? "B" : ""}课组（${g.name}）`
      : `${g.name}[${g.group_code}]`;
    for (const cid of gc.course_ids) {
      const prev = courseGroupLabels.get(cid) ?? [];
      if (!prev.includes(label)) prev.push(label);
      courseGroupLabels.set(cid, prev);
    }
  }

  const groupInfo = new Map<number, { ids: string[]; credits: number }>();
  for (const gc of groupCourses) {
    const credits = gc.course_ids.reduce((s, id) => s + (courseMap.get(id)?.credits ?? 0), 0);
    groupInfo.set(gc.group_id, { ids: gc.course_ids, credits });
  }

  return { tracks, groupReqs, courseMap, groupName, courseGroupLabels, groupInfo };
}

let builtIndexes: AiIndexes | null = null;
let builtYear = "";

/** 按当前年级惰性构建索引（年级切换后自动重建） */
function ensureBuilt(): AiIndexes {
  const year = getSchemeYear();
  if (!builtIndexes || builtYear !== year) {
    builtIndexes = buildIndexes(getSchemeData());
    builtYear = year;
  }
  return builtIndexes;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// 学期顺序（与 SemesterContext 一致），用于已修/在修/预选 标注
const SEM_ORDER = [
  "大一·开学前（军训）", "大一·秋季", "大一·春季", "大一·夏季",
  "大二·秋季", "大二·春季", "大二·夏季", "大三·秋季", "大三·春季", "大三·夏季",
  "大四·秋季", "大四·春季",
];

/** 学期状态标注：当前学期=在修，之后=预选，之前=已修（不标注） */
function semTag(sem: string, current?: string): string {
  if (!current) return "";
  const ci = SEM_ORDER.indexOf(current);
  if (ci < 0) return "";
  const si = SEM_ORDER.indexOf(sem);
  if (si < 0) return "";
  if (si > ci) return "（预选）";
  if (si === ci) return "（在修）";
  return "";
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 累计统计 */
function summarize(history: History, custom: Custom): { semesters: number; courses: number; credits: number } {
  const { courseMap } = ensureBuilt();
  let courses = 0;
  let credits = 0;
  for (const ids of Object.values(history)) {
    courses += ids.length;
    for (const id of ids) credits += courseMap.get(id)?.credits ?? 0;
  }
  for (const rows of Object.values(custom)) {
    courses += rows.length;
    for (const r of rows) credits += r.credits ?? 0;
  }
  return { semesters: Object.keys(history).length, courses, credits };
}

/** 构建发送给模型的上下文文本；无有效数据时返回 null */
function buildContextText(history: History, custom: Custom, currentSemester?: string): string | null {
  const { tracks, groupReqs, courseMap, groupName, courseGroupLabels, groupInfo } = ensureBuilt();
  const lines: string[] = [];
  let totalCredits = 0;

  lines.push("【用户选课数据】（由本站工作台自动整理，供个性化分析）");
  if (currentSemester && SEM_ORDER.includes(currentSemester)) {
    lines.push(`当前学期：${currentSemester}；学期标注说明——已修（当前学期之前，不可退）、在修（当前学期，可退）、预选（当前学期之后，可自由调整）`);
  }
  lines.push("一、选课历史（学期：课程名(学分,课程号)）");
  const sems = Object.keys(history).sort();
  if (sems.length === 0) {
    lines.push("（无已修记录）");
  }
  for (const sem of sems) {
    const rows: string[] = [];
    for (const id of history[sem]) {
      const c = courseMap.get(id);
      if (c) {
        rows.push(`${c.name}(${c.credits}学分,${c.id})`);
        totalCredits += c.credits;
      }
    }
    if (rows.length > 0) lines.push(`- ${sem}${semTag(sem, currentSemester)}：${rows.join("、")}`);
  }

  const customRows: string[] = [];
  for (const [sem, rows] of Object.entries(custom)) {
    for (const r of rows) {
      customRows.push(`- ${sem}${semTag(sem, currentSemester)}：${r.name}（${r.credits}学分${r.property ? "," + r.property : ""}）`);
      totalCredits += r.credits ?? 0;
    }
  }
  if (customRows.length > 0) {
    lines.push("二、自定义课程");
    lines.push(...customRows);
  }

  lines.push(`三、总学分：${totalCredits}`);
  lines.push("四、各学位轨道课组完成度（主=该轨道主课组A；格式：已修门数/总门数、已修学分/总学分，括号内为组内已修课程）");
  for (const t of tracks) {
    const reqs = groupReqs.filter((r) => r.track_code === t.track_code);
    if (reqs.length === 0) continue;
    lines.push(`- ${t.track_code} ${t.name}（要求 ${t.total_credits_required} 学分）：`);
    for (const r of reqs) {
      const info = groupInfo.get(r.group_id);
      const gname = groupName.get(r.group_id) ?? String(r.group_id);
      if (!info) continue;
      const taken = info.ids.filter((id) => sems.some((sem) => history[sem]?.includes(id)));
      const takenCredits = taken.reduce((s, id) => s + (courseMap.get(id)?.credits ?? 0), 0);
      const tag = r.is_main ? "主" : "次";
      const takenStr = taken.length > 0 ? `（${taken.map((id) => courseMap.get(id)?.name ?? id).join("、")}）` : "";
      lines.push(`  · ${tag} ${gname}：${taken.length}/${info.ids.length} 门、${takenCredits}/${info.credits} 学分${takenStr}`);
    }
  }
  // 五、在修与预选课程的课组归属（判断退课/推迟影响用；已修课程不需要）
  if (currentSemester && SEM_ORDER.includes(currentSemester)) {
    const ci = SEM_ORDER.indexOf(currentSemester);
    const laterSems = Object.keys(history)
      .filter((s) => {
        const si = SEM_ORDER.indexOf(s);
        return si >= 0 && si >= ci;
      })
      .sort((a, b) => SEM_ORDER.indexOf(a) - SEM_ORDER.indexOf(b));
    if (laterSems.length > 0) {
      lines.push("五、在修与预选课程的课组归属（判断退课/推迟影响用）：");
      for (const sem of laterSems) {
        lines.push(`- ${sem}${semTag(sem, currentSemester)}：`);
        const ids = history[sem] ?? [];
        const rows: string[] = [];
        for (const id of ids) {
          const c = courseMap.get(id);
          if (!c) continue;
          const labels = courseGroupLabels.get(id);
          rows.push(`  · ${c.name}(${c.credits}学分)：${labels && labels.length > 0 ? labels.join("、") : "不属于任何课组"}`);
        }
        for (const r of custom[sem] ?? []) {
          rows.push(`  · ${r.name}(${r.credits}学分)：自定义课程，无课组归属`);
        }
        if (rows.length > 0) lines.push(...rows);
      }
    }
  }
  lines.push("【/用户选课数据】");

  let text = lines.join("\n");
  // 后端 context 上限 24000 字符；本块（用户选课数据）只占其中一部分，
  // 还要给【算法推荐候选】与【学位评定进度】块留余量，故前端截断阈值取 16000。
  const MAX = 16000;
  if (text.length > MAX) text = text.slice(0, MAX) + "\n…（数据过长已截断）";
  return text;
}

function makeUserData(history: History, custom: Custom, currentSemester?: string): AiUserData | null {
  const hasHistory = Object.values(history).some((ids) => ids.length > 0);
  const hasCustom = Object.values(custom).some((rows) => rows.length > 0);
  if (!hasHistory && !hasCustom) return null;
  const text = buildContextText(history, custom, currentSemester);
  if (!text) return null;
  const s = summarize(history, custom);
  return { history, custom, text, ...s };
}

/** 从工作台 localStorage 读取（自动关联） */
export function loadWorkspaceContext(currentSemester?: string): AiUserData | null {
  const history = readLocal<History>(HISTORY_KEY, {});
  const custom = readLocal<Custom>(CUSTOM_KEY, {});
  return makeUserData(history, custom, currentSemester);
}

/** 从手动上传的 JSON 读取（工作台导出格式：{ history: {...} }，可含 custom） */
export function parseHistoryJson(raw: string, currentSemester?: string): AiUserData | null {
  let obj: { history?: History; custom?: Custom };
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || !obj.history || typeof obj.history !== "object" || Array.isArray(obj.history)) {
    return null;
  }
  for (const ids of Object.values(obj.history)) {
    if (!Array.isArray(ids)) return null;
  }
  const history = obj.history;
  const custom = obj.custom && typeof obj.custom === "object" && !Array.isArray(obj.custom) ? obj.custom : {};
  return makeUserData(history, custom, currentSemester);
}

export function saveManualContext(data: AiUserData | null): void {
  try {
    if (data) {
      localStorage.setItem(AI_CTX_KEY, JSON.stringify({ history: data.history, custom: data.custom }));
    } else {
      localStorage.removeItem(AI_CTX_KEY);
    }
  } catch {
    /* 忽略 */
  }
}

export function loadManualContext(currentSemester?: string): AiUserData | null {
  try {
    const raw = localStorage.getItem(AI_CTX_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { history: History; custom?: Custom };
    return makeUserData(obj.history, obj.custom ?? {}, currentSemester);
  } catch {
    return null;
  }
}

/** 导出文件名用的时间戳 */
export function ctxTimestamp(): string {
  const n = new Date();
  return `${n.getFullYear()}${pad2(n.getMonth() + 1)}${pad2(n.getDate())}`;
}
