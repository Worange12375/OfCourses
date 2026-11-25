# -*- coding: utf-8 -*-
"""
培养方案 Word → structured_data_{2024,2025,2026}.json 转换脚本 + 差异报告。

输入：extracted/{year}_{plan|teaching}.json（由 extract_scheme_tables.py 生成）
基准：../../src/data/structured_data.json（2024 级现网数据，作为 2024 版与属性继承字典）
输出：
  converted/structured_data_2024.json  —— 现网数据原样复制（基准版本）
  converted/structured_data_2025.json  —— Word 解析生成
  converted/structured_data_2026.json  —— Word 解析生成
  converted/diff_report.md             —— 三版本差异报告（供人工核对）

转换规则（与 2026-11-14 用户确认的方案一致）：
  1. 2024 版直接复用现网数据；Word 解析结果仅用于校对（差异报告第一部分）。
  2. 2025/2026 课程：培养方案表格逐行解析；课程属性/类属优先继承 2024 同 ID 课程，
     新课程按课组规则推断（基础=required、其余=restricted；模块1-3=I、4-8=II、9-13=III）。
  3. 三选一/二选一：表格备注「N选一」行 + 紧随的无备注行自动成组。
  4. 学期开课（semester_courses）：教学计划「第X学年 + 季节学期 + 表格」直接映射。
  5. choice_sets/degree_* 等框架继承 2024，过滤掉目标版本不存在的课程；差异进报告。
  6. 「新开课」（无编号）不进数据，单独在报告中列出。

运行：python convert_scheme.py
"""

import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
EXTRACTED = BASE / "extracted"
OUT = BASE / "converted"
OUT.mkdir(exist_ok=True)
SRC_DATA = BASE.parent.parent / "src" / "data" / "structured_data.json"

EMPTY_NOTE = re.compile(r"^[\s]*$")

# ---------------- 课组/模块上下文识别 ----------------

GROUP_HEADS = [
    # (段落正则, group_code)  —— 基础/加强/通识/实践课组
    (re.compile(r"数学基础"), "MATH_BASIS"),
    (re.compile(r"物理基础"), "PHY_BASIS"),
    (re.compile(r"信智基础"), "CS_BASIS"),
    (re.compile(r"机电基础"), "ME_BASIS"),
    (re.compile(r"计算基础"), "COMP_BASIS"),
    (re.compile(r"运筹统计"), "OR_STAT"),
    (re.compile(r"力学基础"), "MECH_BASIS"),
    (re.compile(r"工程数学进阶"), "ADV_MATH"),
    (re.compile(r"书院通识课"), "SHUYUAN_GE"),
]
RE_FLYING = re.compile(r"飞行学员班")  # 飞行学员班专用培养方案：不属于本工具范围，遇即停止解析
RE_PRACTICE = re.compile(r"进阶式实践")
RE_SKIP = re.compile(r"通识选修课\s*\d+\s*学分")  # 校级通识选修课清单：现网不收录，整节跳过
RE_SKIP2 = re.compile(r"[）)]\s*限选课\s*1\s*学分")  # 思政限选/通识混排大表：现网不收录，整节跳过
RE_MODULE = re.compile(r"模块(\d+)：(.+)")
RE_COURSE_GROUP = re.compile(r"课组(\d+)([AB])")
RE_SECTION = re.compile(r"^[（(]\d+[)）]|^[一二三四五六七八九十]、|^\d+．")
RE_COURSE_ID = re.compile(r"^\d{5,9}$")
RE_CREDITS = re.compile(r"(\d+(?:\.\d+)?)\s*学分|^(\d+(?:\.\d+)?)$")
RE_CHOICE = re.compile(r"([二三四五六])选一")
RE_TERM_HEAD = re.compile(r"第([一二三四])学年")
RE_SEASON = re.compile(r"(秋季|春季|夏季)学期")

CN_YEAR = {"一": 1, "二": 2, "三": 3, "四": 4}

# 2024 现网 NEW 占位课 → 最新 Word（20261008）中的真实编号（2026-11-14 名称+学分对照确认）。
# 未映射的 NEW006/009/011 在最新 Word 中仍为新开课，保留占位；
# NEW013「安全管理与工程」→ 40161032「安全工程与管理」为同一门课拿到正式课号（用户 2026-11-14 确认 remap）；
# NEW017-020（实践环节新开课）最新 Word 中仍无编号，保留占位。
NEW_REMAP = {
    "NEW001": "30311003",  # 实验与量测技术
    "NEW002": "30311054",  # 航天动力学与控制
    "NEW003": "30311064",  # 推进原理
    "NEW004": "40311043",  # 新概念热学
    "NEW005": "14920054",  # 优化理论与算法
    "NEW007": "34100453",  # 机器学习
    "NEW008": "34100443",  # 程序验证原理
    "NEW010": "44100703",  # 数据系统软件
    "NEW012": "40161072",  # 智能交互
    "NEW013": "40161032",  # 安全管理与工程 → 安全工程与管理（用户确认同一门课）
    "NEW014": "40161053",  # 需求与库存管理
    "NEW015": "40161082",  # 产业链供应链管理
    "NEW016": "40161062",  # 服务创新与运作管理
}
# 教学计划「新开课」中确认收录的课程（名称 → (占位ID, 学分)），2025/2026 生效。
# 计算力学导论：用户确认替换 2024 版的工程科学计算（30310973，2024 版保留不删——四字班方案照旧执行）。
NEW_EXTRA = {
    "计算力学导论": ("NEW021", 3),
}
# 培养方案「新开课」行显式映射：(年级, 课组code, 课程名) → 课号（2026-11-15 修复）。
# 此前 Word 培养方案里课号为「新开课」的行被解析器整行跳过，导致课组缺员
# （导图 1A/2A 缺计算力学导论、4A/5B 缺工业智能大模型、6A 缺形式语言与自动机 等）。
# 课号优先用该课后来拿到的正式课号（同一门课，如固体力学基础 2026 Word=20310654、
# 推进原理 2026 Word 标新开课但即 30311064）；确无编号用 NEW 占位。
# 注意：11A「试验设计与数据分析」与 9A 的 40160933 同名但是新课，分配 NEW022。
SCHEME_NEW_ROWS: dict[tuple[str, str, str], str] = {}
for _y in ("2024", "2025", "2026"):
    SCHEME_NEW_ROWS[(_y, "4A", "工业智能大模型")] = "NEW006"
    SCHEME_NEW_ROWS[(_y, "13B", "工业大数据分析")] = "NEW020"
