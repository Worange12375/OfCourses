import {Fragment, useRef, useMemo, useState} from "react";
import Island, {Content, Header} from "@jetbrains/ring-ui-built/components/island/island";
import Button from "@jetbrains/ring-ui-built/components/button/button";
import {MiniSelect} from "../components/MiniSelect";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useCourseGroups} from "../hooks/useCurriculumData";
import {AiVoteWidget} from "../components/VoteWidget";
import AiAssistant from "../components/AiAssistant";
import CourseReviews from "../components/CourseReviews";
import {getSchemeData, useSchemeData} from "@/data/schemeStore";
import {useAccount} from "@/account/AccountContext";
import enData from "@/data/courses_en.json";

type HistoryData = Record<string, string[]>;

// —— 工具页侧栏条目（PC 端醒目化：图标 + 活动态指示条）——
const IconDegree = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z" />
    <path d="M22 10v6" />
    <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
  </svg>
);
const IconSparkles = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z" />
  </svg>
);
const IconMessage = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const TOOL_ITEMS = [
  { key: "degree" as const, zh: "学位评定", en: "Degree Eval.", Icon: IconDegree },
  { key: "ai" as const, zh: "AI推荐助手", en: "AI Assistant", Icon: IconSparkles },
  { key: "review" as const, zh: "课程评价", en: "Reviews", Icon: IconMessage },
];

// —— 六学位轨道徽章（空态展示用；数据与培养方案数据同步，按当前年级版本动态取）——
const degreeTrackChips = () => (getSchemeData().degree_tracks as Array<{track_code: string; name: string; total_credits_required: number}>)
  .map((t) => ({code: t.track_code, name: t.name, req: t.total_credits_required}));
const trackEnName = (code: string, fallback: string) => (enData.tracks as Record<string, string>)[code] || fallback;

// —— 六轨道评定规则详述（空态展示用；口径与评定算法、structured_data.json 一致）——
// origin 为培养方案原文提炼句（degree_tracks.description），zh/en 为精简解读。
const DEGREE_TRACK_RULES: Array<{code: string; zh: string; en: string; origin: string; groupsZh: string; groupsEn: string}> = [
  {
    code: "AE",
    zh: "修满模块 1（智能空天系统）A 课组，再从模块 1 的 B 课组选修课程，A 课组 + B 课组合计修满 24 学分即达成。",
    en: "Complete Group 1A (Module 1: Intelligent Aerospace Systems), then take electives from Group 1B of the same module until 24 credits are earned in total.",
    origin: "修完模块1的A课组，并选择模块1的B课组课程，共计24学分",
    groupsZh: "主修课组：课组 1A；选修课组：课组 1B",
    groupsEn: "Main group: 1A; Elective group: 1B",
  },
  {
    code: "EM",
    zh: "与 AE 轨道同框架：修满模块 1 的 A 课组，并从模块 1 的 B 课组选修至合计 24 学分；其中弹性力学（30310084）为本轨道指定必修课程，未修即未达成。",
    en: "Same framework as AE: complete Group 1A and take electives from Group 1B up to 24 credits in total; Elasticity (30310084) is a mandatory course for this track.",
    origin: "修完模块1的A课组，并选择模块1的B课组课程（必修弹性力学），共计24学分",
    groupsZh: "主修课组：课组 1A；选修课组：课组 1B；指定必修：弹性力学（30310084）",
    groupsEn: "Main group: 1A; Elective group: 1B; Mandatory: Elasticity (30310084)",
  },
  {
    code: "PE",
    zh: "修满模块 2（智能热管理系统）A 课组，再从模块 2 的 B 课组选修课程，合计修满 24 学分即达成。",
    en: "Complete Group 2A (Module 2: Intelligent Thermal Management Systems), then take electives from Group 2B until 24 credits are earned in total.",
    origin: "修完模块2的A课组，并选择模块2的B课组课程，共计24学分",
    groupsZh: "主修课组：课组 2A；选修课组：课组 2B",
    groupsEn: "Main group: 2A; Elective group: 2B",
  },
  {
    code: "IE",
    zh: "在模块 9–13（统计与机器学习、系统优化与智能决策、人因与人本智能、物流与供应链、智能工业与服务系统）中任选一个模块作为主修模块，修满其 A 课组，并从 III 类（模块 9–13）的其余课程中选修，合计修满 24 学分即达成。",
    en: "Pick any one module among 9-13 as your main module, complete its Group A, then take electives from the remaining courses of Category III (Modules 9-13) until 24 credits are earned in total.",
    origin: "修完模块9-13任一模块的A课组，并选择模块9-13的其他课程，共计24学分",
    groupsZh: "主修：任选模块 9–13 之一，修满其 A 课组；选修范围：III 类（模块 9–13）的其余课程",
    groupsEn: "Main: any one of Modules 9-13 (complete its Group A); Electives: remaining courses of Category III (Modules 9-13)",
  },
  {
    code: "SE",
    zh: "在模块 4–8（核心工业软件、大数据智能、可信软件、可视媒体计算、智能计算系统）中任选一个模块作为主修模块，修满其 A 课组，并从 II 类（模块 4–8）的其余课程中选修，合计修满 24 学分即达成。",
    en: "Pick any one module among 4-8 as your main module, complete its Group A, then take electives from the remaining courses of Category II (Modules 4-8) until 24 credits are earned in total.",
    origin: "修完模块4-8任一模块的A课组，并选择模块4-8的其他课程，共计24学分",
    groupsZh: "主修：任选模块 4–8 之一，修满其 A 课组；选修范围：II 类（模块 4–8）的其余课程",
    groupsEn: "Main: any one of Modules 4-8 (complete its Group A); Electives: remaining courses of Category II (Modules 4-8)",
  },
  {
    code: "CE",
    zh: "任选一个模块的 A 课组修满作为主修模块，其余学分可从所有模块的课程中自由选择，但至少 1 门课程的原始类须来自其他类（非主修 A 课组所在类）【跨类要求】；合计修满 21 学分即达成（比其他轨道少 3 学分）。",
    en: "Complete the Group A of any one module as your main module; remaining credits may come from courses of any module, provided at least 1 course's original category differs from that of the main Group A (cross-category requirement). 21 credits in total (3 fewer than other tracks).",
    origin: "修完某个模块中的A课组作为主修模块，其余课程可以从所有模块中选择，且至少跨类选择一门课程",
    groupsZh: "主修：任一模块的 A 课组；选修：全部模块的课程（至少 1 门课程原始类跨类）",
    groupsEn: "Main: Group A of any module; Electives: courses of any module (at least 1 cross-category course by original category)",
  },
  {
    code: "CED",
    zh: "交叉工程双学位：从两个不同类的模块中分别确定专业一与专业二。修满专业一模块的 A 课组，并在专业二模块的 A 课组中选修不少于 9 学分；两模块内的全部已修课程（含 B 课组，重复课程学分不重复计）合计不少于 21 学分，且两模块须跨类选择，三项条件全部满足即达成。",
    en: "Cross-disciplinary dual degree: pick two modules from different categories as your first and second specialty. Complete the Group A of the first module, earn at least 9 credits from the Group A of the second module, and earn 21+ credits in total from all courses taken within these two modules (Group B included, duplicate courses counted once). All three conditions must hold.",
    origin: "修完专业一任一模块的A课组，并从专业二各模块的A课组中选修不少于9学分的课程，且专业一与专业二须跨类选择，可获得交叉工程（专业一+专业二）学位",
    groupsZh: "主修：专业一模块 A 课组（修满）；第二专业：专业二模块 A 课组（≥9 学分）；合计：两模块内全部课程 ≥21 学分（含 B 课组、去重）",
    groupsEn: "Main: Group A of first module (complete); Second specialty: Group A of second module (≥9 credits); Total: ≥21 credits across both modules (Group B included, deduped)",
  },
];

interface GroupProgress {
  groupId: number;
  label: string;
  takenCredits: number;
  totalCredits: number;
  pct: number;
}

interface TrackProgress {
  trackCode: string;
  trackName: string;
  creditsEarned: number;
  creditsRequired: number;
  pct: number;
  mainGroups: GroupProgress[];
  subGroups: GroupProgress[];
  bestModules?: number[];
  isComplete: boolean;
  missingRequired?: string;
  aGroupComplete?: boolean;
  aGroupCompleteIds?: number[];
  specialNote?: string;
}

// —— 学位评定常量（培养方案相对稳定，集中管理便于维护）——
const MODULE_CREDIT_CAP = 24;          // 单模块毕业要求学分上限
const CE_CREDIT_REQ = 21;              // 交叉工程毕业要求学分（比传统少 3）
const CREDIT_PCT_CAP = 48;             // 学分部分占模块评定上限（%）
const A_GROUP_PCT_CAP = 52;            // A 组课程数占模块评定上限（%）
const EM_A_GROUP_PCT = 42;             // EM 轨道 A 组占比（%）
const EM_TANXIAN_PCT = 10;             // EM 轨道"弹性力学"占比（%）
const CE_CROSS_BONUS = 10;             // 兜底路径跨类加成（%）
const PCT_MAX = 100;                   // 百分比满值
const FALLBACK_W_MAIN = 0.9;           // 兜底路径主权重
const FALLBACK_W_CROSS = 0.1;          // 兜底路径跨类权重
const PCT_EPSILON = 0.01;              // 浮点相等判定阈值
const TANXIAN_COURSE_ID = "30310084";  // 弹性力学课号
const ALL_MODULE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // 全模块编号
const CED_A_PCT = 32;                  // CED 主修模块 A 组完成度占比（%）
const CED_SECOND_PCT = 20;             // CED 第二专业 A 组学分占比（%，÷9 学分）
const CED_CREDITS_PCT = 48;            // CED 两模块合计学分占比（%，÷21 学分）
const CED_SECOND_A_REQ = 9;            // CED 第二专业 A 课组最低学分（用户 2026-11-15 定稿）
const CED_PICK_KEY = "oc_ced_pick";    // CED 手动指定的专业对（localStorage 持久化）
const CE_PICK_KEY = "oc_ce_pick";      // CE 手动指定的主修模块（localStorage 持久化）

