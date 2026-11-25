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
  | "workspace.collapseSidebar"
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
  | "workspace.searchFilter"
  | "workspace.expandSearchFilter"
  | "workspace.filterSidebarHint"
  | "workspace.collapseFilters"
  | "workspace.doneFilters"
  | "workspace.relationFilters"
  | "mindmap.searchPlaceholder"
  | "mindmap.searchPopup"
  | "mindmap.noMatches"
  | "mindmap.foundTargets"
  | "mindmap.targetNoExpand"
  | "mindmap.matchCount"
  | "mindmap.position"
  | "mindmap.expandedAll"
  | "mindmap.limitNotExpanded"
  | "mindmap.sameNameCount"
  | "mindmap.oneMatch"
  | "mindmap.prev"
  | "mindmap.next"
  | "mindmap.expandMatchesBtn"
  | "mindmap.editSearch"
  | "mindmap.clearSearch"
  | "mindmap.otherScopeHint"
  | "mindmap.limitShort"
  | "mindmap.shownShort"
  | "mindmap.expandTray"
  | "mindmap.collapseTray"
  | "mindmap.visibleLimit"
  | "mindmap.purpleTick"
  | "mindmap.shownCourses"
  | "mindmap.pinnedSuffix"
  | "mindmap.expandAll"
  | "mindmap.collapseAll"
  | "mindmap.reset"
  | "mindmap.pinOff"
  | "mindmap.pinOn"
  | "mindmap.creditUnit"
  | "mindmap.creditMissing"
  | "mindmap.appearsInGroups"
  | "mindmap.collapseDesc"
  | "mindmap.collapsePinned"
  | "mindmap.collapseSoft"
  | "mindmap.cancel"
  | "mindmap.expandMatchesTitle"
  | "mindmap.expandMatchesDesc"
  | "mindmap.raiseLimitTo"
  | "mindmap.expandWithin"
  | "mindmap.keysOn"
  | "mindmap.keysOff"
  | "mindmap.resetView"
  | "mindmap.scopeFallback"
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
        "workspace.collapseSidebar": "收起《",
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
        "workspace.searchFilter": "搜索与筛选",
        "workspace.expandSearchFilter": "展开搜索与筛选",
        "workspace.filterSidebarHint": "展开来搜索筛选，折叠来看课程目录",
        "workspace.collapseFilters": "收起筛选",
        "workspace.doneFilters": "完成",
        "workspace.relationFilters": "关系图筛选",
        "mindmap.searchPlaceholder": "输入关键词，查找课程/模块/课组…",
        "mindmap.searchPopup": "搜索导图",
        "mindmap.noMatches": "无匹配目标",
        "mindmap.foundTargets": "找到 {n} 个目标文本，点击即可定位",
        "mindmap.targetNoExpand": "该目标无可展开节点",
        "mindmap.matchCount": "共 {n} 处同名匹配",
        "mindmap.position": "第 {i} / {n} 处",
        "mindmap.expandedAll": "已展开全部 {n} 个匹配结果",
        "mindmap.limitNotExpanded": "受上限（{max}）约束，还有 {n} 个匹配结果未展开",
        "mindmap.sameNameCount": "共 {n} 处同名",
        "mindmap.oneMatch": "1 处匹配",
        "mindmap.prev": "上一个",
        "mindmap.next": "下一个",
        "mindmap.expandMatchesBtn": "展开全部匹配",
        "mindmap.editSearch": "点击修改搜索",
        "mindmap.clearSearch": "清除搜索",
        "mindmap.otherScopeHint": "在「{scope}」中还发现了 {n} 项结果，点击切换查看 →",
        "mindmap.limitShort": "上限 {max}",
        "mindmap.shownShort": "已显示 {shown}/{max}",
        "mindmap.expandTray": "展开 ▾",
        "mindmap.collapseTray": "收起 ▴",
        "mindmap.visibleLimit": "同时可见课程上限",
        "mindmap.purpleTick": "紫色刻度 = {n}：设为此值可恰好只展开培养方案全部课程",
        "mindmap.shownCourses": "已显示课程 {shown} / {max}",
        "mindmap.pinnedSuffix": "已固定 {n}",
        "mindmap.expandAll": "展开全部",
        "mindmap.collapseAll": "收起全部",
        "mindmap.reset": "重置",
        "mindmap.pinOff": "取消固定",
        "mindmap.pinOn": "固定（常驻展开，不被回收）",
        "mindmap.creditUnit": "学分",
        "mindmap.creditMissing": "学分未标注",
        "mindmap.appearsInGroups": "出现于 {n} 个课组",
        "mindmap.collapseDesc": "你已固定 {n} 个节点。收起时是否一并收起这些固定节点？",
        "mindmap.collapsePinned": "一并收起固定（{n}）",
        "mindmap.collapseSoft": "仅收起未固定",
        "mindmap.cancel": "取消",
        "mindmap.expandMatchesTitle": "展开全部匹配",
        "mindmap.expandMatchesDesc": "全部展开共需显示 {needed} 门课程，超出当前上限 {max}。是否临时扩大上限以展开全部？",
        "mindmap.raiseLimitTo": "扩大上限至 {n}",
        "mindmap.expandWithin": "仅展开上限内（{max}）",
        "mindmap.keysOn": "方向键平移：已开启（点击关闭）",
        "mindmap.keysOff": "方向键平移：已关闭（点击开启）",
        "mindmap.resetView": "复位视图",
        "mindmap.scopeFallback": "范围",
        "mobile.tourUsePC": "功能引导步骤较多，建议在 PC 端查看完整教程。另外，部分手机浏览器可能会出现组件颜色缺失；若遇到此情况，请尝试在 PC 端使用、更换浏览器或开启暗色模式。你也可以前往「关于我们」页的问题反馈区提供机型和浏览器信息，帮助我们改进兼容性。",
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
        "workspace.collapseSidebar": "Collapse «",
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
        "workspace.searchFilter": "Search & Filter",
        "workspace.expandSearchFilter": "Expand Search & Filter",
        "workspace.filterSidebarHint": "Expand to search & filter · collapse to view the catalog",
        "workspace.collapseFilters": "Collapse Filters",
        "workspace.doneFilters": "Done",
        "workspace.relationFilters": "Graph Filters",
        "mindmap.searchPlaceholder": "Search courses, modules or groups…",
        "mindmap.searchPopup": "Search Map",
        "mindmap.noMatches": "No matches",
        "mindmap.foundTargets": "{n} matching targets found, click to locate",
        "mindmap.targetNoExpand": "This target has no expandable nodes",
        "mindmap.matchCount": "{n} matches in total",
        "mindmap.position": "Match {i} / {n}",
        "mindmap.expandedAll": "Expanded all {n} matches",
        "mindmap.limitNotExpanded": "Limit ({max}) reached — {n} matches not expanded",
        "mindmap.sameNameCount": "{n} matches",
        "mindmap.oneMatch": "1 match",
        "mindmap.prev": "Prev",
        "mindmap.next": "Next",
        "mindmap.expandMatchesBtn": "Expand all matches",
        "mindmap.editSearch": "Click to edit search",
        "mindmap.clearSearch": "Clear search",
        "mindmap.otherScopeHint": "{n} more results in \"{scope}\" — click to view →",
        "mindmap.limitShort": "Limit {max}",
        "mindmap.shownShort": "Shown {shown}/{max}",
        "mindmap.expandTray": "Expand ▾",
        "mindmap.collapseTray": "Collapse ▴",
        "mindmap.visibleLimit": "Visible course limit",
        "mindmap.purpleTick": "Purple tick = {n}: set exactly this value to expand all main-scheme courses",
        "mindmap.shownCourses": "Courses shown {shown} / {max}",
        "mindmap.pinnedSuffix": "{n} pinned",
        "mindmap.expandAll": "Expand all",
        "mindmap.collapseAll": "Collapse all",
        "mindmap.reset": "Reset",
        "mindmap.pinOff": "Unpin",
        "mindmap.pinOn": "Pin (keep expanded)",
        "mindmap.creditUnit": "cr",
        "mindmap.creditMissing": "Credits not labeled",
        "mindmap.appearsInGroups": "Appears in {n} groups",
        "mindmap.collapseDesc": "You have {n} pinned nodes. Collapse them as well?",
        "mindmap.collapsePinned": "Collapse pinned too ({n})",
        "mindmap.collapseSoft": "Collapse unpinned only",
        "mindmap.cancel": "Cancel",
        "mindmap.expandMatchesTitle": "Expand all matches",
        "mindmap.expandMatchesDesc": "Expanding all requires {needed} visible courses, above the current limit {max}. Temporarily raise the limit to expand all?",
        "mindmap.raiseLimitTo": "Raise limit to {n}",
        "mindmap.expandWithin": "Expand within limit ({max})",
        "mindmap.keysOn": "Arrow-key panning: on (click to disable)",
        "mindmap.keysOff": "Arrow-key panning: off (click to enable)",
        "mindmap.resetView": "Reset view",
        "mindmap.scopeFallback": "Scope",
        "mobile.tourUsePC": "This tutorial is best viewed on a PC. Some mobile browsers may also fail to render component colors; if so, try using a PC, switching browsers, or enabling dark mode. You may also provide your device/browser info in the Feedback section on the About page to help us improve compatibility.",
    },
};