for _y in ("2025", "2026"):
    SCHEME_NEW_ROWS.update({
        (_y, "1A", "计算力学导论"): "NEW021",
        (_y, "2A", "计算力学导论"): "NEW021",
        (_y, "5B", "工业智能大模型"): "NEW006",
        (_y, "5B", "工业大数据分析"): "NEW020",
        (_y, "6A", "形式语言与自动机"): "44100563",  # Word 标「新开课」2学分：沿用原课号，学分按 Word
        (_y, "8B", "嵌入式系统"): "NEW009",
        (_y, "9B", "工业大数据分析"): "NEW020",
        (_y, "10B", "博弈论与机制设计"): "NEW011",
        (_y, "11A", "试验设计与数据分析"): "NEW022",
        (_y, "12B", "博弈论与机制设计"): "NEW011",
        (_y, "13B", "工业大数据分析"): "NEW020",
        (_y, "MECH_BASIS", "固体力学基础"): "20310654",  # 2025 Word 尚为「新开课」，2026 Word 给出正式课号
    })
SCHEME_NEW_ROWS[("2026", "1B", "推进原理")] = "30311064"
SCHEME_NEW_ROWS[("2026", "10B", "机器学习")] = "34100453"
for _y in ("2024", "2025", "2026"):
    # 实践节三门新开课：2024 基准 SHIJIAN 组已含（NEW017/18/19），2025/2026 Word 仍标「新开课」
    SCHEME_NEW_ROWS[(_y, "SHIJIAN", "专业实践")] = "NEW018"
    SCHEME_NEW_ROWS[(_y, "SHIJIAN", "科研科创实践")] = "NEW017"
    SCHEME_NEW_ROWS[(_y, "SHIJIAN", "综合论文")] = "NEW019"

# 「N选一」选课组的成员数上限（二选一=2 门、三选一=3 门……）。
# 修复：此前选课组开启后无差别吸收后续所有无备注行（1A 二选一吞进实验与量测技术、
# 力学基础两个三选一被合并成 5 门组等）。
CHOICE_CAP = {"二": 2, "三": 3, "四": 4, "五": 5, "六": 6}
# 2024 版专调（2026-11-14 定稿；总原则=忠于各年级最新版 Word，Word 是什么样就改成什么样。
# 2024 级基准=现网旧版数据，仅作属性继承字典；此前误删 30160023/误换 30311013 已回滚——
# 四字班最新 Word 里这两门课（含「运筹学二选一」组）都原样存在，换号只是五/六字班的变化）：
#   学分/学期按 Word 2024 口径校准：40880023 非参数统计方法 2→3；40161082 产业链供应链管理 3→2
#   （2024 Word 写 2、2025/2026 Word 写 3，跨版本不一致保留——各自忠于各自 Word）；
#   84100372 三维空间计算基础 3→2 且开课学期 大四·春→大四·秋。
#   另有 8 门 Word 独有课收编（collect_2024_word_courses）与 NEW013→40161032 remap。
ADJUST_2024 = {
    "remove_courses": [],
    "remove_choice_sets": [],
    # 旧ID → (新课号或 None=仅改学分, 新学分)
    "replace_courses": {
        "40880023": (None, 3),
        "40161082": (None, 2),
        "84100372": (None, 2),
    },
    # 课号 → (旧学期, 新学期)
    "replace_semesters": {"84100372": ("大四·春季", "大四·秋季")},
}
FOREIGN_IDS = ["FOREIGN_1", "FOREIGN_2", "FOREIGN_3", "FOREIGN_4"]  # 二外课程：课程目录专用，全版本保留
# remap 后课名对齐最新 Word 正式名称（现网占位名与 Word 名称不一致的）
REMAP_RENAME = {
    "40161032": "安全工程与管理",  # 现网 NEW013「安全管理与工程」→ Word 正式名
}
MODULE_CLASS = {1: "I", 2: "I", 3: "I", 4: "II", 5: "II", 6: "II", 7: "II", 8: "II",
                9: "III", 10: "III", 11: "III", 12: "III", 13: "III"}
