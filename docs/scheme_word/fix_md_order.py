# -*- coding: utf-8 -*-
"""修复网站版 md：① 表格行序按 Word 重排；② 多选一备注补到所有成员行（四字班风格）。
先备份原文件到 docs/scheme_word/backup_md/，再原地写回。
"""
import json
import re
import shutil
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent
SITE = BASE.parent.parent / "src" / "assets" / "doc"
BAK = BASE / "backup_md"
ID = re.compile(r"^\d{8}$|^NEW\d+$")
CHOICE_WORD = re.compile(r"[二三四五六]选一|至少选一门")


def table_blocks_md(text):
    """切分为 (普通行文本列表) + 表格块标记。返回 [段落行...] 的混合列表：
    ('t', [(first,name,raw), ...]) 或 ('l', raw)"""
    out, cur = [], []
    def flush():
        nonlocal cur
        if cur:
            out.append(("t", cur)); cur = []
    for raw in text.splitlines():
        t = raw.strip()
        if t.startswith("|"):
            if "---" in t or "课程编号" in t or "课程号" in t:
                continue
            cells = [c.strip() for c in t.strip("|").split("|")]
            first = cells[0] if cells else ""
            name = cells[1] if len(cells) > 1 else ""
            if ID.match(first) or first == "新开课":
                cur.append((first, name, raw))
                continue
        flush()
        out.append(("l", raw))
    flush()
    return out


def word_tables(path):
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    out = []
    for t in d["tables"]:
        rows = []
        for r in t["rows"]:
            first = r[0].strip() if r and isinstance(r[0], str) else ""
            name = r[1].strip() if len(r) > 1 and isinstance(r[1], str) else ""
            if ID.match(first) or first == "新开课":
                rows.append((first, name))
        if rows:
            out.append(rows)
    return out


def choice_members(year):
    """choice set 成员课号 → 组名关键词（二选一等）"""
    d = json.loads((BASE.parent.parent / "src" / "data" / f"structured_data_{year}.json").read_text(encoding="utf-8"))
    m = {}
    for cs in d["choice_sets"]:
        m1 = CHOICE_WORD.search(cs["name"])
        kw = m1.group(0) if m1 else ""
        for sc in d["choice_set_courses"]:
            if sc["set_id"] == cs["set_id"]:
                m.setdefault(sc["course_id"], set()).add(kw)
    return m


def reorder_block(wrows, block):
    """按 Word 行序重排 md 块行。返回 (新行列表, 变更说明)"""
    by_key = {}
    for row in block:
        by_key.setdefault((row[0], row[1]), []).append(row)
    used = set()
    new_rows, moved = [], 0
    for key in wrows:
        lst = by_key.get(key)
        if not lst:
            continue
        row = lst.pop(0)
        used.add(id(row))
        new_rows.append(row)
    # 剩余 md 独有行（人工备注/笔误替换行）：尽量按课号跟随；否则按名称跟随；再否则放末尾
    rest = [row for row in block if id(row) not in used]
    for row in rest:
        idx = next((i for i, k in enumerate(wrows) if k[0] == row[0]), None)
        if idx is None:
            idx = next((i for i, k in enumerate(wrows) if k[1] == row[1]), None)
        if idx is not None and idx < len(new_rows):
            new_rows.insert(min(idx + 1, len(new_rows)), row)
        else:
            new_rows.append(row)
    if [r[0] for r in new_rows] != [r[0] for r in block]:
        moved = 1
    return new_rows, moved


def process(year, fname, kindj):
    p = SITE / year / f"{fname}.md"
    text = p.read_text(encoding="utf-8")
    shutil.copy2(p, BAK / f"{year}_{fname}.md")
    wtabs = word_tables(BASE / "extracted" / f"{year}_{kindj}.json")
    wcs = [Counter((f, n) for f, n in t) for t in wtabs]
    blocks = table_blocks_md(text)
    cmem = choice_members(year)

    stats = {"reordered": 0, "annotated": 0}
    new_parts = []
    for typ, content in blocks:
        if typ != "t":
            new_parts.append(content)
            continue
        block = content
        cs = Counter((r[0], r[1]) for r in block)
        # 匹配 Word 表：同集合优先，否则最大交集
        wi = next((i for i, c in enumerate(wcs) if c == cs), None)
        if wi is None:
            best, bestn = None, 0
            for i, c in enumerate(wcs):
                n = len(set(c) & set(cs))
                if n > bestn:
                    best, bestn = i, n
            if best is not None and bestn >= max(2, len(block) // 2):
                wi = best
        if wi is not None:
            new_block, moved = reorder_block(wtabs[wi], block)
            if moved:
                stats["reordered"] += 1
            block = new_block
        # 多选一标注补全：成员行备注列无「选一」字样时补组名
        for i, (first, name, raw) in enumerate(block):
            kws = cmem.get(first)
            if not kws:
                continue
            kw = sorted(kws)[-1]
            if not kw or CHOICE_WORD.search(raw):
                continue
            cells = raw.strip("|").split("|")
            # 找最后一个备注列（最后一个非空右列或最后一列）追加
            for j in range(len(cells) - 1, 1, -1):
                c = cells[j].strip()
                if c:
                    cells[j] = f"{c}<br>{kw}" if "<br>" not in c else f"{c}{kw}"
                    break
            else:
                if len(cells) >= 2:
                    cells.append(kw)
            block[i] = (first, name, "| " + " | ".join(cells) + " |")
            stats["annotated"] += 1
        new_parts.extend(r[2] for r in block)
    p.write_text("\n".join(new_parts) + "\n", encoding="utf-8", newline="")
    print(f"{year} {fname}: 重排 {stats['reordered']} 表, 补标注 {stats['annotated']} 行")


BAK.mkdir(exist_ok=True)
for y in ("2024", "2025", "2026"):
    process(y, "教学计划", "teaching")
    process(y, "培养方案", "plan")
