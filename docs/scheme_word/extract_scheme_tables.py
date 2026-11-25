# -*- coding: utf-8 -*-
"""
培养方案 Word → 表格/段落中间 JSON 提取脚本。

输入：docs/scheme_word/{2024,2025,2026}/*.docx（培养方案 + 教学计划，共 6 份）
输出：docs/scheme_word/extracted/<年级>_<文档类型>.json
    {
      "file": 原文件名,
      "paragraphs": [非空段落文本...],           # 用于标题结构（一、二、三…与 1．2．小节）
      "tables": [ {"rows": [[单元格文本,...], ...], "n_rows": R, "n_cols": C}, ... ]
    }

说明：本脚本只做「结构无损提取」，不做语义解析（模块/课组归类由后续转换脚本负责）。
运行：python extract_scheme_tables.py
"""

import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

BASE = Path(__file__).resolve().parent
OUT = BASE / "extracted"
OUT.mkdir(exist_ok=True)

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def cell_text(tc: ET.Element) -> str:
    """单元格内所有段落文本拼接（段间空格），去掉多余空白。"""
    parts = []
    for p in tc.iter(f"{W_NS}p"):
        t = "".join(node.text or "" for node in p.iter(f"{W_NS}t"))
        if t.strip():
            parts.append(t.strip())
    return " ".join(parts)


def para_text(p: ET.Element) -> str:
    return "".join(node.text or "" for node in p.iter(f"{W_NS}t")).strip()


def extract(docx_path: Path) -> dict:
    with zipfile.ZipFile(docx_path) as z:
        xml = z.read("word/document.xml")
    root = ET.fromstring(xml)
    body = root.find(f"{W_NS}body")

    paragraphs: list[str] = []
    tables: list[dict] = []
    blocks: list[dict] = []  # 有序内容流（p/table 交错），供转换脚本定位「表格属于哪个小节」

    # 顶层遍历：段落归 paragraphs，表格按 w:tr 拆行
    for child in body:
        if child.tag == f"{W_NS}p":
            t = para_text(child)
            if t:
                paragraphs.append(t)
                blocks.append({"type": "p", "text": t})
        elif child.tag == f"{W_NS}tbl":
            rows = []
            for tr in child.findall(f"{W_NS}tr"):
                row = [cell_text(tc) for tc in tr.findall(f"{W_NS}tc")]
                rows.append(row)
            tables.append({"rows": rows, "n_rows": len(rows), "n_cols": max((len(r) for r in rows), default=0)})
            blocks.append({"type": "table", "index": len(tables) - 1})

    return {"file": docx_path.name, "paragraphs": paragraphs, "tables": tables, "blocks": blocks}


def main() -> None:
    for cohort_dir in sorted(BASE.iterdir()):
        if not cohort_dir.is_dir() or not cohort_dir.name.isdigit():
            continue
        for docx in sorted(cohort_dir.glob("*.docx")):
            kind = "plan" if "培养方案" in docx.name else "teaching"
            data = extract(docx)
            out = OUT / f"{cohort_dir.name}_{kind}.json"
            out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"{out.name}: 段落 {len(data['paragraphs'])}, 表格 {len(data['tables'])} "
                  f"(行数 {[t['n_rows'] for t in data['tables']]})")


if __name__ == "__main__":
    main()
