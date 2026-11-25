// 站内课程推荐算法：与工作台（Workspace.tsx）courseScores 逻辑同源，
// 供 AI 助手把【算法推荐候选】注入上下文 —— 模型只负责解释结果，不自行编造推荐。
// 索引按年级惰性构建：schemeStore 年级切换后，下一次调用推荐入口时自动重建。

import {getSchemeData, getSchemeYear, type SchemeData} from "@/data/schemeStore";

type History = Record<string, string[]>;
type Custom = Record<string, Array<{ id: string; name: string; credits: number; property?: string }>>;

interface SdCourse {
  course_id: string;
  name: string;
  credits: number;
  module_type?: string | null;
  original_class?: string | null;
  course_attr?: string | null; // 修读属性：required 必修 / restricted 限选 / elective 任选 / prof_required 专业必修
  prof_note?: string | null;   // 专业必修的适用专业说明
}

/** 修读属性中文标签（课程目录/推荐列表/理由栏共用） */
export const ATTR_LABELS: Record<string, string> = {
  required: "必修",
  restricted: "限选",
  elective: "任选",
  prof_required: "专业必修",
};

/** 修读属性英文（紧凑形式，节点小字/详情栏用） */
export const ATTR_LABELS_EN: Record<string, string> = {
  required: "Required",
  restricted: "Restricted",
  elective: "Elective",
  prof_required: "Major Req",
};

export function courseAttrLabel(c: { course_attr?: string | null }): string | null {
  return c.course_attr ? ATTR_LABELS[c.course_attr] ?? null : null;
}
interface SdGroup { group_id: number; group_code: string; module_id: number | null; name: string; }

// 数据视图与索引按年级惰性构建：schemeStore 年级切换后，下一次调用推荐入口时自动重建

let builtYear = "";
let courses: SdCourse[] = [];
let groups: SdGroup[] = [];
let groupCourses: Array<{ group_id: number; course_ids: string[] }> = [];
let semesterCourses: Array<{ semester: string; course_id: string }> = [];

// —— 学期表（与 useCurriculumData.ALL_SEMESTERS 同序）——
export const REC_SEMESTERS = [
  "大一·开学前（军训）", "大一·秋季", "大一·春季", "大一·夏季",
  "大二·秋季", "大二·春季", "大二·夏季", "大三·秋季", "大三·春季", "大三·夏季",
  "大四·秋季", "大四·春季",
] as const;

const SEM_ORDER: string[] = [...REC_SEMESTERS];
const termIdx = (s: string) => SEM_ORDER.indexOf(s);

// —— 静态索引（按年级惰性构建；年级切换后首次调用推荐入口时重建）——
const courseMap = new Map<string, SdCourse>();
const groupMap = new Map<number, SdGroup>();
const semesterMap = new Map<string, SdCourse[]>();
const courseGroupInfo = new Map<string, Array<{ groupCode: string; moduleId: number | null }>>();
const courseModuleMap = new Map<string, Set<number>>();
let moduleScoringConfig: { modConfig: Map<number, { aPerCourse: number; bPerCourse: number }>; courseModInfo: Map<string, Map<number, { isA: boolean; isB: boolean }>> } = { modConfig: new Map(), courseModInfo: new Map() };
const FOUNDATION_GROUP_IDS = new Set<number>();
const foundationCourseIds = new Map<number, Set<string>>(); // group_id → course_ids
const foundationGroupCode = new Map<number, string>();      // group_id → group_code
const courseChoiceSetIds = new Map<string, Set<number>>();
const choiceSetName = new Map<number, string>();
const choiceSetCourses = new Map<number, string[]>();

