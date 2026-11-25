// 学位评定算法：与综合工具页"学位评定"（ToolsPage.tsx trackProgresses）完全同源，
// 供 AI 助手把【学位评定进度】注入上下文 —— 模型只引用数字解读，不自行套公式重算。
// 索引按年级惰性构建（与 recommend.ts 同模式）：getSchemeYear() 变化时重建，其余调用复用。

import {getSchemeData, getSchemeYear, type SchemeData} from "@/data/schemeStore";

type History = Record<string, string[]>;

interface SdCourse { course_id: string; name: string; credits: number; original_class?: string | null; }
interface SdGroup { group_id: number; group_code: string; module_id: number | null; name: string; }

// —— 常量（与 ToolsPage 完全一致）——
const MODULE_CREDIT_CAP = 24;
const CE_CREDIT_REQ = 21;
const CREDIT_PCT_CAP = 48;
const A_GROUP_PCT_CAP = 52;
const EM_A_GROUP_PCT = 42;
const EM_TANXIAN_PCT = 10;
const CE_CROSS_BONUS = 10;
const PCT_MAX = 100;
const FALLBACK_W_MAIN = 0.9;
const FALLBACK_W_CROSS = 0.1;
const PCT_EPSILON = 0.01;
const TANXIAN_COURSE_ID = "30310084"; // 弹性力学
const ALL_MODULE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
// CED 交叉工程（专业一+专业二）双学位权重（2026-11-15 用户定稿，与 ToolsPage 一致）
const CED_A_PCT = 32;       // 主修模块 A 课组完成度占比
const CED_SECOND_PCT = 20;  // 第二模块 A 课组学分占比（÷9）
const CED_CREDITS_PCT = 48; // 两模块合计学分占比（÷21）
const CED_SECOND_A_REQ = 9; // 第二模块 A 课组最低学分

// —— 按年级惰性构建的索引 ——
interface DegreeIndexes {
  groupCourseSet: Map<number, Set<string>>;
  groupChoiceSets: Map<number, Array<{maxSelect: number; minSelect: number; courseIds: Set<string>}>>;
  courseCreditsMap: Map<string, number>;
  courseNameMap: Map<string, string>;
  moduleGroupInfo: Map<number, {aGroupId: number; bGroupId: number}>;
  categoryCourseSets: Record<number, Set<string>>;
  courseOriginalCatMap: Map<string, number>;
  tracks: Array<{track_code: string; name: string; total_credits_required: number | null}>;
  courseReqs: Array<{track_code: string | null; course_id: string | null}>;
}

let builtIndexes: DegreeIndexes | null = null;
let builtYear = "";