# 2024 版课组 → group_id（与现网 course_groups 一致；14A/14B 新增为 36/37）
GROUP_IDS = {
    "MATH_BASIS": 1, "PHY_BASIS": 2, "CS_BASIS": 3, "ME_BASIS": 4,
    "COMP_BASIS": 5, "OR_STAT": 6, "MECH_BASIS": 7, "SHUYUAN_GE": 8, "SHIJIAN": 9,
}
GROUP_NAMES = {
    "MATH_BASIS": "数学基础", "PHY_BASIS": "物理基础", "CS_BASIS": "信智基础",
    "ME_BASIS": "机电基础", "COMP_BASIS": "计算基础（基础加强）",
    "OR_STAT": "运筹统计（基础加强）", "MECH_BASIS": "力学基础（基础加强）",
    "ADV_MATH": "工程数学进阶（基础加强）",
    "SHUYUAN_GE": "书院通识课", "SHIJIAN": "进阶式实践",
}
BASIS_REQUIRED = {"MATH_BASIS", "PHY_BASIS", "CS_BASIS", "ME_BASIS", "SHUYUAN_GE", "SHIJIAN"}


def parse_plan(year: str, base_courses: dict) -> dict:
    """解析培养方案 → {courses, group_courses, choice_sets, choice_set_courses, modules, warnings}"""
    d = json.loads((EXTRACTED / f"{year}_plan.json").read_text(encoding="utf-8"))
    # 「新开课」行显式映射：(课组code, 课程名) → 课号
    new_rows = {(g, n): cid for (y, g, n), cid in SCHEME_NEW_ROWS.items() if y == year}
    blocks, tables = d["blocks"], d["tables"]

    courses: dict[str, dict] = {}
    group_courses: dict[str, list[str]] = {}
    choice_sets: list[dict] = []
    choice_set_courses: list[dict] = []
    warnings: list[str] = []
    modules_found: dict[int, str] = {}
    groups_found: list[tuple[str, int | None, str]] = []  # (code, module_id, name)

    cur_module: int | None = None
    cur_group: str | None = None
    cur_set: dict | None = None  # 进行中的选课组 {"name":..., "ids": [...]}
    skipping = False  # 校级通识选修课节：整节跳过（现网不维护该清单）

    def flush_set():
        nonlocal cur_set
        if cur_set and len(cur_set["ids"]) >= 2:
            choice_sets.append({"group": cur_set.get("group"), "name": cur_set["name"],
                                "min_select": 1, "max_select": 1, "course_ids": cur_set["ids"]})
        cur_set = None

    for b in blocks:
        if b["type"] == "p":
            text = b["text"]
            if RE_FLYING.search(text):
                break  # 飞行学员班专用方案：不属于本工具范围，停止解析
            if RE_SKIP.search(text) or RE_SKIP2.search(text):
                skipping = True
                flush_set()
                cur_module, cur_group = None, None
                continue
            if skipping and RE_SECTION.match(text):
                skipping = False  # 到达下一小节，结束跳过
            if skipping:
                continue
            m = RE_MODULE.search(text)
            if m:
                flush_set()
                cur_module = int(m.group(1))
                modules_found[cur_module] = m.group(2).strip()
                cur_group = None
                continue
            m = RE_COURSE_GROUP.search(text)
            if m:
                flush_set()
                num, ab = int(m.group(1)), m.group(2)
                cur_module = num
                cur_group = f"{num}{ab}"
                groups_found.append((cur_group, num, f"模块{num} 课组{num}{ab}"))
                continue
            matched = False
            for pat, code in GROUP_HEADS:
                if pat.search(text) and re.match(r"^[（(]\d+[)）]", text):
                    flush_set()
                    cur_module, cur_group = None, code
                    groups_found.append((code, None, GROUP_NAMES[code]))
                    matched = True
                    break
            if matched:
                continue
            if RE_PRACTICE.search(text) and re.match(r"^[（(]?\d", text):
                flush_set()
                cur_module, cur_group = None, "SHIJIAN"
                groups_found.append(("SHIJIAN", None, GROUP_NAMES["SHIJIAN"]))
                continue
            # 其他说明性段落：打断选课组收集
            if not text.startswith("注") and cur_set and not RE_CHOICE.search(text):
                pass
            continue

        # 表格 → 课程行
        if b["type"] != "table":
            continue
        if skipping:
            continue
        tb = tables[b["index"]]
        if cur_group is None and cur_module is None:
            # 通识等无归属表格：仍收课程（继承属性），但不进 group_courses
            pass
        for row in tb["rows"]:
            if not row:
                continue
            first = row[0].strip()
            name = row[1].strip() if len(row) > 1 else ""
            # 「新开课」行：经显式映射取得课号后按正常课程行处理；无映射则告警跳过
            resolved_new = False
            if first == "新开课" and cur_group:
                hit = new_rows.get((cur_group, name))
                if not hit:
                    warnings.append(f"培养方案[{cur_group}]「{name}」为新开课且无映射，未收录")
                    if cur_set and not any(RE_CHOICE.search(c) for c in row if isinstance(c, str)):
                        flush_set()
                    continue
                first = hit
                resolved_new = True  # 映射课号可能为 NEW 占位（非纯数字），放行后续课程行逻辑
            if not resolved_new and not RE_COURSE_ID.match(first):
                # 表头/说明行 → 打断进行中的选课组
                if cur_set and not any(RE_CHOICE.search(c) for c in row if isinstance(c, str)):
                    flush_set()
                continue
            cid = first
            credits_raw = row[2].strip() if len(row) > 2 else ""
            note = row[3].strip() if len(row) > 3 else ""
            mc = RE_CREDITS.search(credits_raw)
            credits = float(mc.group(1) or mc.group(2)) if mc else None
            if credits is not None and credits == int(credits):
                credits = int(credits)

            base = base_courses.get(cid)
            module_cls = MODULE_CLASS.get(cur_module) if cur_module else None
            attr = base["course_attr"] if base else ("required" if cur_group in BASIS_REQUIRED else "restricted")
            course = {
                "course_id": cid,
                "name": name or (base["name"] if base else ""),
                "credits": credits if credits is not None else (base["credits"] if base else 0),
                "module_type": module_cls if module_cls else (base["module_type"] if base else None),
                "original_class": module_cls if module_cls else (base["original_class"] if base else None),
                "course_attr": attr,
            }
            if base and base["course_attr"] == "prof_required":
                course["course_attr"] = "prof_required"
                if base.get("prof_note"):
                    course["prof_note"] = base["prof_note"]
            courses[cid] = course

            if cur_group:
                group_courses.setdefault(cur_group, [])
                if cid not in group_courses[cur_group]:
                    group_courses[cur_group].append(cid)

            # 选课组：备注「N选一」开启（成员数封顶 N），收集后续无备注行
            cm = RE_CHOICE.search(note)
            if cm:
                flush_set()
                cur_set = {"name": f"{cm.group(1)}选一", "ids": [cid], "group": cur_group,
                           "cap": CHOICE_CAP.get(cm.group(1), 99)}
            elif cur_set and not note and len(cur_set["ids"]) < cur_set["cap"]:
                cur_set["ids"].append(cid)
            else:
                flush_set()
        flush_set()

    flush_set()
    return {"courses": courses, "group_courses": group_courses, "choice_sets": choice_sets,
            "choice_set_courses": choice_set_courses, "modules_found": modules_found,
            "groups_found": groups_found, "warnings": warnings}