function buildIndexes(data: SchemeData) {
  courses = data.courses as unknown as SdCourse[];
  groups = data.course_groups as unknown as SdGroup[];
  groupCourses = data.group_courses as unknown as Array<{ group_id: number; course_ids: string[] }>;
  semesterCourses = data.semester_courses as unknown as Array<{ semester: string; course_id: string }>;

  courseMap.clear();
  for (const c of courses) courseMap.set(c.course_id, c);

  groupMap.clear();
  for (const g of groups) groupMap.set(g.group_id, g);

  /** 学期 → 开课课程（英语1-4 在运行时注入所有春秋学期，与 Workspace.semesterMap 一致） */
  semesterMap.clear();
  {
    const m = new Map<string, SdCourse[]>();
    for (const sc of semesterCourses) {
      const course = courseMap.get(sc.course_id);
      if (!course) continue;
      const prev = m.get(sc.semester) ?? [];
      prev.push(course);
      m.set(sc.semester, prev);
    }
    const ENGLISH_IDS = ["14201002", "14201012", "14201022", "14201032"];
    for (const [sem, list] of m.entries()) {
      if (sem.includes("夏季") || sem.includes("开学前")) continue;
      const ids = new Set(list.map((c) => c.course_id));
      for (const id of ENGLISH_IDS) {
        const ec = courseMap.get(id);
        if (ec && !ids.has(id)) { list.push(ec); ids.add(id); }
      }
    }
    for (const [k, v] of m.entries()) semesterMap.set(k, v);
  }

  courseGroupInfo.clear();
  for (const gc of groupCourses) {
    const group = groupMap.get(gc.group_id);
    if (!group) continue;
    for (const cid of gc.course_ids) {
      const prev = courseGroupInfo.get(cid) ?? [];
      prev.push({ groupCode: group.group_code, moduleId: group.module_id });
      courseGroupInfo.set(cid, prev);
    }
  }

  courseModuleMap.clear();
  for (const [cid, infos] of courseGroupInfo) {
    for (const info of infos) {
      if (info.moduleId !== null) {
        const prev = courseModuleMap.get(cid) ?? new Set<number>();
        prev.add(info.moduleId);
        courseModuleMap.set(cid, prev);
      }
    }
  }

  /** 模块评分配置：A/B 组每门课分值（240/80 学分按组内门数均摊） */
  {
    const modConfig = new Map<number, { aPerCourse: number; bPerCourse: number }>();
    const courseModInfo = new Map<string, Map<number, { isA: boolean; isB: boolean }>>();
    const modACount = new Map<number, number>();
    const modBCount = new Map<number, number>();
    for (const gc of groupCourses) {
      const group = groupMap.get(gc.group_id);
      if (!group || group.module_id === null) continue;
      const isA = group.group_code.endsWith("A");
      const isB = group.group_code.endsWith("B");
      if (isA) modACount.set(group.module_id, (modACount.get(group.module_id) ?? 0) + gc.course_ids.length);
      if (isB) modBCount.set(group.module_id, (modBCount.get(group.module_id) ?? 0) + gc.course_ids.length);
      for (const cid of gc.course_ids) {
        if (!courseModInfo.has(cid)) courseModInfo.set(cid, new Map());
        const cm = courseModInfo.get(cid)!;
        if (!cm.has(group.module_id)) cm.set(group.module_id, { isA: false, isB: false });
        const e = cm.get(group.module_id)!;
        if (isA) e.isA = true;
        if (isB) e.isB = true;
      }
    }
    for (const modId of new Set([...modACount.keys(), ...modBCount.keys()])) {
      const aCount = modACount.get(modId) ?? 0;
      const bCount = modBCount.get(modId) ?? 0;
      modConfig.set(modId, { aPerCourse: aCount > 0 ? 240 / aCount : 0, bPerCourse: bCount > 0 ? 80 / bCount : 0 });
    }
    moduleScoringConfig = { modConfig, courseModInfo };
  }

  FOUNDATION_GROUP_IDS.clear();
  for (const g of groups) {
    if (["COMP_BASIS", "OR_STAT", "MECH_BASIS"].includes(g.group_code)) FOUNDATION_GROUP_IDS.add(g.group_id);
  }
  foundationCourseIds.clear();
  foundationGroupCode.clear();
  for (const gc of groupCourses) {
    if (FOUNDATION_GROUP_IDS.has(gc.group_id)) {
      foundationCourseIds.set(gc.group_id, new Set(gc.course_ids));
      const g = groupMap.get(gc.group_id);
      if (g) foundationGroupCode.set(gc.group_id, g.group_code);
    }
  }

  courseChoiceSetIds.clear();
  choiceSetName.clear();
  choiceSetCourses.clear();
  for (const cs of (data as unknown as { choice_sets: Array<{ set_id: number; name: string }> }).choice_sets) {
    choiceSetName.set(cs.set_id, cs.name);
  }
  for (const csc of (data as unknown as { choice_set_courses: Array<{ set_id: number; course_id: string }> }).choice_set_courses) {
    const prev = courseChoiceSetIds.get(csc.course_id) ?? new Set<number>();
    prev.add(csc.set_id);
    courseChoiceSetIds.set(csc.course_id, prev);
    const list = choiceSetCourses.get(csc.set_id) ?? [];
    list.push(csc.course_id);
    choiceSetCourses.set(csc.set_id, list);
  }

  // 定向特例表按年级选定，并过滤掉当前方案中不存在的课号（防幽灵引用）
  const ids = new Set(courses.map((c) => c.course_id));
  const filterBonus = (m: Record<string, Array<{ semesterMatch: string; bonus: number; label?: string }>>) =>
    Object.fromEntries(Object.entries(m).filter(([cid]) => ids.has(cid)));
  COURSE_BONUS = filterBonus(COURSE_BONUS_BY_YEAR[getSchemeYear()] ?? COURSE_BONUS_BY_YEAR["2024"]);
  DUAL_SEASON_COURSES = new Set((DUAL_SEASON_BY_YEAR[getSchemeYear()] ?? []).filter((cid) => ids.has(cid)));
  DAER_CHUN_SPECIAL_62 = new Set((DAER_CHUN_BY_YEAR[getSchemeYear()] ?? DAER_CHUN_BY_YEAR["2024"]).filter((cid) => ids.has(cid)));
}

function ensureBuilt() {
  const y = getSchemeYear();
  if (y !== builtYear) {
    builtYear = y;
    buildIndexes(getSchemeData());
  }
}

// —— 打分规则常量（与 Workspace 完全一致）——
const PE_BY_SEMESTER: Record<string, string[]> = {
  "大一·秋季": ["10720011"], "大一·春季": ["10720021"],
  "大二·秋季": ["10720031"], "大二·春季": ["10720041"],
  "大三·秋季": ["10720110"], "大三·春季": ["10720120"],
  "大四·秋季": ["10720130"], "大四·春季": ["10720140"],
};

const FOUNDATION_GROUP_CODES = new Set(["MATH_BASIS", "PHY_BASIS", "ME_BASIS", "MECH_BASIS", "CS_BASIS", "OR_STAT", "COMP_BASIS"]);
/** 大二·春特殊课 +62（1.0.1 调优遗产，用户 2026-11-15 追认：2024/2025 保留；六字班思政换新课号后相应替换——
 *  习概 10680022 → 10680153；旧毛概 10680142 在六字班无直接对应课程，不加；英语(4) 14201032 各年级不变）。 */
const DAER_CHUN_BY_YEAR: Record<string, string[]> = {
  "2024": ["10680022", "10680142", "14201032"],
  "2025": ["10680022", "10680142", "14201032"],
  "2026": ["10680153", "14201032"],
};
let DAER_CHUN_SPECIAL_62 = new Set<string>(DAER_CHUN_BY_YEAR["2024"]);

/** 春秋双开课程：数据只记一个推荐学期，但另一季同样开设，可在任一春秋学期进主候选。
 *  2024：运筹学（确定性方法）30160353 / 运筹学（1）30160023（Word 2024 备注「二选一，春秋均开，可在大一春季修读」）、
 *  写作与沟通 10691342（大一·秋定向加分的进池配套）。2025/2026 不开运筹学（1），名单去掉 30160023。 */
const DUAL_SEASON_BY_YEAR: Record<string, string[]> = {
  "2024": ["30160353", "30160023", "10691342"],
  "2025": ["30160353", "10691342"],
  "2026": ["30160353", "10691342"],
};
let DUAL_SEASON_COURSES = new Set<string>(DUAL_SEASON_BY_YEAR["2024"]);

/** AI 方向课名单：远期方向建议中纳入（NEW007 机器学习已 remap 为 34100453） */
const AI_COURSE_IDS = new Set(["24100033", "34100453", "30160253", "84100343", "44100203"]);

// —— 方向倾向补丁（打分本体不动，方向仅作为参数注入加成与模拟约束）——

export type RecDirection = "aero" | "soft" | "ie";

/** 方向元数据：航=模块1-3/力学基础激活；软=模块4-8/计算基础激活；工工=模块9-13/运筹统计激活 */
const DIRECTION_META: Record<RecDirection, { label: string; modules: number[]; foundation: string }> = {
  aero: { label: "航（模块1-3）", modules: [1, 2, 3], foundation: "MECH_BASIS" },
  soft: { label: "软（模块4-8）", modules: [4, 5, 6, 7, 8], foundation: "COMP_BASIS" },
  ie: { label: "工工（模块9-13）", modules: [9, 10, 11, 12, 13], foundation: "OR_STAT" },
};

