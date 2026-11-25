// 学位评定算法抽查脚本（临时，不入库）：用一段模拟历史验证与 ToolsPage 口径一致
import { buildDegreeEvalText, evalDegreeTracks } from "../src/utils/degreeEval";
import { evalModuleProgress } from "../src/utils/degreeEval";

// 模拟历史：模块9A 高完成度（4/5 门）+ 大量通识学分
const history: Record<string, string[]> = {
  "大一·秋季": ["10421055", "12090052", "14201002", "10720011"],
  "大一·春季": ["10421065", "14201012", "10720021"],
  "大二·秋季": ["34100373", "10420803", "30160213"],
  "大二·春季": ["20160013", "40160763", "10680073"],
  "大三·秋季": ["30160253", "40160923", "30160353"],
};

const results = evalDegreeTracks(history);
console.log(results.map((t) => `${t.code} ${t.pct}% best=${t.bestModules?.join("/")} a=${t.bestGroupInfo?.aTaken}/${t.bestGroupInfo?.aTotal} credits=${t.creditsEarned}/${t.creditsRequired}${t.missingRequired ? ` missing=${t.missingRequired}` : ""}`).join("\n"));
console.log("--- 逐模块 ---");
console.log(evalModuleProgress(history).filter((m) => m.pct > 0).map((m) => `模块${m.modId}(类${m.cat}) ${m.pct}% a=${m.aTaken}/${m.aTotal} catCredits=${m.catCredits}`).join("\n"));
console.log("--- 双口径（当前学期=大三·秋季）---");
console.log(buildDegreeEvalText(history, "大三·秋季").slice(0, 900));
console.log("--- 单口径（无当前学期）---");
console.log(buildDegreeEvalText(history).slice(0, 200));

// —— CED 场景验证（2026-11-15）：读 2024 数据构造达标/部分达标历史 ——
import {readFileSync} from "node:fs";
import {setSchemeDataByYear} from "../src/data/schemeStore";

const sd = JSON.parse(readFileSync(new URL("../src/data/structured_data_2024.json", import.meta.url), "utf-8"));
const gidOf = (code: string) => sd.course_groups.find((g: any) => g.group_code === code)!.group_id;
const coursesOf = (code: string) => sd.group_courses.find((g: any) => g.group_id === gidOf(code))!.course_ids;
const cedAll = (codes: string[]) => ({ "大一·秋季": codes.flatMap((c) => coursesOf(c)) });

const show = (label: string, h: Record<string, string[]>) => {
  const t = evalDegreeTracks(h).find((x) => x.code === "CED")!;
  console.log(`${label}: CED ${t.pct}% complete=${t.isComplete} pair=${t.cedInfo?.pairCredits}/21 secondA=${t.cedInfo?.secondACredits}/9 best=${t.bestModules?.join("+")}${t.missingRequired ? ` missing=${t.missingRequired}` : ""}`);
};

console.log("--- CED 场景（2024）---");
show("① 模块1(A+B)+模块9(A+B) 全修（应达标 100%）", cedAll(["1A", "1B", "9A", "9B"]));
show("② 模块1(A+B) 全修 + 模块9(A+B) 仅 4 学分课（第二专业 A 组不足 9）", {
  "大一·秋季": [...coursesOf("1A"), ...coursesOf("1B"), coursesOf("9A")[0]],
});
show("③ 仅模块1(A+B) 全修（第二专业 A 组 0 学分）", cedAll(["1A", "1B"]));

// —— 年级切换验证：切到 2026 后同场景重算（索引应按年级重建） ——
setSchemeDataByYear("2026");
console.log("--- CED 场景（切 2026 后）---");
const sd26 = JSON.parse(readFileSync(new URL("../src/data/structured_data_2026.json", import.meta.url), "utf-8"));
const gidOf26 = (code: string) => sd26.course_groups.find((g: any) => g.group_code === code)!.group_id;
const coursesOf26 = (code: string) => sd26.group_courses.find((g: any) => g.group_id === gidOf26(code))!.course_ids;
const h26 = { "大一·秋季": [...coursesOf26("1A"), ...coursesOf26("1B"), ...coursesOf26("9A"), ...coursesOf26("9B")] };
const t26 = evalDegreeTracks(h26).find((x) => x.code === "CED")!;
console.log(`① 模块1(A+B)+模块9(A+B) 全修：CED ${t26.pct}% complete=${t26.isComplete} pair=${t26.cedInfo?.pairCredits}/21 secondA=${t26.cedInfo?.secondACredits}/9 best=${t26.bestModules?.join("+")}`);
setSchemeDataByYear("2024");
