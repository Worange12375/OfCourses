import {useRef, useMemo, useState} from "react";
import Island, {Content, Header} from "@jetbrains/ring-ui-built/components/island/island";
import Button from "@jetbrains/ring-ui-built/components/button/button";
import Select, {type SelectItem} from "@jetbrains/ring-ui-built/components/select/select";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useCourseGroups} from "../hooks/useCurriculumData";
import {VoteWidget} from "../components/VoteWidget";
import structuredData from "@/data/structured_data.json";

type HistoryData = Record<string, string[]>;

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

interface ToolsPageProps {
  mobile?: boolean;
}

export const ToolsPage = ({mobile}: ToolsPageProps) => {
  const {locale} = useLocale();
  const {theme} = useAppTheme();
  const isDark = theme === "dark";
  const {data: allGroups} = useCourseGroups();

  const [toolPage, setToolPage] = useState<string>("degree");
  const [historyData, setHistoryData] = useState<HistoryData | null>(null);
  const [fileName, setFileName] = useState("");
  const [selectedModules, setSelectedModules] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const textDark = isDark ? "text-white/90" : "text-gray-800";
  const textBody = isDark ? "text-white/75" : "text-gray-700";
  const textMuted = isDark ? "text-white/50" : "text-gray-500";
  const bgCard = isDark ? "bg-white/5" : "bg-white";
  const borderCls = isDark ? "border-white/10" : "border-gray-200";
  const progressBgCss = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const progressFillCss = "linear-gradient(90deg, #60a5fa, #93c5fd)";
  const progressSubFillCss = isDark ? "rgba(147,197,253,0.5)" : "rgb(147,197,253)";
  const progressCompleteCss = isDark ? "rgba(74,222,128,0.6)" : "rgb(74,222,128)";

  // course_id → credits lookup
  const courseCreditsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of structuredData.courses) {
      map.set(c.course_id, c.credits);
    }
    return map;
  }, []);

  // group_id → Set<course_id>
  const groupCourseSet = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const gc of structuredData.group_courses) {
      map.set(gc.group_id, new Set(gc.course_ids));
    }
    return map;
  }, []);

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

  // Check if ALL courses in a group are selected
  const isGroupComplete = (gid: number): boolean => {
    const cs = groupCourseSet.get(gid);
    if (!cs || cs.size === 0) return false;
    for (const cid of cs) {
      if (!allSelectedIds.has(cid)) return false;
    }
    return true;
  };

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

  // Count selected / total courses in an A group
  const aGroupCourseCount = (gid: number): {taken: number; total: number} => {
    const cs = groupCourseSet.get(gid);
    if (!cs) return {taken: 0, total: 0};
    let taken = 0;
    for (const cid of cs) {
      if (allSelectedIds.has(cid)) taken++;
    }
    return {taken, total: cs.size};
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

  // Cross-category check relative to a specific module:
  // Are there selected courses that belong to a DIFFERENT category (I/II/III)
  // than the main module, AND are NOT part of the main module's own groups?
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
      // Does this course belong to any category OTHER than mainCat?
      for (const cat of [1, 2, 3]) {
        if (cat === mainCat) continue;
        if (categoryCourseSets[cat].has(cid)) return true;
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
        mids.sort();

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
          allMainGroups.push(groupProgress(modInfo.aGroupId, locale === "zh" ? `模块${modId}A` : `Module ${modId}A`));
          allSubGroups.push(groupProgress(modInfo.bGroupId, locale === "zh" ? `模块${modId}B` : `Module ${modId}B`));
        }

        const sorted = [...modulePcts].sort((a, b) => b.pct - a.pct || b.aPct - a.aPct);
        if (sorted.length > 0) {
          const best = sorted[0];
          bestModules = sorted.filter((m) => Math.abs(m.pct - best.pct) < PCT_EPSILON && Math.abs(m.aPct - best.aPct) < PCT_EPSILON).map((m) => m.modId);
          bestModulePct = best.pct;
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
          const c24Pct = Math.min(CREDIT_PCT_CAP, (allCatCredits / MODULE_CREDIT_CAP) * CREDIT_PCT_CAP);
          const modPct = aPct + c24Pct;
          qualifiedModules.push({modId, pct: modPct, aPct, isMod3AB});
        }

        allMainGroups = [];
        allSubGroups = [];

        if (qualifiedModules.length > 0) {
          bestModules = qualifiedModules.sort((a, b) => b.pct - a.pct || b.aPct - a.aPct).map((m) => m.modId);
          const best = qualifiedModules.sort((a, b) => b.pct - a.pct || b.aPct - a.aPct)[0];

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
            creditsEarned = Math.min(allCatCredits, MODULE_CREDIT_CAP);
          }

          for (const qm of qualifiedModules) {
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
            const c24Pct = Math.min(CREDIT_PCT_CAP, (allCatCredits / MODULE_CREDIT_CAP) * CREDIT_PCT_CAP);
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

          // Show top 3 candidates
          const candidates = ALL_MODULE_IDS.map((modId) => {
            const mi = moduleGroupInfo.get(modId);
            if (!mi) return null;
            const cnt = aGroupCourseCount(mi.aGroupId);
            const aPct = cnt.total > 0 ? (cnt.taken / cnt.total) * A_GROUP_PCT_CAP : 0;
            const c24Pct = Math.min(CREDIT_PCT_CAP, (allCatCredits / MODULE_CREDIT_CAP) * CREDIT_PCT_CAP);
            return {modId, pct: aPct + c24Pct, mi};
          }).filter(Boolean).sort((a, b) => b!.pct - a!.pct).slice(0, 3);

          for (const cand of candidates) {
            if (cand) {
              allMainGroups.push(groupProgress(cand.mi.aGroupId, locale === "zh" ? `模块${cand.modId}A` : `Module ${cand.modId}A`));
              allSubGroups.push(groupProgress(cand.mi.bGroupId, locale === "zh" ? `模块${cand.modId}B` : `Module ${cand.modId}B`));
            }
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
        trackName: locale === "zh" ? track.name : track.name,
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
  }, [historyData, allGroups, groupCourseSet, courseCreditsMap, moduleGroupInfo, groupModuleMap, allSelectedIds, locale, categoryCourseSets]);

  const allSelectedCount = allSelectedIds.size;

  // Build module options for detail queries from actual data
  const trackDetailOptions = useMemo(() => {
    if (!trackProgresses.length) return {ie: [] as SelectItem[], se: [] as SelectItem[]};

    // IE modules from track data
    const ieTrack = trackProgresses.find((t) => t.trackCode === "IE");
    const seTrack = trackProgresses.find((t) => t.trackCode === "SE");

    const ieModuleIds = ieTrack
      ? [...new Set(ieTrack.mainGroups.map((g) => groupModuleMap.get(g.groupId)).filter((m): m is number => m !== undefined))].sort()
      : [9, 10, 11, 12, 13];

    const seModuleIds = seTrack
      ? [...new Set(seTrack.mainGroups.map((g) => groupModuleMap.get(g.groupId)).filter((m): m is number => m !== undefined))].sort()
      : [4, 5, 6, 7, 8];

    return {
      ie: [
        {key: "all", label: locale === "zh" ? "全部模块" : "All Modules"},
        ...ieModuleIds.map((m) => ({key: m.toString(), label: locale === "zh" ? `模块${m}` : `Module ${m}`})),
      ],
      se: [
        {key: "all", label: locale === "zh" ? "全部模块" : "All Modules"},
        ...seModuleIds.map((m) => ({key: m.toString(), label: locale === "zh" ? `模块${m}` : `Module ${m}`})),
      ],
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

  return (
    <div className={`flex flex-1 ${mobile ? "flex-col h-full" : "flex-row h-full"} ${isDark ? "bg-[#0e0e14]" : "bg-gray-50"}`}>
      {/* ===== Sidebar ===== */}
      <div className={`${mobile ? "flex flex-row border-b p-2 gap-1 overflow-x-auto" : "flex flex-col w-36 shrink-0 border-r p-2 gap-1"} ${borderCls} ${isDark ? "bg-[#14141e]" : "bg-white"}`}>
        <button
          onClick={() => setToolPage("degree")}
          className={`cursor-pointer rounded border-none px-3 py-2 text-xs font-medium ${mobile ? "flex-1 text-center whitespace-nowrap" : "text-left"} transition-colors ${
            toolPage === "degree"
              ? isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-600"
              : isDark ? "text-white/60 hover:bg-white/5" : "text-gray-600 hover:bg-gray-100"
          }`}
        >{locale === "zh" ? "学位评定" : "Degree Eval."}</button>
        <button
          onClick={() => setToolPage("ai")}
          className={`cursor-pointer rounded border-none px-3 py-2 text-xs font-medium ${mobile ? "flex-1 text-center whitespace-nowrap" : "text-left"} transition-colors ${
            toolPage === "ai"
              ? isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-600"
              : isDark ? "text-white/60 hover:bg-white/5" : "text-gray-600 hover:bg-gray-100"
          }`}
        >{locale === "zh" ? "AI推荐助手" : "AI Assistant"}</button>
        <button
          onClick={() => setToolPage("review")}
          className={`cursor-pointer rounded border-none px-3 py-2 text-xs font-medium ${mobile ? "flex-1 text-center whitespace-nowrap" : "text-left"} transition-colors ${
            toolPage === "review"
              ? isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-600"
              : isDark ? "text-white/60 hover:bg-white/5" : "text-gray-600 hover:bg-gray-100"
          }`}
        >{locale === "zh" ? "课程评价" : "Reviews"}</button>
      </div>
      {/* ===== Content ===== */}
      <div className={`flex-1 flex flex-col gap-3 p-3 ${mobile ? "overflow-y-auto oc-mobile-pb-nav" : "overflow-auto"}`}>
      {toolPage === "degree" && <>
      <Island className={`${bgCard}`}>
        <Header border>
          <span className={`text-sm font-semibold ${textDark}`}>
            {locale === "zh" ? "学位评定" : "Degree Evaluation"}
          </span>
        </Header>
        <Content>
          <div className="px-4 py-3 flex flex-col gap-3">
            <div className={`text-xs ${textBody}`}>
              {locale === "zh"
                ? "导入工作台导出的 JSON 历史记录文件，系统将自动计算各专业学位的获取进度。"
                : "Import a JSON history file from Workspace to evaluate degree progress."}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => fileInputRef.current?.click()}>
                {locale === "zh" ? "导入历史记录" : "Import History"}
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

      {/* ===== Results (only after import) ===== */}
      {historyData && trackProgresses.length > 0 && (
        <>
          {/* Overview cards */}
          <Island className={`${bgCard}`}>
            <Header border>
              <span className={`text-sm font-semibold ${textDark}`}>
                {locale === "zh" ? "学位获取进度" : "Degree Progress"}
              </span>
            </Header>
            <Content>
              <div className="px-4 py-3 grid grid-cols-2 gap-3">
                {trackProgresses.slice(0, 8).map((tp) => (
                  <div
                    key={tp.trackCode}
                    className={`rounded-lg border p-3 ${borderCls} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${textDark}`}>{tp.trackName}</span>
                        {tp.isComplete && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            isDark ? "bg-green-500/20 text-green-300" : "bg-green-100 text-green-700"
                          }`}>
                            {locale === "zh" ? "已达标" : "Complete"}
                          </span>
                        )}
                      </div>
                      <span className={`text-sm font-bold ${tp.isComplete ? "text-green-500" : textDark}`}>
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
                        {locale === "zh"
                          ? `最佳匹配：${tp.bestModules.map((m) => `模块${m}`).join("、")}`
                          : `Best match: ${tp.bestModules.map((m) => `Module ${m}`).join(", ")}`}
                      </div>
                    )}

                    {/* Special note (module 3 A+B path) */}
                    {tp.specialNote && (
                      <div className={`mt-1 text-[11px] font-medium ${isDark ? "text-green-300" : "text-green-600"}`}>
                        ✅ {tp.specialNote}
                      </div>
                    )}

                    {/* Group detail rows */}
                    <div className="mt-2 space-y-1">
                      {tp.mainGroups.map((g) => (
                        <div key={`m-${g.groupId}`} className="flex justify-between text-[11px]">
                          <span className={`flex items-center gap-1 ${textBody}`}>
                            {g.label}
                            {tp.aGroupCompleteIds?.includes(g.groupId) && (
                              <span className={`text-[9px] px-1 py-0.5 rounded ${
                                isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-700"
                              }`}>
                                {locale === "zh" ? "A课组已修完" : "Complete"}
                              </span>
                            )}
                          </span>
                          <span className={textMuted}>
                            {g.takenCredits}/{g.totalCredits} 学分
                          </span>
                        </div>
                      ))}
                      {tp.subGroups.map((g) => (
                        <div key={`s-${g.groupId}`} className="flex justify-between text-[11px]">
                          <span className={textMuted}>{g.label}</span>
                          <span className={textMuted}>
                            {g.takenCredits}/{g.totalCredits} 学分
                          </span>
                        </div>
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
          <Island className={`${bgCard}`}>
            <Header border>
              <span className={`text-sm font-semibold ${textDark}`}>
                {locale === "zh" ? "模块级详细查询" : "Module-Level Detail Query"}
              </span>
            </Header>
            <Content>
              <div className="px-4 py-3 flex flex-col gap-3">
                {/* Industrial Engineering (III类 模块9-13) */}
                <div className={`rounded-lg border p-3 ${borderCls}`}>
                  <div className={`text-xs font-semibold mb-2 ${textDark}`}>
                    {locale === "zh" ? "工业工程 (III类 模块9-13)" : "Industrial Eng. (Type III, Modules 9-13)"}
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-36">
                      <Select
                        data={trackDetailOptions.ie}
                        selected={trackDetailOptions.ie.find((o) => o.key === (selectedModules["IE"]?.toString() ?? "all")) ?? trackDetailOptions.ie[0]}
                        onSelect={(opt) => {
                          if (opt) setSelectedModules((p) => ({...p, IE: parseInt(opt.key as string, 10)}));
                        }}
                        label=""
                      />
                    </div>
                  </div>
                  {selectedModules["IE"] ? (
                    (() => {
                      const m = selectedModules["IE"]!;
                      const info = moduleGroupInfo.get(m);
                      if (!info) return <div className={`text-xs ${textMuted}`}>{locale === "zh" ? "无数据" : "No data"}</div>;
                      const aGp = groupProgress(info.aGroupId, locale === "zh" ? "A课组" : "Group A");
                      const bGp = groupProgress(info.bGroupId, locale === "zh" ? "B课组" : "Group B");
                      return (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] w-12 ${textBody}`}>{aGp.label}</span>
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{background: progressBgCss}}>
                              <div className="h-full rounded-full transition-all" style={{width: `${aGp.pct}%`, background: progressFillCss}} />
                            </div>
                            <span className={`text-[11px] w-20 text-right ${textMuted}`}>{aGp.takenCredits}/{aGp.totalCredits} 学分</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] w-12 ${textMuted}`}>{bGp.label}</span>
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{background: progressBgCss}}>
                              <div className="h-full rounded-full transition-all" style={{width: `${bGp.pct}%`, background: progressSubFillCss}} />
                            </div>
                            <span className={`text-[11px] w-20 text-right ${textMuted}`}>{bGp.takenCredits}/{bGp.totalCredits} 学分</span>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className={`text-[11px] ${textMuted}`}>
                      {locale === "zh" ? "请选择一个模块查看详情" : "Select a module to view details"}
                    </div>
                  )}
                </div>

                {/* Software Engineering (II类 模块4-8) */}
                <div className={`rounded-lg border p-3 ${borderCls}`}>
                  <div className={`text-xs font-semibold mb-2 ${textDark}`}>
                    {locale === "zh" ? "软件工程 (II类 模块4-8)" : "Software Eng. (Type II, Modules 4-8)"}
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-36">
                      <Select
                        data={trackDetailOptions.se}
                        selected={trackDetailOptions.se.find((o) => o.key === (selectedModules["SE"]?.toString() ?? "all")) ?? trackDetailOptions.se[0]}
                        onSelect={(opt) => {
                          if (opt) setSelectedModules((p) => ({...p, SE: parseInt(opt.key as string, 10)}));
                        }}
                        label=""
                      />
                    </div>
                  </div>
                  {selectedModules["SE"] ? (
                    (() => {
                      const m = selectedModules["SE"]!;
                      const info = moduleGroupInfo.get(m);
                      if (!info) return <div className={`text-xs ${textMuted}`}>{locale === "zh" ? "无数据" : "No data"}</div>;
                      const aGp = groupProgress(info.aGroupId, locale === "zh" ? "A课组" : "Group A");
                      const bGp = groupProgress(info.bGroupId, locale === "zh" ? "B课组" : "Group B");
                      return (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] w-12 ${textBody}`}>{aGp.label}</span>
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{background: progressBgCss}}>
                              <div className="h-full rounded-full transition-all" style={{width: `${aGp.pct}%`, background: progressFillCss}} />
                            </div>
                            <span className={`text-[11px] w-20 text-right ${textMuted}`}>{aGp.takenCredits}/{aGp.totalCredits} 学分</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] w-12 ${textMuted}`}>{bGp.label}</span>
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{background: progressBgCss}}>
                              <div className="h-full rounded-full transition-all" style={{width: `${bGp.pct}%`, background: progressSubFillCss}} />
                            </div>
                            <span className={`text-[11px] w-20 text-right ${textMuted}`}>{bGp.takenCredits}/{bGp.totalCredits} 学分</span>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className={`text-[11px] ${textMuted}`}>
                      {locale === "zh" ? "请选择一个模块查看详情" : "Select a module to view details"}
                    </div>
                  )}
                </div>

                {/* Module 1 detail (AE/EM share this) */}
                <div className={`rounded-lg border p-3 ${borderCls}`}>
                  <div className={`text-xs font-semibold mb-2 ${textDark}`}>
                    {locale === "zh" ? "I类基础加强 (模块1-3)" : "Type I Core (Modules 1-3)"}
                  </div>
                  <div className="space-y-1.5">
                    {[1, 2, 3].map((modId) => {
                      const info = moduleGroupInfo.get(modId);
                      if (!info) return null;
                      const aGp = groupProgress(info.aGroupId, `${locale === "zh" ? "模块" : "Module "}${modId}A`);
                      const bGp = groupProgress(info.bGroupId, `${locale === "zh" ? "模块" : "Module "}${modId}B`);
                      return (
                        <div key={modId}>
                          <div className={`text-[11px] font-medium mb-0.5 ${textDark}`}>
                            {locale === "zh" ? `模块${modId}` : `Module ${modId}`}
                            {modId === 1 && (
                              <span className={`ml-2 text-[10px] ${textMuted}`}>
                                ({locale === "zh" ? "AE/EM 必修" : "AE/EM Required"})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 pl-2">
                            <span className={`text-[11px] w-14 ${textBody}`}>{aGp.label}</span>
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{background: progressBgCss}}>
                              <div className="h-full rounded-full transition-all" style={{width: `${aGp.pct}%`, background: progressFillCss}} />
                            </div>
                            <span className={`text-[10px] w-16 text-right ${textMuted}`}>{aGp.takenCredits}/{aGp.totalCredits}</span>
                          </div>
                          <div className="flex items-center gap-2 pl-2">
                            <span className={`text-[11px] w-14 ${textMuted}`}>{bGp.label}</span>
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{background: progressBgCss}}>
                              <div className="h-full rounded-full transition-all" style={{width: `${bGp.pct}%`, background: progressSubFillCss}} />
                            </div>
                            <span className={`text-[10px] w-16 text-right ${textMuted}`}>{bGp.takenCredits}/{bGp.totalCredits}</span>
                          </div>
                        </div>
                      );
                    })}
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
      <Island className={`${bgCard}`}>
          <Header border>
            <span className={`text-sm font-semibold ${textDark}`}>
              {locale === "zh" ? "课程推荐 AI 助手" : "AI Course Assistant"}
            </span>
          </Header>
          <Content>
            <div className="flex flex-col gap-4 px-4 py-3">
              <p className={`text-xs leading-relaxed ${textBody}`}>
                {locale === "zh"
                  ? "我们计划为大家提供一个网页端的对话式 AI 助手：它会结合你已修读的课程与培养方案要求，智能推荐适合你的后续课程。届时我们会综合技术难度、维护成本与数据安全等因素，决定是否内置一个免费可用的模型；同时也计划支持你自行接入自己的 API。"
                  : "We plan to offer a web-based conversational AI assistant: based on the courses you have already taken and your program requirements, it will recommend suitable next courses. We will weigh technical complexity, maintenance cost, and data security when deciding whether to bundle a free built-in model — and we also plan to let you plug in your own API."}
              </p>
              <div className={`rounded-lg border p-3 ${borderCls} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`}>
                <div className={`mb-2 text-xs font-semibold ${textDark}`}>
                  {locale === "zh" ? "你对这个设计打几分？" : "How would you rate this plan?"}
                </div>
                <VoteWidget topic="ai" />
              </div>
            </div>
          </Content>
      </Island>
      )}

      {toolPage === "review" && (
      <Island className={`${bgCard}`}>
          <Header border>
            <span className={`text-sm font-semibold ${textDark}`}>
              {locale === "zh" ? "课程评价" : "Course Reviews"}
            </span>
          </Header>
          <Content>
            <div className="flex flex-col gap-4 px-4 py-3">
              <p className={`text-xs leading-relaxed ${textBody}`}>
                {locale === "zh"
                  ? "我们计划为网站引入账号系统。届时你可以在这里分享自己的选课体验与推荐老师，也能查阅其他同学的真实评价，帮助后来的同学少走弯路。"
                  : "We plan to introduce user accounts. You will be able to share your course experience and recommended instructors, and read honest reviews from other students — helping those who come after you avoid detours."}
              </p>
              <div className={`rounded-lg border p-3 ${borderCls} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`}>
                <div className={`mb-2 text-xs font-semibold ${textDark}`}>
                  {locale === "zh" ? "你对这个设计打几分？" : "How would you rate this plan?"}
                </div>
                <VoteWidget topic="review" />
              </div>
            </div>
          </Content>
        </Island>
      )}
    </div>
    </div>
  );
};