/** 各方向的"基础加强第二门"标志课（大二·春季开课，方向宣言） */
const DIRECTION_FLAG_COURSES: Record<RecDirection, string[]> = {
  aero: ["20310643", "20310584", "20310474"], // 固体力学基础/材料力学/材料力学（英）
  soft: ["44100573"], // 计算机组成原理
  ie: ["30160203"], // 应用统计与数据分析
};
const ALL_FLAG_COURSES = new Set(Object.values(DIRECTION_FLAG_COURSES).flat());

/** 从已修/在修历史推断方向：看基础加强"第二门"方向课（必修课不体现方向） */
export function inferDirection(history: History): RecDirection | null {
  ensureBuilt();
  const taken = new Set<string>();
  for (const ids of Object.values(history)) ids.forEach((id) => taken.add(id));
  for (const dir of ["aero", "soft", "ie"] as RecDirection[]) {
    if (DIRECTION_FLAG_COURSES[dir].some((id) => taken.has(id))) return dir;
  }
  return null;
}

/** 方向中文标签（UI 提示用） */
export function directionLabel(dir: RecDirection): string {
  return DIRECTION_META[dir].label;
}

// 问题原文方向关键词兜底：classify 静默失败/漏判时，用确定性关键词抓住用户在对话里
// 明说的方向。只认兴趣/意向类高置信词，不收"操作系统/数据库"这类课程名，
// 避免"XX课程属于哪个课组"这类事实型问题被误判出方向。
const DIRECTION_KEYWORDS: Array<{ dir: RecDirection; re: RegExp }> = [
  // 模块号明示（先判 9-13 再判 1-3：正则加 (?!\d) 防止"模块12"被"模块1"截胡）
  { dir: "ie", re: /(?:模块|module)\s*(?:9|10|11|12|13|九|十[一二三])/i },
  { dir: "soft", re: /(?:模块|module)\s*(?:[4-8]|四|五|六|七|八)/i },
  { dir: "aero", re: /(?:模块|module)\s*(?:[1-3]|一|二|三)(?![0-9])/i },
  { dir: "aero", re: /航空航天|航空|航天|空天|飞行器|飞机|火箭|卫星|导弹|发动机|空气动力|对(力学|流体|固体力学|材料力学)感/ },
  { dir: "soft", re: /软件|计算机|编程|程序设计|写代码|软件开发/ },
  { dir: "ie", re: /工业工程|工工|物流|供应链|数据分析|质量管理|精益|人因/ },
];

/** 从用户提问原文中检测明示的方向倾向（classify 失败时的本地确定性兜底） */
export function detectStatedDirection(question: string): RecDirection | null {
  for (const { dir, re } of DIRECTION_KEYWORDS) {
    if (re.test(question)) return dir;
  }
  return null;
}

const ENGLISH3_WEIGHT: Record<string, number> = {
  "大一·秋季": 0, "大一·春季": 0, "大一·夏季": 0,
  "大二·秋季": 0, "大二·春季": 1, "大二·夏季": 0,
  "大三·秋季": 2, "大三·春季": 3, "大三·夏季": 0,
  "大四·秋季": 4, "大四·春季": 4, "大四·夏季": 0,
};
const ENGLISH4_WEIGHT: Record<string, number> = {
  "大一·秋季": 0, "大一·春季": 0, "大一·夏季": 0,
  "大二·秋季": 0, "大二·春季": 0, "大二·夏季": 0,
  "大三·秋季": 1, "大三·春季": 2, "大三·夏季": 0,
  "大四·秋季": 3, "大四·春季": 4, "大四·夏季": 0,
};
// 注：Workspace 中 ENGLISH3_WEIGHT 的键为"大二·秋季:0…"等，仅春秋季有正权重，此处补全 12 学期键，语义一致。

/** 定向加分表按年级拆分。继承原则（用户 2026-11-15 定稿）：
 *  - 四字班特例五、六字班默认继承，除非特例推荐学期已成为计划推荐学期；
 *  - 运筹学（1）30160023 五、六字班不开，定向换成运筹学（确定性方法）30160353（同名机制，大一·春 +62）；
 *  - 数值分析基础 14920032 / 科学与工程计算基础 10421403 大一·春提前修特例：2024/2025 计划大二·春 → 继承；
 *    2026 计划已前移至大一·春 → 特例取消（用户确认）；
 *  - 自动控制原理 30310992 大三·秋 +300 三年计划同为推荐学期 → 继承。 */
const COURSE_BONUS_BY_YEAR: Record<string, Record<string, Array<{ semesterMatch: string; bonus: number; label?: string }>>> = {
  "2024": {
    "10691342": [{ semesterMatch: "大一·秋季", bonus: 62 }],
    "30160023": [{ semesterMatch: "大一·春季", bonus: 62 }],
    "24100023": [{ semesterMatch: "大一·秋季", bonus: 61 }],
    "14920032": [{ semesterMatch: "大一·春季", bonus: 61 }],
    "10421403": [{ semesterMatch: "大一·春季", bonus: 61 }],
    "44100203": [{ semesterMatch: "大二·秋季", bonus: 11 }],
    "30310992": [{
      semesterMatch: "大三·秋季",
      bonus: 300,
      label: "全院必修核心课，仅大三秋季开课，且是飞行动力学等后续课程的先修——强烈建议本学期修读，不要推迟",
    }],
  },
  "2025": {
    "10691342": [{ semesterMatch: "大一·秋季", bonus: 62 }],
    "30160353": [{ semesterMatch: "大一·春季", bonus: 62 }],
    "24100023": [{ semesterMatch: "大一·秋季", bonus: 61 }],
    "14920032": [{ semesterMatch: "大一·春季", bonus: 61 }],
    "10421403": [{ semesterMatch: "大一·春季", bonus: 61 }],
    "44100203": [{ semesterMatch: "大二·秋季", bonus: 11 }],
    "30310992": [{
      semesterMatch: "大三·秋季",
      bonus: 300,
      label: "全院必修核心课，仅大三秋季开课，且是飞行动力学等后续课程的先修——强烈建议本学期修读，不要推迟",
    }],
  },
  "2026": {
    "10691342": [{ semesterMatch: "大一·秋季", bonus: 62 }],
    "30160353": [{ semesterMatch: "大一·春季", bonus: 62 }],
    "24100023": [{ semesterMatch: "大一·秋季", bonus: 61 }],
    "44100203": [{ semesterMatch: "大二·秋季", bonus: 11 }],
    "30310992": [{
      semesterMatch: "大三·秋季",
      bonus: 300,
      label: "全院必修核心课，仅大三秋季开课，且是飞行动力学等后续课程的先修——强烈建议本学期修读，不要推迟",
    }],
  },
};
let COURSE_BONUS = COURSE_BONUS_BY_YEAR["2024"];

