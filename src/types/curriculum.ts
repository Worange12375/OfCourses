// 培养方案数据类型定义，与 src/data/structured_data.json 的数据形状一一对应。
// 历史备注：本文件最初由 Supabase 数据库类型生成（supabase gen types），
// 2026-09 起项目移除 Supabase 依赖，改为本地手工维护。

export type Course = {
  course_id: string;
  credits: number;
  is_new: boolean | null;
  module_type: string | null;
  name: string;
};

export type Module = {
  description: string | null;
  module_id: number;
  name: string;
};

export type CourseGroup = {
  group_code: string;
  group_id: number;
  module_id: number | null;
  name: string;
};

export type ChoiceSet = {
  group_id: number | null;
  max_select: number;
  min_select: number;
  name: string;
  set_id: number;
};

export type ChoiceSetCourse = {
  course_id: string;
  set_id: number;
};

export type DegreeTrack = {
  description: string | null;
  name: string;
  total_credits_required: number | null;
  track_code: string;
};

export type DegreeGroupReq = {
  group_id: number | null;
  id: number;
  is_main: boolean | null;
  track_code: string | null;
};

export type DegreeCourseReq = {
  course_id: string | null;
  id: number;
  track_code: string | null;
};

export type CoursePrereq = {
  course_id: string;
  prereq_course_id: string;
};

export type CoursePrereqChoiceSet = {
  course_id: string;
  prereq_choice_set: number;
};

export type GroupCourse = {
  course_id: string;
  group_id: number;
  note: string | null;
};
