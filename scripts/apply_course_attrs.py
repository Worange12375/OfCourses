# -*- coding: utf-8 -*-
"""给 structured_data.json 的课程打「修读属性」标签（course_attr）。

属性四档（依据培养方案第五项「课程设置与学分分布」）：
  required      必修
  restricted    限选
  elective      任选
  prof_required 专业必修（附 prof_note 说明适用专业——仅对走对应专业学位路径的学生是必修）

规则（用户 2026-09-28 定稿）：
  1. 通识：思政必修10门/体育(1)-(4)/写作与沟通/军事2门/书院通识2门 = 必修；
     英语(3)(4)=限选；体育专项(1)(2)=限选、(3)(4)=任选；第二外国语=限选；
     汉语系列（国际生）/国际·台湾新生集训=任选；思政限选（四史等）不入系统，只在 KB 说明。
  2. 科学基础：数学/物理/信智/机电基础全部 = 必修。
  3. 基础加强：离散(1)、运筹学确定性方法二选一（两门）、动力学基础/理论力学/理论力学(英)三选一（三门）= 必修；
     计算机组成原理/应用统计与数据分析/固体力学基础/材料力学/材料力学(英) = 限选。
  4. 专业交叉模块：有「XX专业必修」备注 = prof_required；其余 = 限选。
  5. 进阶式实践：全部 = 必修。

用法：python apply_course_attrs.py   （幂等，可反复执行）
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "src", "data", "structured_data.json"))

REQUIRED = {
    # 思政必修（17学分，形势与政策 2组选1组的四门均按必修属性）
    "10680053", "10680101", "10680121", "10680131", "10680111", "10610193",
    "10680073", "10680142", "10680022", "10680092",
    # 体育(1)-(4)
    "10720011", "10720021", "10720031", "10720041",
    # 写作与沟通 / 军事
    "10691342", "12090052", "12090062",
    # 英语(1)(2)（英语综合能力课组必修侧）
    "14201002", "14201012",
    # 书院通识课
    "04790012", "34790012",
    # 数学基础（8门，含概率论三选一、数值分析二选一，组内选择均按必修属性）
    "10421055", "10421065", "10421324", "30160213", "10420803", "40420624", "14920032", "10421403",
    # 物理基础
    "10430484", "10430494", "10431282",
    # 信智基础
    "34100063", "34100362", "00740302", "34100373", "20160023", "24100033",
    # 机电基础
    "20120273", "10220053", "20250253", "30310992",
    # 基础加强·必修侧（三组各含必修）
    "24100023",                                   # 离散数学(1)
    "30160353", "30160023",                       # 运筹学确定性方法 二选一
    "20310633", "20310334", "20310504",           # 动力学基础/理论力学/理论力学(英) 三选一
    # 进阶式实践（全部必修；34100232 与 30160322 为二选一）
    "34100232", "30160322", "21510222", "44790012", "44790023", "NEW018", "NEW017", "NEW019",
}

RESTRICTED = {
    # 基础加强·限选侧（专业交叉模块先修）
    "44100573", "30160203", "20310643", "20310584", "20310474",
    # 英语(3)(4)
    "14201022", "14201032",
    # 体育专项(1)(2)（大三/大四前段，5-6学期限选）
    "10720110", "10720120",
    # 第二外国语（自定义 FOREIGN_ 课）
    "FOREIGN_1", "FOREIGN_2", "FOREIGN_3", "FOREIGN_4",
}

ELECTIVE = {
    # 体育专项(3)(4)（7-8学期任选）
    "10720130", "10720140",
    # 汉语系列（国际学生）
    "14202002", "14202012", "14202022", "14202032",
    # 国际新生集训 / 台湾新生集训
    "12530023", "12530033",
}

PROF_REQUIRED = {
    # 课程号: (适用专业说明)
    "NEW003": "航空航天工程专业必修",
    "30310084": "工程力学专业必修",
    "NEW002": "航空航天工程专业：1B 课组至少选一门",
    "20160013": "工业工程专业必修（10A）",
    "30160234": "工业工程专业必修（11A）",
    "40160933": "工业工程专业必修（11A）",
}


def main() -> None:
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)

    gname = {g["group_id"]: g["group_code"] for g in data["course_groups"]}
    module_group_ids = {
        gc["group_id"] for gc in data["group_courses"] if re_module(gname.get(gc["group_id"], ""))
    }
    module_course_ids: set = set()
    for gc in data["group_courses"]:
        if gc["group_id"] in module_group_ids:
            module_course_ids.update(gc["course_ids"])

    n = {"required": 0, "restricted": 0, "elective": 0, "prof_required": 0}
    unknown = []
    for c in data["courses"]:
        cid = c["course_id"]
        if cid in PROF_REQUIRED:
            c["course_attr"] = "prof_required"
            c["prof_note"] = PROF_REQUIRED[cid]
        elif cid in REQUIRED:
            c["course_attr"] = "required"
        elif cid in RESTRICTED:
            c["course_attr"] = "restricted"
        elif cid in ELECTIVE:
            c["course_attr"] = "elective"
        elif cid in module_course_ids:
            c["course_attr"] = "restricted"  # 专业交叉模块无特殊备注 = 限选
        else:
            unknown.append(f"{cid} {c['name']}")
            continue
        n[c["course_attr"]] += 1

    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"打标完成：必修 {n['required']} / 限选 {n['restricted']} / 任选 {n['elective']} / 专业必修 {n['prof_required']}")
    if unknown:
        print("以下课程未匹配任何规则，请人工确认：")
        for u in unknown:
            print("  ", u)


def re_module(code: str) -> bool:
    """课组代码形如 1A/2B/.../13B（模块课组）"""
    if len(code) < 2:
        return False
    body, suffix = code[:-1], code[-1]
    return suffix in ("A", "B") and body.isdigit()


if __name__ == "__main__":
    main()