/** 工作台打分用的按年级特例表（调用时 schemeStore.current 已是该年级数据；按数据存在性过滤防幽灵课号） */
export function cohortScoringTables(year: string): {
  courseBonus: Record<string, Array<{ semesterMatch: string; bonus: number; label?: string }>>;
  dualSeason: Set<string>;
  daerChun62: Set<string>;
} {
  const data = getSchemeData();
  const ids = new Set((data.courses as unknown as SdCourse[]).map((c) => c.course_id));
  const bonus = Object.fromEntries(
    Object.entries(COURSE_BONUS_BY_YEAR[year] ?? COURSE_BONUS_BY_YEAR["2024"]).filter(([cid]) => ids.has(cid)),
  );
  return {
    courseBonus: bonus,
    dualSeason: new Set((DUAL_SEASON_BY_YEAR[year] ?? []).filter((cid) => ids.has(cid))),
    daerChun62: new Set((DAER_CHUN_BY_YEAR[year] ?? DAER_CHUN_BY_YEAR["2024"]).filter((cid) => ids.has(cid))),
  };
}

const FOUNDATION_SCORE_MAP: Array<[string, number, number]> = [
  ["COMP_BASIS", 4, 8],
  ["OR_STAT", 9, 13],
  ["MECH_BASIS", 1, 3],
];

const FOUNDATION_LABELS: Record<string, string> = {
  COMP_BASIS: "计算基础（II类）",
  OR_STAT: "运筹统计（III类）",
  MECH_BASIS: "力学基础（I类）",
};

export interface RecItem {
  id: string;
  name: string;
  credits: number;
  score: number;
  reasons: string[];
}

export interface RecResult {
  targetSemester: string;
  direction: RecDirection | null; // 本次候选按哪个方向定向生成（null=全向）
  items: RecItem[];              // 排除已修，按得分降序（均为目标学期实际开课）
  preview: PreviewSemester[];    // 滚动预推荐：目标学期后两个学期的模拟选课
  sameFamilyNotes: SameFamilyNote[]; // 同族课提示（模拟选课中遇到的限选组冲突）
  farYears: FarYearSuggestion[]; // 远期方向建议（按年级聚合，不逐学期）
  directionRequired: boolean;    // 方向门：无方向时滚动模拟被禁止（预推荐/远期不生成），需先确认方向
  activeFoundations: string[];   // 已激活基础方向（已修≥2门该方向课组）
  topModules: number[];          // 模块进度优先模块（前两档）
  hasSecondForeign: boolean;
}

/** 目标学期自动检测：优先直接采用工作台当前学期（用户正在规划的学期）；
 *  无当前学期信息时，按学期顺序找第一个无已修记录的学期。 */
export function defaultTargetSemester(history: History, currentSemester?: string): string {
  ensureBuilt();
  if (currentSemester && SEM_ORDER.includes(currentSemester)) return currentSemester;
  for (const sem of SEM_ORDER) {
    if (!(sem in history)) return sem;
  }
  return SEM_ORDER[SEM_ORDER.length - 1];
}

/** 核心打分：与 Workspace.tsx courseScores 完全同源，并记录加分理由。
 *  direction 传入时叠加方向补丁：基础方向激活定向 + 方向模块加成（打分本体不加方向时保持原样）。
 *  preferNative=true（中文环境）时全英文授课课程（课名带"（英）"）降权，排在对应中文版本之后。 */
