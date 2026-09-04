import {createContext, useCallback, useContext, useState, type ReactNode} from "react";

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

// 读取本地持久化的学期；无效/过期值回落到默认值，避免历史字典变更导致白屏
const readStoredSemester = (): Semester => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (ALL_SEMESTERS as readonly string[]).includes(raw)) return raw as Semester;
  } catch {
    /* localStorage 不可用（隐私模式等）时静默回落 */
  }
  return DEFAULT_SEMESTER;
};

interface SemesterContextType {
  semester: Semester;
  setSemester: (s: Semester) => void;
  allSemesters: readonly Semester[];
}

const SemesterContext = createContext<SemesterContextType | null>(null);

export const SemesterProvider = ({children}: {children: ReactNode}) => {
  const [semester, setSemesterState] = useState<Semester>(readStoredSemester);

  // 选择即落盘，刷新/重进后自动恢复
  const setSemester = useCallback((s: Semester) => {
    setSemesterState(s);
    try {
      localStorage.setItem(STORAGE_KEY, s);
    } catch {
      /* 写入失败不影响当前会话内的使用 */
    }
  }, []);

  return (
    <SemesterContext.Provider value={{semester, setSemester, allSemesters: ALL_SEMESTERS}}>
      {children}
    </SemesterContext.Provider>
  );
};

export const useSemester = (): SemesterContextType => {
  const ctx = useContext(SemesterContext);
  if (!ctx) throw new Error("useSemester must be used within SemesterProvider");
  return ctx;
};