function buildIndexes(data: SchemeData): DegreeIndexes {
  const courses = data.courses as unknown as SdCourse[];
  const groups = data.course_groups as unknown as SdGroup[];
  const groupCourses = data.group_courses as unknown as Array<{ group_id: number; course_ids: string[] }>;

  const courseCreditsMap = new Map<string, number>();
  const courseNameMap = new Map<string, string>();
  for (const c of courses) {
    courseCreditsMap.set(c.course_id, c.credits);
    courseNameMap.set(c.course_id, c.name);
  }

  const groupCourseSet = new Map<number, Set<string>>();
  for (const gc of groupCourses) groupCourseSet.set(gc.group_id, new Set(gc.course_ids));

  const choiceSetInfo = new Map<number, { maxSelect: number; minSelect: number; courseIds: Set<string> }>();
  for (const cs of data.choice_sets as unknown as Array<{ set_id: number; max_select: number | null; min_select: number | null }>) {
    const courseIds = new Set(
      (data.choice_set_courses as unknown as Array<{ set_id: number; course_id: string }>)
        .filter((x) => x.set_id === cs.set_id).map((x) => x.course_id),
    );
    choiceSetInfo.set(cs.set_id, { maxSelect: cs.max_select ?? 1, minSelect: cs.min_select ?? 1, courseIds });
  }

  const groupChoiceSets = new Map<number, Array<{ maxSelect: number; minSelect: number; courseIds: Set<string> }>>();
  for (const cs of data.choice_sets as unknown as Array<{ set_id: number; group_id: number | null; max_select: number | null; min_select: number | null }>) {
    const info = choiceSetInfo.get(cs.set_id);
    if (!info) continue;
    const gid = cs.group_id ?? 0;
    if (!groupChoiceSets.has(gid)) groupChoiceSets.set(gid, []);
    groupChoiceSets.get(gid)!.push(info);
  }

  const moduleGroupInfo = new Map<number, { aGroupId: number; bGroupId: number }>();
  for (const g of groups) {
    if (g.module_id === null) continue;
    if (!moduleGroupInfo.has(g.module_id)) moduleGroupInfo.set(g.module_id, { aGroupId: 0, bGroupId: 0 });
    const e = moduleGroupInfo.get(g.module_id)!;
    if (g.group_code.endsWith("A")) e.aGroupId = g.group_id;
    else e.bGroupId = g.group_id;
  }

  const moduleCategory = (modId: number): number => (modId <= 3 ? 1 : modId <= 8 ? 2 : 3);

  const categoryCourseSets: Record<number, Set<string>> = { 1: new Set(), 2: new Set(), 3: new Set() };
  for (const g of groups) {
    if (g.module_id === null) continue;
    const cat = moduleCategory(g.module_id);
    const cs = groupCourseSet.get(g.group_id);
    if (!cs) continue;
    for (const cid of cs) categoryCourseSets[cat].add(cid);
  }

  const courseOriginalCatMap = new Map<string, number>();
  for (const c of courses) {
    if (c.original_class === "I") courseOriginalCatMap.set(c.course_id, 1);
    else if (c.original_class === "II") courseOriginalCatMap.set(c.course_id, 2);
    else if (c.original_class === "III") courseOriginalCatMap.set(c.course_id, 3);
  }

  return {
    groupCourseSet,
    groupChoiceSets,
    courseCreditsMap,
    courseNameMap,
    moduleGroupInfo,
    categoryCourseSets,
    courseOriginalCatMap,
    tracks: data.degree_tracks as unknown as Array<{ track_code: string; name: string; total_credits_required: number | null }>,
    courseReqs: data.degree_course_requirements as unknown as Array<{ track_code: string | null; course_id: string | null }>,
  };
}

function ensureBuilt(): DegreeIndexes {
  const year = getSchemeYear();
  if (!builtIndexes || builtYear !== year) {
    builtIndexes = buildIndexes(getSchemeData());
    builtYear = year;
  }
  return builtIndexes;
}

// —— 核心：六轨道评定（与 ToolsPage.trackProgresses 同源）——
export interface TrackEval {
  code: string;
  name: string;
  pct: number;
  creditsEarned: number;
  creditsRequired: number;
  bestModules?: number[];
  bestGroupInfo?: { aTaken: number; aTotal: number; aCredits: number; aTotalCredits: number };
  isComplete: boolean;
  missingRequired?: string;
  ceSpecialNote?: string;
  ceFallbackMissingCross?: boolean;
  tanxianDone?: boolean; // 仅 EM
  cedInfo?: { secondModId: number; secondACredits: number; pairCredits: number }; // 仅 CED
}