export function recommendFor(history: History, custom: Custom | undefined, targetSemester: string, direction?: RecDirection, preferNative?: boolean): RecResult {
  ensureBuilt();
  const dirMeta = direction ? DIRECTION_META[direction] : undefined;
  const historyIds = new Set<string>();
  for (const ids of Object.values(history)) ids.forEach((id) => historyIds.add(id));

  // 二外判断与 Workspace.hasSecondForeign 同源：历史 + 自定义课程均计入
  const customIds = new Set<string>();
  if (custom) for (const rows of Object.values(custom)) rows.forEach((r) => customIds.add(r.id));
  const hasSecondForeign = [...historyIds, ...customIds].some((id) => id.startsWith("FOREIGN_"));

  // 全部已修 ID（历史 + 预选；AI 场景无预选中集合，即历史本身）
  const allSelectedIds = new Set(historyIds);

  // —— staging 学期派生数据（对应 Workspace.stagingCourseInfo）——
  const stagingCourseIds = new Set((semesterMap.get(targetSemester) ?? []).map((c) => c.course_id));
  const peCourseIds = new Set(PE_BY_SEMESTER[targetSemester] ?? []);
  const isSummer = targetSemester.includes("开学前") || targetSemester.includes("夏季");
  const needPe = !isSummer && peCourseIds.size > 0 && ![...allSelectedIds].some((id) => peCourseIds.has(id));

  const stagingShuyuanIds = new Set<string>();
  const stagingShijianIds = new Set<string>();
  for (const cid of stagingCourseIds) {
    for (const info of courseGroupInfo.get(cid) ?? []) {
      if (info.groupCode === "SHUYUAN_GE") stagingShuyuanIds.add(cid);
      if (info.groupCode === "SHIJIAN") stagingShijianIds.add(cid);
    }
  }
  const stagingSpecialIds = new Set([...stagingShuyuanIds, ...stagingShijianIds]);

  // —— 模块进度分（已修课程在各模块累计）——
  const moduleScoreMap = new Map<number, number>();
  {
    const { modConfig, courseModInfo } = moduleScoringConfig;
    for (const cid of allSelectedIds) {
      const cm = courseModInfo.get(cid);
      if (!cm) continue;
      for (const [modId, { isA, isB }] of cm) {
        const cfg = modConfig.get(modId);
        if (!cfg) continue;
        let add = 0;
        if (isA) add += cfg.aPerCourse;
        if (isB) add += cfg.bPerCourse;
        moduleScoreMap.set(modId, (moduleScoreMap.get(modId) ?? 0) + add);
      }
    }
  }

  // —— 已激活基础方向（某方向课组已修≥2门 → +80 加成）；给定方向时强制激活对应组 ——
  const foundationActive = new Map<string, number>();
  if (dirMeta) {
    foundationActive.set(dirMeta.foundation, 80);
  } else {
    for (const gCode of ["COMP_BASIS", "OR_STAT", "MECH_BASIS"]) {
      for (const [gid, cids] of foundationCourseIds) {
        if (foundationGroupCode.get(gid) !== gCode) continue;
        let cnt = 0;
        for (const cid of allSelectedIds) if (cids.has(cid)) cnt++;
        if (cnt >= 2) { foundationActive.set(gCode, 80); break; }
      }
    }
  }

  // —— 打分主循环 ——
  const items: RecItem[] = [];
  for (const c of courses) {
    // 该学期是否实际开课（体育课 + 开课表 + 春秋双开；循环不变量提前算好，供方案A加权复用）
    const openThisSemester =
      stagingCourseIds.has(c.course_id) ||
      peCourseIds.has(c.course_id) ||
      (DUAL_SEASON_COURSES.has(c.course_id) && !isSummer);
    let score = 0;
    const reasons: string[] = [];

    if (needPe && peCourseIds.has(c.course_id)) {
      score += 400;
      reasons.push("体育必修（该学期需修）");
    }
    if (stagingSpecialIds.has(c.course_id)) {
      score += 400;
      reasons.push("书院通识/进阶实践（该学期应修）");
    }
    if (stagingCourseIds.has(c.course_id)) {
      score += 100;
      reasons.push("本学期开课");
    }

    // 春秋双开课：目标学期虽非其记录的推荐学期，但另一季同样开设，可正常推荐
    if (DUAL_SEASON_COURSES.has(c.course_id) && !stagingCourseIds.has(c.course_id) && !isSummer) {
      score += 50;
      reasons.push("春秋双开，本学期亦可修读");
    }

    const cMods = courseModuleMap.get(c.course_id);
    if (cMods && foundationActive.size > 0) {
      let maxF = 0;
      for (const [gCode, fScore] of foundationActive) {
        const entry = FOUNDATION_SCORE_MAP.find(([cg]) => cg === gCode);
        if (!entry) continue;
        const [, lo, hi] = entry;
        for (const m of cMods) if (m >= lo && m <= hi) maxF = Math.max(maxF, fScore);
      }
      if (maxF > 0) {
        score += maxF;
        reasons.push(`契合已激活基础方向（${[...foundationActive.keys()].map((k) => FOUNDATION_LABELS[k] ?? k).join("、")}）`);
      }
    }

    const { courseModInfo } = moduleScoringConfig;
    const cm = courseModInfo.get(c.course_id);
    if (cm) {
      let maxMod = 0;
      for (const [modId] of cm) {
        const ms = moduleScoreMap.get(modId) ?? 0;
        if (ms > maxMod) maxMod = ms;
      }
      if (maxMod > 0) {
        score += maxMod;
        reasons.push("模块进度补足");
      }
    }

    // 方向补丁：方向交叉模块的课 +60，其他交叉模块的课 −40（仅显式传入方向时生效）
    if (dirMeta && cMods && cMods.size > 0) {
      if ([...cMods].some((m) => dirMeta.modules.includes(m))) {
        score += 60;
        reasons.push(`契合所选方向（${dirMeta.label}）`);
      } else {
        score -= 40;
      }
    }

    const cats = courseGroupInfo.get(c.course_id) ?? [];
    score += Math.max(cats.length, 1) * 10;

    const bonusRules = COURSE_BONUS[c.course_id];
    if (bonusRules) {
      for (const rule of bonusRules) {
        if (rule.semesterMatch === targetSemester) {
          score += rule.bonus;
          // 定向重点课（如自动控制原理）用专属理由提醒模型强调；普通定向加分沿用通用文案
          reasons.push(rule.label ?? "该学期为推荐学期");
        }
      }
    }

    if (targetSemester === "大二·春季") {
      const inFoundation = (courseGroupInfo.get(c.course_id) ?? []).some((i) => FOUNDATION_GROUP_CODES.has(i.groupCode));
      if (inFoundation && stagingCourseIds.has(c.course_id)) {
        score += 61;
        reasons.push("大二春季基础课程加成");
      }
      if (DAER_CHUN_SPECIAL_62.has(c.course_id)) {
        score += 62;
        reasons.push("大二春季特殊课程加成");
      }
    }

    if (c.course_id === "14201022" && !historyIds.has("14201022") && !hasSecondForeign) {
      const w = ENGLISH3_WEIGHT[targetSemester];
      if (w !== undefined && w > 0) { score += w * 101; reasons.push("英语(3)限选（毕业外语要求），建议尽早修读"); }
    }
    if (c.course_id === "14201032" && !historyIds.has("14201032") && !hasSecondForeign) {
      const w = ENGLISH4_WEIGHT[targetSemester];
      if (w !== undefined && w > 0) { score += w * 101; reasons.push("英语(4)限选（毕业外语要求），建议尽早修读"); }
    }
    if (c.course_id === "14201002" && !historyIds.has("14201002") && termIdx(targetSemester) > termIdx("大一·秋季")) {
      score += 400; reasons.push("英语(1)必修漏修，优先补上");
    }
    if (c.course_id === "14201012" && !historyIds.has("14201012") && termIdx(targetSemester) > termIdx("大一·春季")) {
      score += 400; reasons.push("英语(2)必修漏修，优先补上");
    }

    // 修读属性（培养方案第五项）：必修/专业必修给理由与小幅加成；限选/任选不进理由栏（避免噪音），可在目录与 KB 查询
    if (c.course_attr === "required" && !reasons.some((r) => r.includes("必修"))) {
      score += 25;
      reasons.push("必修课程");
    } else if (c.course_attr === "prof_required") {
      score += 15;
      reasons.push(c.prof_note || "专业必修课程");
    }

    // 语言偏好（中文环境）：全英文授课版本降权，使用户对话语言与推荐授课语言匹配；
    // 同族中存在中文版本时其自然排在前面，被推荐的（英）课程须由模型主动注明"全英文授课"
    if (preferNative && /（英）/.test(c.name)) {
      score -= 20;
      reasons.push("全英文授课");
    }

    // 方案A：必修课优先推进——必修（required）在其推荐开课学期且未修、且所属多选一组尚未被已修课满足时，
    // 给予显著加权。没有这项时，module_id=null 的机电/通识类必修（如自动控制原理）拿不到模块进度分与
    // 方向加成，会被方向课挤出预推荐，而它们往往只有唯一开课窗口。
    // 注意：prof_required 不加——它是特定专业路径的必修，对其他方向学生只是限选，加权会把别的专业的
    // 专业必修（如运筹学（应用随机模型））推进无关方向的规划（推演实测踩过）。
    if (
      c.course_attr === "required" &&
      openThisSemester &&
      !historyIds.has(c.course_id) &&
      !findSameFamily(c.course_id, historyIds) // 多选一组内已修其一即满足，不再加权重复修
    ) {
      score += 80;
      reasons.push("必修课·推荐学期，优先推进");
    }

    if (historyIds.has(c.course_id)) score -= 400; // 已修课程沉底

    // 候选硬过滤：只保留目标学期实际开课的课程（含该学期体育课）；
    // 春秋双开课（DUAL_SEASON_COURSES）在任何春秋学期均视为开课。
    // 否则"模块进度补足"分会把推荐学期在之后学年的课（如大三的课）排进大二候选，诱导模型跨学期推荐。
    if (score > 0 && !historyIds.has(c.course_id) && openThisSemester) {
      items.push({ id: c.course_id, name: c.name, credits: c.credits, score, reasons });
    }
  }

  // 模块进度提示：最高分一档（并列全取），不足两个再取次高分一档
  const sortedMods = [...moduleScoreMap.entries()].sort((a, b) => b[1] - a[1]).filter(([, s]) => s > 0);
  const topModules: number[] = [];
  if (sortedMods.length > 0) {
    const top = sortedMods[0][1];
    for (const [id, s] of sortedMods) { if (s === top) topModules.push(id); }
    if (topModules.length < 2) {
      const second = sortedMods.find(([id, s]) => s < top && !topModules.includes(id));
      if (second) {
        for (const [id, s] of sortedMods) { if (s === second[1] && !topModules.includes(id)) topModules.push(id); }
      }
    }
  }

  items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    targetSemester,
    direction: direction ?? null,
    items,
    preview: [],
    sameFamilyNotes: [],
    farYears: [],
    directionRequired: false,
    activeFoundations: [...foundationActive.keys()].map((k) => FOUNDATION_LABELS[k] ?? k),
    topModules,
    hasSecondForeign,
  };
}