def parse_teaching(year: str) -> list[dict]:
    """解析教学计划 → semester_courses（学期开课）。"""
    d = json.loads((EXTRACTED / f"{year}_teaching.json").read_text(encoding="utf-8"))
    blocks, tables = d["blocks"], d["tables"]
    result: list[dict] = []
    cn_year, season = None, None
    for b in blocks:
        if b["type"] == "p":
            if RE_FLYING.search(b["text"]):
                break  # 飞行学员班专用教学计划：不属于本工具范围
            my = RE_TERM_HEAD.search(b["text"])
            if my:
                cn_year = CN_YEAR[my.group(1)]
                continue
            ms = RE_SEASON.search(b["text"])
            if ms:
                season = ms.group(1)
                continue
        elif b["type"] == "table":
            sem = None
            if cn_year is None:
                sem = "大一·开学前（军训）"
            elif season:
                sem = f"大{['一','二','三','四'][cn_year-1]}·{'秋' if season=='秋季' else '春' if season=='春季' else '夏'}季"
            if not sem:
                continue
            for row in tables[b["index"]]["rows"]:
                if not row:
                    continue
                first = row[0].strip()
                name = row[1].strip() if len(row) > 1 else ""
                if not (RE_COURSE_ID.match(first) or first == "新开课"):
                    continue  # 表头（课程编号）、「专业交叉模块」等说明行
                result.append({"semester": sem, "course_id": first, "course_name": name})
    return result


def merge_teaching_courses(parsed: dict, sems: list[dict], base_courses: dict, year: str) -> list[str]:
    """教学计划中出现而培养方案未列的课程（体育/英语/军事/新开课等）补进 courses。
    「新开课」按课程名匹配现网 NEW 占位 ID；匹配不到的跳过并告警。"""
    warns: list[str] = []
    # 新开课按课程名匹配：优先本版本培养方案解析结果（SCHEME_NEW_ROWS 已定课号，
    # 如 2025 固体力学基础→20310654），再退回 2024 基准（NEW 占位优先；如「科研科创实践」→NEW017）
    parsed_by_name = {c["name"]: cid for cid, c in parsed["courses"].items()}
    new_by_name = {c["name"]: cid for cid, c in base_courses.items() if cid.startswith("NEW")}
    any_by_name = {c["name"]: cid for cid, c in base_courses.items()}
    for r in sems:
        cid, name = r["course_id"], r["course_name"]
        if not cid or cid == "课程编号" or (not name and not RE_COURSE_ID.match(cid or "")):
            continue
        if not RE_COURSE_ID.match(cid):
            hit = parsed_by_name.get(name) or new_by_name.get(name) or any_by_name.get(name)
            if hit:
                r["course_id"] = cid = hit
            elif name in NEW_EXTRA:
                # 确认收录的教学计划新开课：分配占位 ID 进数据（2026-11-14 用户确认「计算力学导论」）
                pid, cr = NEW_EXTRA[name]
                r["course_id"] = cid = pid
                if cid not in parsed["courses"]:
                    parsed["courses"][cid] = {
                        "course_id": cid, "name": name, "credits": cr,
                        "module_type": None, "original_class": None, "course_attr": "restricted",
                    }
            else:
                warns.append(f"{year} 教学计划「{name}」为新开课且无对应编号，未收录")
                r["course_id"] = ""
                continue
        if cid not in parsed["courses"]:
            base = base_courses.get(cid)
            parsed["courses"][cid] = {
                "course_id": cid,
                "name": name or (base["name"] if base else ""),
                "credits": base["credits"] if base else 0,
                "module_type": base["module_type"] if base else None,
                "original_class": base["original_class"] if base else None,
                "course_attr": base["course_attr"] if base else "restricted",
            }
    return warns


