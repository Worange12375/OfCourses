# -*- coding: utf-8 -*-
"""只读诊断：对比站点 md 表格行与 Word 原文表格行，输出单元格级差异清单（不改任何文件）。
用法：python diff_md_vs_word.py 2025|2026|2024 [培养方案|教学计划]
"""
import re
import sys
from pathlib import Path

from docx import Document

ROOT = Path(__file__).resolve().parent
CONVERTED = ROOT / "converted"
SITE = ROOT.parent.parent / "src" / "assets" / "doc"


def table_rows_from_md(text: str):
    """提取 md 中所有表格数据行：[[c1,c2,...], ...]（保留顺序，剔除表头/分隔行）"""
    rows = []
    for line in text.splitlines():
        s = line.strip()
        if not (s.startswith("|") and s.endswith("|")):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):  # 分隔行
            continue
        joined = "".join(cells)
        if joined in ("课程编号课程名称学分备注", "课程编号课程名称学分备注学期"):
            continue
        rows.append(cells)
    return rows


def table_rows_from_docx(path: Path):
    d = Document(str(path))
    rows = []
    for tbl in d.tables:
        for r in tbl.rows:
            rows.append([c.text.strip().replace("\n", "<br>") for c in r.cells])
    return rows


def norm(cell: str) -> str:
    """归一化：全角空格/多空格 → 单空格，供比对"""
    return re.sub(r"[\s\u3000]+", " ", cell).strip()


def main():
    year = sys.argv[1] if len(sys.argv) > 1 else "2025"
    kind = sys.argv[2] if len(sys.argv) > 2 else "培养方案"
    kind2 = "教学计划" if kind == "教学计划" else "培养方案"

    md_path = SITE / year / f"{kind2}.md"
    docx_path = ROOT / year / f"{year}级{kind2}-笃实书院修订-20261008.docx"
    md_rows = table_rows_from_md(md_path.read_text(encoding="utf-8"))
    dx_rows = table_rows_from_docx(docx_path)

    print(f"[{year} {kind2}] md 行数={len(md_rows)}  word 行数={len(dx_rows)}")
    print("图例：md=站点文档行  word=原文行；<=> 完全一致\n")

    # 按 (课号, 课名) 建队列对齐：同一课可在多个课组出现，按出现次序一一配对
    from collections import defaultdict, deque
    md_q = defaultdict(deque)   # key -> deque[(idx, row)]
    for i, r in enumerate(md_rows):
        if len(r) >= 2 and r[0]:
            md_q[(norm(r[0]), norm(r[1]))].append((i, r))
    used = set()
    diff_count = 0
    matched = 0
    for wi, wrow in enumerate(dx_rows):
        if len(wrow) < 2:
            continue
        wkey = (norm(wrow[0]), norm(wrow[1]))
        if not wkey[0] or wkey[0] == "课程编号" or wkey[0] == "课程号":
            continue
        if not md_q.get(wkey):
            print(f"[!] word 第{wi+1}行在 md 中未找到: {wkey}")
            continue
        i, mrow_raw = md_q[wkey].popleft()
        used.add(i)
        matched += 1
        mrow = [norm(c) for c in mrow_raw]
        wnorm = [norm(c) for c in wrow]
        if mrow == wnorm:
            continue
        diff_count += 1
        print(f"--- 差异 {diff_count} (word#{wi+1}) {wkey[0]} {wkey[1]}")
        width = max(len(mrow), len(wnorm))
        for k in range(width):
            m = mrow[k] if k < len(mrow) else "<缺列>"
            w = wnorm[k] if k < len(wnorm) else "<缺列>"
            mark = "  " if m == w else "**"
            print(f"    {mark} col{k+1}  md={m!r:40}  word={w!r}")
    for i, r in enumerate(md_rows):
        if i not in used:
            print(f"[?] md 多出行（word 无对应键）: {[norm(c) for c in r]}")
    print(f"\n共 {diff_count} 行差异（匹配 {matched} 行）")


if __name__ == "__main__":
    main()
