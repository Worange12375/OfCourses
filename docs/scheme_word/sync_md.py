# -*- coding: utf-8 -*-
"""比对人工 md 培养方案中的课组表格与 Word 解析结果，输出差异与替换文本。

用法：
    python sync_md.py diff2024   # 2024 人工 md vs 2024 Word
    python sync_md.py diff2025   # 2025 底稿 md vs 2025 Word
    python sync_md.py dump2024 1B 10B 13B   # 输出指定课组的 Word 版 md 表格
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MD = {
    "2024": HERE.parent.parent / "src" / "assets" / "doc" / "2024" / "培养方案.md",
    "2025": HERE.parent.parent / "src" / "assets" / "doc" / "2025" / "培养方案.md",
    "2026": HERE.parent.parent / "src" / "assets" / "doc" / "2026" / "培养方案.md",
}
RE_COURSE_ROW = re.compile(r"^\|\s*([0-9A-Z_]{5,12}|新开课)\s*\|")
RE_GROUP_HEAD = re.compile(r"^#{2,5}\s+[（(]?[ab][.）]?\s*课组(\d+)([AB])")
RE_MODULE_HEAD = re.compile(r"^#{2,6}\s*[（(]?(\d{1,2})[）)]?\s*模块(\d+)：(.+)$")
RE_FIXED_GROUP = re.compile(
    r"^#{3,4}\s*[（(]?\d+[）)]?\s*(数学基础|物理基础|信智基础|机电基础|计算基础|运筹统计|力学基础|工程数学进阶|书院通识课)")


def fixed_key(text: str):
    m = RE_FIXED_GROUP.search(text)
    return m.group(1) if m else None


def parse_md_groups(path: Path):
    """解析 md：返回 {group_code: [row_tuple]} 与 {module_no: title}。行元组=(编号,名称,学分,备注...)"""
    groups, modules = {}, {}
    cur = None
    for line in path.read_text(encoding="utf-8").splitlines():
        mh = RE_MODULE_HEAD.match(line)
        gh = RE_GROUP_HEAD.match(line)
        fk = fixed_key(line)
        if mh:
            modules[int(mh.group(2))] = mh.group(3).strip()
            cur = None
            continue
        if gh:
            cur = f"{gh.group(1)}{gh.group(2)}"
            groups.setdefault(cur, [])
            continue
        if fk:
            cur = fk
            groups.setdefault(cur, [])
            continue
        if line.startswith("#"):
            cur = None
        if cur and RE_COURSE_ROW.match(line):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            groups[cur].append(tuple(cells))
    return groups, modules


RE_FIXED_WORD = re.compile(
    r"^[（(]\d+[）)]\s*(数学基础|物理基础|信智基础|机电基础|计算基础|运筹统计|力学基础|工程数学进阶|书院通识课)")


def parse_word_groups(year: str):
    d = json.loads((HERE / "extracted" / f"{year}_plan.json").read_text(encoding="utf-8"))
    blocks, tables = d["blocks"], d["tables"]
    groups, modules = {}, {}
    cur = None
    for b in blocks:
        if b["type"] == "p":
            mm = re.search(r"模块(\d+)：(.+)", b["text"])
            if mm:
                modules[int(mm.group(1))] = mm.group(2).strip()
            mg = re.search(r"课组(\d+)([AB])", b["text"])
            fw = RE_FIXED_WORD.match(b["text"].strip())
            if mg:
                cur = f"{mg.group(1)}{mg.group(2)}"
            elif fw:
                cur = fw.group(1)
                groups.setdefault(cur, [])
            else:
                cur = None
        elif b["type"] == "table" and cur:
            rows = []
            for r in tables[b["index"]]["rows"]:
                if not r:
                    continue
                first = str(r[0]).strip()
                if re.match(r"^[0-9A-Z_]{5,12}$", first) or first == "新开课":
                    if first == "课程编号":
                        continue
                    cells = [str(c).strip() for c in r]
                    while len(cells) < 4:
                        cells.append("")
                    rows.append(tuple(cells[:4] + (cells[4:] if len(cells) > 4 else [])))
            if rows:
                groups.setdefault(cur, []).extend(rows)
            cur = None if not cur else cur
    return groups, modules


def norm(cell: str) -> str:
    """归一化单元格用于比对：统一学分写法等。"""
    c = cell.strip()
    c = re.sub(r"\s+", "", c)
    m = re.match(r"^(\d+(?:\.\d+)?)学分$", c)
    if m:
        v = float(m.group(1))
        c = str(int(v)) if v == int(v) else str(v)
    return c


def row_eq(a, b):
    n = max(len(a), len(b))
    return all(norm(a[i] if i < len(a) else "") == norm(b[i] if i < len(b) else "") for i in range(n))


def fmt_rows(rows):
    out = ["| 课程编号 | 课程名称 | 学分 | 备注 |", "| --- | --- | --- | --- |"]
    for r in rows:
        cells = [str(c) for c in r[:4]]
        extra = r[4:]
        if extra:
            out.append("| " + " | ".join(cells + list(extra)) + " |")
        else:
            out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)


def diff_year(year: str):
    md_groups, md_modules = parse_md_groups(MD[year])
    w_groups, w_modules = parse_word_groups(year)
    print(f"===== {year}：md 课组 {len(md_groups)} 个 / Word 课组 {len(w_groups)} 个 =====")
    print("-- 模块名差异 --")
    for no, wn in sorted(w_modules.items()):
        mn = md_modules.get(no)
        if mn and mn != wn:
            print(f"  模块{no}: md「{mn}」→ Word「{wn}」")
        elif mn is None:
            print(f"  模块{no}: md 无标题, Word「{wn}」")
    print("-- 课组差异（md→Word）--")
    for code in sorted(set(md_groups) | set(w_groups), key=lambda x: (int(re.match(r"\d+", x).group()) if re.match(r"\d+", x) else 99, x)):
        mrows = md_groups.get(code, [])
        wrows = w_groups.get(code, [])
        # Word 多个表格合并后可能有重复行（同课在组内多课组列出属正常；组内去重保持顺序）
        seen, wd = set(), []
        for r in wrows:
            k = (r[0], r[1])
            if k not in seen:
                seen.add(k)
                wd.append(r)
        mset = {(r[0], r[1]): r for r in mrows}
        wset = {(r[0], r[1]): r for r in wd}
        only_md = [k for k in mset if k not in wset]
        only_w = [k for k in wset if k not in mset]
        changed = [k for k in mset if k in wset and not row_eq(mset[k], wset[k])]
        if only_md or only_w or changed:
            print(f"  [{code}] md {len(mrows)} 行 / Word {len(wd)} 行")
            for k in only_md:
                print(f"    - md 独有: {mset[k]}")
            for k in only_w:
                print(f"    + Word 独有: {wset[k]}")
            for k in changed:
                print(f"    * 不一致: md {mset[k]}  vs  Word {wset[k]}")


def dump_groups(year: str, codes):
    w_groups, _ = parse_word_groups(year)
    for code in codes:
        rows = w_groups.get(code)
        print(f"----- {code} -----")
        print(fmt_rows(rows) if rows else "(Word 中无此课组)")
        print()


def parse_md_teaching(path: Path):
    """解析教学计划 md → {semester: [row_tuple]}，semester 形如 大一·秋季。"""
    result = {}
    cn_map = {"一": "大一", "二": "大二", "三": "大三", "四": "大四"}
    season_map = {"秋": "秋季", "春": "春季", "夏": "夏季"}
    cn, season = None, None
    for line in path.read_text(encoding="utf-8").splitlines():
        t = line.strip()
        m = re.match(r"^第([一二三四])学年$", t)
        if m:
            cn = cn_map[m.group(1)]
            continue
        ms = re.match(r"^(秋季|春季|夏季)学期$", t)
        if ms:
            season = season_map[ms.group(1)[0]]
            continue
        if t.startswith("End") or re.match(r"^笃实书院$", t):
            continue
        if cn and season and RE_COURSE_ROW.match(line) and "建议修读学分" not in line:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            result.setdefault(f"{cn}·{season}", []).append(tuple(cells))
    return result


def parse_word_teaching(year: str):
    d = json.loads((HERE / "extracted" / f"{year}_teaching.json").read_text(encoding="utf-8"))
    blocks, tables = d["blocks"], d["tables"]
    result = {}
    cn_year, season = None, None
    cn_map = {1: "大一", 2: "大二", 3: "大三", 4: "大四"}
    for b in blocks:
        if b["type"] == "p":
            if "飞行学员班" in b["text"]:
                break  # 飞行学员班专用教学计划：不属于比对范围
            my = re.search(r"第([一二三四])学年", b["text"])
            if my:
                cn_year = cn_map[{"一": 1, "二": 2, "三": 3, "四": 4}[my.group(1)]]
            ms = re.search(r"(秋季|春季|夏季)学期", b["text"])
            if ms:
                season = ms.group(1)
        elif b["type"] == "table" and cn_year and season:
            for r in tables[b["index"]]["rows"]:
                if not r:
                    continue
                first = str(r[0]).strip()
                name = str(r[1]).strip() if len(r) > 1 else ""
                if first in ("课程编号", "") or "建议修读" in name:
                    continue
                if re.match(r"^[0-9A-Z_]{5,12}$", first) or first == "新开课":
                    cells = [str(c).strip() for c in r]
                    while len(cells) < 4:
                        cells.append("")
                    result.setdefault(f"{cn_year}·{season}", []).append(tuple(cells))
    return result


def difft_year(year: str):
    md_t = parse_md_teaching(HERE.parent.parent / "src" / "assets" / "doc" / year / "教学计划.md")
    w_t = parse_word_teaching(year)
    print(f"===== {year} 教学计划：md 学期 {len(md_t)} / Word 学期 {len(w_t)} =====")
    for sem in sorted(set(md_t) | set(w_t)):
        mrows = md_t.get(sem, [])
        wrows = w_t.get(sem, [])
        mset = {(r[0], r[1]): r for r in mrows}
        wset = {(r[0], r[1]): r for r in wrows}
        only_md = [k for k in mset if k not in wset]
        only_w = [k for k in wset if k not in mset]
        changed = [k for k in mset if k in wset and not row_eq(mset[k], wset[k])]
        if only_md or only_w or changed:
            print(f"  [{sem}] md {len(mrows)} / Word {len(wrows)}")
            for k in only_md:
                print(f"    - md 独有: {mset[k]}")
            for k in only_w:
                print(f"    + Word 独有: {wset[k]}")
            for k in changed:
                print(f"    * 不一致: md {mset[k]}  vs  Word {wset[k]}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd.startswith("difft"):
        difft_year(cmd[5:])
    elif cmd.startswith("diff"):
        diff_year(cmd[4:])
    elif cmd == "dump":
        dump_groups(sys.argv[2], sys.argv[3:])