export function evalDegreeTracks(history: History): TrackEval[] {
  const {
    groupCourseSet, groupChoiceSets, courseCreditsMap, courseNameMap,
    moduleGroupInfo, categoryCourseSets, courseOriginalCatMap, tracks, courseReqs,
  } = ensureBuilt();
  const moduleCategory = (modId: number): number => (modId <= 3 ? 1 : modId <= 8 ? 2 : 3);

  const allSelectedIds = new Set<string>();
  for (const ids of Object.values(history)) ids.forEach((id) => allSelectedIds.add(id));

  const groupEffectiveProgress = (gid: number): { total: number; taken: number; complete: boolean } => {
    const cs = groupCourseSet.get(gid);
    if (!cs || cs.size === 0) return { total: 0, taken: 0, complete: false };
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
    return { total, taken, complete: total > 0 && taken >= total };
  };

  const isGroupComplete = (gid: number): boolean => groupEffectiveProgress(gid).complete;

  const creditsTakenInGroup = (gid: number): number => {
    const cs = groupCourseSet.get(gid);
    if (!cs) return 0;
    let total = 0;
    for (const cid of allSelectedIds) {
      if (cs.has(cid)) total += courseCreditsMap.get(cid) ?? 0;
    }
    return total;
  };

  const totalCreditsInGroup = (gid: number): number => {
    const cs = groupCourseSet.get(gid);
    if (!cs) return 1;
    let total = 0;
    for (const cid of cs) total += courseCreditsMap.get(cid) ?? 0;
    return total || 1;
  };

  const aGroupCourseCount = (gid: number): { taken: number; total: number } => {
    const p = groupEffectiveProgress(gid);
    return { taken: p.taken, total: p.total };
  };

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

  // CED：两模块 A+B 组内已选课程合计学分（跨模块去重）
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

  const selectedCreditsInCategory = (cat: number): number => {
    const set = categoryCourseSets[cat];
    if (!set) return 0;
    let total = 0;
    for (const cid of set) {
      if (allSelectedIds.has(cid)) total += courseCreditsMap.get(cid) ?? 0;
    }
    return total;
  };

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

  const hasCrossCategoryRelativeToModule = (modId: number): boolean => {
    const modInfo = moduleGroupInfo.get(modId);
    if (!modInfo) return false;
    const mainCat = moduleCategory(modId);
    const modCourseIds = new Set<string>();
    for (const gid of [modInfo.aGroupId, modInfo.bGroupId]) {
      const cs = groupCourseSet.get(gid);
      if (cs) for (const cid of cs) modCourseIds.add(cid);
    }
    for (const cid of allSelectedIds) {
      if (modCourseIds.has(cid)) continue;
      const oc = courseOriginalCatMap.get(cid);
      if (oc !== undefined) {
        if (oc !== mainCat) return true;
      } else {
        for (const cat of [1, 2, 3]) {
          if (cat === mainCat) continue;
          if (categoryCourseSets[cat].has(cid)) return true;
        }
      }
    }
    return false;
  };

  const bestGroupInfoOf = (modId: number | undefined) => {
    if (!modId) return undefined;
    const info = moduleGroupInfo.get(modId);
    if (!info) return undefined;
    const cnt = aGroupCourseCount(info.aGroupId);
    return {
      aTaken: cnt.taken,
      aTotal: cnt.total,
      aCredits: creditsTakenInGroup(info.aGroupId),
      aTotalCredits: totalCreditsInGroup(info.aGroupId),
    };
  };

  const reqCoursesByTrack = new Map<string, string[]>();
  for (const rc of courseReqs) {
    if (!rc.track_code || !rc.course_id) continue;
    if (!reqCoursesByTrack.has(rc.track_code)) reqCoursesByTrack.set(rc.track_code, []);
    reqCoursesByTrack.get(rc.track_code)!.push(rc.course_id);
  }

  const results: TrackEval[] = [];

  for (const track of tracks) {
    const code = track.track_code;
    const requiredCourses = reqCoursesByTrack.get(code) ?? [];

    let bestModules: number[] | undefined;
    let ceSpecialNote: string | undefined;
    let ceFallbackMissingCross = false;
    let bestModulePct = 0;
    let creditsEarned = 0;
    let missingRequired: string | undefined;
    let tanxianDone: boolean | undefined;
    let cedInfo: TrackEval["cedInfo"];

    if (code === "AE" || code === "EM" || code === "PE") {
      const modId = code === "PE" ? 2 : 1;
      const modInfo = moduleGroupInfo.get(modId);
      if (modInfo) {
        const cnt = aGroupCourseCount(modInfo.aGroupId);
        const totalCreds = moduleTotalSelectedCredits(modId);
        const aPctBase = cnt.total > 0 ? cnt.taken / cnt.total : 0;

        if (code === "EM") {
          tanxianDone = allSelectedIds.has(TANXIAN_COURSE_ID);
          const tanxingPct = tanxianDone ? EM_TANXIAN_PCT : 0;
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
      }
    } else if (code === "IE" || code === "SE") {
      const cat = code === "SE" ? 2 : 3;
      const mr = code === "SE" ? { s: 4, e: 8 } : { s: 9, e: 13 };
      const mids: number[] = [];
      for (const modId of moduleGroupInfo.keys()) {
        if (modId >= mr.s && modId <= mr.e) mids.push(modId);
      }
      mids.sort((a, b) => a - b);

      const catCredits = selectedCreditsInCategory(cat);
      const modulePcts: Array<{ modId: number; pct: number; aPct: number }> = [];

      for (const modId of mids) {
        const modInfo = moduleGroupInfo.get(modId);
        if (!modInfo) continue;
        const cnt = aGroupCourseCount(modInfo.aGroupId);
        const aPct = cnt.total > 0 ? (cnt.taken / cnt.total) * A_GROUP_PCT_CAP : 0;
        const c24Pct = Math.min(CREDIT_PCT_CAP, (catCredits / MODULE_CREDIT_CAP) * CREDIT_PCT_CAP);
        modulePcts.push({ modId, pct: aPct + c24Pct, aPct });
      }

      const sorted = [...modulePcts].sort((a, b) => b.pct - a.pct || b.aPct - a.aPct || a.modId - b.modId);
      if (sorted.length > 0) {
        const best = sorted[0];
        bestModules = sorted.filter((m) => Math.abs(m.pct - best.pct) < PCT_EPSILON && Math.abs(m.aPct - best.aPct) < PCT_EPSILON).map((m) => m.modId);
        bestModulePct = best.pct;
        creditsEarned = Math.min(catCredits, MODULE_CREDIT_CAP);
      }
    } else if (code === "CE") {
      const mod3Info = moduleGroupInfo.get(3);
      const mod3ABComplete = mod3Info ? isGroupComplete(mod3Info.aGroupId) && isGroupComplete(mod3Info.bGroupId) : false;
      const allCatCredits = selectedCreditsAllCategories();

      const qualifiedModules: Array<{ modId: number; pct: number; aPct: number; isMod3AB: boolean }> = [];

      for (const modId of ALL_MODULE_IDS) {
        const modInfo = moduleGroupInfo.get(modId);
        if (!modInfo) continue;

        let aComplete: boolean;
        let isMod3AB = false;
        if (modId === 3 && mod3ABComplete) { aComplete = true; isMod3AB = true; }
        else { aComplete = isGroupComplete(modInfo.aGroupId); }

        if (!aComplete) continue;
        if (!isMod3AB) {
          if (!hasCrossCategoryRelativeToModule(modId)) continue;
        }

        const cnt = aGroupCourseCount(modInfo.aGroupId);
        const aPct = cnt.total > 0 ? (cnt.taken / cnt.total) * A_GROUP_PCT_CAP : 0;
        const c24Pct = Math.min(CREDIT_PCT_CAP, (allCatCredits / CE_CREDIT_REQ) * CREDIT_PCT_CAP);
        qualifiedModules.push({ modId, pct: aPct + c24Pct, aPct, isMod3AB });
      }

      if (qualifiedModules.length > 0) {
        const sortedQ = [...qualifiedModules].sort((a, b) => b.pct - a.pct || b.aPct - a.aPct || a.modId - b.modId);
        bestModules = sortedQ.map((m) => m.modId);
        const best = sortedQ[0];
        bestModulePct = best.isMod3AB ? 100 : best.pct;
        ceSpecialNote = best.isMod3AB ? "已达标模块3A+B交叉方案" : undefined;
        creditsEarned = Math.min(allCatCredits, CE_CREDIT_REQ);
      } else {
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
        bestModulePct = bestQ * FALLBACK_W_MAIN + (bestQCross ? CE_CROSS_BONUS : 0) * FALLBACK_W_CROSS;
        ceFallbackMissingCross = !bestQCross;
        creditsEarned = Math.min(allCatCredits, CE_CREDIT_REQ);
      }
    } else if (code === "CED") {
      // CED 交叉工程（专业一+专业二）双学位（用户 2026-11-15 定稿）：
      // ① 两模块跨类 ② 主修模块 A 课组修完 ③ 第二模块 A 课组 ≥9 学分 ④ 两模块合计（去重）≥21 学分
      // 百分比 = 主修A组完成度×32% + 第二模块A组学分(÷9)×20% + 合计学分(÷21)×48%；三项全满足=100%
      const pairs: Array<{ m1: number; m2: number; pct: number; a1Complete: boolean; a2Credits: number; pairCredits: number }> = [];
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
          pairs.push({ m1, m2, pct: complete ? 100 : a1Pct + a2Pct + credPct, a1Complete, a2Credits, pairCredits });
        }
      }
      if (pairs.length > 0) {
        // 取进度最高的模块对；同分按合计学分，再按模块编号
        pairs.sort((a, b) => b.pct - a.pct || b.pairCredits - a.pairCredits || a.m1 - b.m1 || a.m2 - b.m2);
        const best = pairs[0];
        bestModules = [best.m1, best.m2];
        bestModulePct = best.pct;
        creditsEarned = Math.min(best.pairCredits, CE_CREDIT_REQ);
        cedInfo = { secondModId: best.m2, secondACredits: best.a2Credits, pairCredits: best.pairCredits };
        if (!best.a1Complete) missingRequired = `专业一（模块${best.m1}）的A课组未修完`;
        else if (best.a2Credits < CED_SECOND_A_REQ) missingRequired = `专业二（模块${best.m2}）A课组已修 ${best.a2Credits} 学分，不足 ${CED_SECOND_A_REQ} 学分`;
        else if (best.pairCredits < CE_CREDIT_REQ) missingRequired = `两模块合计已修 ${best.pairCredits} 学分，不足 ${CE_CREDIT_REQ} 学分`;
      }
    }

    for (const cid of requiredCourses) {
      if (!allSelectedIds.has(cid)) {
        missingRequired = courseNameMap.get(cid) ?? cid;
      }
    }

    const pct = Math.min(100, Math.round(bestModulePct));
    results.push({
      code,
      name: track.name,
      pct,
      creditsEarned,
      creditsRequired: track.total_credits_required || MODULE_CREDIT_CAP,
      bestModules,
      bestGroupInfo: bestGroupInfoOf(bestModules?.[0]),
      isComplete: pct >= 100,
      missingRequired,
      ceSpecialNote,
      ceFallbackMissingCross,
      tanxianDone,
      cedInfo,
    });
  }

  return results.sort((a, b) => b.pct - a.pct);
}

