# -*- coding: utf-8 -*-
"""
只读比对：现网旧版 md（src/assets/doc/培养方案.md / 教学计划.md）
vs 2024/2025/2026 Word 原始提取（extracted/*_plan.json / *_teaching.json）。

目的：找出 Word 原文有、而现网 md 没有的内容（段落 + 表格行），排查流水线丢失。
不做任何写入。
"""
import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
DOC = BASE.parent.parent / "src" / "assets" / "doc"

WS = re.compile(r"\s+")


def norm(s: str) -> str:
    # 去全部空白与 md 强调符，保留实质文字
    s = WS.sub("", s)
    return s.replace("**", "").replace("*", "").replace("`", "")


def load_md_haystack(path: Path) -> str:
    return norm(path.read_text(encoding="utf-8"))


def table_rows(data: dict):
    for t in data.get("tables", []):
        for r in t["rows"]:
            yield [c if isinstance(c, str) else "" for c in r]


def report(kind: str, doc_label: str, data: dict, hay: str, hay_label: str) -> None:
    print(f"\n{'=' * 70}\n[{doc_label}] vs {hay_label} —— Word 有、现网 md 无：")
    miss = []

    # 段落
    for p in data.get("paragraphs", []):
        n = norm(p)
        if n and n not in hay:
            miss.append(("段落", p))

    # 表格行：整行与「去掉空列后的行」都试
    for r in table_rows(data):
        joined = "|" + "|".join(r) + "|"
        n1 = norm(joined)
        trimmed = [c for c in r if c.strip()]
        n2 = norm("|" + "|".join(trimmed) + "|") if len(trimmed) != len(r) else n1
        if n1 not in hay and n2 not in hay:
            miss.append(("表格行", joined))

    if not miss:
        print("  （无缺失，Word 内容全部能在现网 md 中找到）")
    else:
        print(f"  共 {len(miss)} 条缺失：")
        for typ, text in miss:
            disp = text if len(text) <= 120 else text[:120] + "…"
            print(f"  - [{typ}] {disp}")


def main() -> None:
    for year in ("2024", "2025", "2026"):
        live_plan = load_md_haystack(DOC / str(year) / "培养方案.md")
        live_teach = load_md_haystack(DOC / str(year) / "教学计划.md")
        plan = json.loads((BASE / "extracted" / f"{year}_plan.json").read_text(encoding="utf-8"))
        report("plan", f"{year} 培养方案 Word", plan, live_plan, f"converted/培养方案_{year}.md")
        teach = json.loads((BASE / "extracted" / f"{year}_teaching.json").read_text(encoding="utf-8"))
        report("teach", f"{year} 教学计划 Word", teach, live_teach, f"converted/教学计划_{year}.md")


if __name__ == "__main__":
    main()
