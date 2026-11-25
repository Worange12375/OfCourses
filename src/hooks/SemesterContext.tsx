import {createContext, useContext, useMemo, type ReactNode} from "react";
import {useAccount, resolveCohort} from "../account/AccountContext";

/**
 * 当前学期上下文（2026-11-14 改版：自动判定，不再手动选择）
 *
 * 规则（用户定稿）：
 *   学期 = 年级 + 日历季节 组合（「大三·秋季」式，与培养方案学期体系一致）：
 *   - 季节：2-6 月 春季、7-8 月 夏季、9-1 月 秋季
 *   - 年级：9-12 月按当年、1-8 月按去年计学年；grade = 学年 - 入学年 + 1（四字班 2024 级 2026 年 11 月 → 大三）
 *   - 入学年（cohort）：账号「自动」模式从邮箱前缀尾数推断（wutc24 → 2024）；未设置时回落本机旧选择。
 */
const ALL_SEMESTERS = [
  "大一·开学前（军训）",
  "大一·秋季",
  "大一·春季",
  "大一·夏季",
  "大二·秋季",
  "大二·春季",
  "大二·夏季",
  "大三·秋季",
  "大三·春季",
  "大三·夏季",
  "大四·秋季",
  "大四·春季",
] as const;

export type Semester = (typeof ALL_SEMESTERS)[number];

const STORAGE_KEY = "oc_semester_v1";
const DEFAULT_SEMESTER: Semester = "大一·开学前（军训）";
const GRADE_NAMES = ["", "大一", "大二", "大三", "大四"] as const;

// 读取本机旧选择（仅在年级信息不可用时兜底，保持老用户数据不丢）
const readStoredSemester = (): Semester => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (ALL_SEMESTERS as readonly string[]).includes(raw)) return raw as Semester;
  } catch {
    /* localStorage 不可用（隐私模式等）时静默回落 */
  }
  return DEFAULT_SEMESTER;
};

/** 按入学年与当前日期推断学期（自动判定核心算法） */
export const computeCurrentSemester = (cohortYear: string | null): Semester => {
  if (!cohortYear || !/^\d{4}$/.test(cohortYear)) return readStoredSemester();
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  // 学年基准：9-12 月属「当年入学学年」，1-8 月属「去年入学学年」
  const termYear = month >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  const grade = Math.min(4, Math.max(1, termYear - Number(cohortYear) + 1));
  const term = month >= 2 && month <= 6 ? "春季" : month >= 7 && month <= 8 ? "夏季" : "秋季";
  const result = `${GRADE_NAMES[grade]}·${term}` as Semester;
  return (ALL_SEMESTERS as readonly string[]).includes(result) ? result : readStoredSemester();
};

interface SemesterContextType {
  semester: Semester;
  allSemesters: readonly Semester[];
  semesterAuto: boolean; // 是否为自动判定（年级信息可用时为 true）
}

const SemesterContext = createContext<SemesterContextType | null>(null);

export const useSemester = (): SemesterContextType => {
  const ctx = useContext(SemesterContext);
  if (!ctx) throw new Error("useSemester must be used within SemesterProvider");
  return ctx;
};

export const SemesterProvider = ({children}: {children: ReactNode}) => {
  const {user, authReady} = useAccount();
  const cohortYear = resolveCohort(user);

  const semester = useMemo<Semester>(() => {
    if (!authReady) return readStoredSemester(); // 会话探测完成前先用本机旧值，避免闪烁
    return computeCurrentSemester(cohortYear);
  }, [authReady, cohortYear]);

  const value = useMemo<SemesterContextType>(
    () => ({semester, allSemesters: ALL_SEMESTERS, semesterAuto: authReady && !!cohortYear}),
    [semester, authReady, cohortYear],
  );

  return <SemesterContext.Provider value={value}>{children}</SemesterContext.Provider>;
};