/** 逐模块进度（与 ToolsPage.computeModuleProgressPct 同源）：A课组完成度×52% + 学分进度×48% */
export interface ModuleEval {
  modId: number;
  cat: number; // 1=I类(1-3) 2=II类(4-8) 3=III类(9-13)
  pct: number;
  aTaken: number;
  aTotal: number;
  aCredits: number;
  aTotalCredits: number;
  catCredits: number; // I类=本模块学分，II/III类=类总学分
}

export function evalModuleProgress(history: History): ModuleEval[] {
  const { groupCourseSet, groupChoiceSets, courseCreditsMap, moduleGroupInfo, categoryCourseSets } = ensureBuilt();
  const moduleCategory = (modId: number): number => (modId <= 3 ? 1 : modId <= 8 ? 2 : 3);

  const allSelectedIds = new Set<string>();
  for (const ids of Object.values(history)) ids.forEach((id) => allSelectedIds.add(id));

  const groupEffectiveProgress = (gid: number): { total: number; taken: number } => {
    const cs = groupCourseSet.get(gid);
    if (!cs || cs.size === 0) return { total: 0, taken: 0 };
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
    return { total, taken };
  };

  const creditsTakenInGroup = (gid: number): number => {
    const cs = groupCourseSet.get(gid);
    if (!cs) return 0;
    let total = 0;
    for (const cid of allSelectedIds) if (cs.has(cid)) total += courseCreditsMap.get(cid) ?? 0;
    return total;
  };

  const totalCreditsInGroup = (gid: number): number => {
    const cs = groupCourseSet.get(gid);
    if (!cs) return 1;
    let total = 0;
    for (const cid of cs) total += courseCreditsMap.get(cid) ?? 0;
    return total || 1;
  };

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

  const selectedCreditsInCategory = (cat: number): number => {
    let total = 0;
    for (const cid of categoryCourseSets[cat] ?? []) {
      if (allSelectedIds.has(cid)) total += courseCreditsMap.get(cid) ?? 0;
    }
    return total;
  };

  const out: ModuleEval[] = [];
  for (const modId of ALL_MODULE_IDS) {
    const info = moduleGroupInfo.get(modId);
    if (!info) continue;
    const cat = moduleCategory(modId);
    const cnt = groupEffectiveProgress(info.aGroupId);
    const aPct = cnt.total > 0 ? (cnt.taken / cnt.total) * A_GROUP_PCT_CAP : 0;
    const catCredits = cat === 1 ? moduleTotalSelectedCredits(modId) : selectedCreditsInCategory(cat);
    const creditPct = Math.min(CREDIT_PCT_CAP, (catCredits / MODULE_CREDIT_CAP) * CREDIT_PCT_CAP);
    out.push({
      modId,
      cat,
      pct: Math.min(PCT_MAX, Math.round(aPct + creditPct)),
      aTaken: cnt.taken,
      aTotal: cnt.total,
      aCredits: creditsTakenInGroup(info.aGroupId),
      aTotalCredits: totalCreditsInGroup(info.aGroupId),
      catCredits,
    });
  }
  return out;
}