const REC_MAX_ITEMS = 15;        // 弱模型注入的主候选条数（上下文短，防止淹没）
export const REC_MAX_ITEMS_STRONG = 25; // 强模型注入条数：多给候选，由模型自行判断取舍

/** 滚动模拟的年级学分目标（±2 学分浮动） */
const YEAR_CREDIT_TARGETS: Record<string, number> = { "大一": 23, "大二": 26, "大三": 20, "大四": 10 };
const ROLLING_SEMESTERS = 2; // 逐门预推荐的学期数（目标学期之后）
const FAR_MAX_PER_YEAR = 5;  // 远期每年级最多列出的课程数

/** 滚动预推荐的单学期模拟结果 */
export interface PreviewSemester {
  semester: string;
  items: RecItem[];
  credits: number;
  target: number;
}

/** 同族课提示：模拟选课时遇到与已选课同限选组的课程 */
export interface SameFamilyNote {
  semester: string;
  courseName: string;
  courseId: string;
  courseCredits: number;
  relatedName: string;
  relatedId: string;
  relatedCredits: number;
  setName: string;
}

/** 远期（预推荐学期之后）按年级聚合的方向课建议 */
export interface FarYearSuggestion {
  year: string;
  items: RecItem[];
}

/** 找到课程与已知已选课程共享的限选组（返回组名与同族课程名/课号/学分，供模型行内标注） */
function findSameFamily(
  courseId: string,
  knownIds: Set<string>
): { setName: string; relatedName: string; relatedId: string; relatedCredits: number } | null {
  const sets = courseChoiceSetIds.get(courseId);
  if (!sets) return null;
  for (const setId of sets) {
    for (const otherId of choiceSetCourses.get(setId) ?? []) {
      if (otherId !== courseId && knownIds.has(otherId)) {
        return {
          setName: choiceSetName.get(setId) ?? `选课组${setId}`,
          relatedName: courseMap.get(otherId)?.name ?? otherId,
          relatedId: otherId,
          relatedCredits: courseMap.get(otherId)?.credits ?? 0,
        };
      }
    }
  }
  return null;
}

/** 滚动模拟：以现有推荐算法逐学期推演，模拟选课并入副本再推下一学期。
 *  打分逻辑完全不动；仅在"模拟选择"环节：① 把与已选课同限选组的课程移入同族提示队列（不计入学分、不并入副本）；
 *  ② 传入方向时，方向标志课（基础加强第二门）优先强制选入，其他方向组的第二门不选（防"方向传染"）。 */