def remap_new_ids(base: dict) -> dict:
    """2024 基准数据中 NEW 占位课重编号为真实课号（courses/group_courses/semester_courses/先修/学位要求全量替换）。"""
    import copy
    d = copy.deepcopy(base)
    def sub(cid: str) -> str:
        return NEW_REMAP.get(cid, cid)
    for c in d["courses"]:
        old = c["course_id"]
        c["course_id"] = sub(old)
        if old in NEW_REMAP and c["course_id"] in REMAP_RENAME:
            c["name"] = REMAP_RENAME[c["course_id"]]
    for g in d["group_courses"]:
        g["course_ids"] = [sub(i) for i in g["course_ids"]]
    for sc in d["semester_courses"]:
        sc["course_id"] = sub(sc["course_id"])
    for cs in d["choice_set_courses"]:
        cs["course_id"] = sub(cs["course_id"])
    for p in d["course_prerequisites"]:
        p["course_id"] = sub(p["course_id"])
        p["prereq_course_id"] = sub(p["prereq_course_id"])
    for c in d["degree_course_requirements"]:
        c["course_id"] = sub(c["course_id"])
    return d


def build_version(year: str, parsed: dict, base: dict, sems: list[dict]) -> dict:
    """按现网 schema 组装目标版本数据；框架类字段继承 2024 并过滤失效项。"""
    courses = list(parsed["courses"].values())
    course_ids = {c["course_id"] for c in courses}

    # course_groups：9 固定组（1-9，与 2024 一致）+ 模块 A/B（10-35）+ 14A/14B/ADV_MATH 追加
    groups = []
    gid = 0
    code_to_gid = {}
    fixed_order = ["MATH_BASIS", "PHY_BASIS", "CS_BASIS", "ME_BASIS", "COMP_BASIS", "OR_STAT",
                   "MECH_BASIS", "SHUYUAN_GE", "SHIJIAN"]
    for code in fixed_order:
        gid += 1
        code_to_gid[code] = gid
        groups.append({"group_id": gid, "module_id": None, "group_code": code, "name": GROUP_NAMES[code]})
    for num, name in sorted(parsed["modules_found"].items()):
        for ab in "AB":
            code = f"{num}{ab}"
            if code not in parsed["group_courses"]:
                continue
            gid += 1
            code_to_gid[code] = gid
            groups.append({"group_id": gid, "module_id": num, "group_code": code, "name": f"模块{num} 课组{num}{ab}"})
    if "ADV_MATH" in parsed["group_courses"]:
        gid += 1
        code_to_gid["ADV_MATH"] = gid
        groups.append({"group_id": gid, "module_id": None, "group_code": "ADV_MATH", "name": GROUP_NAMES["ADV_MATH"]})

    group_courses = []
    for code, ids in parsed["group_courses"].items():
        g = code_to_gid.get(code)
        if g:
            group_courses.append({"group_id": g, "course_ids": [i for i in ids if i in course_ids]})

    # 模块名忠于本版本 Word（modules_found 为 Word 解析名；如模块11 三版均改「人因与人本智能」）
    modules = []
    for m in base["modules"]:
        if m["module_id"] in parsed["modules_found"]:
            wn = parsed["modules_found"][m["module_id"]]
            modules.append({"module_id": m["module_id"], "name": wn or m["name"], "description": None})
    modules.append({"module_id": 14, "name": "自定义", "description": None})

    # 选课组：解析出的三/二选一（排除固定组，与 2024 同构：挂到对应课组）
    choice_sets, choice_set_courses = [], []
    set_id = 0
    for cs in parsed["choice_sets"]:
        # 主课组：优先用解析时记录的课组（拓扑学等同现于 4A/7B，按成员猜会挂错组）
        host = code_to_gid.get(cs.get("group")) if cs.get("group") else None
        if not host:
            for gc in group_courses:
                if cs["course_ids"][0] in gc["course_ids"]:
                    host = gc["group_id"]
                    break
        set_id += 1
        choice_sets.append({"set_id": set_id, "group_id": host, "name": cs["name"], "min_select": 1, "max_select": 1})
        for cid in cs["course_ids"]:
            choice_set_courses.append({"set_id": set_id, "course_id": cid})

    # 继承框架：先修/学位轨道/学位要求，过滤目标版本不存在的课程
    # degree_group_requirements 的 group_id 需经「2024 group_id → group_code → 新 group_id」映射
    base_gid_code = {g["group_id"]: g["group_code"] for g in base["course_groups"]}
    prereq = [p for p in base["course_prerequisites"]
              if p["course_id"] in course_ids and p["prereq_course_id"] in course_ids]
    tracks = [dict(t) for t in base["degree_tracks"]]
    dgr = []
    for g in base["degree_group_requirements"]:
        code = base_gid_code.get(g["group_id"])
        new_gid = code_to_gid.get(code)
        if new_gid and (code is None or not parsed["group_courses"].get(code) or g["group_id"] >= 10):
            dgr.append({**g, "group_id": new_gid})
    dcr = [dict(c) for c in base["degree_course_requirements"] if c["course_id"] in course_ids]

    # 二外课程（FOREIGN_1-4）：课程目录专用特殊课程，全版本保留（不在任何课组）
    base_all = {c["course_id"]: c for c in base["courses"]}
    for cid in FOREIGN_IDS:
        if cid not in course_ids and cid in base_all:
            courses.append(dict(base_all[cid]))
            course_ids.add(cid)

    # NEW022 试验设计与数据分析（11A 新开课）：Word 备注必修，与人因工程同口径
    for c in courses:
        if c["course_id"] == "NEW022":
            c["course_attr"] = "prof_required"
            c["prof_note"] = "工业工程专业必修（11A）"

    return {
        "courses": courses,
        "modules": modules,
        "course_groups": groups,
        "semester_courses": sems,
        "choice_sets": choice_sets,
        "choice_set_courses": choice_set_courses,
        "degree_tracks": tracks,
        "degree_group_requirements": dgr,
        "degree_course_requirements": dcr,
        "course_prerequisites": prereq,
        "group_courses": group_courses,
    }


