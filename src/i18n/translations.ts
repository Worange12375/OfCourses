export type Locale = "zh" | "en";

export type TranslationKey =
    | "nav.home"
    | "nav.curriculum"
    | "nav.workspace"
    | "nav.about"
    | "nav.tools"
    | "nav.defaultUser"
    | "nav.language"
    | "home.welcome"
    | "home.subtitle"
    | "workspace.history"
    | "workspace.staging"
    | "workspace.stagingSubtitle"
    | "workspace.catalog"
    | "workspace.search"
    | "workspace.property"
    | "workspace.allProperties"
    | "workspace.totalSelected"
    | "workspace.fold"
    | "workspace.unfold"
    | "workspace.prev"
    | "workspace.next"
    | "about.title"
    | "about.description"
    | "nav.semester"
    | "nav.currentSemester"
    | "workspace.filterHeader"
    | "workspace.searchPlaceholder"
    | "workspace.filterClear"
    | "workspace.filterProperty"
    | "workspace.filterGroup"
    | "workspace.filterSemester"
    | "workspace.filterModule"
    | "workspace.filterABGroup"
    | "workspace.colCode"
    | "workspace.colName"
    | "workspace.colCredits"
    | "workspace.colCategory"
    | "workspace.colSemester"
    | "workspace.noMatch"
    | "workspace.noHistory"
    | "workspace.stagingPlaceholder"
    | "workspace.filterUnset"
    | "workspace.filterTypeI"
    | "workspace.filterTypeII"
    | "workspace.filterTypeIII"
    | "workspace.filterNonModule"
    | "workspace.filterGroupA"
    | "workspace.filterGroupB"
    | "workspace.stagingCourse"
    | "workspace.stagingSemester"
    | "workspace.stagingSave"
    | "workspace.stagingTotal"
    | "workspace.stagingRemove"
    | "workspace.stagingEmpty"
    | "workspace.historyEdit"
    | "workspace.historyDelete"
    | "workspace.historyDeleteConfirm"
    | "workspace.historyDeleteCancel"
    | "workspace.historyFuturePlanned"
    | "workspace.historyFutureNext"
    | "workspace.customCourse"
    | "workspace.customCourseName"
    | "workspace.customCourseCredits"
    | "workspace.customCourseAdd"
    | "workspace.customCourseEmpty"
    | "workspace.importExport"
    | "workspace.importTitle"
    | "workspace.exportTitle"
    | "workspace.importBtn"
    | "workspace.exportBtn"
    | "workspace.importConfirm"
    | "workspace.importSuccess"
    | "workspace.importError"
    | "workspace.importMergeHint"
    | "workspace.importConfirmMerge"
    | "workspace.importConfirmOverwrite"
    | "workspace.importCancel"
    | "workspace.blueNeed"
    | "workspace.blueRec"
    | "workspace.blueRecEng"
    | "workspace.geCredits"
    | "workspace.foundI"
    | "workspace.foundII"
    | "workspace.foundIII"
    | "workspace.conflictDuplicate"
    | "workspace.conflictNotice"
    | "workspace.conflictTitle"
    | "workspace.exportSuccess"
    | "workspace.creditLimit"
    | "workspace.creditMin"
    | "workspace.creditSummer"
    | "workspace.saveAnyway"
    | "workspace.saveForceConfirm"
    | "workspace.saveForceTitle"
    | "workspace.errorTitle"
    | "workspace.warningTitle"
    | "workspace.errorCreditOver"
    | "workspace.errorCreditUnder"
    | "workspace.warningCreditOver"
    | "workspace.warningCreditUnder"
    | "workspace.peRequired"
    | "workspace.noDeleteEmpty"
    | "mobile.settings"
    | "mobile.theme"
    | "mobile.dark"
    | "mobile.light"
    | "mobile.language"
    | "mobile.viewMode"
    | "mobile.promptTitle"
    | "mobile.promptDesc"
    | "mobile.pcMode"
    | "mobile.mobileMode"
    | "mobile.rememberChoice"
    | "mobile.curriculum.mindMap"
    | "mobile.curriculum.plan"
    | "workspace.select"
    | "mobile.tourUsePC";

