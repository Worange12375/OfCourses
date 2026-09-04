"""OfCourses 投票后端离线自测

用临时 SQLite 验证限流、熔断、恢复、站点统计的完整逻辑，不碰生产数据。

运行：
    python test_main.py
或：
    python -m pytest test_main.py -v
"""

import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="ofcourses-test-")
os.environ["VOTE_DB_PATH"] = os.path.join(_TMP, "test.db")
os.environ["VOTE_IP_SALT"] = "test-salt"
os.environ["VOTE_ADMIN_TOKEN"] = "test-admin-token"
os.environ["VOTE_SCT_KEY"] = ""  # 测试环境不推送微信

import main
from fastapi.testclient import TestClient

client = TestClient(main.app)
TOKEN = "test-admin-token"

_passed = 0
_failed = 0


def check(name: str, cond: bool, extra: str = "") -> None:
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  [PASS] {name}")
    else:
        _failed += 1
        print(f"  [FAIL] {name} {extra}")


def vote(topic: str, score: int, vid: str):
    return client.post("/vote/submit", json={"topic": topic, "score": score, "voter_id": vid})


def meta(key: str) -> str:
    c = main._connect()
    try:
        return main._get_meta(c, key)
    finally:
        c.close()


print("\n--- 投票与去重 ---")
r = vote("ai", 5, "voter-0001")
check("首次投票返回 200", r.status_code == 200, f"got {r.status_code}")
r2 = vote("ai", 3, "voter-0001")
check("重复投票返回 409", r2.status_code == 409, f"got {r2.status_code}")
check("409 回带原始分值", r2.json().get("score") == 5, f"got {r2.json()}")
check("不同设备可独立投票", vote("ai", 4, "voter-0002").status_code == 200)
check("stats 统计正确", client.get("/vote/stats?topic=ai").json()["count"] == 2)

print("\n--- 分档限流 ---")
main.RATE_SUBMIT_VOTER_PER_HOUR = 1
check("限流内首次通过", vote("review", 5, "voter-0003").status_code == 200)
check("超 voter 限流返回 429", vote("ai", 5, "voter-0003").status_code == 429)
main.RATE_SUBMIT_VOTER_PER_HOUR = 5

print("\n--- 熔断与恢复 ---")
main.CIRCUIT_MAX_NEW_VOTES = 2
vote("ai", 5, "burst-0004")
check("异常流量触发熔断", meta("circuit_open") == "1")
check("熔断后 submit 返回 503", vote("ai", 5, "voter-9999").status_code == 503)
check("熔断后 stats 仍可读", client.get("/vote/stats?topic=ai").status_code == 200)

a = client.get(f"/vote/admin?token={TOKEN}")
check("admin 页面可访问", a.status_code == 200, f"got {a.status_code}")
check("admin 显示熔断告警", "熔断" in a.text)
check("admin 含站点统计板块", "站点访问统计" in a.text)
check("错误 token 返回 401", client.get("/vote/admin?token=wrong").status_code == 401)

rs = client.get(f"/vote/admin/resume?token={TOKEN}", follow_redirects=False)
check("resume 返回重定向", rs.status_code in (302, 307), f"got {rs.status_code}")
check("恢复后 circuit_open 归零", meta("circuit_open") == "0")
check(
    "恢复后可再次投票（不被历史数据立刻再熔断）",
    vote("review", 4, "after-resume-01").status_code == 200,
)
main.CIRCUIT_MAX_NEW_VOTES = 50

print("\n--- 站点访问统计 ---")
for i, (p, m) in enumerate([("/", False), ("/workspace", True), ("/", False)]):
    client.post("/track", json={"vid": f"visitor-{i}", "path": p, "mobile": m})
client.post("/track", json={"vid": "visitor-0", "path": "/about", "mobile": False})
c = main._connect()
site = main._site_stats(c)
c.close()
check("UV 按 vid 去重", site["total_uv"] == 3, f"got {site['total_uv']}")
check("PV 累计 4 次", site["total_pv"] == 4, f"got {site['total_pv']}")
check(
    "设备占比区分正确",
    site["mobile_uv"] == 1 and site["pc_uv"] == 2,
    f"got mobile={site['mobile_uv']} pc={site['pc_uv']}",
)
check("趋势数据非空", len(site["trend"]) > 0, f"got {len(site['trend'])}")

print("\n--- CSV 导出 ---")
ex = client.get(f"/vote/admin/export?token={TOKEN}")
check("导出返回 CSV", ex.status_code == 200 and "text/csv" in ex.headers["content-type"])
check("CSV 含表头", ex.text.startswith("topic,score,voter_id"))

print(f"\n结果：通过 {_passed} 项，失败 {_failed} 项")
if _failed:
    raise SystemExit(1)