def apply_2024_adjustments(d: dict) -> dict:
    """2024 版专调（ADJUST_2024，2026-11-14 用户逐项确认）：
    删停开课 + 撤销只剩一门的选择组 + 换课号（含学分变化）。"""
    # 1. 删 30160023 运筹学（1）：courses/学期/课组/选择组/先修/学位要求全量移除
    removed = set(ADJUST_2024["remove_courses"])
    d["courses"] = [c for c in d["courses"] if c["course_id"] not in removed]
    d["semester_courses"] = [s for s in d["semester_courses"] if s["course_id"] not in removed]
    for g in d["group_courses"]:
        g["course_ids"] = [i for i in g["course_ids"] if i not in removed]
    d["course_prerequisites"] = [p for p in d["course_prerequisites"]
                                 if p["course_id"] not in removed and p["prereq_course_id"] not in removed]
    d["degree_course_requirements"] = [c for c in d["degree_course_requirements"]
                                       if c["course_id"] not in removed]
    # 2. 撤销「运筹学二选一」等只剩不足两门的指定选择组，choice_set 重排
    gone_sets = set(ADJUST_2024["remove_choice_sets"])
    kept_sets = [cs for cs in d["choice_sets"] if cs["name"] not in gone_sets]
    old_ids = {cs["set_id"] for cs in d["choice_sets"]} - {cs["set_id"] for cs in kept_sets}
    d["choice_sets"] = kept_sets
    d["choice_set_courses"] = [c for c in d["choice_set_courses"] if c["set_id"] not in old_ids]
    # set_id 连续重排（choice_set_courses 同步映射）
    id_map = {}
    for new_id, cs in enumerate(d["choice_sets"], 1):
        id_map[cs["set_id"]] = new_id
        cs["set_id"] = new_id
    for c in d["choice_set_courses"]:
        c["set_id"] = id_map[c["set_id"]]
    # 3. 换课号/学分校准：全量替换（new=None 表示仅改学分）
    for old, (new, credits) in ADJUST_2024["replace_courses"].items():
        for c in d["courses"]:
            if c["course_id"] == old:
                if new:
                    c["course_id"] = new
                c["credits"] = credits
        if new:
            for g in d["group_courses"]:
                g["course_ids"] = [new if i == old else i for i in g["course_ids"]]
            for s in d["semester_courses"]:
                if s["course_id"] == old:
                    s["course_id"] = new
            for cs in d["choice_set_courses"]:
                if cs["course_id"] == old:
                    cs["course_id"] = new
            for p in d["course_prerequisites"]:
                if p["course_id"] == old:
                    p["course_id"] = new
                if p["prereq_course_id"] == old:
                    p["prereq_course_id"] = new
            for c in d["degree_course_requirements"]:
                if c["course_id"] == old:
                    c["course_id"] = new
    # 4. 开课学期校准
    for cid, (old_sem, new_sem) in ADJUST_2024.get("replace_semesters", {}).items():
        for s in d["semester_courses"]:
            if s["course_id"] == cid and s["semester"] == old_sem:
                s["semester"] = new_sem
    return d


def collect_2024_word_courses(d: dict, p24: dict, sems24: list[dict]) -> list[str]:
    """收编 2024 Word 有而现网没有的课程（2026-11-14 用户确认：8 门全收进 2024 版）。
    课程定义/课组取自 2024 Word 培养方案解析，学期取自 2024 Word 教学计划解析；
    Word 解析组名（如 "1B"/"10B"）经现网 course_groups 的 group_code 映射到 group_id。"""
    added: list[str] = []
    base_ids = {c["course_id"] for c in d["courses"]}
    gc_map = {g["group_code"]: g["group_id"] for g in d["course_groups"]}
    for cid, c in p24["courses"].items():
        if cid in base_ids:
            continue
        d["courses"].append(dict(c))
        added.append(cid)
        for s in sems24:
            if s["course_id"] == cid:
                d["semester_courses"].append(dict(s))
        for gname, ids in p24["group_courses"].items():
            if cid in ids:
                gid = gc_map.get(gname)
                if gid:
                    for g in d["group_courses"]:
                        if g["group_id"] == gid and cid not in g["course_ids"]:
                            g["course_ids"].append(cid)
                            break
    return added