type Translations = Record<Locale, Record<TranslationKey, string>>;

export const translations: Translations = {
    zh: {
        "nav.home": "主页",
        "nav.curriculum": "培养方案",
        "nav.workspace": "工作台",
        "nav.about": "关于我们",
        "nav.tools": "综合工具",
        "nav.defaultUser": "默认用户",
        "nav.language": "中/EN",
        "nav.semester": "当前学期",
        "nav.currentSemester": "您当前的学期：",
        "home.welcome": "欢迎使用 OfCourses",
        "home.subtitle": "你的智能选课规划助手",
        "workspace.history": "历史记录",
        "workspace.staging": "预选课程",
        "workspace.stagingSubtitle": "下学期",
        "workspace.catalog": "课程目录",
        "workspace.search": "搜索",
        "workspace.property": "课程属性",
        "workspace.allProperties": "全部属性",
        "workspace.totalSelected": "已选总数",
        "workspace.fold": "折叠",
        "workspace.unfold": "展开",
        "workspace.prev": "上一页",
        "workspace.next": "下一页",
        "workspace.searchPlaceholder": "按课程名、课程编号搜索",
        "workspace.filterHeader": "筛选",
        "workspace.filterClear": "清除筛选设置",
        "workspace.filterProperty": "按课程属性",
        "workspace.filterGroup": "按课程组",
        "workspace.filterSemester": "按推荐学期",
        "workspace.filterModule": "按模块",
        "workspace.filterABGroup": "课组",
        "workspace.colCode": "课程编号",
        "workspace.colName": "课程名称",
        "workspace.colCredits": "学分",
        "workspace.colCategory": "类别",
        "workspace.colSemester": "推荐学期",
        "workspace.noMatch": "无匹配课程",
        "workspace.noHistory": "暂无历史记录",
        "workspace.stagingPlaceholder": "选课功能开发中...",
        "workspace.filterUnset": "未启用",
        "workspace.filterTypeI": "I类",
        "workspace.filterTypeII": "II类",
        "workspace.filterTypeIII": "III类",
        "workspace.filterNonModule": "非模块",
        "workspace.filterGroupA": "A课组",
        "workspace.filterGroupB": "B课组",
        "workspace.stagingCourse": "预选课程",
        "workspace.stagingSemester": "您当前选择的是",
        "workspace.stagingSave": "保存到历史记录",
        "workspace.stagingTotal": "当前共选择了",
        "workspace.stagingRemove": "移除",
        "workspace.stagingEmpty": "暂未选择课程",
        "workspace.historyEdit": "编辑",
        "workspace.historyDelete": "删除",
        "workspace.historyDeleteConfirm": "确认删除该学期记录？",
        "workspace.historyDeleteCancel": "取消",
        "workspace.historyFuturePlanned": "已规划",
        "workspace.historyFutureNext": "预选",
        "workspace.customCourse": "自定义课程",
        "workspace.customCourseName": "课程名称",
        "workspace.customCourseCredits": "学分",
        "workspace.customCourseAdd": "添加",
        "workspace.customCourseEmpty": "暂未添加自定义课程",
        "workspace.importExport": "记录导入",
        "workspace.importTitle": "导入历史记录",
        "workspace.exportTitle": "导出历史记录",
        "workspace.importBtn": "导入",
        "workspace.exportBtn": "导出",
        "workspace.importConfirm": "即将导入数据，是否继续？",
        "workspace.importSuccess": "导入成功！",
        "workspace.importError": "文件解析失败，请检查格式",
        "workspace.importMergeHint": "将【合并】到现有数据（按学期并集），不会覆盖已有记录。",
        "workspace.importConfirmMerge": "确认导入（合并）",
        "workspace.importConfirmOverwrite": "确认导入（覆盖）",
        "workspace.importCancel": "取消",
        "workspace.blueNeed": "须选择",
        "workspace.blueRec": "推荐",
        "workspace.blueRecEng": "推荐",
        "workspace.geCredits": "通识学分 · ",
        "workspace.foundI": "I类",
        "workspace.foundII": "II类",
        "workspace.foundIII": "III类",
        "workspace.conflictDuplicate": "课程重复选择",
        "workspace.conflictNotice": "提示",
        "workspace.conflictTitle": "选课冲突",
        "workspace.exportSuccess": "已导出记录到本地",
        "workspace.creditLimit": "学分约束",
        "workspace.creditMin": "每学期至少6学分（军训/暑期除外）",
        "workspace.creditSummer": "暑期课程不设学分下限",
        "workspace.saveAnyway": "我已知晓，仍要保存",
        "workspace.saveForceConfirm": "您已确认知晓上述风险，确认保存？",
        "workspace.saveForceTitle": "二次确认",
        "workspace.errorTitle": "错误",
        "workspace.warningTitle": "警告",
        "workspace.errorCreditOver": "学分超出上限",
        "workspace.errorCreditUnder": "学分不足下限",
        "workspace.warningCreditOver": "接近学分上限",
        "workspace.warningCreditUnder": "学分偏低",
        "workspace.peRequired": "本学期有体育课要求，请选择体育课",
        "workspace.noDeleteEmpty": "暂无数据可删除",
        "about.title": "关于我们",
        "about.description": "OfCourses —— 你的智能选课规划助手。",
        "mobile.settings": "设置",
        "mobile.theme": "主题",
        "mobile.dark": "深色",
        "mobile.light": "浅色",
        "mobile.language": "语言",
        "mobile.viewMode": "显示模式",
        "mobile.promptTitle": "本网站建议在 PC 端使用以获得最佳体验",
        "mobile.promptDesc": "移动端模式已对界面进行简化适配，复杂功能仍建议在电脑上操作。",
        "mobile.pcMode": "使用 PC 模式",
        "mobile.mobileMode": "使用移动端模式",
        "mobile.rememberChoice": "记住我的选择",
        "mobile.curriculum.mindMap": "思维导图",
        "mobile.curriculum.plan": "培养方案",
        "workspace.select": "选课",
        "mobile.tourUsePC": "功能引导建议在 PC 端查看",
    },
    en: {
        "nav.home": "Home",
        "nav.curriculum": "Curriculum",
        "nav.workspace": "Workspace",
        "nav.about": "About Us",
        "nav.tools": "Tools",
        "nav.defaultUser": "Default User",
        "nav.language": "中/EN",
        "nav.semester": "Current Semester",
        "nav.currentSemester": "Your current semester: ",
        "home.welcome": "Welcome to OfCourses",
        "home.subtitle": "Your smart course planning assistant",
        "workspace.history": "History",
        "workspace.staging": "Staging",
        "workspace.stagingSubtitle": "Next Term",
        "workspace.catalog": "Catalog",
        "workspace.search": "Search",
        "workspace.property": "Property",
        "workspace.allProperties": "All properties",
        "workspace.totalSelected": "Total selected",
        "workspace.fold": "Fold",
        "workspace.unfold": "Unfold",
        "workspace.prev": "Prev",
        "workspace.next": "Next",
        "workspace.searchPlaceholder": "Search by course name or code",
        "workspace.filterHeader": "Filters",
        "workspace.filterClear": "Clear Filters",
        "workspace.filterProperty": "By Property",
        "workspace.filterGroup": "By Group",
        "workspace.filterSemester": "By Semester",
        "workspace.filterModule": "By Module",
        "workspace.filterABGroup": "Sub-group",
        "workspace.colCode": "Code",
        "workspace.colName": "Name",
        "workspace.colCredits": "Credits",
        "workspace.colCategory": "Category",
        "workspace.colSemester": "Semester",
        "workspace.noMatch": "No matching courses",
        "workspace.noHistory": "No history available",
        "workspace.stagingPlaceholder": "Course selection in development...",
        "workspace.filterUnset": "Not set",
        "workspace.filterTypeI": "Type I",
        "workspace.filterTypeII": "Type II",
        "workspace.filterTypeIII": "Type III",
        "workspace.filterNonModule": "Non-module",
        "workspace.filterGroupA": "Group A",
        "workspace.filterGroupB": "Group B",
        "workspace.stagingCourse": "Course Selection",
        "workspace.stagingSemester": "Current selection:",
        "workspace.stagingSave": "Save to History",
        "workspace.stagingTotal": "Total: ",
        "workspace.stagingRemove": "Remove",
        "workspace.stagingEmpty": "No courses selected",
        "workspace.historyEdit": "Edit",
        "workspace.historyDelete": "Delete",
        "workspace.historyDeleteConfirm": "Delete this semester record?",
        "workspace.historyDeleteCancel": "Cancel",
        "workspace.historyFuturePlanned": "Planned",
        "workspace.historyFutureNext": "Preselect",
        "workspace.customCourse": "Custom Courses",
        "workspace.customCourseName": "Course Name",
        "workspace.customCourseCredits": "Credits",
        "workspace.customCourseAdd": "Add",
        "workspace.customCourseEmpty": "No custom courses yet",
        "workspace.importExport": "Import/Export",
        "workspace.importTitle": "Import Records",
        "workspace.exportTitle": "Export Records",
        "workspace.importBtn": "Import",
        "workspace.exportBtn": "Export",
        "workspace.importConfirm": "Import data? This will overwrite current records.",
        "workspace.importSuccess": "Import successful!",
        "workspace.importError": "Invalid file format",
        "workspace.importMergeHint": "Will be [merged] into existing data (union per semester); current records are kept.",
        "workspace.importConfirmMerge": "Confirm (merge)",
        "workspace.importConfirmOverwrite": "Confirm (overwrite)",
        "workspace.importCancel": "Cancel",
        "workspace.blueNeed": "Need ",
        "workspace.blueRec": "Recommended: ",
        "workspace.blueRecEng": "Rec: ",
        "workspace.geCredits": "GE credits · ",
        "workspace.foundI": "Type I",
        "workspace.foundII": "Type II",
        "workspace.foundIII": "Type III",
        "workspace.conflictDuplicate": "Course Duplicate",
        "workspace.conflictNotice": "Notice",
        "workspace.conflictTitle": "Course Conflict",
        "workspace.exportSuccess": "Records exported",
        "workspace.creditLimit": "Credit Limits",
        "workspace.creditMin": "Min 6 credits/semester (excl. boot camp/summer)",
        "workspace.creditSummer": "Summer term: no minimum credit limit",
        "workspace.saveAnyway": "I understand, save anyway",
        "workspace.saveForceConfirm": "You have confirmed the risks. Save?",
        "workspace.saveForceTitle": "Confirm Again",
        "workspace.errorTitle": "Error",
        "workspace.warningTitle": "Warning",
        "workspace.errorCreditOver": "Credits exceed maximum",
        "workspace.errorCreditUnder": "Credits below minimum",
        "workspace.warningCreditOver": "Near credit limit",
        "workspace.warningCreditUnder": "Low credits",
        "workspace.peRequired": "PE course required this semester",
        "workspace.noDeleteEmpty": "No data to delete",
        "about.title": "About Us",
        "about.description": "OfCourses — Your smart course planning assistant.",
        "mobile.settings": "Settings",
        "mobile.theme": "Theme",
        "mobile.dark": "Dark",
        "mobile.light": "Light",
        "mobile.language": "Language",
        "mobile.viewMode": "View Mode",
        "mobile.promptTitle": "This site works best on a PC",
        "mobile.promptDesc": "Mobile mode simplifies the interface; complex features are still recommended on desktop.",
        "mobile.pcMode": "Use PC Mode",
        "mobile.mobileMode": "Use Mobile Mode",
        "mobile.rememberChoice": "Remember my choice",
        "mobile.curriculum.mindMap": "Mind Map",
        "mobile.curriculum.plan": "Curriculum Plan",
        "workspace.select": "Select",
        "mobile.tourUsePC": "Tutorial is best viewed on a PC",
    },
};