/** 学期顺序（与 SemesterContext 一致），用于已修/在修/预选拆分 */
const SEMS = [
  "大一·开学前（军训）", "大一·秋季", "大一·春季", "大一·夏季",
  "大二·秋季", "大二·春季", "大二·夏季", "大三·秋季", "大三·春季", "大三·夏季",
  "大四·秋季", "大四·春季",
];

/** CE 跨类课清单（相对主修模块）：与 hasCrossCategoryRelativeToModule 同口径——
 * 课程须在主修模块 A/B 课组之外（主修模块内的方案交叉课不计），且原始类 ≠ 主修模块的类。 */
function ceCrossCourseNames(mainModId: number, history: History): string[] {
  const { moduleGroupInfo, groupCourseSet, courseOriginalCatMap, categoryCourseSets, courseNameMap } = ensureBuilt();
  const mi = moduleGroupInfo.get(mainModId);
  if (!mi) return [];
  // 模块→类映射（1–3 类 / 4–8 类 / 9–13 类），与各处局部 moduleCategory 同式
  const mainCat = mainModId <= 3 ? 1 : mainModId <= 8 ? 2 : 3;
  const modCourseIds = new Set<string>();
  for (const gid of [mi.aGroupId, mi.bGroupId]) {
    const cs = groupCourseSet.get(gid);
    if (cs) for (const cid of cs) modCourseIds.add(cid);
  }
  const ids = new Set<string>();
  for (const arr of Object.values(history)) arr.forEach((id) => ids.add(id));
  const out: string[] = [];
  for (const cid of ids) {
    if (modCourseIds.has(cid)) continue;
    const oc = courseOriginalCatMap.get(cid);
    let isCross = false;
    if (oc !== undefined) isCross = oc !== mainCat;
    else {
      for (const cat of [1, 2, 3]) {
        if (cat === mainCat) continue;
        if (categoryCourseSets[cat].has(cid)) { isCross = true; break; }
      }
    }
    if (isCross) out.push(courseNameMap.get(cid) ?? cid);
  }
  return out.sort((a, b) => a.localeCompare(b, "zh"));
}

