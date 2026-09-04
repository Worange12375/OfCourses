import { useMemo } from "react";
import structuredData from "@/data/structured_data.json";
import enData from "@/data/courses_en.json";
import { useLocale } from "@/i18n/LocaleContext";
import type {
  Course,
  CourseGroup,
  CoursePrereq,
  ChoiceSet,
  ChoiceSetCourse,
  DegreeCourseReq,
  DegreeGroupReq,
  DegreeTrack,
  Module,
} from "@/types/curriculum";

interface SemesterCourse {
  semester: string;
  course_id: string;
  course_name?: string;
}

interface GroupCourses {
  group_id: number;
  course_ids: string[];
}

interface UseResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

function useFrom<T>(getData: () => T[]): UseResult<T> {
  return useMemo(() => ({ data: getData(), loading: false, error: null }), []);
}

// ---- i18n helpers ----
export function tName(courseId: string, zhName: string): string {
  return (enData.courses as Record<string, string>)[courseId] || zhName;
}

export function tModule(moduleId: number, zhName: string): string {
  return (enData.modules as Record<string, string>)[String(moduleId)] || zhName;
}

export function tGroup(groupCode: string, zhName: string): string {
  return (enData.groups as Record<string, string>)[groupCode] || zhName;
}

export function tSemester(zhSem: string): string {
  return (enData.semesters as Record<string, string>)[zhSem] || zhSem;
}

export function tTrack(trackCode: string, zhName: string): string {
  return (enData.tracks as Record<string, string>)[trackCode] || zhName;
}

export function useTName(): {
  tName: (courseId: string, zhName: string) => string;
  tModule: (moduleId: number, zhName: string) => string;
  tGroup: (groupCode: string, zhName: string) => string;
  tSemester: (zhSem: string) => string;
  tTrack: (trackCode: string, zhName: string) => string;
  locale: string;
} {
  const { locale } = useLocale();
  return useMemo(
    () => ({
      tName: (courseId: string, zhName: string) =>
        locale === "en" ? (enData.courses as Record<string, string>)[courseId] || zhName : zhName,
      tModule: (moduleId: number, zhName: string) =>
        locale === "en" ? (enData.modules as Record<string, string>)[String(moduleId)] || zhName : zhName,
      tGroup: (groupCode: string, zhName: string) =>
        locale === "en" ? (enData.groups as Record<string, string>)[groupCode] || zhName : zhName,
      tSemester: (zhSem: string) =>
        locale === "en" ? (enData.semesters as Record<string, string>)[zhSem] || zhSem : zhSem,
      tTrack: (trackCode: string, zhName: string) =>
        locale === "en" ? (enData.tracks as Record<string, string>)[trackCode] || zhName : zhName,
      locale,
    }),
    [locale]
  );
}

export function useCourses(): UseResult<Course> {
  return useFrom(() =>
    structuredData.courses.map((c) => ({
      course_id: c.course_id,
      name: c.name,
      credits: c.credits,
      module_type: c.module_type ?? null,
      is_new: c.course_id.startsWith("NEW"),
    }))
  );
}

export function useCourse(courseId: string): {
  data: Course | null;
  loading: boolean;
  error: Error | null;
} {
  const { data: courses } = useCourses();
  return useMemo(
    () => ({ data: courses.find((c) => c.course_id === courseId) ?? null, loading: false, error: null }),
    [courseId, courses]
  );
}

export function useModules(): UseResult<Module> {
  return useFrom(() => structuredData.modules);
}

export function useCourseGroups(): UseResult<CourseGroup> {
  return useFrom(() => structuredData.course_groups);
}

export function useModuleGroups(moduleId: number): UseResult<CourseGroup> {
  const { data: groups } = useCourseGroups();
  return useMemo(
    () => ({
      data: groups.filter((g) => g.module_id === moduleId),
      loading: false,
      error: null,
    }),
    [moduleId, groups]
  );
}

export function useGroupCourses(groupId: number): UseResult<Course> {
  const { data: allGroupCourses } = useFrom<GroupCourses>(
    () => structuredData.group_courses
  );
  const { data: allCourses } = useCourses();

  return useMemo(() => {
    const gc = allGroupCourses.find((g) => g.group_id === groupId);
    if (!gc) return { data: [], loading: false, error: null };
    return {
      data: allCourses.filter((c) => gc.course_ids.includes(c.course_id)),
      loading: false,
      error: null,
    };
  }, [groupId, allGroupCourses, allCourses]);
}

