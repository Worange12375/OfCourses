"""Paratera 探针：列出可用模型 + 验证 tools 参数透传（选强模型型号的依据）。

用法（服务器上，root）：
    python3 /opt/ofcourses-vote/probe_models.py
    PROBE_MODEL=GLM-4.6 python3 /opt/ofcourses-vote/probe_models.py   # 指定模型测 tools

key 读取顺序：ofcourses-vote 运行进程的真实环境（/proc/PID/environ，最可靠）
→ service 文件行内 Environment= → 常见 EnvironmentFile 位置。
只打印 key 来源与长度，绝不打印 key 本身。
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

BASE = "https://llmapi.paratera.com/v1"
SERVICE = "ofcourses-vote"


def get_key():
    # 1) 运行中进程的真实环境（systemd 无论用 Environment= 还是 EnvironmentFile= 注入，都会出现在这里）
    try:
        pid = subprocess.check_output(
            ["systemctl", "show", "-p", "MainPID", "--value", SERVICE], text=True
        ).strip()
        if pid and pid != "0":
            with open(f"/proc/{pid}/environ", "rb") as f:
                for line in f.read().split(b"\0"):
                    if line.startswith(b"PARATERA_API_KEY="):
                        return line.decode("utf-8", "replace").split("=", 1)[1].strip(), f"/proc/{pid}/environ（运行进程真实环境）"
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] 进程环境读取失败：{exc}")
    # 2) service 文件行内
    try:
        out = subprocess.check_output(
            ["grep", "-ohP", r"PARATERA_API_KEY=\K\S+", f"/etc/systemd/system/{SERVICE}.service"],
            text=True,
        ).strip()
        if out:
            return out, "service 文件行内 Environment="
    except Exception:
        pass
    # 3) 常见 EnvironmentFile 位置
    for path in (f"/opt/{SERVICE}/.env", f"/opt/{SERVICE}/vote.env", f"/etc/default/{SERVICE}"):
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    if line.startswith("PARATERA_API_KEY="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'"), path
    return "", "未找到"


def main() -> None:
    key, src = get_key()
    print(f"key 来源：{src}，长度：{len(key)}")
    if not key:
        print("!! 未找到 PARATERA_API_KEY，请检查 systemd 配置后重试")
        sys.exit(1)

    # —— 1) 可用模型清单 ——
    try:
        req = urllib.request.Request(BASE + "/models", headers={"Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
        ids = sorted(m.get("id", "") for m in data.get("data", []))
        print(f"\n=== 可用模型（{len(ids)} 个，按名称排序）===")
        for mid in ids:
            print(f"  - {mid}")
    except urllib.error.HTTPError as exc:
        print(f"models 调用失败：HTTP {exc.code} {exc.read().decode('utf-8', 'replace')[:200]}")
    except Exception as exc:  # noqa: BLE001
        print(f"models 调用失败：{exc}")

    # —— 2) tools 透传验证 ——
    model = os.environ.get("PROBE_MODEL") or "GLM-4.5-Flash"
    body = {
        "model": model,
        "messages": [{"role": "user", "content": "帮我搜索名字带计算机的课程"}],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "search_courses",
                    "description": "按关键词搜索课程",
                    "parameters": {
                        "type": "object",
                        "properties": {"query": {"type": "string", "description": "课程名称关键词"}},
                        "required": ["query"],
                    },
                },
            }
        ],
        "max_tokens": 512,
    }
    req2 = urllib.request.Request(
        BASE + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    print(f"\n=== tools 透传验证（model={model}）===")
    try:
        with urllib.request.urlopen(req2, timeout=90) as r:
            obj = json.loads(r.read().decode("utf-8", "replace"))
        msg = (obj.get("choices") or [{}])[0].get("message") or {}
        usage = obj.get("usage") or {}
        if msg.get("tool_calls"):
            print("√ 该模型支持 tools：返回了 tool_calls：")
            print(json.dumps(msg["tool_calls"], ensure_ascii=False, indent=2))
        else:
            print("× 该模型未发起 tool_calls，直接文本回答（前 200 字）：")
            print("  " + (msg.get("content") or "")[:200].replace("\n", " "))
        if usage:
            print(f"  usage: prompt={usage.get('prompt_tokens')} completion={usage.get('completion_tokens')}")
    except urllib.error.HTTPError as exc:
        print(f"tools 验证失败：HTTP {exc.code} {exc.read().decode('utf-8', 'replace')[:300]}")
    except Exception as exc:  # noqa: BLE001
        print(f"tools 验证失败：{exc}")

    print("\n提示：把以上输出发给开发同学即可完成选型；测其他模型改用 PROBE_MODEL=模型名 重跑。")


if __name__ == "__main__":
    main()
