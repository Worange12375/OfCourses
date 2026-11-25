# -*- coding: utf-8 -*-
"""只读：完整输出关键差异段落的 Word 原文（培养方案三版），供人工对照。"""
import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
KEYS = ["交叉", "航空航天工程：", "工程力学：", "能源与动力工程：", "工业工程：", "软件工程：",
        "模块11", "培养总学分", "科学基础", "基础加强", "课组1A", "课组2A", "课组3A", "课组6A"]

for year in ("2024", "2025", "2026"):
    data = json.loads((BASE / "extracted" / f"{year}_plan.json").read_text(encoding="utf-8"))
    print(f"\n{'=' * 72}\n【{year} 培养方案 Word 段落】")
    for p in data["paragraphs"]:
        if any(k in p for k in KEYS):
            print("-" + p)