def main() -> None:
    raw = json.loads(SRC_DATA.read_text(encoding="utf-8"))
    # 2024 基准：先做 NEW 占位课重编号（最新 Word 已给出真实课号的 13 门）
    base = remap_new_ids(raw)

    # 2024 Word 解析（供收编缺失课与校对报告复用）
    p24 = parse_plan("2024", {c["course_id"]: c for c in base["courses"]})
    sems24 = parse_teaching("2024")
    all_warns: list[str] = merge_teaching_courses(
        p24, sems24, {c["course_id"]: c for c in base["courses"]}, "2024")

    # 2024：重编号 + 用户确认的专调（删运筹(1)/撤二选一组/流体力学换号/学分学期校准）
    base = apply_2024_adjustments(base)

    # 交叉工程（专业一+专业二）双学位轨道（2026-11-15 用户定稿；三版 Word 学位文字一致，此处统一注册）：
    # ① 专业一/专业二两模块须跨类（moduleCategory 不同）；② 主修模块 A 课组修完；
    # ③ 第二模块 A 课组已修 ≥9 学分；④ 两模块内全部已修课程合计 ≥21 学分（含 B 课组、去重）。
    # 达标判定与百分比权重（32/20/48）在 degreeEval.ts / ToolsPage.tsx 中实现，数据层仅登记轨道。
    if not any(t["track_code"] == "CED" for t in base["degree_tracks"]):
        base["degree_tracks"].append({
            "track_code": "CED",
            "name": "交叉工程（专业一+专业二）",
            "total_credits_required": 21,
            "description": "修完专业一任一模块的A课组，并从专业二各模块的A课组中选修不少于9学分的课程，"
                           "且专业一与专业二须跨类选择；两模块内全部修读课程合计不少于21学分"
                           "（含B课组课程，仅限两模块内的课程，重复课程学分不重复计）",
        })
        print("补建 CED 交叉工程双学位轨道")
    added24 = collect_2024_word_courses(base, p24, sems24)
    if added24:
        print(f"2024 收编 {len(added24)} 门 Word 独有课: {', '.join(added24)}")
    # 2024 补遗（2026-11-15 全课组复核发现，均为现网基准遗漏、Word 2024 有明确依据）：
    # ① 13B 课组补挂 需求与库存管理（40161053）——Word 2024 13B 有此行，现网基准只挂了 12A；
    # ② 补建 4A「四选一」选课组——Word 2024 拓扑学行备注「四选一」，现网基准未建组。
    _gmap24 = {g["group_code"]: g["group_id"] for g in base["course_groups"]}
    for g in base["group_courses"]:
        if g["group_id"] == _gmap24.get("13B") and "40161053" not in g["course_ids"]:
            g["course_ids"].append("40161053")
    _gid4a = _gmap24.get("4A")
    if _gid4a and not any(cs["group_id"] == _gid4a for cs in base["choice_sets"]):
        _sid = max(cs["set_id"] for cs in base["choice_sets"]) + 1
        base["choice_sets"].append({"set_id": _sid, "group_id": _gid4a, "name": "4A课组四选一",
                                    "min_select": 1, "max_select": 1})
        for _cid in ("30420364", "40420644", "30430203", "14920054"):
            base["choice_set_courses"].append({"set_id": _sid, "course_id": _cid})
    # 模块名忠于 Word 2024（如模块11「人因与智能交互」→「人因与人本智能」）
    for m_ in base["modules"]:
        wn = p24["modules_found"].get(m_["module_id"])
        if wn and wn != m_["name"]:
            print(f"2024 模块{m_['module_id']} 改名: {m_['name']} → {wn}")
            m_["name"] = wn
    base_courses = {c["course_id"]: c for c in base["courses"]}
    (OUT / "structured_data_2024.json").write_text(
        json.dumps(base, ensure_ascii=False, indent=1), encoding="utf-8")

    report: list[str] = ["# 培养方案三版本转换差异报告", "",
                         "> 生成方式：Word（20261008 修订版）解析 + 2024 现网数据基准继承。",
                         "> 标注「待核对」的条目需要人工确认后再定稿。", ""]

    versions = {}
    for year in ["2025", "2026"]:
        parsed = parse_plan(year, base_courses)
        sems = parse_teaching(year)
        all_warns += merge_teaching_courses(parsed, sems, base_courses, year)
        data = build_version(year, parsed, base, sems)
        # 1B「航空航天工程专业至少选一门」（飞行动力学与飞行控制 / 航天动力学与控制）
        # ——Word 三版 1B 均有此备注；2024 版继承现网基准已有组，2025/2026 解析不建组，此处补齐。
        _gmap = {g["group_code"]: g["group_id"] for g in data["course_groups"]}
        _gid1b = _gmap.get("1B")
        _ids1b = {"30310914", "30311054"}
        _have1b = {c["course_id"] for c in data["courses"]}
        if _gid1b and _ids1b <= _have1b and not any(
                cs["group_id"] == _gid1b and {sc["course_id"] for sc in data["choice_set_courses"]
                                              if sc["set_id"] == cs["set_id"]} == _ids1b
                for cs in data["choice_sets"]):
            _sid = max((cs["set_id"] for cs in data["choice_sets"]), default=0) + 1
            data["choice_sets"].append({"set_id": _sid, "group_id": _gid1b,
                                        "name": "飞行控制二选一", "min_select": 1, "max_select": 1})
            for _cid in sorted(_ids1b):
                data["choice_set_courses"].append({"set_id": _sid, "course_id": _cid})
            print(f"{year}: 补建 1B 飞行控制二选一组")
        versions[year] = data
        (OUT / f"structured_data_{year}.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{year}: courses={len(data['courses'])} groups={len(data['course_groups'])} "
              f"semesters={len({s['semester'] for s in sems})} choice_sets={len(data['choice_sets'])}")

    # ---------- 校对：2024 校准版 vs 2024 Word（p24/sems24/all_warns 复用上方解析结果） ----------
    word_ids = set(p24["courses"])
    base_ids = set(base_courses)
    missing_in_word = base_ids - word_ids  # 现网有、Word 没有
    new_in_word = word_ids - base_ids      # Word 有、现网没有（=20261008 修订新增）
    report += ["## 一、2024 版校对（现网数据 vs 最新 Word）", ""]
    report.append(f"- 现网 {len(base_ids)} 门；Word 解析 {len(word_ids)} 门。")
    if missing_in_word:
        report.append(f"- 现网有而 Word 没有（{len(missing_in_word)} 门，需确认是否已删除）：")
        for cid in sorted(missing_in_word):
            c = base_courses[cid]
            report.append(f"  - `{cid}` {c['name']}（{c['credits']}学分，{c['course_attr']}）")
    if new_in_word:
        report.append(f"- Word 有而现网没有（{len(new_in_word)} 门，需确认是否新增）：")
        for cid in sorted(new_in_word):
            c = p24["courses"][cid]
            report.append(f"  - `{cid}` {c['name']}（{c['credits']}学分）")
    # 学分/名称差异
    diffs = []
    for cid in base_ids & word_ids:
        b, w = base_courses[cid], p24["courses"][cid]
        if b["credits"] != w["credits"]:
            diffs.append(f"  - `{cid}` {b['name']}：现网 {b['credits']} 学分 → Word {w['credits']} 学分")
    if diffs:
        report.append("- 学分不一致（待核对）：")
        report.extend(diffs)
    report.append("")

    # ---------- 模块名称差异 ----------
    report += ["## 二、模块名称差异（2024 现网 vs 各 Word）", ""]
    for year, parsed in [("2025", parse_plan("2025", base_courses)), ("2026", parse_plan("2026", base_courses))]:
        for m in base["modules"]:
            wn = parsed["modules_found"].get(m["module_id"])
            if wn and wn != m["name"]:
                report.append(f"- 模块{m['module_id']}：现网「{m['name']}」→ {year}「{wn}」")
    report.append("")

    # ---------- 三版本课程差异 ----------
    all_years = {"2024": base_courses, "2025": {c["course_id"]: c for c in versions["2025"]["courses"]},
                 "2026": {c["course_id"]: c for c in versions["2026"]["courses"]}}
    report += ["## 三、三版本课程集合差异", ""]
    ids = set(all_years["2024"]) | set(all_years["2025"]) | set(all_years["2026"])
    only24 = sorted(set(all_years["2024"]) - set(all_years["2025"]) - set(all_years["2026"]))
    only25 = sorted(set(all_years["2025"]) - set(all_years["2024"]) - set(all_years["2026"]))
    only26 = sorted(set(all_years["2026"]) - set(all_years["2024"]) - set(all_years["2025"]))
    report.append(f"- 仅 2024 有（{len(only24)} 门）：" + ("、" .join(f"{i}{all_years['2024'][i]['name']}" for i in only24) if only24 else "无"))
    report.append(f"- 仅 2025 有（{len(only25)} 门）：" + ("、".join(f"{i}{all_years['2025'][i]['name']}" for i in only25) if only25 else "无"))
    report.append(f"- 仅 2026 有（{len(only26)} 门）：" + ("、".join(f"{i}{all_years['2026'][i]['name']}" for i in only26) if only26 else "无"))
    report.append("")
    # 学分差异矩阵
    report += ["## 四、跨版本学分不一致（待核对）", ""]
    for cid in sorted(ids):
        vals = {y: (all_years[y][cid]["credits"] if cid in all_years[y] else None) for y in all_years}
        if len({json.dumps(v) for v in vals.values()}) > 1:
            names = [all_years[y][cid]["name"] for y in all_years if cid in all_years[y]]
            report.append(f"- `{cid}` {names[0]}：2024={vals['2024']} / 2025={vals['2025']} / 2026={vals['2026']}")
    report.append("")

    # ---------- 新开课告警 ----------
    if all_warns:
        report += ["## 五、新开课/未收录告警（待人工处理）", ""]
        report += [f"- {w}" for w in all_warns]
        report.append("")

    (OUT / "diff_report.md").write_text("\n".join(report), encoding="utf-8")
    print("diff_report.md 已生成")


if __name__ == "__main__":
    main()