export function buildRollingPreview(
  history: History,
  custom: Custom | undefined,
  targetSemester: string,
  currentSemester?: string,
  direction?: RecDirection,
  preferNative?: boolean
): { preview: PreviewSemester[]; notes: SameFamilyNote[]; farYears: FarYearSuggestion[]; directionRequired: boolean } {
  ensureBuilt();
  // 方向门：无方向时禁止滚动模拟。模拟从当前学期之后开始，几乎必然覆盖大二·春季
  // （基础加强第二门=方向宣言的开设学期）——无方向模拟会"替用户做方向宣言"，
  // 把通用课排进大二春再滚到大三，整条链被错误方向污染。此时必须先确认方向。
  if (!direction) return { preview: [], notes: [], farYears: [], directionRequired: true };
  const dirMeta = DIRECTION_META[direction];
  const flagIds = new Set(DIRECTION_FLAG_COURSES[direction]);
  // 模拟起点：当前学期之后（无当前学期信息则从目标学期之后开始）
  const anchor = currentSemester && SEM_ORDER.includes(currentSemester) ? currentSemester : targetSemester;
  const ai = SEM_ORDER.indexOf(anchor);
  const future = SEM_ORDER.slice(ai + 1).filter((s) => !s.includes("夏季") && !s.includes("开学前"));
  if (future.length === 0) return { preview: [], notes: [], farYears: [], directionRequired: false };

  const previewSems = future.slice(0, ROLLING_SEMESTERS);
  const farSems = future.slice(ROLLING_SEMESTERS);

  // 远期方向建议的依据模块：有方向用方向全模块，否则用用户当前选课涉及的前两个模块
  let topModules: number[];
  if (dirMeta) {
    topModules = dirMeta.modules;
  } else {
    const moduleCount = new Map<number, number>();
    for (const ids of Object.values(history)) {
      for (const cid of ids) {
        for (const info of courseGroupInfo.get(cid) ?? []) {
          if (info.moduleId !== null) moduleCount.set(info.moduleId, (moduleCount.get(info.moduleId) ?? 0) + 1);
        }
      }
    }
    topModules = [...moduleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([m]) => m);
  }

  // 逐学期滚动模拟
  const simHistory: History = Object.fromEntries(Object.entries(history).map(([k, v]) => [k, [...v]]));
  const knownIds = new Set<string>(); // 用户历史 + 已模拟选入的课程（滚动累积，远期阶段也用它排除）
  for (const ids of Object.values(simHistory)) ids.forEach((id) => knownIds.add(id));
  const preview: PreviewSemester[] = [];
  const notes: SameFamilyNote[] = [];
  const notedCourses = new Set<string>();

  for (const sem of previewSems) {
    const year = sem.split("·")[0];
    const target = YEAR_CREDIT_TARGETS[year] ?? 22;
    const rec = recommendFor(simHistory, custom, sem, direction, preferNative);
    const chosen: RecItem[] = [];
    let credits = 0;

    // 方案B：必修优先占位——该学期开课且未修的必修课先强制选入（先修链与开课核对已由打分保证）；
    // 多选一组内已被已知课程满足的必修跳过。必修是底盘，不能被方向课挤出模拟清单
    //（典型受害者：自动控制原理，仅大三·秋开课、还是飞行动力学的先修）。
    for (const it of rec.items) {
      const meta = courseMap.get(it.id);
      if (!meta || meta.course_attr !== "required") continue;
      if (chosen.some((c) => c.id === it.id)) continue;
      if (findSameFamily(it.id, knownIds)) continue;
      chosen.push(it);
      credits += it.credits;
      knownIds.add(it.id);
    }

    // 方向标志课（基础加强第二门）优先强制选入：该学期开课、在候选中、且无同族冲突
    if (flagIds) {
      const flagItem = rec.items.find((it) => flagIds.has(it.id));
      if (flagItem && !findSameFamily(flagItem.id, knownIds)) {
        chosen.push(flagItem);
        credits += flagItem.credits;
        knownIds.add(flagItem.id);
      }
    }

    for (const it of rec.items) {
      if (chosen.some((c) => c.id === it.id)) continue;
      // 其他方向组的第二门不选（防"方向传染"：无方向先验的模拟选课把后续学期带偏）
      if (ALL_FLAG_COURSES.has(it.id) && (!flagIds || !flagIds.has(it.id))) continue;
      const fam = findSameFamily(it.id, knownIds);
      if (fam) {
        if (!notedCourses.has(it.id)) {
          notes.push({
            semester: sem,
            courseName: it.name,
            courseId: it.id,
            courseCredits: it.credits,
            relatedName: fam.relatedName,
            relatedId: fam.relatedId,
            relatedCredits: fam.relatedCredits,
            setName: fam.setName,
          });
          notedCourses.add(it.id);
        }
        continue; // 同族课不入模拟副本、不计学分
      }
      const isPe = (PE_BY_SEMESTER[sem] ?? []).includes(it.id);
      if (!isPe && credits >= target - 2) break; // 达到年级目标下限即停
      if (!isPe && it.credits > 0 && credits + it.credits > target + 2) continue; // 超上限的跳过，尝试更小课程
      chosen.push(it);
      credits += it.credits;
      knownIds.add(it.id);
      if (chosen.length >= 12) break;
    }

    simHistory[sem] = chosen.map((c) => c.id);
    preview.push({ semester: sem, items: chosen, credits, target });
  }

  // 远期方向建议：预推荐学期之后，按用户当前选课情况的方向课（含 AI 方向课），按年级聚合
  const farYears: FarYearSuggestion[] = [];
  if (topModules.length > 0) {
    const yearMap = new Map<string, RecItem[]>();
    for (const sem of farSems) {
      const year = sem.split("·")[0];
      for (const c of semesterMap.get(sem) ?? []) {
        if (knownIds.has(c.course_id)) continue;
        const infos = courseGroupInfo.get(c.course_id) ?? [];
        const inTopModule = infos.some((i) => i.moduleId !== null && topModules.includes(i.moduleId));
        const isAI = AI_COURSE_IDS.has(c.course_id);
        if (!inTopModule && !isAI) continue;
        if (findSameFamily(c.course_id, knownIds)) continue;
        const list = yearMap.get(year) ?? [];
        if (list.some((x) => x.id === c.course_id)) continue;
        list.push({ id: c.course_id, name: c.name, credits: c.credits, score: inTopModule ? 1 : 0, reasons: [] });
        yearMap.set(year, list);
        knownIds.add(c.course_id);
      }
    }
    for (const [year, items] of yearMap) {
      items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      const trimmed = items.slice(0, FAR_MAX_PER_YEAR);
      if (trimmed.length > 0) farYears.push({ year, items: trimmed });
    }
  }

  return { preview, notes, farYears, directionRequired: false };
}

/** 课程归属简标：该课程所属的交叉模块课组代码（如 [1A] / [4B/7B/11A]；基础课组返回空串） */
function groupTag(id: string): string {
  const codes = (courseGroupInfo.get(id) ?? [])
    .filter((i) => i.moduleId !== null)
    .map((i) => i.groupCode);
  return codes.length > 0 ? `[${codes.join("/")}]` : "";
}

/** 生成注入模型的【算法推荐候选】文本块；主候选与滚动预推荐均为空时返回空串。
 *  allowDirectionSwitch=true（强模型档）：方向标注措辞放宽为"可随用户明确意愿换向（先评估时机成本）"。 */
