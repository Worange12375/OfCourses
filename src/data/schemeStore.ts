/**
 * 培养方案三版本数据仓库（2026-11-14 培养方案更新适配）。
 *
 * - 数据源：structured_data_{2024,2025,2026}.json（由 docs/scheme_word/convert_scheme.py 生成）
 * - 年级 → 版本：登录用户的 effectiveCohort（'auto' 已解析为具体年份）；未登录/无匹配 → 2024 默认
 * - 非组件模块（导图共享层、recommend、degreeEval 等）用 getSchemeData() 在调用时取当前数据；
 *   React 组件用 useSchemeData()（年级变化时返回新数据引用，触发重渲染）。
 * - ⚠️ 已知限制（待办）：utils/aiContext.ts 仍静态引用 structured_data.json（2024 数据），
 *   属综合工具页 AI 批次的 init 化范围；recommend.ts 与 degreeEval.ts 已按年级惰性 init 化。
 */

import {useMemo} from "react";
import data2024 from "@/data/structured_data_2024.json";
import data2025 from "@/data/structured_data_2025.json";
import data2026 from "@/data/structured_data_2026.json";
import {useAccount} from "@/account/AccountContext";

export type SchemeData = typeof data2024;
export type SchemeYear = "2024" | "2025" | "2026";

const BY_YEAR: Record<SchemeYear, SchemeData> = {
    "2024": data2024,
    "2025": data2025 as unknown as SchemeData,
    "2026": data2026 as unknown as SchemeData,
};

export const DEFAULT_SCHEME_YEAR: SchemeYear = "2024";

/** 年级（20XX）→ 培养方案年份；未提供或无对应版本时回落默认 */
export const schemeYearOf = (cohort: string | null | undefined): SchemeYear => {
    if (cohort && cohort in BY_YEAR) return cohort as SchemeYear;
    return DEFAULT_SCHEME_YEAR;
};

let currentYear: SchemeYear = DEFAULT_SCHEME_YEAR;
let current: SchemeData = BY_YEAR[currentYear];

/** 当前生效的培养方案数据（非组件模块在函数调用时取值，确保拿到最新版本） */
export const getSchemeData = (): SchemeData => current;
export const getSchemeYear = (): SchemeYear => currentYear;

/** 切换当前生效版本（幂等；由 useSchemeData 在年级变化时调用） */
export const setSchemeDataByYear = (cohort: string | null | undefined): SchemeYear => {
    const y = schemeYearOf(cohort);
    if (y !== currentYear) {
        currentYear = y;
        current = BY_YEAR[y];
    }
    return y;
};

/** React 侧统一入口：年级（含 auto 解析）变化时切换数据仓库并返回当前数据 */
export const useSchemeData = (): {structuredData: SchemeData; schemeYear: SchemeYear} => {
    const {effectiveCohort} = useAccount();
    const schemeYear = schemeYearOf(effectiveCohort);
    setSchemeDataByYear(effectiveCohort);
    return useMemo(() => ({structuredData: getSchemeData(), schemeYear}), [schemeYear]);
};