/** 生成注入模型的【学位评定进度】文本块；无历史时返回空串。
 * currentSemester 提供时区分两种口径：
 * - 计划：历史全部课程均按已修计（与综合工具页一致）；
 * - 已修落定：仅计当前学期之前的课程（在修/预选不计，退课即失效）。 */
export function buildDegreeEvalText(history: History, currentSemester?: string): string {
  if (!history || Object.values(history).every((ids) => ids.length === 0)) return "";
  const ci = currentSemester ? SEMS.indexOf(currentSemester) : -1;
  const hasLater = ci >= 0 && Object.keys(history).some((sem) => {
    const si = SEMS.indexOf(sem);
    return si >= 0 && si >= ci;
  });

  const results = evalDegreeTracks(history);
  if (results.length === 0) return "";
  const pastResults = hasLater
    ? evalDegreeTracks(Object.fromEntries(Object.entries(history).filter(([sem]) => {
        const si = SEMS.indexOf(sem);
        return !(si >= 0 && si >= ci);
      })))
    : null;
  const pastPct = (code: string): number | null => (pastResults ? pastResults.find((t) => t.code === code)?.pct ?? null : null);

  const lines: string[] = [];
  lines.push("【学位评定进度】（由本站学位评定算法对用户选课历史精确计算，模型请直接引用以下数字回答进度类问题，严禁自行套用公式重算或修改口径）");
  if (hasLater && currentSemester) {
    const laterSems = Object.keys(history).filter((sem) => {
      const si = SEMS.indexOf(sem);
      return si > ci;
    }).sort((a, b) => SEMS.indexOf(a) - SEMS.indexOf(b));
    lines.push(`当前学期：${currentSemester}（在修）；当前学期之后的学期课程为预选：${laterSems.length > 0 ? laterSems.join("、") : "（无）"}。`);
    lines.push("口径：\"计划\"=历史全部课程均按已修计；\"已修落定\"=仅计当前学期之前的课程。在修/预选课程退掉后不再计入，依赖它们的课组/模块完成度会随之下降。");
  }
  for (const t of results) {
    const parts: string[] = [];
    const past = pastPct(t.code);
    parts.push(hasLater ? `计划进度 ${t.pct}%（已修落定 ${past ?? 0}%）` : `总进度 ${t.pct}%${t.isComplete ? "（已达标）" : ""}`);
    if (t.bestModules && t.bestModules.length > 0) parts.push(`最佳模块：模块${t.bestModules.join("、模块")}`);
    if (t.bestGroupInfo) {
      const g = t.bestGroupInfo;
      parts.push(`A课组 ${g.aTaken}/${g.aTotal} 门、${g.aCredits}/${g.aTotalCredits} 学分`);
    }
    parts.push(`计入评定学分 ${t.creditsEarned}/${t.creditsRequired}`);
    if (t.code === "EM" && t.tanxianDone !== undefined) parts.push(`弹性力学${t.tanxianDone ? "已修（+10%）" : "未修"}`);
    if (t.code === "CED" && t.cedInfo) parts.push(`主修=模块${t.bestModules?.[0]}，第二专业=模块${t.cedInfo.secondModId}（其A课组已修 ${t.cedInfo.secondACredits}/${CED_SECOND_A_REQ} 学分），两模块合计 ${t.cedInfo.pairCredits}/${CE_CREDIT_REQ} 学分`);
    if (t.ceSpecialNote) parts.push(t.ceSpecialNote);
    if (t.ceFallbackMissingCross) parts.push("无完全合格模块（兜底路径，缺跨类课程）");
    // CE 跨类课清单（相对最佳主修模块）：按算法口径（主修模块内的方案交叉课不计）列出，模型直接引用、不自行推断
    if (t.code === "CE" && t.bestModules && t.bestModules.length > 0) {
      const cross = ceCrossCourseNames(t.bestModules[0], history);
      if (cross.length > 0) parts.push(`跨类课（模块${t.bestModules[0]}口径，均在主修模块之外）：${cross.join("、")}`);
      else parts.push(`跨类课（模块${t.bestModules[0]}口径）：无——主修模块内的方案交叉课（在主修模块A/B课组内、原始类为外类的课）不计入跨类，需在主修模块之外另修一门原始类为其他类的课程`);
    }
    if (t.missingRequired) parts.push(`缺必修课：${t.missingRequired}`);
    lines.push(`- ${t.code} ${t.name}：${parts.join("；")}`);
  }
  // 逐模块进度（仅列有进度的模块，降序）：供"进度最高的模块/模块级分析"直接引用
  const modEvals = evalModuleProgress(history).filter((m) => m.pct > 0).sort((a, b) => b.pct - a.pct || a.modId - b.modId);
  const modPastMap = hasLater
    ? new Map(evalModuleProgress(Object.fromEntries(Object.entries(history).filter(([sem]) => {
        const si = SEMS.indexOf(sem);
        return !(si >= 0 && si >= ci);
      }))).map((m) => [m.modId, m.pct]))
    : null;
  if (modEvals.length > 0) {
    const CAT_LABEL: Record<number, string> = { 1: "I类", 2: "II类", 3: "III类" };
    lines.push("逐模块进度（降序，格式：模块N（类）：进度%；A课组 x/y 门、a/b 学分；类内学分 c/24）：");
    for (const m of modEvals) {
      const pastM = modPastMap?.get(m.modId);
      const pctStr = hasLater ? `计划 ${m.pct}%（已修落定 ${pastM ?? 0}%）` : `进度 ${m.pct}%`;
      lines.push(`- 模块${m.modId}（${CAT_LABEL[m.cat]}）：${pctStr}；A课组 ${m.aTaken}/${m.aTotal} 门、${m.aCredits}/${m.aTotalCredits} 学分；类内学分 ${m.catCredits}/24`);
    }
  }
  lines.push("口径：总进度 = 最佳模块A课组完成度×52% + 模块/类学分进度×48%（单模块24学分）；EM 为 弹性力学10% + A课组42% + 学分48%；CE 要求A课组修满且至少跨类一门（模块3 A+B 为特殊路径），否则按兜底加权；CE 的跨类课必须不在主修模块内——主修模块A/B课组内的方案交叉课（课程本身在主修模块中、原始类标注为其他类）不计入跨类；CED（专业一+专业二）为跨类模块对：主修A组完成度×32% + 第二模块A组学分(÷9)×20% + 两模块合计学分(÷21)×48%（含B组、去重），三项全满足=100%。");
  lines.push("【/学位评定进度】");
  return lines.join("\n");
}