export function useFoundationGroups(): UseResult<CourseGroup> {
  const { data: groups } = useCourseGroups();
  return useMemo(
    () => ({
      data: groups.filter((g) => g.module_id === null && !g.group_code.startsWith("SHUYUAN") && g.group_code !== "SHIJIAN"),
      loading: false,
      error: null,
    }),
    [groups]
  );
}

export function useSemesterCourses(): UseResult<SemesterCourse> {
  return useFrom(() => structuredData.semester_courses);
}

export function useSemesterCoursesBySemester(semester: string): UseResult<Course> {
  const { data: allSemesterCourses } = useSemesterCourses();
  const { data: allCourses } = useCourses();

  return useMemo(() => {
    const courseIds = allSemesterCourses
      .filter((sc) => sc.semester === semester)
      .map((sc) => sc.course_id);
    return {
      data: allCourses.filter((c) => courseIds.includes(c.course_id)),
      loading: false,
      error: null,
    };
  }, [semester, allSemesterCourses, allCourses]);
}

export function useAllSemesters(): UseResult<string> {
  const { data: semesterCourses } = useSemesterCourses();
  return useMemo(() => {
    const semesters = [...new Set(semesterCourses.map((sc) => sc.semester))];
    return { data: semesters, loading: false, error: null };
  }, [semesterCourses]);
}

export function useDegreeTracks(): UseResult<DegreeTrack> {
  return useFrom(() => structuredData.degree_tracks);
}

export function useDegreeGroupRequirements(): UseResult<DegreeGroupReq> {
  return useFrom(() => structuredData.degree_group_requirements);
}

export function useTrackGroups(trackCode: string): UseResult<DegreeGroupReq & { group: CourseGroup | null }> {
  const { data: allReqs } = useDegreeGroupRequirements();
  const { data: groups } = useCourseGroups();

  return useMemo(() => {
    const reqs = allReqs.filter((r) => r.track_code === trackCode);
    return {
      data: reqs.map((r) => ({
        ...r,
        group: groups.find((g) => g.group_id === r.group_id) ?? null,
      })),
      loading: false,
      error: null,
    };
  }, [trackCode, allReqs, groups]);
}

export function useDegreeCourseRequirements(): UseResult<DegreeCourseReq> {
  return useFrom(() => structuredData.degree_course_requirements);
}

export function usePrerequisites(): UseResult<CoursePrereq> {
  return useFrom(() => structuredData.course_prerequisites);
}

export function useCoursePrerequisites(courseId: string): UseResult<Course> {
  const { data: allPrereqs } = usePrerequisites();
  const { data: allCourses } = useCourses();

  return useMemo(() => {
    const prereqIds = allPrereqs
      .filter((p) => p.course_id === courseId)
      .map((p) => p.prereq_course_id);
    return {
      data: allCourses.filter((c) => prereqIds.includes(c.course_id)),
      loading: false,
      error: null,
    };
  }, [courseId, allPrereqs, allCourses]);
}

export function useChoiceSets(): UseResult<ChoiceSet> {
  return useFrom(() => structuredData.choice_sets);
}

export function useGroupChoiceSets(groupId: number): UseResult<
  ChoiceSet & { courses: Course[] }
> {
  const { data: allSets } = useChoiceSets();
  const { data: allSetCourses } = useFrom<ChoiceSetCourse>(
    () => structuredData.choice_set_courses
  );
  const { data: allCourses } = useCourses();

  return useMemo(() => {
    const sets = allSets.filter((s) => s.group_id === groupId);
    return {
      data: sets.map((s) => ({
        ...s,
        courses: allSetCourses
          .filter((sc) => sc.set_id === s.set_id)
          .map((sc) => allCourses.find((c) => c.course_id === sc.course_id)!)
          .filter(Boolean),
      })),
      loading: false,
      error: null,
    };
  }, [groupId, allSets, allSetCourses, allCourses]);
}

export const ALL_SEMESTERS = [
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