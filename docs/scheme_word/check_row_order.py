# -*- coding: utf-8 -*-
"""只读：核对网站版 md 各表格的课程行序 vs Word 原始行序（extracted JSON）。
输出每版教学计划/培养方案中顺序不一致的课号序列段。
"""
import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
SITE = BASE.parent.parent / "src" / "assets" / "doc"
ID = re.compile(r"^\d{8}|^NEW\d+")

def word_seq(path_json):
    """Word 表格行序：所有含课号的行的课号序列（跳过表头/说明行）。"""
    d = json.loads(Path(path_json).read_text(encoding="utf-8"))
    seq = []
    for t in d["tables"]:
        for r in t["rows"]:
            first = r[0].strip() if r and isinstance(r[0], str) else ""
            name = r[1].strip() if len(r) > 1 and isinstance(r[1], str) else ""
            if ID.match(first) or first == "新开课":
                seq.append((first, name))
    return seq

def md_seq(path_md):
    out = []
    for line in Path(path_md).read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if not t.startswith("|") or "---" in t or "课程编号" in t or "课程号" in t:
            continue
        cells = [c.strip() for c in t.strip("|").split("|")]
        if not cells:
            continue
        first = cells[0]
        name = cells[1] if len(cells) > 1 else ""
        if ID.match(first) or first == "新开课":
            out.append((first, name))
    return out

def cmp(year, kind):
    kindj = "teaching" if kind == "teach" else "plan"
    w = word_seq(BASE / "extracted" / f"{year}_{kindj}.json")
    m = md_seq(SITE / year / f"{kind == 'plan' and '培养方案' or '教学计划'}.md")
    # 多重集差找顺序差异：对齐公共子序列（LCS 简化：逐个匹配 Word 序，看 md 中的相对位置）
    from collections import Counter
    cw, cm = Counter(w), Counter(m)
    if cw != cm:
        only_w = list((cw - cm).elements())
        only_m = list((cm - cw).elements())
        if only_w or only_m:
            print(f"[{year} {kind}] 行集合差异: Word独有{only_w[:6]} md独有{only_m[:6]}")
    # 顺序差异：公共行在两边的相对顺序
    common_w = [x for x in w if x in cm]
    common_m = [x for x in m if cw[x] > 0 for _ in [0]]
    # 逐行映射 md 中公共行出现序（按 Word 顺序找 md 索引是否递增）
    mw_index = {}
    for i, x in enumerate(m):
        mw_index.setdefault(x, []).append(i)
    pos = 0
    bad = []
    used = set()
    for x in common_w:
        idxs = [i for i in mw_index.get(x, []) if i >= pos and (x, i) not in used]
        if not idxs:
            bad.append(x)
            continue
        pos = idxs[0]
        used.add((x, idxs[0]))
    if bad:
        names = {c["course_id"]: c["name"] for c in json.loads((BASE.parent.parent / "src" / "data" / f"structured_data_{year}.json").read_text(encoding="utf-8"))["courses"]}
        print(f"[{year} {kind}] 顺序异常 {len(bad)} 行（在 md 中相对位置错乱）:")
        for x in bad[:15]:
            print("   ", x[0], names.get(x[0], x[1]))

for y in ("2024", "2025", "2026"):
    cmp(y, "teach")
    cmp(y, "plan")