export function buildRecommendText(rec: RecResult | null, allowDirectionSwitch = false, maxItems: number = REC_MAX_ITEMS): string {
  if (!rec || (rec.items.length === 0 && rec.preview.length === 0)) return "";
  const lines: string[] = [];
  const dirMeta = rec.direction ? DIRECTION_META[rec.direction] : undefined;
  const dirNote = dirMeta
    ? allowDirectionSwitch
      ? `（已按「${dirMeta.label}」方向生成；用户在对话中明确提出想换方向时，先按系统规则评估换向时机与成本，确认后按新方向给建议）`
      : `（已按「${dirMeta.label}」方向生成，推荐与规划须与该方向一致）`
    : "";
  lines.push(`【算法推荐候选】（由本站推荐算法计算，模型必须基于此结果回答推荐类问题，严禁自行编造或补充课程）`);
  lines.push(`目标学期：${rec.targetSemester}${dirNote}`);
  if (rec.activeFoundations.length > 0) lines.push(`已激活基础方向：${rec.activeFoundations.join("、")}`);
  if (rec.topModules.length > 0) lines.push(`模块进度优先模块：${rec.topModules.map((m) => `模块${m}`).join("、")}`);
  if (rec.hasSecondForeign) lines.push("已修第二外国语：英语(3)(4)学分要求视为满足");
  lines.push("候选课程（综合得分降序，格式：课程名(学分,课程号)｜推荐理由；每门均为目标学期实际开课的课程）：");
  rec.items.slice(0, maxItems).forEach((it, i) => {
    lines.push(`${i + 1}. ${it.name}（${it.credits}学分,${it.id}）｜${it.reasons.length > 0 ? it.reasons.join("；") : "常规候选"}`);
  });
  lines.push("说明：候选已过滤为 目标学期实际开课 的课程，得分综合考虑 本学期开课、体育/英语必修、模块进度、基础方向、方向倾向、推荐学期加成；用户已修课程已排除；理由栏标注同限选组关系的课程，回答时必须主动向用户说明。推荐学期在之后学年的课程不会出现在候选中，用户问及时应说明其推荐学期、建议届时再修。");
  if (maxItems > REC_MAX_ITEMS) {
    // 强模型档：候选给得更宽（前 25），明确授权模型自行取舍，而非按名次照搬
    lines.push("本候选列表按综合得分降序排列，但比弱档给得更宽（含更多低分候选）：排序仅供参考，你应结合用户的方向意向、学分负荷与先修链，自行判断该主推哪些、舍弃哪些，并可在回答中说明取舍理由。");
  }
  if (rec.directionRequired) {
    lines.push("");
    lines.push(
      "滚动预推荐（未生成——方向未确认）：涉及大二·春季及之后的学期规划与专业方向强相关（基础加强第二门课=方向宣言，各方向标志课与流体力学全部于大二·春季开课），方向未确认时禁止滚动模拟。请在本回答结尾向用户确认感兴趣的方向（航=模块1-3 / 软=模块4-8 / 工工=模块9-13），用户确认方向后后续提问才会生成方向化的预推荐。在此之前：主候选（目标学期）可正常回答，但严禁自行推测方向，严禁编造或预排任何后续学期的课程清单。"
    );
  }
  if (rec.preview.length > 0) {
    lines.push("");
    lines.push("滚动预推荐（目标学期后两个学期的模拟选课，已按年级学分目标滚动推演；多学期规划时这两个学期逐门照抄此表，严禁把课程排到其他学期；条目后 [代码] 为课程所属课组，引用归属时照抄）：");
    for (const p of rec.preview) {
      const body = p.items.map((it) => `${it.name}（${it.credits}学分,${it.id}）${groupTag(it.id)}`).join("、");
      lines.push(`- ${p.semester}（模拟约${p.credits}学分）：${body || "（无可推荐课程）"}`);
    }
  }
  if (rec.sameFamilyNotes.length > 0) {
    lines.push("同族课提示（请按学期主动向用户说明；向用户转述时按系统格式要求行内标注同族课程与学分/课号）：");
    for (const n of rec.sameFamilyNotes) {
      lines.push(
        `- ${n.semester}的 ${n.courseName}（${n.courseCredits}学分,${n.courseId}）与已选的「${n.relatedName}（${n.relatedCredits}学分,${n.relatedId}）」同属「${n.setName}」限选组——组内修其一即满足要求，再修不计入课组进度。`,
      );
    }
  }
  if (rec.farYears.length > 0) {
    lines.push("远期方向建议（更远学期不做逐门排课，仅按年级给方向性参考；提及这些课时不标注具体学期）：");
    for (const fy of rec.farYears) {
      lines.push(`- ${fy.year}阶段可考虑：${fy.items.map((it) => `${it.name}（${it.credits}学分,${it.id}）${groupTag(it.id)}`).join("、")}`);
    }
  }
  lines.push("【/算法推荐候选】");
  return lines.join("\n");
}

/** 便捷入口：读取历史 → 打分 → 滚动模拟 → 生成文本。
 *  direction 传入时主候选与滚动模拟均按该方向定向（航/软/工工）。
 *  opts.preferNative：中文环境全英课降权；opts.allowDirectionSwitch：注入文案允许强模型换向。 */
export function buildRecContext(
  history: History,
  custom: Custom | undefined,
  targetSemester?: string,
  currentSemester?: string,
  direction?: RecDirection,
  opts?: { preferNative?: boolean; allowDirectionSwitch?: boolean; maxItems?: number },
): { text: string; semester: string; direction: RecDirection | null; directionRequired: boolean } {
  const sem = targetSemester && SEM_ORDER.includes(targetSemester) ? targetSemester : defaultTargetSemester(history, currentSemester);
  const rec = recommendFor(history, custom, sem, direction, opts?.preferNative);
  const rolling = buildRollingPreview(history, custom, sem, currentSemester, direction, opts?.preferNative);
  rec.preview = rolling.preview;
  rec.sameFamilyNotes = rolling.notes;
  rec.farYears = rolling.farYears;
  rec.directionRequired = rolling.directionRequired;
  rec.direction = direction ?? null;
  // 主候选逐门同族标注：与用户已修/在修课同限选组的，写入理由栏供模型主动说明（含同族课学分/课号，供行内标注格式使用）
  const historyIds = new Set<string>();
  for (const ids of Object.values(history)) ids.forEach((id) => historyIds.add(id));
  for (const it of rec.items) {
    const fam = findSameFamily(it.id, historyIds);
    if (fam) {
      it.reasons.push(
        `与已选「${fam.relatedName}（${fam.relatedCredits}学分,${fam.relatedId}）」同属「${fam.setName}」限选组（修其一即可，再修不计入课组进度）`,
      );
    }
  }
  return { text: buildRecommendText(rec, opts?.allowDirectionSwitch ?? false, opts?.maxItems ?? REC_MAX_ITEMS), semester: sem, direction: direction ?? null, directionRequired: rec.directionRequired };
}
