# -*- coding: utf-8 -*-
"""
Word 提取 JSON → 培养方案/教学计划 Markdown 生成脚本（CurriculumPage 文档面板三版本适配）。

输入：extracted/{year}_{plan|teaching}.json（blocks 有序流）
输出：converted/培养方案_{year}.md、教学计划_{year}.md
说明：2024 版沿用现有人工整理的 src/assets/doc/培养方案.md（质量更高），本脚本只生成 2025/2026。
标题层级映射（对齐现有 培养方案.md 风格）：
  一、二、…       → ##
  1．2．…         → ###
  （1）（2）…     → ####
  1）2）… / a. b. → #####（加粗短语则用 **…**）
  其他正文段落    → ####（与现有版一致，正文段落用四级标题呈现）
表格 → 标准 md 表格（首个含「课程编号」或全空单元格较少的行作为表头）。

运行：python gen_scheme_md.py
"""

import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
EXTRACTED = BASE / "extracted"
OUT = BASE / "converted"

RE_H2 = re.compile(r"^[一二三四五六七八九十]+、")
RE_H3 = re.compile(r"^\d+．")
RE_H4 = re.compile(r"^[（(]\d+[)）]")
RE_H5a = re.compile(r"^\d+[）)]")
RE_H5b = re.compile(r"^[a-z]\.\s*")
RE_FLYING = re.compile(r"飞行学员班")
RE_COURSE_ROW = re.compile(r"^\d{5,9}$|^新开课$")


def md_escape(cell: str) -> str:
    return cell.replace("|", "\\|").replace("\n", " ").strip()


def table_to_md(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    n_cols = max(len(r) for r in rows)
    rows = [r + [""] * (n_cols - len(r)) for r in rows]
    # 表头：第一行（含「课程编号」或任意非空）——原样使用
    header = rows[0]
    lines = ["| " + " | ".join(md_escape(c) for c in header) + " |",
             "| " + " | ".join(["---"] * n_cols) + " |"]
    for r in rows[1:]:
        lines.append("| " + " | ".join(md_escape(c) for c in r) + " |")
    return "\n".join(lines) + "\n"


def para_to_md(text: str) -> str:
    if RE_H2.match(text):
        return f"## {text}"
    if RE_H3.match(text):
        return f"### {text}"
    if RE_H4.match(text):
        return f"#### {text}"
    if RE_H5a.match(text) or RE_H5b.match(text):
        return f"##### {text}"
    return f"#### {text}"


def gen(year: str, kind: str) -> None:
    d = json.loads((EXTRACTED / f"{year}_{kind}.json").read_text(encoding="utf-8"))
    blocks, tables = d["blocks"], d["tables"]
    out: list[str] = [f"# 笃实书院{year}级{'本科培养方案' if kind == 'plan' else '本科指导性教学计划'}", ""]
    for b in blocks:
        if b["type"] == "p":
            if RE_FLYING.search(b["text"]):
                break  # 飞行学员班专用方案不进文档
            out.append(para_to_md(b["text"]))
            out.append("")
        else:
            md = table_to_md(tables[b["index"]]["rows"])
            if md:
                out.append(md)
    name = "培养方案" if kind == "plan" else "教学计划"
    (OUT / f"{name}_{year}.md").write_text("\n".join(out), encoding="utf-8")
    print(f"{name}_{year}.md: {len(out)} 行")


if __name__ == "__main__":
    for year in ["2024", "2025", "2026"]:
        gen(year, "plan")
        gen(year, "teaching")