interface ToolsPageProps {
  mobile?: boolean;
}

export const ToolsPage = ({mobile}: ToolsPageProps) => {
  // 当前年级的培养方案数据（消费 useSchemeData：切年级触发重渲染，函数内读取点动态取到新版本）
  const {structuredData} = useSchemeData();
  const {locale} = useLocale();
  const {user, currentSchemeId, schemes, fetchSchemeData} = useAccount();
  // 云端方案选择弹窗：「导入云端方案」时列出账号下全部方案供用户挑选
  const [cloudPickOpen, setCloudPickOpen] = useState(false);
  const {theme} = useAppTheme();
  const isDark = theme === "dark";
  const {data: allGroups} = useCourseGroups();

  const [toolPage, setToolPage] = useState<string>("degree");
  const [historyData, setHistoryData] = useState<HistoryData | null>(null);
  const [fileName, setFileName] = useState("");
  const [selectedModules, setSelectedModules] = useState<Record<string, string>>({});
  // CED 手动指定的专业一/专业二（null = 自动取最优对；撤销即清空）
  const [cedPick, setCedPickState] = useState<{m1: number; m2: number} | null>(() => {
    try {
      const o = JSON.parse(localStorage.getItem(CED_PICK_KEY) ?? "null");
      return o && Number.isFinite(o?.m1) && Number.isFinite(o?.m2) ? {m1: o.m1, m2: o.m2} : null;
    } catch { return null; }
  });
  const setCedPick = (p: {m1: number; m2: number} | null) => {
    setCedPickState(p);
    try {
      if (p) localStorage.setItem(CED_PICK_KEY, JSON.stringify(p));
      else localStorage.removeItem(CED_PICK_KEY);
    } catch { /* 隐私模式忽略 */ }
  };
  // CE 手动指定的主修模块（null = 自动取最优；撤销即清空）
  const [cePick, setCePickState] = useState<number | null>(() => {
    try {
      const o = JSON.parse(localStorage.getItem(CE_PICK_KEY) ?? "null");
      return o && Number.isFinite(o?.modId) ? (o.modId as number) : null;
    } catch { return null; }
  });
  const setCePick = (modId: number | null) => {
    setCePickState(modId);
    try {
      if (modId !== null) localStorage.setItem(CE_PICK_KEY, JSON.stringify({modId}));
      else localStorage.removeItem(CE_PICK_KEY);
    } catch { /* 隐私模式忽略 */ }
  };
  // CED 指定区的提示条：同类自动纠正 / 无效存量指定的提醒（点选或撤销后清除）
  const [cedHint, setCedHint] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const textDark = isDark ? "text-white/90" : "text-gray-800";
  const textBody = isDark ? "text-white/75" : "text-gray-700";
  const textMuted = isDark ? "text-white/50" : "text-gray-500";
  const bgCard = isDark ? "bg-white/5" : "bg-white";
  const toolIslandClass = `${bgCard} ${mobile ? "oc-mobile-tool-island" : ""}`;
  const borderCls = isDark ? "border-white/10" : "border-gray-200";
  const progressBgCss = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const progressFillCss = "linear-gradient(90deg, #60a5fa, #93c5fd)";
  const progressCompleteCss = isDark ? "rgba(74,222,128,0.6)" : "rgb(74,222,128)";

  // course_id → credits lookup
  const courseCreditsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of structuredData.courses) {
      map.set(c.course_id, c.credits);
    }
    return map;
  }, [structuredData]);

  // group_id → Set<course_id>
  const groupCourseSet = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const gc of structuredData.group_courses) {
      map.set(gc.group_id, new Set(gc.course_ids));
    }
    return map;
  }, [structuredData]);

  // choice_set_id → {maxSelect, minSelect, courseIds}
  const choiceSetInfo = useMemo(() => {
    const map = new Map<number, {maxSelect: number; minSelect: number; courseIds: Set<string>}>();
    for (const cs of structuredData.choice_sets) {
      const courseIds = new Set(
        structuredData.choice_set_courses.filter((x) => x.set_id === cs.set_id).map((x) => x.course_id),
      );
      map.set(cs.set_id, {maxSelect: cs.max_select ?? 1, minSelect: cs.min_select ?? 1, courseIds});
    }
    return map;
  }, [structuredData]);

  // group_id → choice sets that belong to that group
  const groupChoiceSets = useMemo(() => {
    const map = new Map<number, Array<{maxSelect: number; minSelect: number; courseIds: Set<string>}>>();
    for (const cs of structuredData.choice_sets) {
      const info = choiceSetInfo.get(cs.set_id);
      if (!info) continue;
      if (!map.has(cs.group_id)) map.set(cs.group_id, []);
      map.get(cs.group_id)!.push(info);
    }
    return map;
  }, [choiceSetInfo]);

  // Effective progress of a group, accounting for 二选一/三选一 choice sets:
  // each choice set counts as `max_select` slots (NOT its raw course count), so
  // picking one of a pair no longer caps the A-group completion below 100%.
  const groupEffectiveProgress = (gid: number): {total: number; taken: number; complete: boolean} => {
    const cs = groupCourseSet.get(gid);
    if (!cs || cs.size === 0) return {total: 0, taken: 0, complete: false};
    const sets = groupChoiceSets.get(gid) ?? [];
    const setCourses = new Set<string>();
    for (const s of sets) for (const cid of s.courseIds) if (cs.has(cid)) setCourses.add(cid);
    let total = 0;
    let taken = 0;
    for (const cid of cs) {
      if (setCourses.has(cid)) continue;
      total += 1;
      if (allSelectedIds.has(cid)) taken += 1;
    }
    for (const s of sets) {
      const slot = s.maxSelect > 0 ? s.maxSelect : 1;
      total += slot;
      let selectedInSet = 0;
      for (const cid of s.courseIds) if (cs.has(cid) && allSelectedIds.has(cid)) selectedInSet += 1;
      taken += Math.min(slot, selectedInSet);
    }
    return {total, taken, complete: total > 0 && taken >= total};
  };

  // All course IDs selected across all semesters
  const allSelectedIds = useMemo(() => {
    const set = new Set<string>();
    if (historyData) {
      for (const [, ids] of Object.entries(historyData)) ids.forEach((id) => set.add(id));
    }
    return set;
  }, [historyData]);

  // Build module → {aGroupId, bGroupId} from groups data
  const moduleGroupInfo = useMemo(() => {
    const info = new Map<number, {aGroupId: number; bGroupId: number}>();
    for (const g of allGroups) {
      if (g.module_id === null) continue;
      const isA = g.group_code.endsWith("A");
      if (!info.has(g.module_id)) info.set(g.module_id, {aGroupId: 0, bGroupId: 0});
      const e = info.get(g.module_id)!;
      if (isA) e.aGroupId = g.group_id;
      else e.bGroupId = g.group_id;
    }
    return info;
  }, [allGroups]);

  // group_id → module_id (for IE/SE module range filtering)
  const groupModuleMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const g of allGroups) {
      if (g.module_id !== null) map.set(g.group_id, g.module_id);
    }
    return map;
  }, [allGroups]);

  // course_id → module_id (for out-of-group course attribution)
  const courseModuleMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of allGroups) {
      if (g.module_id === null) continue;
      const cs = groupCourseSet.get(g.group_id);
      if (!cs) continue;
      for (const cid of cs) map.set(cid, g.module_id);
    }
    return map;
  }, [allGroups, groupCourseSet]);

  // Credits taken in a group
  const creditsTakenInGroup = (gid: number): number => {
    const cs = groupCourseSet.get(gid);
    if (!cs) return 0;
    let total = 0;
    for (const cid of allSelectedIds) {
      if (cs.has(cid)) total += courseCreditsMap.get(cid) ?? 0;
    }
    return total;
  };

  // Total credits in a group
  const totalCreditsInGroup = (gid: number): number => {
    const cs = groupCourseSet.get(gid);
    if (!cs) return 1;
    let total = 0;
    for (const cid of cs) total += courseCreditsMap.get(cid) ?? 0;
    return total || 1;
  };

  // Check if a group is complete, accounting for 二选一/三选一 choice sets
  const isGroupComplete = (gid: number): boolean => groupEffectiveProgress(gid).complete;

  // Get module category: I(1-3), II(4-8), III(9-13)
  const moduleCategory = (modId: number): number => {
    if (modId <= 3) return 1;
    if (modId <= 8) return 2;
    return 3;
  };

  // Build category course sets: I类 (modules 1-3), II类 (modules 4-8), III类 (modules 9-13)
  const categoryCourseSets = useMemo(() => {
    const sets: Record<number, Set<string>> = {1: new Set(), 2: new Set(), 3: new Set()};
    for (const g of allGroups) {
      if (g.module_id === null) continue;
      const cat = moduleCategory(g.module_id);
      const cs = groupCourseSet.get(g.group_id);
      if (!cs) continue;
      for (const cid of cs) sets[cat].add(cid);
    }
    return sets;
  }, [allGroups, groupCourseSet]);

  // course_id → original category (1/2/3) from the course's original_class field; absent if unset
  const courseOriginalCatMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of structuredData.courses) {
      if (c.original_class === "I") map.set(c.course_id, 1);
      else if (c.original_class === "II") map.set(c.course_id, 2);
      else if (c.original_class === "III") map.set(c.course_id, 3);
    }
    return map;
  }, []);

  // Selected credits in a category (deduped by course_id)
  const selectedCreditsInCategory = (cat: number): number => {
    const set = categoryCourseSets[cat];
    if (!set) return 0;
    let total = 0;
    for (const cid of set) {
      if (allSelectedIds.has(cid)) total += courseCreditsMap.get(cid) ?? 0;
    }
    return total;
  };

  // Selected credits across ALL categories combined (deduped)
  const selectedCreditsAllCategories = (): number => {
    const seen = new Set<string>();
    let total = 0;
    for (const cat of [1, 2, 3]) {
      for (const cid of categoryCourseSets[cat]) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        if (allSelectedIds.has(cid)) total += courseCreditsMap.get(cid) ?? 0;
      }
    }
    return total;
  };

  // Count selected / total "slots" in an A group (choice sets count as one slot)
  const aGroupCourseCount = (gid: number): {taken: number; total: number} => {
    const p = groupEffectiveProgress(gid);
    return {taken: p.taken, total: p.total};
  };

  // Get total selected credits in a single module (A+B, deduped within module)
  const moduleTotalSelectedCredits = (modId: number): number => {
    const info = moduleGroupInfo.get(modId);
    if (!info) return 0;
    const seen = new Set<string>();
    let total = 0;
    for (const gid of [info.aGroupId, info.bGroupId]) {
      const cs = groupCourseSet.get(gid);
      if (!cs) continue;
      for (const cid of cs) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        if (allSelectedIds.has(cid)) total += courseCreditsMap.get(cid) ?? 0;
      }
    }
    return total;
  };

  // CED：两模块 A+B 组内已选课程的合计学分（跨模块去重，重复课程只计一次）
  const modulePairSelectedCredits = (mod1: number, mod2: number): number => {
    const seen = new Set<string>();
    let total = 0;
    for (const modId of [mod1, mod2]) {
      const info = moduleGroupInfo.get(modId);
      if (!info) continue;
      for (const gid of [info.aGroupId, info.bGroupId]) {
        const cs = groupCourseSet.get(gid);
        if (!cs) continue;
        for (const cid of cs) {
          if (seen.has(cid)) continue;
          seen.add(cid);
          if (allSelectedIds.has(cid)) total += courseCreditsMap.get(cid) ?? 0;
        }
      }
    }
    return total;
  };

  // Cross-category check relative to a specific module:
  // Are there selected courses that belong to a DIFFERENT category (I/II/III)
  // than the main module, AND are NOT part of the main module's own groups?
  // Category is determined by each course's original_class when set, falling
  // back to the group-derived category (current behavior) when unset.
  const hasCrossCategoryRelativeToModule = (modId: number): boolean => {
    const modInfo = moduleGroupInfo.get(modId);
    if (!modInfo) return false;
    const mainCat = moduleCategory(modId);
    // Build set of course IDs that are part of this module's A/B groups
    const modCourseIds = new Set<string>();
    for (const gid of [modInfo.aGroupId, modInfo.bGroupId]) {
      const cs = groupCourseSet.get(gid);
      if (cs) for (const cid of cs) modCourseIds.add(cid);
    }
    // Check each selected course: does it belong to a category ≠ mainCat
    // while NOT being part of the main module's groups?
    for (const cid of allSelectedIds) {
      if (modCourseIds.has(cid)) continue;
      const oc = courseOriginalCatMap.get(cid); // 1/2/3 if original_class set, else undefined
      if (oc !== undefined) {
        // original_class is authoritative: cross iff its home category differs
        if (oc !== mainCat) return true;
      } else {
        // original_class unset: fall back to group-derived category check
        for (const cat of [1, 2, 3]) {
          if (cat === mainCat) continue;
          if (categoryCourseSets[cat].has(cid)) return true;
        }
      }
    }
    return false;
  };

  // Group progress helper
  const groupProgress = (gid: number, label: string): GroupProgress => {
    const takenCredits = creditsTakenInGroup(gid);
    const totalCredits = totalCreditsInGroup(gid);
    return {
      groupId: gid,
      label,
      takenCredits,
      totalCredits,
      pct: Math.round((takenCredits / totalCredits) * 100),
    };
  };

  // —— 模块级详细查询增强：课程级明细 + 课组外已选 ——
  const courseName = (cid: string): string =>
    structuredData.courses.find((c) => c.course_id === cid)?.name ?? cid;

  // 单模块对学位评定的进度百分比（与学位卡片口径一致）：
  // A 组完成度×52% + 学分进度×48%；I 类(模块1-3)用本模块学分，II/III 类用类总学分。
  const computeModuleProgressPct = (modId: number): number => {
    const info = moduleGroupInfo.get(modId);
    if (!info) return 0;
    const cnt = aGroupCourseCount(info.aGroupId);
    const aPct = cnt.total > 0 ? (cnt.taken / cnt.total) * A_GROUP_PCT_CAP : 0;
    const cat = moduleCategory(modId);
    let creditPct: number;
    if (cat === 1) {
      const totalCreds = moduleTotalSelectedCredits(modId);
      creditPct = Math.min(CREDIT_PCT_CAP, (totalCreds / MODULE_CREDIT_CAP) * CREDIT_PCT_CAP);
    } else {
      const catCredits = selectedCreditsInCategory(cat);
      creditPct = Math.min(CREDIT_PCT_CAP, (catCredits / MODULE_CREDIT_CAP) * CREDIT_PCT_CAP);
    }
    return Math.min(PCT_MAX, Math.round(aPct + creditPct));
  };

  // 专业交叉模块（类1-3，即模块1-14）内、本课组(A/B)之外已选的课程
  const outOfGroupSelected = (
    modId: number,
  ): Array<{cid: string; name: string; credits: number; modOf: number}> => {
    const info = moduleGroupInfo.get(modId);
    const modCourseIds = new Set<string>();
    if (info) {
      for (const gid of [info.aGroupId, info.bGroupId]) {
        const cs = groupCourseSet.get(gid);
        if (cs) for (const cid of cs) modCourseIds.add(cid);
      }
    }
    const out: Array<{cid: string; name: string; credits: number; modOf: number}> = [];
    for (const cat of [1, 2, 3] as const) {
      for (const cid of categoryCourseSets[cat]) {
        if (modCourseIds.has(cid)) continue;
        if (!allSelectedIds.has(cid)) continue;
        out.push({
          cid,
          name: courseName(cid),
          credits: courseCreditsMap.get(cid) ?? 0,
          modOf: courseModuleMap.get(cid) ?? 0,
        });
      }
    }
    return out;
  };

  // 课组内课程的"二选一/三选一/四选一…"标注（N = 选课组成员数，培养方案最大为四选一）
  const choiceLabelOf = (
    sets: Array<{maxSelect: number; minSelect: number; courseIds: Set<string>}>,
    cid: string,
  ): string | null => {
    const zhNum = (n: number) => (["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][n] ?? String(n));
    for (const s of sets) {
      if (s.courseIds.has(cid)) {
        const n = s.courseIds.size;
        if (n === 2) return locale === "zh" ? "二选一" : "Pick 1/2";
        if (n >= 3) return locale === "zh" ? `${zhNum(n)}选一` : `Pick 1/${n}`;
        return null;
      }
    }
    return null;
  };

  // 渲染一个课组（A/B）的全部课程：名称 + 学分 + 是否已选 + 选课性质
  const renderGroupCourses = (gid: number, label: string, isMain: boolean) => {
    const cs = groupCourseSet.get(gid);
    if (!cs || cs.size === 0) return null;
    const sets = groupChoiceSets.get(gid) ?? [];
    return (
      <div className="mb-1.5">
        <div className={`text-[11px] font-medium ${isMain ? textBody : textMuted}`}>
          {label}（{cs.size} 门）
        </div>
        <div className="pl-2 mt-0.5 space-y-0.5">
          {[...cs].map((cid) => {
            const sel = allSelectedIds.has(cid);
            const ch = choiceLabelOf(sets, cid);
            const nameCls = sel
              ? isMain ? textBody : textMuted
              : isDark ? "text-white/35" : "text-gray-400";
            return (
              <div key={cid} className="flex items-center justify-between text-[11px]">
                <span className={`flex items-center gap-1 ${nameCls}`}>
                  <span className={sel ? "text-green-500" : isDark ? "text-white/25" : "text-gray-400"}>{sel ? "✓" : "○"}</span>
                  <span className="truncate">{courseName(cid)}</span>
                  {ch && (
                    <span className={`shrink-0 text-[9px] px-1 rounded ${isDark ? "bg-white/10 text-white/60" : "bg-gray-100 text-gray-500"}`}>{ch}</span>
                  )}
                </span>
                <span className={`shrink-0 ml-2 ${textMuted}`}>{courseCreditsMap.get(cid) ?? 0} 学分</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 渲染单个模块的详细查询卡片（进度百分比 + A/B 全课程 + 课组外已选）
  const renderModuleDetail = (modId: number) => {
    const info = moduleGroupInfo.get(modId);
    if (!info) return <div className={`text-xs ${textMuted}`}>{locale === "zh" ? "无数据" : "No data"}</div>;
    const pct = computeModuleProgressPct(modId);
    const out = outOfGroupSelected(modId);
    return (
      <div key={modId} className={`rounded-lg border p-3 ${borderCls}`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className={`text-xs font-semibold ${textDark}`}>
            {locale === "zh" ? `模块${modId}` : `Module ${modId}`}
          </span>
          <span className={`text-xs font-bold ${pct >= 100 ? "text-green-500" : textDark}`}>{pct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full overflow-hidden mb-2" style={{background: progressBgCss}}>
          <div className="h-full rounded-full transition-all" style={{width: `${pct}%`, background: pct >= 100 ? progressCompleteCss : progressFillCss}} />
        </div>
        {renderGroupCourses(info.aGroupId, locale === "zh" ? "A 课组" : "Group A", true)}
        {renderGroupCourses(info.bGroupId, locale === "zh" ? "B 课组" : "Group B", false)}
        <div className="mt-1.5">
          <div className={`text-[11px] font-medium ${textBody}`}>
            {locale === "zh" ? "专业交叉模块内·本课组外已选" : "Selected outside this group (interdisc. modules)"}
          </div>
          {out.length === 0 ? (
            <div className={`pl-2 mt-0.5 text-[11px] ${textMuted}`}>{locale === "zh" ? "无" : "None"}</div>
          ) : (
            <div className="pl-2 mt-0.5 space-y-0.5">
              {out.map((o) => (
                <div key={o.cid} className="flex items-center gap-1.5 text-[11px]">
                  <span className="shrink-0 text-green-500">✓</span>
                  <span className={`min-w-0 flex-1 truncate ${textBody}`}>{o.name}</span>
                  {o.modOf > 0 && (
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${
                        isDark ? "bg-white/10 text-white/55" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {locale === "zh" ? `模块${o.modOf}` : `M${o.modOf}`}
                    </span>
                  )}
                  <span className={`shrink-0 whitespace-nowrap ${textMuted}`}>{o.credits} 学分</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Compute all track progresses with new percentage rules
  const trackProgresses = useMemo((): TrackProgress[] => {
    if (!historyData) return [];

    const trackData = structuredData.degree_tracks;
    const trackGroups = structuredData.degree_group_requirements;
    const courseReqs = structuredData.degree_course_requirements;

    const reqByTrack = new Map<string, {main: number[]; sub: number[]}>();
    for (const rg of trackGroups) {
      if (!reqByTrack.has(rg.track_code)) reqByTrack.set(rg.track_code, {main: [], sub: []});
      const e = reqByTrack.get(rg.track_code)!;
      if (rg.is_main) e.main.push(rg.group_id);
      else e.sub.push(rg.group_id);
    }

    const reqCoursesByTrack = new Map<string, string[]>();
    for (const rc of courseReqs) {
      if (!reqCoursesByTrack.has(rc.track_code)) reqCoursesByTrack.set(rc.track_code, []);
      reqCoursesByTrack.get(rc.track_code)!.push(rc.course_id);
    }

    const results: TrackProgress[] = [];

    for (const track of trackData) {
      const code = track.track_code;
      const groups = reqByTrack.get(code);
      const requiredCourses = reqCoursesByTrack.get(code) ?? [];

      let bestModules: number[] | undefined;
      let ceSpecialNote: string | undefined;
      let bestModulePct = 0;
      let creditsEarned = 0;
      let allMainGroups: GroupProgress[] = [];
      let allSubGroups: GroupProgress[] = [];
      let missingRequired: string | undefined;

      if (code === "AE" || code === "EM" || code === "PE") {
        // AE/PE: A组52% (课程数比例) + 模块24学分48%
        // EM: 弹性力学10% + A组42% + 模块24学分48%
        const modId = code === "PE" ? 2 : 1;
        const modInfo = moduleGroupInfo.get(modId);
        if (modInfo) {
          const cnt = aGroupCourseCount(modInfo.aGroupId);
          const totalCreds = moduleTotalSelectedCredits(modId);
          const aPctBase = cnt.total > 0 ? (cnt.taken / cnt.total) : 0;

          if (code === "EM") {
            const tanxing = allSelectedIds.has(TANXIAN_COURSE_ID);
            const tanxingPct = tanxing ? EM_TANXIAN_PCT : 0;
            const aPct = aPctBase * EM_A_GROUP_PCT;
            const c24Pct = Math.min(CREDIT_PCT_CAP, (totalCreds / MODULE_CREDIT_CAP) * CREDIT_PCT_CAP);
            creditsEarned = Math.min(totalCreds, MODULE_CREDIT_CAP);
            bestModulePct = Math.min(PCT_MAX, Math.round(tanxingPct + aPct + c24Pct));
          } else {
            const aPct = aPctBase * A_GROUP_PCT_CAP;
            const c24Pct = Math.min(CREDIT_PCT_CAP, (totalCreds / MODULE_CREDIT_CAP) * CREDIT_PCT_CAP);
            creditsEarned = Math.min(totalCreds, MODULE_CREDIT_CAP);
            bestModulePct = Math.min(PCT_MAX, Math.round(aPct + c24Pct));
          }
          bestModules = [modId];
          allMainGroups = [groupProgress(modInfo.aGroupId, locale === "zh" ? `模块${modId}A` : `Module ${modId}A`)];
          allSubGroups = [groupProgress(modInfo.bGroupId, locale === "zh" ? `模块${modId}B` : `Module ${modId}B`)];
        }
      } else if (code === "IE" || code === "SE") {
        // General: A group (52% cap) + category credits (48% cap)
        const cat = code === "SE" ? 2 : 3;
        const mr = code === "SE" ? {s: 4, e: 8} : {s: 9, e: 13};
        const mids: number[] = [];
        for (const g of allGroups) {
          if (g.module_id !== null && g.module_id >= mr.s && g.module_id <= mr.e) {
            if (!mids.includes(g.module_id)) mids.push(g.module_id);
          }
        }
        mids.sort((a, b) => a - b);

        const catCredits = selectedCreditsInCategory(cat);
        const modulePcts: Array<{modId: number; pct: number; aPct: number; aComplete: boolean}> = [];

        for (const modId of mids) {
          const modInfo = moduleGroupInfo.get(modId);
          if (!modInfo) continue;
          const cnt = aGroupCourseCount(modInfo.aGroupId);
          const aPct = cnt.total > 0 ? (cnt.taken / cnt.total) * A_GROUP_PCT_CAP : 0;
          const c24Pct = Math.min(CREDIT_PCT_CAP, (catCredits / MODULE_CREDIT_CAP) * CREDIT_PCT_CAP);
          const modPct = aPct + c24Pct;
          modulePcts.push({modId, pct: modPct, aPct, aComplete: isGroupComplete(modInfo.aGroupId)});
        }

        // 按各模块对该学位的百分比进度降序；同分按 A 组进度，再按模块号
        const sorted = [...modulePcts].sort((a, b) => b.pct - a.pct || b.aPct - a.aPct || a.modId - b.modId);
        if (sorted.length > 0) {
          const best = sorted[0];
          bestModules = sorted.filter((m) => Math.abs(m.pct - best.pct) < PCT_EPSILON && Math.abs(m.aPct - best.aPct) < PCT_EPSILON).map((m) => m.modId);
          bestModulePct = best.pct;
        }

        // A/B 成对输出：每个模块的 B 课组紧随其 A 课组
        for (const m of sorted) {
          const modInfo = moduleGroupInfo.get(m.modId);
          if (!modInfo) continue;
          allMainGroups.push(groupProgress(modInfo.aGroupId, locale === "zh" ? `模块${m.modId}A` : `Module ${m.modId}A`));
          allSubGroups.push(groupProgress(modInfo.bGroupId, locale === "zh" ? `模块${m.modId}B` : `Module ${m.modId}B`));
        }

        if (bestModules && bestModules.length > 0) {
          const modInfo = moduleGroupInfo.get(bestModules[0]);
          if (modInfo) {
            creditsEarned = Math.min(catCredits, MODULE_CREDIT_CAP);
          }
        }
      } else if (code === "CE") {
        // CE: A group (52% cap) + ALL categories credits (48% cap)
        const mod3Info = moduleGroupInfo.get(3);
        let mod3ABComplete = false;
        if (mod3Info) {
          mod3ABComplete = isGroupComplete(mod3Info.aGroupId) && isGroupComplete(mod3Info.bGroupId);
        }

        const allCatCredits = selectedCreditsAllCategories();

        // Collect qualifying modules: A complete + cross (except module3 A+B = special path, no cross needed)
        const qualifiedModules: Array<{modId: number; pct: number; aPct: number; isMod3AB: boolean}> = [];

        for (const modId of ALL_MODULE_IDS) {
          const modInfo = moduleGroupInfo.get(modId);
          if (!modInfo) continue;

          let aComplete: boolean;
          let isMod3AB = false;
          if (modId === 3 && mod3ABComplete) { aComplete = true; isMod3AB = true; }
          else { aComplete = isGroupComplete(modInfo.aGroupId); }

          if (!aComplete) continue;

          // Module3 A+B special path: no cross-category required
          // Normal path: cross-category required
          if (!isMod3AB) {
            const crossOk = hasCrossCategoryRelativeToModule(modId);
            if (!crossOk) continue;
          }

          const cnt = aGroupCourseCount(modInfo.aGroupId);
          const aPct = cnt.total > 0 ? (cnt.taken / cnt.total) * A_GROUP_PCT_CAP : 0;
          const c24Pct = Math.min(CREDIT_PCT_CAP, (allCatCredits / CE_CREDIT_REQ) * CREDIT_PCT_CAP);
          const modPct = aPct + c24Pct;
          qualifiedModules.push({modId, pct: modPct, aPct, isMod3AB});
        }

        allMainGroups = [];
        allSubGroups = [];

        // 手动指定主修模块优先：达标则按达标口径，未达标按兜底公式只算该模块
        const manualMod = cePick ?? undefined;
        if (manualMod !== undefined && moduleGroupInfo.has(manualMod)) {
          const mi = moduleGroupInfo.get(manualMod)!;
          const q = qualifiedModules.find((m) => m.modId === manualMod);
          bestModules = [manualMod];
          creditsEarned = Math.min(allCatCredits, CE_CREDIT_REQ);
          allMainGroups = [groupProgress(mi.aGroupId, locale === "zh" ? `主修·模块${manualMod}A` : `Main · Module ${manualMod}A`)];
          allSubGroups = [groupProgress(mi.bGroupId, locale === "zh" ? `模块${manualMod}B` : `Module ${manualMod}B`)];
          if (q) {
            bestModulePct = q.isMod3AB ? 100 : q.pct;
            ceSpecialNote = q.isMod3AB ? (locale === "zh" ? "已达标模块3A+B交叉方案" : "Module 3 A+B Cross Path") : undefined;
          } else {
            const cnt = aGroupCourseCount(mi.aGroupId);
            const aPct = cnt.total > 0 ? (cnt.taken / cnt.total) * A_GROUP_PCT_CAP : 0;
            const c24Pct = Math.min(CREDIT_PCT_CAP, (allCatCredits / CE_CREDIT_REQ) * CREDIT_PCT_CAP);
            const crossOk = hasCrossCategoryRelativeToModule(manualMod);
            bestModulePct = (aPct + c24Pct) * FALLBACK_W_MAIN + (crossOk ? CE_CROSS_BONUS : 0) * FALLBACK_W_CROSS;
            if (!isGroupComplete(mi.aGroupId)) {
              missingRequired = locale === "zh" ? `主修模块${manualMod}的A课组未修完` : `Group A of Module ${manualMod} is incomplete`;
            } else if (!crossOk) {
              missingRequired = locale === "zh" ? "须至少跨类选择一门课程" : "Must select at least 1 cross-category course";
            }
          }
        } else if (qualifiedModules.length > 0) {
          // 按各模块对该学位的百分比进度降序；同分按 A 组进度，再按模块号
          const sortedQ = [...qualifiedModules].sort((a, b) => b.pct - a.pct || b.aPct - a.aPct || a.modId - b.modId);
          bestModules = sortedQ.map((m) => m.modId);
          const best = sortedQ[0];

          // Module 3 A+B special path: pin to 100%
          if (best.isMod3AB) {
            bestModulePct = 100;
          } else {
            bestModulePct = best.pct;
          }

          // Record special note for module 3 A+B path
          ceSpecialNote = best.isMod3AB ? (locale === "zh" ? "已达标模块3A+B交叉方案" : "Module 3 A+B Cross Path") : undefined;

          const bestInfo = moduleGroupInfo.get(best.modId);
          if (bestInfo) {
            creditsEarned = Math.min(allCatCredits, CE_CREDIT_REQ);
          }

          // A/B 成对输出：每个模块的 B 课组紧随其 A 课组
          for (const qm of sortedQ) {
            const mi = moduleGroupInfo.get(qm.modId);
            if (mi) {
              allMainGroups.push(groupProgress(mi.aGroupId, locale === "zh" ? `模块${qm.modId}A` : `Module ${qm.modId}A`));
              allSubGroups.push(groupProgress(mi.bGroupId, locale === "zh" ? `模块${qm.modId}B` : `Module ${qm.modId}B`));
            }
          }
        } else {
          // No fully qualified module: take max pct, apply q*0.9 + 0.1*cross
          let bestQ = 0;
          let bestQCross = false;
          for (const modId of ALL_MODULE_IDS) {
            const modInfo = moduleGroupInfo.get(modId);
            if (!modInfo) continue;
            const cnt = aGroupCourseCount(modInfo.aGroupId);
            const aPct = cnt.total > 0 ? (cnt.taken / cnt.total) * A_GROUP_PCT_CAP : 0;
            const c24Pct = Math.min(CREDIT_PCT_CAP, (allCatCredits / CE_CREDIT_REQ) * CREDIT_PCT_CAP);
            const modPct = aPct + c24Pct;
            if (modPct > bestQ) {
              bestQ = modPct;
              bestQCross = hasCrossCategoryRelativeToModule(modId);
            }
          }
          const crossScore = bestQCross ? CE_CROSS_BONUS : 0;
          bestModulePct = bestQ * FALLBACK_W_MAIN + crossScore * FALLBACK_W_CROSS;
          if (!bestQCross) {
            missingRequired = locale === "zh" ? "须至少跨类选择一门课程" : "Must select at least 1 cross-category course";
          }
          // Even when not fully qualified, show the real selected cross-engineering credits
          creditsEarned = Math.min(allCatCredits, CE_CREDIT_REQ);

          // Show top 3 candidates
          const candidates = ALL_MODULE_IDS.map((modId) => {
            const mi = moduleGroupInfo.get(modId);
            if (!mi) return null;
            const cnt = aGroupCourseCount(mi.aGroupId);
            const aPct = cnt.total > 0 ? (cnt.taken / cnt.total) * A_GROUP_PCT_CAP : 0;
            const c24Pct = Math.min(CREDIT_PCT_CAP, (allCatCredits / CE_CREDIT_REQ) * CREDIT_PCT_CAP);
            return {modId, pct: aPct + c24Pct, mi};
          }).filter(Boolean).sort((a, b) => b!.pct - a!.pct || a!.modId - b!.modId).slice(0, 3);

          for (const cand of candidates) {
            if (cand) {
              allMainGroups.push(groupProgress(cand.mi.aGroupId, locale === "zh" ? `模块${cand.modId}A` : `Module ${cand.modId}A`));
              allSubGroups.push(groupProgress(cand.mi.bGroupId, locale === "zh" ? `模块${cand.modId}B` : `Module ${cand.modId}B`));
            }
          }
        }
      } else if (code === "CED") {
        // CED 交叉工程（专业一+专业二）双学位（用户 2026-11-15 定稿）：
        // ① 两模块跨类 ② 主修模块 A 课组修完 ③ 第二模块 A 课组 ≥9 学分 ④ 两模块合计（去重）≥21 学分
        // 百分比 = 主修A组完成度×32% + 第二模块A组学分(÷9)×20% + 合计学分(÷21)×48%；三项全满足=100%
        allMainGroups = [];
        allSubGroups = [];
        const pairs: Array<{m1: number; m2: number; pct: number; a1Complete: boolean; a2Credits: number; pairCredits: number}> = [];
        for (const m1 of ALL_MODULE_IDS) {
          const i1 = moduleGroupInfo.get(m1);
          if (!i1) continue;
          const cnt1 = aGroupCourseCount(i1.aGroupId);
          const a1Pct = cnt1.total > 0 ? (cnt1.taken / cnt1.total) * CED_A_PCT : 0;
          const a1Complete = isGroupComplete(i1.aGroupId);
          for (const m2 of ALL_MODULE_IDS) {
            if (m2 === m1 || moduleCategory(m1) === moduleCategory(m2)) continue;
            const i2 = moduleGroupInfo.get(m2);
            if (!i2) continue;
            const a2Credits = creditsTakenInGroup(i2.aGroupId);
            const pairCredits = modulePairSelectedCredits(m1, m2);
            const a2Pct = Math.min(1, a2Credits / CED_SECOND_A_REQ) * CED_SECOND_PCT;
            const credPct = Math.min(1, pairCredits / CE_CREDIT_REQ) * CED_CREDITS_PCT;
            const complete = a1Complete && a2Credits >= CED_SECOND_A_REQ && pairCredits >= CE_CREDIT_REQ;
            pairs.push({m1, m2, pct: complete ? 100 : a1Pct + a2Pct + credPct, a1Complete, a2Credits, pairCredits});
          }
        }
        if (pairs.length > 0) {
          // 取进度最高的模块对；同分按合计学分，再按模块编号。手动指定优先（须为合法跨类对，否则回退自动）
          pairs.sort((a, b) => b.pct - a.pct || b.pairCredits - a.pairCredits || a.m1 - b.m1 || a.m2 - b.m2);
          const manual = cedPick ? pairs.find((p) => p.m1 === cedPick.m1 && p.m2 === cedPick.m2) : undefined;
          const best = manual ?? pairs[0];
          bestModules = [best.m1, best.m2];
          bestModulePct = best.pct;
          creditsEarned = Math.min(best.pairCredits, CE_CREDIT_REQ);
          const bi1 = moduleGroupInfo.get(best.m1);
          const bi2 = moduleGroupInfo.get(best.m2);
          if (bi1 && bi2) {
            allMainGroups = [
              groupProgress(bi1.aGroupId, locale === "zh" ? `专业一·模块${best.m1}A` : `Specialty 1 · Module ${best.m1}A`),
              groupProgress(bi2.aGroupId, locale === "zh" ? `专业二·模块${best.m2}A` : `Specialty 2 · Module ${best.m2}A`),
            ];
            allSubGroups = [
              groupProgress(bi1.bGroupId, locale === "zh" ? `模块${best.m1}B` : `Module ${best.m1}B`),
              groupProgress(bi2.bGroupId, locale === "zh" ? `模块${best.m2}B` : `Module ${best.m2}B`),
            ];
          }
          if (!best.a1Complete) {
            missingRequired = locale === "zh" ? `专业一（模块${best.m1}）的A课组未修完` : `Group A of Module ${best.m1} (Specialty 1) is incomplete`;
          } else if (best.a2Credits < CED_SECOND_A_REQ) {
            missingRequired = locale === "zh" ? `专业二（模块${best.m2}）A课组已修 ${best.a2Credits} 学分，不足 ${CED_SECOND_A_REQ} 学分` : `Group A of Module ${best.m2} (Specialty 2) has ${best.a2Credits} credits, below ${CED_SECOND_A_REQ}`;
          } else if (best.pairCredits < CE_CREDIT_REQ) {
            missingRequired = locale === "zh" ? `两模块合计已修 ${best.pairCredits} 学分，不足 ${CE_CREDIT_REQ} 学分` : `Total credits across both modules: ${best.pairCredits}, below ${CE_CREDIT_REQ}`;
          }
        }
      } else if (!groups) {
        continue;
      } else {
        continue;
      }

      for (const cid of requiredCourses) {
        if (!allSelectedIds.has(cid)) {
          const c = structuredData.courses.find((cc) => cc.course_id === cid);
          missingRequired = c?.name ?? cid;
        }
      }

      const pct = Math.min(100, Math.round(bestModulePct));
      const isComplete = pct >= 100;
      const creditsReq = track.total_credits_required || MODULE_CREDIT_CAP;

      results.push({
        trackCode: code,
        trackName: track.name,
        creditsEarned,
        creditsRequired: creditsReq,
        pct,
        mainGroups: allMainGroups,
        subGroups: allSubGroups,
        bestModules,
        specialNote: ceSpecialNote,
        isComplete,
        missingRequired,
        aGroupComplete: bestModules && bestModules.length > 0 ? isGroupComplete(moduleGroupInfo.get(bestModules[0])?.aGroupId ?? 0) : false,
        aGroupCompleteIds: allMainGroups.filter((g) => isGroupComplete(g.groupId)).map((g) => g.groupId),
      });
    }

    return results.sort((a, b) => b.pct - a.pct);
  }, [historyData, allGroups, groupCourseSet, courseCreditsMap, moduleGroupInfo, groupModuleMap, allSelectedIds, locale, categoryCourseSets, cedPick, cePick]);

  const allSelectedCount = allSelectedIds.size;

  // Build module options for detail queries from actual data
  const trackDetailOptions = useMemo(() => {
    if (!trackProgresses.length) return {ie: [] as {key: string; label: string}[], se: [] as {key: string; label: string}[], ieModuleIds: [] as number[], seModuleIds: [] as number[]};

    // IE modules from track data
    const ieTrack = trackProgresses.find((t) => t.trackCode === "IE");
    const seTrack = trackProgresses.find((t) => t.trackCode === "SE");

    const ieModuleIds = ieTrack
      ? [...new Set(ieTrack.mainGroups.map((g) => groupModuleMap.get(g.groupId)).filter((m): m is number => m !== undefined))].sort((a, b) => a - b)
      : [9, 10, 11, 12, 13];

    const seModuleIds = seTrack
      ? [...new Set(seTrack.mainGroups.map((g) => groupModuleMap.get(g.groupId)).filter((m): m is number => m !== undefined))].sort((a, b) => a - b)
      : [4, 5, 6, 7, 8];

    return {
      ie: [
        {key: "off", label: locale === "zh" ? "未启用" : "Off"},
        {key: "all", label: locale === "zh" ? "全部模块" : "All Modules"},
        ...ieModuleIds.map((m) => ({key: m.toString(), label: locale === "zh" ? `模块${m}` : `Module ${m}`})),
      ],
      se: [
        {key: "off", label: locale === "zh" ? "未启用" : "Off"},
        {key: "all", label: locale === "zh" ? "全部模块" : "All Modules"},
        ...seModuleIds.map((m) => ({key: m.toString(), label: locale === "zh" ? `模块${m}` : `Module ${m}`})),
      ],
      ieModuleIds,
      seModuleIds,
    };
  }, [trackProgresses, groupModuleMap, locale]);

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data.history) {
          setHistoryData(data.history as HistoryData);
          setFileName(file.name);
        } else {
          alert(locale === "zh" ? "无效的 JSON 文件，缺少 history 字段" : "Invalid JSON: missing history field");
        }
      } catch {
        alert(locale === "zh" ? "文件解析失败，请选择有效的 JSON 文件" : "File parse error");
      }
    };
    reader.readAsText(file);
  };

  // 直接读取本浏览器中的工作台数据（localStorage oc_history，与工作台录入实时同步）
  const importFromWorkspace = () => {
    try {
      const raw = localStorage.getItem("oc_history");
      if (!raw) {
        alert(locale === "zh" ? "本浏览器中未找到工作台数据：请先到「工作台」录入课程（数据保存在本地浏览器）。" : "No workspace data found in this browser. Please record your courses in the Workspace first.");
        return;
      }
      const data = JSON.parse(raw) as HistoryData;
      if (!data || typeof data !== "object" || !Object.values(data).every((v) => Array.isArray(v))) {
        alert(locale === "zh" ? "工作台数据格式异常，未导入。" : "Workspace data looks invalid; not imported.");
        return;
      }
      setHistoryData(data);
      setFileName(locale === "zh" ? "当前工作台数据" : "Current workspace data");
    } catch {
      alert(locale === "zh" ? "工作台数据读取失败，未导入。" : "Failed to read workspace data; not imported.");
    }
  };

  // 拉取并应用某个云端方案的快照（成功后关闭选择弹窗）
  const applyCloudScheme = async (id: number, name: string) => {
    const raw = await fetchSchemeData(id);
    if (!raw) {
      alert(locale === "zh" ? "云端方案读取失败，请检查网络后重试。" : "Failed to load the cloud plan; check your connection and retry.");
      return;
    }
    try {
      const obj = JSON.parse(raw) as {h?: HistoryData; history?: HistoryData};
      const hist = obj.h ?? obj.history;
      if (!hist || typeof hist !== "object" || !Object.values(hist).every((v) => Array.isArray(v))) {
        alert(locale === "zh" ? "云端方案数据格式异常，未导入。" : "Cloud plan data looks invalid; not imported.");
        return;
      }
      setHistoryData(hist);
      setFileName(locale === "zh" ? `云端方案：${name}` : `Cloud plan: ${name}`);
      setCloudPickOpen(false);
    } catch {
      alert(locale === "zh" ? "云端方案数据解析失败，未导入。" : "Failed to parse cloud plan data; not imported.");
    }
  };

  // 导入云端方案：未登录回退为导入本浏览器工作台数据；已登录则弹窗让用户挑选具体方案
  const importFromCloud = async () => {
    if (!user) {
      alert(locale === "zh"
        ? "当前未登录，将改为导入本浏览器中的工作台数据。"
        : "Not signed in — falling back to this browser's workspace data.");
      importFromWorkspace();
      return;
    }
    if (schemes.length === 0) {
      alert(locale === "zh"
        ? "账号下暂无云端方案：可先在右上角账号面板中保存或新建方案。"
        : "No cloud plans yet — save or create one from the account panel (top-right) first.");
      return;
    }
    setCloudPickOpen(true);
  };

  return (
    <div className={`flex flex-1 ${mobile ? "flex-col h-full" : "flex-row h-full"} ${isDark ? "bg-[#0e0e14]" : "bg-gray-50"}`}>
      {/* ===== Sidebar ===== */}
      <div className={`${mobile ? "grid grid-cols-3 border-b p-2 gap-1" : "flex w-44 shrink-0 flex-col border-r p-3 gap-1.5"} ${borderCls} ${isDark ? "bg-[#14141e]" : "bg-white"}`}>
        {mobile ? (
          <>
            {TOOL_ITEMS.map((t) => (
              <button
                key={t.key}
                onClick={() => setToolPage(t.key)}
                className={`cursor-pointer rounded border-none py-2 font-medium text-center whitespace-nowrap transition-colors ${mobile ? "min-w-0 px-1 text-[11px]" : "flex-1 px-3 text-xs"} ${
                  toolPage === t.key
                    ? isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-600"
                    : isDark ? "text-white/60 hover:bg-white/5" : "text-gray-600 hover:bg-gray-100"
                }`}
              >{locale === "zh" ? t.zh : t.en}</button>
            ))}
          </>
        ) : (
          <>
            <div className={`px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-white/35" : "text-gray-400"}`}>
              {locale === "zh" ? "综合工具" : "Tools"}
            </div>
            {TOOL_ITEMS.map((t) => {
              const active = toolPage === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setToolPage(t.key)}
                  className={`relative flex cursor-pointer items-center gap-2 rounded-lg border-none px-3 py-2.5 text-left text-[13px] font-medium transition-all ${
                    active
                      ? isDark ? "bg-blue-500/20 text-blue-200" : "bg-blue-100 text-blue-700"
                      : isDark ? "text-white/65 hover:bg-white/5" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-blue-500" />}
                  <span className={`shrink-0 ${active ? (isDark ? "text-blue-300" : "text-blue-600") : isDark ? "text-white/40" : "text-gray-400"}`}>
                    <t.Icon />
                  </span>
                  {locale === "zh" ? t.zh : t.en}
                </button>
              );
            })}
            <div className={`mt-auto px-2 pt-3 text-[10px] leading-relaxed ${isDark ? "text-white/25" : "text-gray-400"}`}>
              {locale === "zh" ? "所有计算均在浏览器本地完成，数据不会上传。" : "All computations run locally in your browser."}
            </div>
          </>
        )}
      </div>
      {/* ===== Content ===== */}
      <div className={`flex-1 flex flex-col ${mobile ? "gap-2 px-2 py-2 overflow-y-auto oc-mobile-pb-nav" : "gap-3 p-3 overflow-auto"}`}>
      {toolPage === "degree" && <>
      <Island className={toolIslandClass}>
        <Header border>
          <span className={`text-sm font-semibold ${textDark}`}>
            {locale === "zh" ? "学位评定" : "Degree Evaluation"}
          </span>
        </Header>
        <Content>
          <div className={`${mobile ? "px-3" : "px-4"} py-3 flex flex-col gap-3`}>
            <div className={`text-xs ${textBody}`}>
              {locale === "zh"
                ? "「导入本地数据」读取工作台导出的 JSON 文件；「导入云端方案」从账号下的云端方案列表中任选一份导入（未登录时自动改为导入本浏览器的工作台数据）。导入后系统将自动计算各专业学位的获取进度。"
                : "\"Import Local Data\" reads a JSON file exported from the Workspace; \"Import Cloud Plan\" lets you pick any cloud plan under your account (falls back to this browser's workspace data when signed out). Degree progress is computed automatically after import."}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => fileInputRef.current?.click()}>
                {locale === "zh" ? "导入本地数据" : "Import Local Data"}
              </Button>
              <Button onClick={importFromCloud}>
                {locale === "zh" ? "导入云端方案" : "Import Cloud Plan"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImport(f);
                }}
              />
              {fileName && (
                <span className={`text-xs ${textMuted}`}>
                  {locale === "zh" ? `已导入：${fileName}` : `Imported: ${fileName}`}
                </span>
              )}
            </div>
            {historyData && (
              <div className={`text-xs ${textMuted}`}>
                {locale === "zh"
                  ? `共导入 ${Object.keys(historyData).length} 个学期，${allSelectedCount} 门课程`
                  : `${Object.keys(historyData).length} semesters, ${allSelectedCount} courses`}
              </div>
            )}
          </div>
        </Content>
      </Island>

      {/* 云端方案选择弹窗：列出账号下全部方案，点选即导入 */}
      {cloudPickOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{background: "rgba(0,0,0,0.45)"}} onClick={() => setCloudPickOpen(false)}>
          <div
            className={`w-full max-w-sm rounded-xl border shadow-2xl ${isDark ? "border-white/10 bg-[#1e1e2a]" : "border-gray-200 bg-white"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between border-b px-4 py-3 ${isDark ? "border-white/10" : "border-gray-200"}`}>
              <span className={`text-sm font-semibold ${textDark}`}>
                {locale === "zh" ? "选择要导入的云端方案" : "Choose a cloud plan to import"}
              </span>
              <button onClick={() => setCloudPickOpen(false)} className={`cursor-pointer text-sm opacity-60 hover:opacity-100 ${isDark ? "text-white" : "text-gray-800"}`}>✕</button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {schemes.map((s) => {
                const active = s.id === currentSchemeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => applyCloudScheme(s.id, s.name)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-none px-3 py-2.5 text-left text-xs transition-colors ${
                      isDark ? "text-white/85 hover:bg-white/5" : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {s.name}
                      {active && (
                        <span className={`ml-2 shrink-0 rounded px-1 py-0.5 text-[9px] ${isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-700"}`}>
                          {locale === "zh" ? "当前" : "current"}
                        </span>
                      )}
                    </span>
                    <span className={`shrink-0 text-[10px] ${isDark ? "text-white/35" : "text-gray-400"}`}>
                      {new Date(s.updated_at * 1000).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== 空态引导（未导入数据时展示，导入后隐藏）===== */}
      {!historyData && (
        <Island className={toolIslandClass}>
          <Header border>
            <span className={`text-sm font-semibold ${textDark}`}>
              {locale === "zh" ? "七个学位轨道的评定规则" : "Evaluation rules of the seven degree tracks"}
            </span>
          </Header>
          <Content>
            <div className={`flex flex-col gap-4 ${mobile ? "px-3" : "px-4"} py-3`}>
              {/* 轨道规则卡（每轨道：精简解读 + 培养方案原文 + 主修/选修结构） */}
              {DEGREE_TRACK_RULES.map((r) => {
                const chip = degreeTrackChips().find((c) => c.code === r.code);
                if (!chip) return null;
                return (
                  <div key={r.code} className={`rounded-lg border p-3 ${borderCls}`}>
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-blue-500">{r.code}</span>
                      <span className={`text-xs font-semibold ${textDark}`}>
                        {locale === "zh" ? chip.name : trackEnName(r.code, chip.name)}
                      </span>
                      <span className={`text-[10px] ${textMuted}`}>
                        {locale === "zh" ? `要求 ${chip.req} 学分` : `${chip.req} credits required`}
                      </span>
                    </div>
                    <div className={`text-[11px] leading-relaxed ${textBody}`}>{locale === "zh" ? r.zh : r.en}</div>
                    <div
                      className={`mt-1.5 rounded-md px-2 py-1.5 text-[11px] leading-relaxed ${isDark ? "bg-white/[0.02] text-white/50" : "bg-gray-50 text-gray-500"}`}
                      style={{borderLeft: "2px solid #3b82f6"}}
                    >
                      {locale === "zh" ? "培养方案原文：" : "From the curriculum: "}
                      “{r.origin}”
                    </div>
                    <div className={`mt-1 text-[11px] ${textMuted}`}>{locale === "zh" ? r.groupsZh : r.groupsEn}</div>
                  </div>
                );
              })}
            </div>
          </Content>
        </Island>
      )}

      {/* ===== Results (only after import) ===== */}
      {historyData && trackProgresses.length > 0 && (
        <>
          {/* Overview cards */}
          <Island className={toolIslandClass}>
            <Header border>
              <span className={`text-sm font-semibold ${textDark}`}>
                {locale === "zh" ? "学位获取进度" : "Degree Progress"}
              </span>
            </Header>
            <Content>
            <div className={`${mobile ? "px-3" : "px-4"} py-3 grid grid-cols-1 md:grid-cols-2 gap-3`}>
                {trackProgresses.slice(0, 8).map((tp) => (
                  <div
                    key={tp.trackCode}
                    className={`rounded-lg border p-3 ${borderCls} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-sm font-semibold truncate ${textDark}`}>
                          {locale === "zh" ? tp.trackName : trackEnName(tp.trackCode, tp.trackName)}
                        </span>
                        {tp.isComplete && (
                          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                            isDark ? "bg-green-500/20 text-green-300" : "bg-green-100 text-green-700"
                          }`}>
                            {locale === "zh" ? "已达标" : "Complete"}
                          </span>
                        )}
                      </div>
                      <span className={`shrink-0 whitespace-nowrap text-sm font-bold ${tp.isComplete ? "text-green-500" : textDark}`}>
                        {tp.creditsEarned}/{tp.creditsRequired}
                      </span>
                    </div>

                    {/* Main progress bar - prominent */}
                    <div className="relative h-5 w-full rounded-full overflow-hidden mb-2" style={{background: progressBgCss}}>
                      <div
                        className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 flex items-center justify-end pr-2`}
                        style={{
                          width: `${Math.min(Math.max(tp.pct, 4), 100)}%`,
                          background: tp.isComplete ? progressCompleteCss : progressFillCss,
                        }}
                      >
                        {tp.pct >= 20 && (
                          <span className="text-[10px] font-bold text-white drop-shadow-sm">
                            {tp.pct}%
                          </span>
                        )}
                      </div>
                      {tp.pct < 20 && (
                        <span className={`absolute inset-y-0 right-1 flex items-center text-[10px] font-bold ${textMuted}`}>
                          {tp.pct}%
                        </span>
                      )}
                    </div>

                    {/* Module info */}
                    {tp.bestModules && tp.bestModules.length > 0 && (
                      <div className={`text-[11px] mt-1.5 ${textMuted}`}>
                        {tp.trackCode === "CED" && cedPick
                          ? (locale === "zh"
                            ? `已指定：模块${tp.bestModules[0]}（专业一） + 模块${tp.bestModules[1]}（专业二）`
                            : `Set: Module ${tp.bestModules[0]} (Specialty 1) + Module ${tp.bestModules[1]} (Specialty 2)`)
                          : tp.trackCode === "CE" && cePick !== null
                            ? (locale === "zh"
                              ? `已指定：主修模块${tp.bestModules[0]}`
                              : `Set: Main module ${tp.bestModules[0]}`)
                            : (locale === "zh"
                              ? `最佳匹配：${tp.bestModules.map((m) => `模块${m}`).join("、")}`
                              : `Best match: ${tp.bestModules.map((m) => `Module ${m}`).join(", ")}`)}
                      </div>
                    )}

                    {/* CED 手动指定专业一/专业二（可撤销，恢复自动取最优对）。
                        下拉用 MiniSelect（同培养方案/导图页搜索范围下拉的自定义组件）：
                        原生 select 的弹出列表在暗色主题下配色异常（白底白字）。 */}
                    {tp.trackCode === "CED" && (() => {
                      const catOf = (n: number) => (n <= 3 ? 1 : n <= 8 ? 2 : 3);
                      const modOpts = ALL_MODULE_IDS.filter((n) => moduleGroupInfo.has(n))
                        .map((n) => ({value: String(n), label: locale === "zh" ? `模块${n}` : `Module ${n}`}));
                      const autoM1 = tp.bestModules?.[0] ?? 1;
                      const autoM2 = tp.bestModules?.[1] ?? ALL_MODULE_IDS.find((n) => n !== autoM1 && catOf(n) !== catOf(autoM1) && moduleGroupInfo.has(n))!;
                      // 存量指定的合法性校验：跨类且两模块均有课组数据；非法指定不生效并提示
                      const manualValid = !!(cedPick && cedPick.m1 !== cedPick.m2 && catOf(cedPick.m1) !== catOf(cedPick.m2)
                        && moduleGroupInfo.has(cedPick.m1) && moduleGroupInfo.has(cedPick.m2));
                      const m1 = (manualValid ? cedPick!.m1 : undefined) ?? autoM1;
                      const m2 = (manualValid ? cedPick!.m2 : undefined) ?? autoM2;
                      // 专业二选项天然只含跨类模块（同大类不可选）；专业一可任选，若原专业二被同类化则自动纠正并提示
                      const m2Opts = modOpts.filter((o) => Number(o.value) !== m1 && catOf(Number(o.value)) !== catOf(m1));
                      const pickM1 = (n1: number) => {
                        if (cedPick?.m2 && cedPick.m2 !== n1 && catOf(cedPick.m2) !== catOf(n1)) {
                          setCedPick({m1: n1, m2: cedPick.m2});
                          setCedHint("");
                          return;
                        }
                        const n2 = ALL_MODULE_IDS.find((n) => n !== n1 && catOf(n) !== catOf(n1) && moduleGroupInfo.has(n))!;
                        setCedPick({m1: n1, m2: n2});
                        setCedHint(locale === "zh"
                          ? `专业一与专业二须跨类（同大类不能组成交叉工程双学位），专业二已自动改为模块${n2}。`
                          : `Specialties must be cross-category (same type cannot form the double degree); Specialty 2 switched to Module ${n2}.`);
                      };
                      const pickM2 = (n2: number) => {
                        setCedPick({m1, m2: n2});
                        setCedHint("");
                      };
                      return (
                        <div className={`mt-1.5 rounded-md border p-1.5 ${isDark ? "border-white/10 bg-white/[0.03]" : "border-gray-200 bg-white"}`}>
                          <div className="flex items-center gap-1.5">
                            <span className={`shrink-0 text-[10px] ${textMuted}`}>{locale === "zh" ? "专业一" : "Spec. 1"}</span>
                            <MiniSelect
                              value={String(m1)}
                              options={modOpts}
                              onChange={(v) => pickM1(Number(v))}
                              isDark={isDark}
                            />
                            <span className={`shrink-0 text-[10px] ${textMuted}`}>{locale === "zh" ? "专业二" : "Spec. 2"}</span>
                            <MiniSelect
                              value={String(m2)}
                              options={m2Opts}
                              onChange={(v) => pickM2(Number(v))}
                              isDark={isDark}
                            />
                          </div>
                          {/* 撤销按钮单独一行（窄屏友好）：常驻、未手动指定时置灰 */}
                          <div className="mt-1.5">
                            <button
                              onClick={() => { setCedPick(null); setCedHint(""); }}
                              disabled={!cedPick}
                              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                                cedPick
                                  ? `cursor-pointer ${isDark ? "border-white/15 text-white/60 hover:bg-white/5" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`
                                  : `cursor-not-allowed opacity-40 ${isDark ? "border-white/10 text-white/40" : "border-gray-200 text-gray-400"}`
                              }`}
                            >
                              {locale === "zh" ? "撤销" : "Reset"}
                            </button>
                          </div>
                          {(cedHint || (cedPick && !manualValid)) && (
                            <div className={`mt-1 text-[10px] leading-relaxed ${isDark ? "text-amber-300" : "text-amber-600"}`}>
                              {cedHint
                                || (locale === "zh"
                                  ? "已指定的专业对无效（同大类或当前年级无该模块数据），本次按自动推荐的最佳对计算；点「撤销」清除该指定。"
                                  : "The saved pair is invalid (same type, or module missing in the current scheme) — the auto best pair is used; press Reset to clear it.")}
                            </div>
                          )}
                          <div className={`mt-1 text-[10px] leading-relaxed ${textMuted}`}>
                            {cedPick && manualValid
                              ? (locale === "zh"
                                ? "已手动指定专业一与专业二，进度按此对计算；点「撤销」恢复自动推荐。"
                                : "Specialties set manually — progress is computed for this pair; press Reset for auto selection.")
                              : (locale === "zh"
                                ? "可在此指定专业一与专业二（须跨类，同大类模块不可组成双学位）；不指定则自动取进度最高的一对。"
                                : "Optionally pick the two specialties (cross-category only — same-type modules cannot form the double degree); defaults to the best-scoring pair.")}
                          </div>
                        </div>
                      );
                    })()}

                    {/* CE 手动指定主修模块（可撤销，恢复自动取最优）。MiniSelect 同 CED */}
                    {tp.trackCode === "CE" && (() => {
                      const modOpts = ALL_MODULE_IDS.filter((n) => moduleGroupInfo.has(n))
                        .map((n) => ({value: String(n), label: locale === "zh" ? `模块${n}` : `Module ${n}`}));
                      const ceValid = cePick !== null && moduleGroupInfo.has(cePick);
                      const ceVal = (ceValid ? cePick : undefined) ?? tp.bestModules?.[0] ?? Number(modOpts[0]?.value ?? 1);
                      return (
                        <div className={`mt-1.5 rounded-md border p-1.5 ${isDark ? "border-white/10 bg-white/[0.03]" : "border-gray-200 bg-white"}`}>
                          <div className="flex items-center gap-1.5">
                            <span className={`shrink-0 text-[10px] ${textMuted}`}>{locale === "zh" ? "主修模块" : "Main module"}</span>
                            <MiniSelect
                              value={String(ceVal)}
                              options={modOpts}
                              onChange={(v) => setCePick(Number(v))}
                              isDark={isDark}
                            />
                          </div>
                          {/* 撤销按钮单独一行（窄屏友好）：常驻、未手动指定时置灰 */}
                          <div className="mt-1.5">
                            <button
                              onClick={() => setCePick(null)}
                              disabled={cePick === null}
                              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                                cePick !== null
                                  ? `cursor-pointer ${isDark ? "border-white/15 text-white/60 hover:bg-white/5" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`
                                  : `cursor-not-allowed opacity-40 ${isDark ? "border-white/10 text-white/40" : "border-gray-200 text-gray-400"}`
                              }`}
                            >
                              {locale === "zh" ? "撤销" : "Reset"}
                            </button>
                          </div>
                          <div className={`mt-1 text-[10px] leading-relaxed ${textMuted}`}>
                            {cePick !== null
                              ? (locale === "zh"
                                ? "已手动指定主修模块，进度按该模块计算；点「撤销」恢复自动推荐。"
                                : "Main module set manually — progress is computed for it; press Reset for auto selection.")
                              : (locale === "zh"
                                ? "可在此指定主修模块；不指定则自动取进度最高的达标模块。"
                                : "Optionally pick the main module; defaults to the best-scoring qualified one.")}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Special note (module 3 A+B path) */}
                    {tp.specialNote && (
                      <div className={`mt-1 text-[11px] font-medium ${isDark ? "text-green-300" : "text-green-600"}`}>
                        ✅ {tp.specialNote}
                      </div>
                    )}

                    {/* Group detail rows: A/B paired, B immediately follows its A */}
                    <div className="mt-2 space-y-1">
                      {tp.mainGroups.map((g, i) => (
                        <Fragment key={`m-${g.groupId}`}>
                          <div className="flex items-center justify-between gap-1.5 text-[11px]">
                            <span className={`flex items-center gap-1 min-w-0 ${textBody}`}>
                              <span className="truncate">{g.label}</span>
                              {tp.aGroupCompleteIds?.includes(g.groupId) && (
                                <span className={`shrink-0 text-[9px] px-1 py-0.5 rounded ${
                                  isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-700"
                                }`}>
                                  {locale === "zh" ? "A课组已修完" : "Complete"}
                                </span>
                              )}
                            </span>
                            <span className={`shrink-0 whitespace-nowrap ${textMuted}`}>
                              {g.takenCredits}/{g.totalCredits} 学分
                            </span>
                          </div>
                          {tp.subGroups[i] && (
                            <div className="flex items-center justify-between gap-1.5 text-[11px]">
                              <span className={`truncate ${textMuted}`}>{tp.subGroups[i].label}</span>
                              <span className={`shrink-0 whitespace-nowrap ${textMuted}`}>
                                {tp.subGroups[i].takenCredits}/{tp.subGroups[i].totalCredits} 学分
                              </span>
                            </div>
                          )}
                        </Fragment>
                      ))}
                    </div>

                    {/* Missing required course warning */}
                    {tp.missingRequired && (
                      <div className={`mt-1.5 text-[11px] ${isDark ? "text-yellow-300" : "text-yellow-600"}`}>
                        {locale === "zh"
                          ? `⚠ 缺少必修：${tp.missingRequired}`
                          : `⚠ Missing: ${tp.missingRequired}`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Content>
          </Island>

          {/* ===== Detail query ===== */}
          <Island className={toolIslandClass}>
            <Header border>
              <span className={`text-sm font-semibold ${textDark}`}>
                {locale === "zh" ? "模块级详细查询" : "Module-Level Detail Query"}
              </span>
            </Header>
            <Content>
              <div className={`${mobile ? "px-3" : "px-4"} py-3 flex flex-col gap-3`}>
                {/* Industrial Engineering (III类 模块9-13) */}
                <div className={`rounded-lg border p-3 ${borderCls}`}>
                  <div className={`text-xs font-semibold mb-2 ${textDark}`}>
                    {locale === "zh" ? "工业工程 (III类 模块9-13)" : "Industrial Eng. (Type III, Modules 9-13)"}
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-36">
                      <MiniSelect
                        value={selectedModules["IE"] ?? "off"}
                        options={trackDetailOptions.ie.map((o) => ({value: o.key, label: o.label}))}
                        onChange={(v) => setSelectedModules((p) => ({...p, IE: v}))}
                        isDark={isDark}
                      />
                    </div>
                  </div>
                  {(() => {
                    const key = selectedModules["IE"] ?? "off";
                    if (key === "off") return null; // 未启用：不展示任何模块详情
                    const mods = key === "all" ? trackDetailOptions.ieModuleIds : [parseInt(key, 10)];
                    return (
                      <div className="space-y-2">
                        {mods.map((mid) => renderModuleDetail(mid))}
                      </div>
                    );
                  })()}
                </div>

                {/* Software Engineering (II类 模块4-8) */}
                <div className={`rounded-lg border p-3 ${borderCls}`}>
                  <div className={`text-xs font-semibold mb-2 ${textDark}`}>
                    {locale === "zh" ? "软件工程 (II类 模块4-8)" : "Software Eng. (Type II, Modules 4-8)"}
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-36">
                      <MiniSelect
                        value={selectedModules["SE"] ?? "off"}
                        options={trackDetailOptions.se.map((o) => ({value: o.key, label: o.label}))}
                        onChange={(v) => setSelectedModules((p) => ({...p, SE: v}))}
                        isDark={isDark}
                      />
                    </div>
                  </div>
                  {(() => {
                    const key = selectedModules["SE"] ?? "off";
                    if (key === "off") return null; // 未启用：不展示任何模块详情
                    const mods = key === "all" ? trackDetailOptions.seModuleIds : [parseInt(key, 10)];
                    return (
                      <div className="space-y-2">
                        {mods.map((mid) => renderModuleDetail(mid))}
                      </div>
                    );
                  })()}
                </div>

                {/* Module 1 detail (AE/EM share this) */}
                <div className={`rounded-lg border p-3 ${borderCls}`}>
                  <div className={`text-xs font-semibold mb-2 ${textDark}`}>
                    {locale === "zh" ? "I类基础加强 (模块1-3)" : "Type I Core (Modules 1-3)"}
                  </div>
                  <div className="space-y-2">
                    {[1, 2, 3].map((mid) => renderModuleDetail(mid))}
                  </div>
                  {(() => {
                    const hasEM = allSelectedIds.has(TANXIAN_COURSE_ID);
                    return (
                      <div className={`mt-2 text-[11px] ${hasEM ? "text-green-500" : isDark ? "text-yellow-300" : "text-yellow-600"}`}>
                        {locale === "zh"
                          ? `${hasEM ? "✅" : "⚠"} 弹性力学：${hasEM ? "已选" : "未选（工程力学必修）"}`
                          : `${hasEM ? "✅" : "⚠"} Elastic Mechanics: ${hasEM ? "Selected" : "Missing (EM Required)"}`}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </Content>
          </Island>
        </>
      )}

      </>}

      {toolPage === "ai" && (
      <Island className={toolIslandClass}>
          <Header border>
            <span className={`text-sm font-semibold ${textDark}`}>
              {locale === "zh" ? "课程推荐 AI 助手" : "AI Course Assistant"}
            </span>
          </Header>
          <Content>
            <div className={`flex flex-col gap-4 ${mobile ? "px-3" : "px-4"} py-3`}>
              <AiAssistant locale={locale} isDark={isDark} />
              <div className={`rounded-lg border p-3 ${borderCls} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`}>
                <div className={`mb-1 text-xs font-semibold ${textDark}`}>
                  {locale === "zh" ? "为这个助手评个分" : "Rate this assistant"}
                </div>
                <div className={`mb-2 text-[11px] leading-relaxed ${textMuted}`}>
                  {locale === "zh"
                    ? "你的评分会直接影响这个工具的迭代优先级；投票完全匿名，每个维度每人一票。"
                    : "Your rating directly shapes what we improve next. Voting is anonymous, one vote per dimension."}
                </div>
                <AiVoteWidget />
              </div>
            </div>
          </Content>
      </Island>
      )}

      {toolPage === "review" && (
        mobile ? (
          <CourseReviews locale={locale} isDark={isDark} mobile={mobile} />
        ) : (
          <Island className={bgCard}>
            <Content>
              <div className="px-4 py-3">
                <CourseReviews locale={locale} isDark={isDark} mobile={mobile} />
              </div>
            </Content>
          </Island>
        )
      )}
    </div>
    </div>
  );
};
