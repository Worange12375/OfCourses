# -*- coding: utf-8 -*-
"""只读：按表格块分段核对 md 行序 vs Word。对每个 Word 表在 md 中找同集合表格块，报告表内顺序差异。"""
import json
import re
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent
SITE = BASE.parent.parent / "src" / "assets" / "doc"
ID = re.compile(r"^\d{8}$|^NEW\d+$")


def table_blocks_md(path):
    """md 中连续 | 行为一个块，返回每块的 [(first, name), ...]"""
    blocks, cur = [], []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if t.startswith("|"):
            if "---" in t or "课程编号" in t or "课程号" in t or "建议修读" in t or "以下" in t:
                continue
            cells = [c.strip() for c in t.strip("|").split("|")]
            first = cells[0] if cells else ""
            name = cells[1] if len(cells) > 1 else ""
            if ID.match(first) or first == "新开课":
                cur.append((first, name))
        else:
            if cur:
                blocks.append(cur)
                cur = []
    if cur:
        blocks.append(cur)
    return blocks


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


def lcs_order_diff(a, b):
    """a,b 同多重集时，返回 b 相对 a 乱序的元素数（LCS 长度差）。"""
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m):
        for j in range(n):
            dp[i + 1][j + 1] = dp[i][j] + 1 if a[i] == b[j] else max(dp[i][j + 1], dp[i + 1][j])
    return n - dp[m][n]


def run(year, kind):
    kindj = "teaching" if kind == "teach" else "plan"
    fname = "培养方案" if kind == "plan" else "教学计划"
    wtabs = word_tables(BASE / "extracted" / f"{year}_{kindj}.json")
    mblocks = table_blocks_md(SITE / year / f"{fname}.md")
    mcs = [Counter(b) for b in mblocks]
    print(f"\n===== {year} {fname} =====")
    issues = 0
    for ti, wt in enumerate(wtabs):
        cwt = Counter(wt)
        # 找同集合 md 块
        hit = next((bi for bi, cm in enumerate(mcs) if cm == cwt), None)
        if hit is None:
            # 找部分重叠块
            best = max(range(len(mblocks)), key=lambda bi: len(set(mcs[bi]) & set(cwt)) if mcs[bi] else 0, default=None)
            inter = len(set(mblocks[best]) & set(wt)) if best is not None and mblocks[best] else 0
            if inter >= max(2, len(wt) // 2):
                diff = lcs_order_diff(wt, mblocks[best])
                w_only = list((cwt - mcs[best]).elements())
                m_only = list((mcs[best] - cwt).elements())
                if diff or w_only or m_only:
                    issues += 1
                    print(f"  Word表#{ti}({len(wt)}行) ↔ md块#{best}: 乱序{diff} Word独有{w_only[:4]} md独有{m_only[:4]}")
            else:
                issues += 1
                print(f"  Word表#{ti}({len(wt)}行): 未在 md 找到对应表格块 (首行 {wt[0] if wt else '-'})")
        else:
            diff = lcs_order_diff(wt, mblocks[hit])
            if diff:
                issues += 1
                print(f"  Word表#{ti} ↔ md块#{hit}: 同集合但顺序差异 {diff}/{len(wt)}")
                print(f"    Word: {[x[0] for x in wt]}")
                print(f"    md  : {[x[0] for x in mblocks[hit]]}")
    if not issues:
        print("  全部表格行序与 Word 一致")


for y in ("2024", "2025", "2026"):
    run(y, "teach")
    run(y, "plan")
