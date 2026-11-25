# -*- coding: utf-8 -*-
"""
只读分析：converted（Word 零缺失权威版）vs src/assets/doc/{year}（网站精修版）。
规范化后逐行比对，输出双向差异，供逐项判读「内容缺失」vs「格式重排」。
"""
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
SITE = BASE.parent.parent / "src" / "assets" / "doc"

WS = re.compile(r"\s+")


def norm_line(s: str) -> str:
    s = s.strip()
    # 去 markdown 标记与空白，保留实质文字
    s = re.sub(r"^#{1,6}\s*", "", s)
    s = s.replace("**", "").replace("*", "").replace("`", "")
    s = re.sub(r"^\d+[.、]\s*", "", s)  # 有序列表号
    s = WS.sub("", s)
    return s


def load_lines(path: Path):
    """返回 [(原始行, 规范化行), ...]，跳过空行与表格分隔行。"""
    out = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        t = raw.strip()
        if not t or re.match(r"^\|[\s\-|]+\|$", t):
            continue
        out.append((raw.rstrip(), norm_line(t)))
    return out


def diff_report(conv_path: Path, site_path: Path, label: str) -> None:
    conv = load_lines(conv_path)
    site = load_lines(site_path)
    conv_norms = [n for _, n in conv]
    site_norms = [n for _, n in site]

    print(f"\n{'=' * 74}\n{label}")
    print(f"converted 行数 {len(conv)}，网站版 行数 {len(site)}")

    def missing(a, b, tag):
        """a 中有而 b 中没有的行"""
        from collections import Counter
        cb = Counter(b)
        ca = Counter(a)
        return [(t, n) for t, n in a if ca[(t, n)] and n not in cb or (n not in cb)]

    # 简单多重集差
    from collections import Counter
    conv_c = Counter(conv_norms)
    site_c = Counter(site_norms)

    only_conv = []
    for raw, n in conv:
        if conv_c[n] > site_c.get(n, 0):
            only_conv.append((raw, n))
    only_site = []
    for raw, n in site:
        if site_c[n] > conv_c.get(n, 0):
            only_site.append((raw, n))

    print(f"\n--- converted 有、网站版无（{len(only_conv)} 行）——网站缺失/旧文字 ---")
    shown = 0
    for raw, n in only_conv:
        if shown >= 60:
            print(f"  …（还有 {len(only_conv) - shown} 行）")
            break
        disp = raw if len(raw) <= 110 else raw[:110] + "…"
        print(f"  L: {disp}")
        shown += 1

    print(f"\n--- 网站版有、converted 无（{len(only_site)} 行）——精修版独有/旧残留 ---")
    shown = 0
    for raw, n in only_site:
        if shown >= 60:
            print(f"  …（还有 {len(only_site) - shown} 行）")
            break
        disp = raw if len(raw) <= 110 else raw[:110] + "…"
        print(f"  S: {disp}")
        shown += 1


def main() -> None:
    for y in ("2024", "2025", "2026"):
        diff_report(BASE / "converted" / f"培养方案_{y}.md", SITE / y / "培养方案.md", f"【{y} 培养方案】converted vs 网站版")
        diff_report(BASE / "converted" / f"教学计划_{y}.md", SITE / y / "教学计划.md", f"【{y} 教学计划】converted vs 网站版")


if __name__ == "__main__":
    main()
