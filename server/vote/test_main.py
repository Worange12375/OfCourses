"""OfCourses 投票后端离线自测

用临时 SQLite 验证限流、熔断、恢复、站点统计的完整逻辑，不碰生产数据。

运行：
    python test_main.py
或：
    python -m pytest test_main.py -v
"""

import json
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="ofcourses-test-")
os.environ["VOTE_DB_PATH"] = os.path.join(_TMP, "test.db")
os.environ["VOTE_IP_SALT"] = "test-salt"
os.environ["VOTE_ADMIN_TOKEN"] = "test-admin-token"
os.environ["VOTE_ADMIN_PASSWORD"] = "test-admin-pw"  # 测试专用密码，与生产密码无关（生产密码只存服务器环境变量）
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
r = vote("ai_std", 5, "voter-0001")
check("首次投票返回 200", r.status_code == 200, f"got {r.status_code}")
r2 = vote("ai_std", 3, "voter-0001")
check("重复投票返回 409", r2.status_code == 409, f"got {r2.status_code}")
check("409 回带原始分值", r2.json().get("score") == 5, f"got {r2.json()}")
check("不同设备可独立投票", vote("ai_std", 4, "voter-0002").status_code == 200)
check("stats 统计正确", client.get("/vote/stats?topic=ai_std").json()["count"] == 2)
check("旧 topic 已下线", client.get("/vote/stats?topic=ai").status_code == 400)
check("四维各自独立计票", vote("ai_overall", 5, "voter-0001").status_code == 200)

print("\n--- 分档限流 ---")
main.RATE_SUBMIT_VOTER_PER_HOUR = 1
check("限流内首次通过", vote("review", 5, "voter-0003").status_code == 200)
check("超 voter 限流返回 429", vote("ai_std", 5, "voter-0003").status_code == 429)
main.RATE_SUBMIT_VOTER_PER_HOUR = 5

print("\n--- 熔断与恢复 ---")
main.CIRCUIT_MAX_NEW_VOTES = 2
vote("ai_std", 5, "burst-0004")
check("异常流量触发熔断", meta("circuit_open") == "1")
check("熔断后 submit 返回 503", vote("ai_std", 5, "voter-9999").status_code == 503)
check("熔断后 stats 仍可读", client.get("/vote/stats?topic=ai_std").status_code == 200)

a = client.get(f"/vote/admin?token={TOKEN}")
check("admin 页面可访问", a.status_code == 200, f"got {a.status_code}")
check("admin 显示熔断告警", "熔断" in a.text)
check("admin 含站点统计板块", "站点访问统计" in a.text)
# 管理鉴权新设计：密码与 token 并存；无有效凭据时返回登录页（而非 401）
r = client.get("/vote/admin?token=wrong")
check("错误 token 返回登录页", r.status_code == 200 and "管理密码" in r.text, f"got {r.status_code}")
check("无凭据返回登录页", "管理密码" in client.get("/vote/admin").text)
check("错误密码登录 401", client.post("/vote/admin/auth", json={"password": "bad"}).status_code == 401)
check(
    "正确密码登录发会话 cookie",
    client.post("/vote/admin/auth", json={"password": "test-admin-pw"}).status_code == 200,
)
check("密码会话可进管理页", "站点访问统计" in client.get("/vote/admin").text)
check("当日统计接口可用", client.get("/vote/admin/day?day=2026-01-01").status_code == 200)

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


print("\n--- AI 推荐助手 ---")

# —— 假上游：模拟 Paratera SSE 响应，不打真实 API ——
class _FakeUpstream:
    def __init__(self, lines):
        self._lines = lines

    def __iter__(self):
        return iter(self._lines)

    def close(self):
        pass


def _fake_open_upstream(body, *args, **kwargs):
    # 校验请求体：system 在最前、最后一条是 user、开启 stream
    _captured_bodies.append(body)
    msgs = body["messages"]
    assert msgs[0]["role"] == "system" and "AI 选课助手" in msgs[0]["content"]
    assert msgs[-1]["role"] == "user"
    assert body.get("stream") is True
    return _FakeUpstream(
        [
            b'data: {"choices":[{"delta":{"reasoning_content":"\\u601d\\u8003"}}]}\n\n',
            b'data: {"choices":[{"delta":{"content":"\\u4f60"}}]}\n\n',
            b'data: {"choices":[{"delta":{"content":"\\u597d"}}]}\n\n',
            b'data: {"usage":{"prompt_tokens":100,"completion_tokens":50}}\n\n',
            b"data: [DONE]\n\n",
        ]
    )


_captured_bodies: list = []


def chat(text: str, vid: str):
    return client.post(
        "/vote/ai/chat",
        json={"visitor_id": vid, "messages": [{"role": "user", "content": text}]},
    )


# 未配置 key：503 且不消耗配额
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
_saved_key = main.AI_API_KEY
main.AI_API_KEY = ""
check("未配置 key 返回 503", chat("你好", "ai-v0").status_code == 503)
c = main._connect()
n0 = c.execute("SELECT COUNT(*) FROM ai_usage").fetchone()[0]
c.close()
check("503 不记 ai_usage", n0 == 0, f"got {n0}")

# 正常流式对话 + 用量记录
main.AI_API_KEY = "fake-key"
main._open_upstream = _fake_open_upstream
r = chat("推荐一门课程", "ai-v1")
check("chat 返回 200", r.status_code == 200, f"got {r.status_code}")
check("响应为 SSE", "text/event-stream" in r.headers.get("content-type", ""))
check("SSE 含增量文本", "\\u4f60" in r.text or "你" in r.text)
check("SSE 含思考过程事件", '"r"' in r.text)
check("SSE 含 usage", '"prompt_tokens": 100' in r.text or '"prompt_tokens":100' in r.text)
c = main._connect()
row = c.execute(
    "SELECT visitor_hash, ip_hash, prompt_tokens, completion_tokens FROM ai_usage ORDER BY id DESC LIMIT 1"
).fetchone()
c.close()
check(
    "ai_usage 记录 token",
    row is not None and row[2] == 100 and row[3] == 50,
    f"got {row}",
)

# 消息格式校验
r = client.post("/vote/ai/chat", json={"visitor_id": "ai-v1", "messages": [{"role": "assistant", "content": "hi"}]})
check("最后一条非 user 返回 400", r.status_code == 400, f"got {r.status_code}")
r = client.post("/vote/ai/chat", json={"visitor_id": "ai-v1", "messages": []})
check("空消息返回 400", r.status_code == 400, f"got {r.status_code}")

# 访客每日限额（visitor 主限额）
c = main._connect()
main._set_meta(c, "ai_quota_visitor", "1")
main._set_meta(c, "ai_quota_ip", "100")
c.close()
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
check("访客第 1 次提问通过", chat("问题A", "ai-v2").status_code == 200)
check("访客第 2 次提问被限 429", chat("问题B", "ai-v2").status_code == 429)
check("另一访客不受影响", chat("问题C", "ai-v3").status_code == 200)

# IP 兜底限额（校园网 NAT：不同访客同 IP 聚集）
c = main._connect()
main._set_meta(c, "ai_quota_ip", "2")
c.close()
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
check("同 IP 第 1 个访客通过", chat("q1", "ai-v4").status_code == 200)
check("同 IP 第 2 个访客通过", chat("q2", "ai-v5").status_code == 200)
check("同 IP 第 3 个访客被限 429", chat("q3", "ai-v6").status_code == 429)

# 全局 token 熔断
c = main._connect()
main._set_meta(c, "ai_token_daily_cap", "10")
c.execute(
    "INSERT INTO ai_usage (visitor_hash, ip_hash, prompt_tokens, completion_tokens, ts) VALUES ('vh','ih',999999,0,?);",
    (int(__import__("time").time()),),
)
c.commit()
c.close()
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
r = chat("问题D", "ai-v7")
check("token 触顶返回 429", r.status_code == 429, f"got {r.status_code}")
check("触顶提示语正确", "今日 AI 额度已用完" in r.json().get("detail", ""), f"got {r.json()}")
c = main._connect()
check("触顶当天已打推送标记", main._get_meta(c, f"ai_cap_notified_{__import__('time').strftime('%Y%m%d')}") == "1")
c.close()

# 管理端：限额配置 + 用量统计
r = client.post(f"/vote/admin/ai/config?visitor=25&ip=120&token_cap=700000&token={TOKEN}")
check("管理端可改限额", r.status_code == 200 and meta("ai_quota_visitor") == "25" and meta("ai_quota_ip") == "120")
check("token 上限已写入", meta("ai_token_daily_cap") == "700000")
c = main._connect()
main._set_meta(c, "ai_token_daily_cap", "600000")
c.close()
r = client.get(f"/vote/admin/ai/stats?token={TOKEN}")
d = r.json()
check(
    "ai/stats 返回统计",
    r.status_code == 200 and d["today_calls"] >= 4 and d["switches"]["master"] is True,
    f"got {d}",
)
check("ai/stats 含启用状态", d["enabled"] is True)

# 管理页第三个页签
a = client.get(f"/vote/admin?token={TOKEN}")
check("admin 含 AI 助手页签", "AI 助手" in a.text and "tab-ai" in a.text)
check("admin 含意图分类测试板块", "意图分类测试" in a.text and "classify-test" in a.text)
check("admin 含限额配置表单", "登录用户每日提问上限" in a.text and "未登录游客限额倍数" in a.text)

# 知识库文件
check("知识库文件存在", os.path.exists(main.AI_KB_PATH))
kb = open(main.AI_KB_PATH, encoding="utf-8").read()
check("知识库含规则与数据", "学位评定" in kb and "课组与课程" in kb and "关于我们" in kb and "原始类" in kb)
check("强模型 skill 文件存在", os.path.exists(os.path.join(os.path.dirname(main.AI_KB_PATH), "kb_strong.txt")))

# 回复语言注入（跟随站点中英文状态）
# 触顶测试插入的假用量行仍在"今天"，先把全局上限设为不限（0）避免干扰
c = main._connect()
main._set_meta(c, "ai_token_daily_cap", "0")
c.close()
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-lang-en", "lang": "en", "messages": [{"role": "user", "content": "hello"}]},
)
check("lang=en 请求通过", r.status_code == 200, f"got {r.status_code}")
check(
    "lang=en 注入英文指令",
    _captured_bodies and "[Reply Language]" in _captured_bodies[-1]["messages"][0]["content"],
)
check(
    "默认 lang=zh 注入中文指令",
    _captured_bodies and "【回复语言】" in _captured_bodies[0]["messages"][0]["content"],
)
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-lang-x", "lang": "fr", "messages": [{"role": "user", "content": "bonjour"}]},
)
check("非法 lang 回退中文不报错", r.status_code == 200, f"got {r.status_code}")

# 个人选课数据（context）注入到最后一条用户消息
r = client.post(
    "/vote/ai/chat",
    json={
        "visitor_id": "ai-ctx",
        "context": "总学分：40\nAE 主课组 3/8 门",
        "messages": [{"role": "user", "content": "帮我看看学位进度"}],
    },
)
check("context 请求通过", r.status_code == 200, f"got {r.status_code}")
last_body = _captured_bodies[-1]["messages"][-1]
check(
    "context 拼入最后一条 user 消息",
    last_body["role"] == "user" and "【用户选课数据】" in last_body["content"] and "总学分：40" in last_body["content"],
    f"got {last_body['content'][:120]}",
)

# 用户侧限额查询
r = client.get("/vote/ai/quota?visitor_id=ai-lang-en")
d = r.json()
# 未登录游客个人限额 = 登录限额 × 游客倍数（默认 0.3，至少 1 次）：25 × 0.3 = 7
check("quota 返回已用/上限", r.status_code == 200 and d["used"] >= 1 and d["limit"] == 7 and d["logged_in"] is False, f"got {d}")
check("quota 含触顶标志", d["ip_exhausted"] in (True, False) and d["token_exhausted"] in (True, False))

# 管理端额度重置（代次机制：记录永不删除，gen+1 使今日统计归零；两档代次互相独立）
c = main._connect()
n_before = c.execute("SELECT COUNT(*) FROM ai_usage;").fetchone()[0]
old_gen = main._ai_cur_gen(c, "flash")
strong_gen_before = main._ai_cur_gen(c, "strong")
c.close()
r = client.post(f"/vote/admin/ai/reset?scope=tokens&token={TOKEN}")
new_gen = r.json().get("gen", 0)
c = main._connect()
n_after = c.execute("SELECT COUNT(*) FROM ai_usage;").fetchone()[0]
cur_gen = main._ai_cur_gen(c, "flash")
day0 = main._day_start(__import__("time").time())
n_old = c.execute(
    "SELECT COUNT(*) FROM ai_usage WHERE ts >= ? AND gen = ?;", (day0, old_gen)
).fetchone()[0]
n_new = c.execute(
    "SELECT COUNT(*) FROM ai_usage WHERE ts >= ? AND gen = ?;", (day0, cur_gen)
).fetchone()[0]
c.close()
check("token 重置返回新代次", r.status_code == 200 and new_gen == old_gen + 1, f"got {r.status_code}, gen {new_gen}")
check("重置不删除用量记录", n_after == n_before, f"before {n_before}, after {n_after}")
check("当前代次已递增", cur_gen == new_gen, f"cur {cur_gen}, expect {new_gen}")
check("旧代次今日记录保留", n_old > 0, f"old gen rows {n_old}")
check("新代次今日统计归零", n_new == 0, f"new gen rows {n_new}")
c = main._connect()
check(
    "重置标准档不影响强档代次",
    main._ai_cur_gen(c, "strong") == strong_gen_before and main._ai_cur_gen(c, "flash") == old_gen + 1,
    f"strong {main._ai_cur_gen(c, 'strong')}, flash {main._ai_cur_gen(c, 'flash')}",
)
c.close()
c = main._connect()
strong_gen_before = main._ai_cur_gen(c, "strong")
c.close()
r = client.post(f"/vote/admin/ai/reset?scope=users&token={TOKEN}")
check("重置用户次数限额", r.status_code == 200)
check("重置后可再次提问", chat("重置后的提问", "ai-after-reset").status_code == 200)
c = main._connect()
g_last = c.execute("SELECT gen FROM ai_usage ORDER BY id DESC LIMIT 1;").fetchone()[0]
c.close()
check("重置后提问按新代次记账", g_last == new_gen, f"got gen {g_last}, expect {new_gen}")
r = client.post(f"/vote/admin/ai/reset?scope=bad&token={TOKEN}")
check("非法 scope 返回 400", r.status_code == 400, f"got {r.status_code}")

# 管理页可视化端点：近 30 天走势 + 某日详情（分段条形图数据）
r = client.get(f"/vote/admin/ai/history?days=30&token={TOKEN}")
d = r.json()
_today = __import__("time").strftime("%Y-%m-%d")
_td = [x for x in d.get("days", []) if x["day"] == _today]
check(
    "ai/history 返回 30 天零填充序列",
    r.status_code == 200 and len(d.get("days", [])) == 30 and len(_td) == 1,
    f"got {len(d.get('days', []))} days",
)
if _td:
    check("ai/history 当日含分档字段", _td[0]["calls"] >= 1 and "flash_calls" in _td[0] and "strong_tokens" in _td[0], f"got {_td[0]}")
r = client.get(f"/vote/admin/ai/day?day={_today}&token={TOKEN}")
d = r.json()
check("ai/day 返回当日详情", r.status_code == 200 and d.get("day") == _today and d.get("tokens", 0) >= 1, f"got {d}")
check("ai/day 分段含重置前后两代次", len(d.get("segments", [])) == 2, f"got {d.get('segments')}")
check("ai/day 分段含档位标注", all("model" in s and "gen" in s for s in d.get("segments", [])), f"got {d.get('segments')}")
check("ai/day 记录重置时刻与档位", len(d.get("resets", [])) == 1 and d["resets"][0]["tier"] == "flash", f"got {d.get('resets')}")

# 强模型档独立重置：scope=strong_tokens 只动强档代次
r = client.post(f"/vote/admin/ai/reset?scope=strong_tokens&token={TOKEN}")
new_strong_gen = r.json().get("gen", 0)
c = main._connect()
check(
    "强档独立重置生效且不影响标准档",
    r.status_code == 200 and new_strong_gen == strong_gen_before + 1
    and main._ai_cur_gen(c, "strong") == strong_gen_before + 1
    and main._ai_cur_gen(c, "flash") == new_gen,
)
c.close()

# 后续测试继续使用代次 1（与新代次无关，直接 INSERT 落 DEFAULT 1）
c = main._connect()
main._set_meta(c, "ai_usage_gen", "1")
main._set_meta(c, "ai_strong_gen", "1")
c.close()

# 上游 429 → SSE 流内等待/致歉（AI_WAIT_TOTAL=-1 表示 deadline 已过，直接致歉，避免测试真等 10 秒）
def _rate_limited_upstream(body, *args, **kwargs):
    raise main.urllib.error.HTTPError("upstream", 429, "rate limited", {}, main.io.BytesIO(b""))

main._open_upstream = _rate_limited_upstream
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
_saved_wait = main.AI_WAIT_TOTAL
main.AI_WAIT_TOTAL = -1
r = chat("限频测试", "ai-ratelimit")
check(
    "上游 429 等待超时返回致歉提示",
    r.status_code == 200 and "模型使用紧张" in r.text,
    f"got {r.status_code} {r.text[:200]}",
)
main.AI_WAIT_TOTAL = _saved_wait

main.AI_API_KEY = _saved_key  # 还原

print("\n--- AI 分类端点（两段式第一段）---")

# classify 直接调 urllib.request.urlopen（非流式单次 JSON），测试里整体打补丁
class _FakeClassifyResp:
    def __init__(self, payload: bytes):
        self._payload = payload

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


_captured_classify_bodies: list = []
_saved_urlopen = main.urllib.request.urlopen


def _classify_upstream_factory(content: str, usage=None):
    def _upstream(req, timeout=None):
        _captured_classify_bodies.append(json.loads(req.data.decode("utf-8")))
        obj = {"choices": [{"message": {"content": content}}]}
        if usage is not None:
            obj["usage"] = usage
        return _FakeClassifyResp(json.dumps(obj).encode("utf-8"))

    return _upstream


main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
main._ai_classify_hits.clear()

# 未配置 key：与 chat 同门槛 503
main.AI_API_KEY = ""
r = client.post("/vote/ai/classify", json={"question": "帮我规划下学期"})
check("classify 未配置 key 返回 503", r.status_code == 503, f"got {r.status_code}")
main.AI_API_KEY = "fake-key"

# 正常 JSON 输出 → 解析出类别/方向/学期
_good = '{"category": "plan", "direction": "soft", "direction_source": "stated", "semester": "大二·春季"}'
main.urllib.request.urlopen = _classify_upstream_factory(
    _good, usage={"prompt_tokens": 30, "completion_tokens": 10}
)
r = client.post(
    "/vote/ai/classify",
    json={"question": "我是软件方向，帮我规划大二春季", "visitor_id": "ai-cls-1"},
)
d = r.json()
check("classify 返回 200", r.status_code == 200, f"got {r.status_code}")
check("classify 解析 category=plan", d.get("category") == "plan", f"got {d}")
check(
    "classify 解析 direction=soft",
    d.get("direction") == "soft" and d.get("direction_source") == "stated",
    f"got {d}",
)
check("classify 解析学期", d.get("semester") == "大二·春季", f"got {d}")
check("classify 非回退", d.get("fallback") is False, f"got {d}")
_cb = _captured_classify_bodies[-1]
check(
    "classify 请求非流式且限 300 token",
    _cb.get("stream") is False and _cb.get("max_tokens") == 300,
    f"got stream={_cb.get('stream')} max_tokens={_cb.get('max_tokens')}",
)
check("classify 用分类系统提示", "意图分类器" in _cb["messages"][0]["content"], f"got {_cb['messages'][0]['content'][:60]}")
check(
    "classify 用户问题在末条",
    _cb["messages"][-1]["role"] == "user" and _cb["messages"][-1]["content"] == "我是软件方向，帮我规划大二春季",
)
c = main._connect()
row = c.execute(
    "SELECT prompt_tokens, completion_tokens FROM ai_usage ORDER BY id DESC LIMIT 1"
).fetchone()
c.close()
check("classify token 记入 ai_usage", row is not None and row[0] == 30 and row[1] == 10, f"got {row}")

# markdown 围栏包裹的 JSON 也能正则提取
_fenced = '```json\n{"category": "curriculum", "direction": "none", "direction_source": "none", "semester": ""}\n```'
main.urllib.request.urlopen = _classify_upstream_factory(_fenced)
r = client.post("/vote/ai/classify", json={"question": "离散数学属于哪个课组？", "visitor_id": "ai-cls-2"})
d = r.json()
check("classify 支持 markdown 围栏", d.get("category") == "curriculum" and d.get("fallback") is False, f"got {d}")

# 非法 category 被拒绝，但方向等合法字段仍可用
_bad = '{"category": "hack", "direction": "aero", "direction_source": "stated", "semester": ""}'
main.urllib.request.urlopen = _classify_upstream_factory(_bad)
r = client.post("/vote/ai/classify", json={"question": "随便问点什么", "visitor_id": "ai-cls-3"})
d = r.json()
check(
    "classify 非法 category 回退 all",
    r.status_code == 200 and d.get("category") == "all" and d.get("direction") == "aero",
    f"got {d}",
)


# 上游异常 → fallback=True 不抛 500
def _broken_upstream(req, timeout=None):
    raise main.urllib.error.HTTPError("upstream", 500, "boom", {}, main.io.BytesIO(b""))


main.urllib.request.urlopen = _broken_upstream
r = client.post("/vote/ai/classify", json={"question": "异常测试", "visitor_id": "ai-cls-4"})
d = r.json()
check(
    "classify 上游异常回退 all",
    r.status_code == 200 and d.get("fallback") is True and d.get("category") == "all",
    f"got {r.status_code} {d}",
)

# 上游输出纯文本（无 JSON）→ fallback
main.urllib.request.urlopen = _classify_upstream_factory("抱歉，我不明白你的意思。")
r = client.post("/vote/ai/classify", json={"question": "没有JSON的输出", "visitor_id": "ai-cls-5"})
d = r.json()
check("classify 无 JSON 回退 all", d.get("fallback") is True and d.get("category") == "all", f"got {d}")

# 上游 429 → deadline 式等待后成功（间隔置 0 避免真等；总上限给 5s 允许多次重试）
_saved_cls_total = main.AI_CLASSIFY_WAIT_TOTAL
_saved_cls_ivl = main.AI_CLASSIFY_WAIT_INTERVAL
main.AI_CLASSIFY_WAIT_TOTAL = 5
main.AI_CLASSIFY_WAIT_INTERVAL = 0
_attempts = {"n": 0}


def _flaky_429_upstream(req, timeout=None):
    _attempts["n"] += 1
    if _attempts["n"] <= 3:
        raise main.urllib.error.HTTPError("upstream", 429, "rate limited", {}, main.io.BytesIO(b""))
    return _classify_upstream_factory(_good, usage={"prompt_tokens": 5, "completion_tokens": 2})(req, timeout)


main.urllib.request.urlopen = _flaky_429_upstream
r = client.post("/vote/ai/classify", json={"question": "重试后成功测试", "visitor_id": "ai-cls-7"})
d = r.json()
check(
    "classify 429 多次重试后成功",
    r.status_code == 200 and d.get("fallback") is False and d.get("category") == "plan" and _attempts["n"] == 4,
    f"got {r.status_code} {d} attempts={_attempts['n']}",
)

# 上游持续 429 → 等待预算耗尽回退（总上限 0 = 第一次 429 即放弃）
main.AI_CLASSIFY_WAIT_TOTAL = 0
_attempts["n"] = 0


def _always_429_upstream(req, timeout=None):
    _attempts["n"] += 1
    raise main.urllib.error.HTTPError("upstream", 429, "rate limited", {}, main.io.BytesIO(b""))


main.urllib.request.urlopen = _always_429_upstream
r = client.post("/vote/ai/classify", json={"question": "重试耗尽测试", "visitor_id": "ai-cls-8"})
d = r.json()
check(
    "classify 429 预算耗尽回退 all",
    r.status_code == 200 and d.get("fallback") is True and d.get("category") == "all" and _attempts["n"] == 1,
    f"got {r.status_code} {d} attempts={_attempts['n']}",
)
main.AI_CLASSIFY_WAIT_TOTAL = _saved_cls_total
main.AI_CLASSIFY_WAIT_INTERVAL = _saved_cls_ivl

# —— 管理端意图分类测试接口 ——
main.urllib.request.urlopen = _classify_upstream_factory(_good, usage={"prompt_tokens": 8, "completion_tokens": 3})
client.cookies.clear()  # 清掉此前登录态，验证无凭据被拒
r = client.post("/vote/admin/ai/classify-test", json={"question": "帮我规划大二春季"})
check("classify-test 未鉴权返回 401", r.status_code == 401, f"got {r.status_code}")
r = client.post(f"/vote/admin/ai/classify-test?token={TOKEN}", json={"question": "帮我规划大二春季"})
d = r.json()
check(
    "classify-test 成功返回诊断",
    r.status_code == 200 and d.get("ok") is True and d.get("result", {}).get("category") == "plan",
    f"got {r.status_code} {d}",
)
check("classify-test 含尝试序列", d.get("attempts") == [{"status": 200, "elapsed_ms": d["attempts"][0]["elapsed_ms"]}], f"got {d.get('attempts')}")
check("classify-test 含上游原始输出", "category" in d.get("content_raw", ""), f"got {d.get('content_raw')}")
check(
    "classify-test 含等待预算",
    d.get("wait_budget") == {"total": main.AI_CLASSIFY_WAIT_TOTAL, "interval": main.AI_CLASSIFY_WAIT_INTERVAL},
    f"got {d.get('wait_budget')}",
)
c = main._connect()
row = c.execute(
    "SELECT COUNT(*) FROM ai_usage WHERE visitor_hash = 'admin-classify-test' AND prompt_tokens = 8"
).fetchone()[0]
c.close()
check("classify-test token 记入 ai_usage", row >= 1, f"got {row}")

# classify-test 走同一重试链路（429 一次后成功，attempts 应含 429 与 200）
_attempts["n"] = 0
main.AI_CLASSIFY_WAIT_TOTAL = 5
main.AI_CLASSIFY_WAIT_INTERVAL = 0
main.urllib.request.urlopen = _flaky_429_upstream
r = client.post(f"/vote/admin/ai/classify-test?token={TOKEN}", json={"question": "重试诊断测试"})
d = r.json()
check(
    "classify-test 429 尝试序列可见",
    r.status_code == 200 and d.get("ok") is True and [a["status"] for a in d.get("attempts", [])] == [429, 429, 429, 200],
    f"got {r.status_code} attempts={d.get('attempts')}",
)
main.AI_CLASSIFY_WAIT_TOTAL = _saved_cls_total
main.AI_CLASSIFY_WAIT_INTERVAL = _saved_cls_ivl

# —— SSE 流式终端接口 ——
main.urllib.request.urlopen = _classify_upstream_factory(_good, usage={"prompt_tokens": 8, "completion_tokens": 3})
r = client.post("/vote/admin/ai/classify-test-stream", json={"question": "流式测试"})
check("classify-test-stream 未鉴权 401", r.status_code == 401, f"got {r.status_code}")
r = client.post(f"/vote/admin/ai/classify-test-stream?token={TOKEN}", json={"question": "流式测试"})
check("classify-test-stream 返回 SSE", r.status_code == 200 and "text/event-stream" in r.headers.get("content-type", ""), f"got {r.status_code} {r.headers.get('content-type')}")
check(
    "classify-test-stream 事件序列完整",
    '"type": "start"' in r.text
    and '"type": "attempt_start"' in r.text
    and '"type": "attempt_done"' in r.text
    and '"type": "result"' in r.text
    and "[DONE]" in r.text,
)
check(
    "classify-test-stream 汇总正确",
    '"ok": true' in r.text and '"category": "plan"' in r.text,
    f"got {r.text[:300]}",
)
check("classify-test-stream 禁缓冲头", r.headers.get("x-accel-buffering") == "no", f"got {r.headers.get('x-accel-buffering')}")
c = main._connect()
row = c.execute(
    "SELECT COUNT(*) FROM ai_usage WHERE visitor_hash = 'admin-classify-test' AND prompt_tokens = 8"
).fetchone()[0]
c.close()
check("classify-test-stream token 记入 ai_usage", row >= 2, f"got {row}")

# 全局 token 熔断对 classify 同样生效
c = main._connect()
main._set_meta(c, "ai_token_daily_cap", "5")
c.close()
main._ai_classify_hits.clear()
main.urllib.request.urlopen = _classify_upstream_factory(
    _good, usage={"prompt_tokens": 100, "completion_tokens": 50}
)
r = client.post("/vote/ai/classify", json={"question": "额度触顶测试", "visitor_id": "ai-cls-6"})
check("classify token 触顶返回 429", r.status_code == 429, f"got {r.status_code}")

# 还原补丁与额度
c = main._connect()
main._set_meta(c, "ai_token_daily_cap", "0")
c.close()
main.urllib.request.urlopen = _saved_urlopen
main.AI_API_KEY = _saved_key
main._ai_classify_hits.clear()

print("\n--- AI 双档模型与工具循环 ---")

# 上一段测试结束时 key 被还原为空，这里重新启用假 key（结束时同样还原）
_saved_api_key = main.AI_API_KEY
main.AI_API_KEY = "fake-key"

# —— search_courses 工具单元测试（确定性检索） ——
r_search = main._tool_search_courses({"keyword": "计算机"})
check(
    "搜索：名称含计算机的课程完整返回",
    r_search["total"] >= 5 and all("计算机" in line for line in r_search["courses"]),
    f"got {r_search}",
)
r_search2 = main._tool_search_courses({"attr": "prof_required"})
check(
    "搜索：专业必修属性过滤",
    r_search2["total"] >= 6
    and all("专业必修" in line for line in r_search2["courses"]),
    f"got {r_search2}",
)
r_search3 = main._tool_search_courses({"keyword": "流体"})
check(
    "搜索：流体力学可查且标注开课学期",
    # 2024 版忠于四字班 Word：30311013（3学分）保留，开课大二·春季
    any("流体力学（30311013" in line and "大二·春季" in line for line in r_search3["courses"]),
    f"got {r_search3}",
)
r_search4 = main._tool_search_courses({"keyword": "不存在的课xyz"})
check("搜索：无结果时给出提示", r_search4["total"] == 0 and "没有匹配" in r_search4["note"], f"got {r_search4}")
r_search5 = main._tool_search_courses({"keyword": "a", "attr": "restricted", "semester": "大三·秋季"})
check("搜索：多条件且关系过滤", all("限选" in l for l in r_search5["courses"]), f"got {r_search5}")

# —— 工具循环（假上游：第一轮 tool_calls → 第二轮正文） ——
_saved_open_upstream = main._open_upstream
_saved_model_strong = main.AI_MODEL_STRONG
_tool_captured: list = []


class _ToolLoopUpstream:
    def __init__(self, lines):
        self._lines = lines

    def __iter__(self):
        return iter(self._lines)

    def close(self):
        pass


def _tool_loop_open(body, *args, **kwargs):
    _tool_captured.append(body)
    if body.get("tools"):
        return _ToolLoopUpstream([
            b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"search_courses","arguments":"{\\"keyword\\": \\"\\"}"}}]}}]}\n\n',
            b'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
            b'data: {"usage":{"prompt_tokens":200,"completion_tokens":10}}\n\n',
            b"data: [DONE]\n\n",
        ])
    return _ToolLoopUpstream([
        b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        b'data: {"usage":{"prompt_tokens":300,"completion_tokens":60}}\n\n',
        b"data: [DONE]\n\n",
    ])


main._open_upstream = _tool_loop_open
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
main._ai_strong_hits.clear()
_saved_tool_rounds = main.AI_TOOL_MAX_ROUNDS
main.AI_TOOL_MAX_ROUNDS = 1  # 验证轮数上限：第 1 轮允许工具，第 2 轮强制摘工具收尾
c = main._connect()
main._set_meta(c, "ai_token_daily_cap", "0")
c.close()
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-tool-1", "category": "curriculum", "messages": [{"role": "user", "content": "列出名字带计算机的课"}]},
)
check("工具循环：chat 返回 200", r.status_code == 200, f"got {r.status_code}")
check("工具循环：SSE 含工具状态事件", '"status": "tool"' in r.text or '"status":"tool"' in r.text)
check("工具循环：最终正文输出", "ok" in r.text)
check("工具循环：两轮 usage 累加", '"prompt_tokens": 500' in r.text or '"prompt_tokens":500' in r.text, f"got {r.text[-400:]}")
check("工具循环：第二轮请求无 tools", len(_tool_captured) == 2 and "tools" not in _tool_captured[1], f"got {len(_tool_captured)} 轮")
check(
    "工具循环：第二轮含工具结果消息",
    any(m.get("role") == "tool" and "search_courses" not in m.get("content", "") for m in _tool_captured[1]["messages"]),
)
c = main._connect()
row = c.execute(
    "SELECT prompt_tokens, completion_tokens, model FROM ai_usage ORDER BY id DESC LIMIT 1"
).fetchone()
c.close()
check("工具循环：累计记账 500/70", row[0] == 500 and row[1] == 70, f"got {row}")
check("工具循环：记账模型为 flash", row[2] == "flash", f"got {row[2]}")

# —— 双档：强档未开启 503 ——
main.AI_MODEL_STRONG = ""
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-strong-0", "tier": "strong", "messages": [{"role": "user", "content": "hi"}]},
)
check("强档未开启返回 503", r.status_code == 503, f"got {r.status_code}")


# —— 双档：强档正常请求（模型名/独立通道/记账；跳过 classify 的类别注入由前端保证） ——
main.AI_MODEL_STRONG = "TEST-STRONG"
main.AI_STRONG_BASE_URL = "https://relay.example/v1"
main.AI_STRONG_KEY = "sk-test-strong"
_strong_conf_captured: list = []


def _plain_strong_open(body, *args, **kwargs):
    _strong_conf_captured.append(kwargs)
    _tool_captured.append(body)
    return _FakeUpstream([
        b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        b'data: {"usage":{"prompt_tokens":100,"completion_tokens":50}}\n\n',
        b"data: [DONE]\n\n",
    ])


main._open_upstream = _plain_strong_open
_tool_captured.clear()
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
main._ai_strong_hits.clear()
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-strong-1", "tier": "strong", "category": "all", "messages": [{"role": "user", "content": "hi"}]},
)
check("强档请求 200", r.status_code == 200, f"got {r.status_code}")
check("强档使用强模型名", _tool_captured and _tool_captured[0]["model"] == "TEST-STRONG", f"got {_tool_captured and _tool_captured[0].get('model')}")
# 强档独立 skill：系统提示来自 kb_strong.txt（含方向变更判断/清单格式），不注入弱模型 core 的规则架构
_strong_sys = _tool_captured[0]["messages"][0]["content"] if _tool_captured else ""
check("强档使用独立 skill（kb_strong）", "【方向变更判断" in _strong_sys and "【清单格式" in _strong_sys, f"got {_strong_sys[:120]}")
check("强档不注入弱模型规则架构", "【回答规则（必须逐条遵守）】" not in _strong_sys)
check(
    "弱档仍注入 core 规则架构",
    _captured_bodies and "【回答规则（必须逐条遵守）】" in _captured_bodies[0]["messages"][0]["content"],
)
check(
    "强档走独立通道（base_url/key）",
    _strong_conf_captured
    and _strong_conf_captured[0].get("base_url") == "https://relay.example/v1"
    and _strong_conf_captured[0].get("api_key") == "sk-test-strong",
    f"got {_strong_conf_captured}",
)
c = main._connect()
row = c.execute(
    "SELECT prompt_tokens, completion_tokens, model FROM ai_usage ORDER BY id DESC LIMIT 1"
).fetchone()
c.close()
check("强档记账 model=strong", row[2] == "strong", f"got {row}")

# —— 强档限额：每人 token = 全局上限 × pct% ——
# 2026-11-16 起用量身份带前缀（游客 vid|），伪造记录须与 _ai_identity 口径一致
_strong_vid_hash = main.hashlib.sha256((main.IP_SALT + "vid|ai-strong-1").encode("utf-8")).hexdigest()[:16]
c = main._connect()
main._set_meta(c, "ai_strong_token_daily_cap", "1000")
main._set_meta(c, "ai_strong_user_pct", "10")   # 每人 100
main._set_meta(c, "ai_strong_daily_count", "0")  # 暂关次数限额
c.close()
main._ai_strong_hits.clear()
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-strong-1", "tier": "strong", "messages": [{"role": "user", "content": "hi"}]},
)
check("强档个人 token 触顶 429", r.status_code == 429, f"got {r.status_code}")
check("强档个人触顶提示正确", "个人额度" in r.json().get("detail", ""), f"got {r.json()}")

# —— 强档限额：有效对话次数 ——
c = main._connect()
main._set_meta(c, "ai_strong_user_pct", "100")   # 每人 1000，放开 token 限制
main._set_meta(c, "ai_strong_daily_count", "1")
main._set_meta(c, "ai_strong_valid_min_tokens", "80")
c.execute(
    "INSERT INTO ai_usage (visitor_hash, ip_hash, prompt_tokens, completion_tokens, ts, model) VALUES (?, 'ih', 10, 90, ?, 'strong');",
    (_strong_vid_hash, int(__import__("time").time())),
)
c.commit()
c.close()
main._ai_strong_hits.clear()
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-strong-1", "tier": "strong", "messages": [{"role": "user", "content": "hi"}]},
)
check("强档有效次数达上限 429", r.status_code == 429, f"got {r.status_code}")
check("强档次数提示正确", "对话次数已达上限" in r.json().get("detail", ""), f"got {r.json()}")

# 低完成度回复不计入有效次数（阈值之下）→ 换个访客验证阈值逻辑
_low_hash = main.hashlib.sha256((main.IP_SALT + "vid|ai-strong-2").encode("utf-8")).hexdigest()[:16]
c = main._connect()
c.execute(
    "INSERT INTO ai_usage (visitor_hash, ip_hash, prompt_tokens, completion_tokens, ts, model) VALUES (?, 'ih', 10, 30, ?, 'strong');",
    (_low_hash, int(__import__("time").time())),
)
c.commit()
c.close()
main._ai_strong_hits.clear()
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-strong-2", "tier": "strong", "messages": [{"role": "user", "content": "hi"}]},
)
check("低完成度回复不计入有效次数", r.status_code == 200, f"got {r.status_code}: {r.json() if r.status_code != 200 else ''}")

# —— 强档限额：独立全局池（flash 大额行不影响强档） ——
c = main._connect()
main._set_meta(c, "ai_strong_token_daily_cap", "500")
main._set_meta(c, "ai_strong_user_pct", "100")
main._set_meta(c, "ai_strong_daily_count", "0")
c.execute(
    "INSERT INTO ai_usage (visitor_hash, ip_hash, prompt_tokens, completion_tokens, ts, model) VALUES ('vh-flash', 'ih', 999999, 0, ?, 'flash');",
    (int(__import__("time").time()),),
)
c.commit()
c.close()
main._ai_strong_hits.clear()
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-strong-3", "tier": "strong", "messages": [{"role": "user", "content": "hi"}]},
)
check("强档全局池与低级档隔离", r.status_code == 200, f"got {r.status_code}")

# 强档自身触顶
c = main._connect()
main._set_meta(c, "ai_strong_token_daily_cap", "10")
c.close()
main._ai_strong_hits.clear()
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-strong-3", "tier": "strong", "messages": [{"role": "user", "content": "hi"}]},
)
check("强档全局触顶 429", r.status_code == 429, f"got {r.status_code}")
check("强档全局触顶提示正确", "强模型额度已用完" in r.json().get("detail", ""), f"got {r.json()}")

# —— 管理端：强档限额配置 + 分档统计 ——
r = client.post(
    f"/vote/admin/ai/config?strong_token_cap=600000&strong_user_pct=15&strong_count=6&strong_valid_min=80&token={TOKEN}"
)
check("管理端可改强档限额", r.status_code == 200, f"got {r.status_code}")
check("强档限额已写入", meta("ai_strong_token_daily_cap") == "600000" and meta("ai_strong_user_pct") == "15")
r = client.get(f"/vote/admin/ai/stats?token={TOKEN}")
d = r.json()
check(
    "ai/stats 分档统计",
    r.status_code == 200 and "by_model" in d and "strong" in d["by_model"] and d["by_model"]["strong"]["calls"] >= 3,
    f"got {d.get('by_model')}",
)
check(
    "ai/stats 含费用估计与开关字段",
    d["strong_price"] > 0 and "strong_cost_today" in d and "strong_cost_total" in d and set(d["switches"]) == {"master", "flash", "strong"},
    f"got price={d.get('strong_price')}, switches={d.get('switches')}",
)
check("ai/stats 含强模型名", d["models"]["strong"] == "TEST-STRONG", f"got {d['models']}")

# —— quota 端点返回强档信息 ——
r = client.get("/vote/ai/quota?visitor_id=ai-strong-1")
d = r.json()
check("quota 端点含强档字段", r.status_code == 200 and d.get("strong", {}).get("enabled") is True, f"got {d}")
check("quota 端点含模型名", d.get("models", {}).get("strong") == "TEST-STRONG", f"got {d.get('models')}")
check(
    "quota 强档已用次数正确",
    d["strong"]["used_valid"] >= 1 and d["strong"]["limit_count"] == 6,
    f"got {d['strong']}",
)

# —— 管理页含强档配置表单与分档用量 ——
a = client.get(f"/vote/admin?token={TOKEN}")
check("admin 含强档限额表单", "高级档全局每日 token 上限" in a.text and "ai-strong-count" in a.text)
check("admin 含分档用量板块", "今日分档用量" in a.text)

# —— 模型配置：管理页 meta 优先，环境变量兜底（2026-11-16）——
# 注意：此处 _open_upstream 已被强档用例换为 _plain_strong_open（不捕获请求体），先换回捕获版
_saved_open_for_mcfg = main._open_upstream
main._open_upstream = _fake_open_upstream
c = main._connect()
main._set_meta(c, "ai_token_daily_cap", "0")
main._set_meta(c, "ai_model_flash", __import__("json").dumps(
    {"display": "快模型", "model": "test-model-meta", "base_url": "https://up.example.com/v1", "key": "k-test-1234567890"},
    ensure_ascii=False,
))
c.close()
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-mcfg-1", "messages": [{"role": "user", "content": "hi"}]},
)
check("模型配置：meta 配置后 chat 200", r.status_code == 200, f"got {r.status_code}")
check("模型配置：请求体用 meta 模型名", _captured_bodies[-1]["model"] == "test-model-meta", f"got {_captured_bodies[-1]['model']}")
check("模型配置：系统提示含当前驱动模型名", "【当前驱动模型】test-model-meta" in _captured_bodies[-1]["messages"][0]["content"])
r = client.get("/vote/ai/quota?visitor_id=ai-mcfg-1")
check("quota 下发自定义显示名", r.json()["display"]["flash"] == "快模型", f"got {r.json().get('display')}")
check("quota 下发 meta 模型名", r.json()["models"]["flash"] == "test-model-meta", f"got {r.json().get('models')}")
a = client.get(f"/vote/admin?token={TOKEN}")
check("admin 含模型配置卡片", "模型配置" in a.text and "ai-mcfg-flash-model" in a.text)
# 清除 meta 配置 → 回落环境变量与内置显示名
c = main._connect()
c.execute("DELETE FROM meta WHERE key = 'ai_model_flash';")
c.commit()
c.close()
r = client.get("/vote/ai/quota?visitor_id=ai-mcfg-1")
check("清除配置后回落环境变量", r.json()["display"]["flash"] == "标准模型" and r.json()["models"]["flash"] == main.AI_MODEL_FLASH, f"got {r.json().get('display')} {r.json().get('models')}")
main._open_upstream = _saved_open_for_mcfg

# —— 内联 <think> 思考适配（GLM-Z1 风格：思考包在 content 里而非 reasoning_content 字段）——
def _inline_think_open(body, *args, **kwargs):
    return _FakeUpstream([
        b'data: {"choices":[{"delta":{"content":"<th"}}]}\n\n',
        b'data: {"choices":[{"delta":{"content":"ink>\\u601d\\u8003\\u4e2d"}}]}\n\n',
        b'data: {"choices":[{"delta":{"content":"</think>"}}]}\n\n',
        b'data: {"choices":[{"delta":{"content":"\\u7b54\\u6848\\u5185\\u5bb9"}}]}\n\n',
        b'data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\n',
        b"data: [DONE]\n\n",
    ])

_saved_open_for_think = main._open_upstream
main._open_upstream = _inline_think_open
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
r = client.post(
    "/vote/ai/chat",
    json={"visitor_id": "ai-think-1", "messages": [{"role": "user", "content": "hi"}]},
)
check("内联 think：chat 200", r.status_code == 200, f"got {r.status_code}")
check("内联 think：思考分流到 r 事件", "思考中" in r.text and '"r"' in r.text, r.text[:300])
check("内联 think：正文无 <think> 标签且含答案", "<think>" not in r.text and "答案内容" in r.text, r.text[:300])
main._open_upstream = _saved_open_for_think

# —— 还原 ——
main._open_upstream = _saved_open_upstream
main.AI_TOOL_MAX_ROUNDS = _saved_tool_rounds
main.AI_MODEL_STRONG = _saved_model_strong
main.AI_STRONG_BASE_URL = main.AI_BASE_URL
main.AI_STRONG_KEY = main.AI_API_KEY
main.AI_API_KEY = _saved_api_key
c = main._connect()
main._set_meta(c, "ai_strong_token_daily_cap", "0")
main._set_meta(c, "ai_strong_user_pct", "100")
main._set_meta(c, "ai_strong_daily_count", "0")
main._set_meta(c, "ai_strong_valid_min_tokens", "80")
main._set_meta(c, "ai_token_daily_cap", "0")
c.close()
main._ai_visitor_hits.clear()
main._ai_ip_hits.clear()
main._ai_strong_hits.clear()

# ---------- 课程评价（2026-11-16）----------
import hashlib
import time as _time

import accounts as _accounts

_notify_calls: list[tuple[str, str]] = []
_orig_notify = main._notify
main._notify = lambda t, c: _notify_calls.append((t, c))  # 拦截推送


def _mk_user(email: str, prefix: str, nickname: str) -> dict:
    """手工造登录态：users + acc_sessions 各一行，返回 cookie dict。"""
    c = main._connect()
    try:
        c.execute(
            "INSERT INTO users (email, prefix, nickname, pass_hash, cohort, ts) VALUES (?, ?, ?, 'x', '2024', ?);",
            (email, prefix, nickname, int(_time.time())))
        uid = c.execute("SELECT last_insert_rowid();").fetchone()[0]
        sid = f"sid-{email}"
        c.execute(
            "INSERT INTO acc_sessions (sid_hash, user_id, expires, ts) VALUES (?, ?, ?, ?);",
            (hashlib.sha256(sid.encode()).hexdigest(), uid, int(_time.time()) + 86400 * 30, int(_time.time())))
        c.commit()
        return {"uid": uid, "cookies": {"oc_sess": sid}}
    finally:
        c.close()


u1 = _mk_user("user1@mails.tsinghua.edu.cn", "user1", "昵称甲")
u2 = _mk_user("user2@mails.tsinghua.edu.cn", "user2", "昵称乙")

r = client.post("/vote/reviews", json={"content": "这门课非常值得上", "topic_id": 1, "sign": "real"})
check("未登录发表评价 401", r.status_code == 401, f"got {r.status_code}")

r = client.get("/vote/reviews/init")
init0 = r.json()
check("init 返回官方条目", init0["logged_in"] is False and len(init0["topics"]) > 100, f"topics={len(init0.get('topics', []))}")
check("letters 仅收录有评价的字母（此刻 0 评价 → 空）", init0["letters"] == [], f"letters={init0['letters']}")
by_name = {t["name"]: t for t in init0["topics"]}

r = client.post("/vote/reviews", cookies=u1["cookies"],
                json={"content": "工程热力学讲得清晰，考试不刁钻，推荐", "topic_id": by_name["工程热力学"]["id"], "sign": "real"})
check("登录后发表评价 200", r.status_code == 200, f"got {r.status_code} {r.text[:120]}")
rv1 = r.json()

r = client.get("/vote/reviews/feed")
check("未审核评价不出现在信息流", all(i["id"] != rv1["id"] for i in r.json()["items"]))

r = client.get(f"/vote/admin/reviews/pending?token={TOKEN}")
check("管理待审队列可见", any(i["id"] == rv1["id"] for i in r.json()["items"]))
pend_item = next(i for i in r.json()["items"] if i["id"] == rv1["id"])
check("待审项带作者邮箱与疑似重复提示", "email" in pend_item and "dup_hints" in pend_item)

r = client.post(f"/vote/admin/reviews/moderate?token={TOKEN}", json={"id": rv1["id"], "action": "approve"})
check("审核通过 200", r.status_code == 200, f"got {r.status_code} {r.text[:120]}")
r = client.get("/vote/reviews/init")
check("有已发布评价后 letters 出现", "G" in r.json()["letters"], f"letters={r.json()['letters']}")
r = client.get("/vote/reviews/feed")
items = r.json()["items"]
check("通过后信息流可见", any(i["id"] == rv1["id"] for i in items))
it1 = next(i for i in items if i["id"] == rv1["id"])
check("实名署名显示邮箱前缀", it1["author_name"] == "user1", f"got {it1['author_name']}")
check("评价带条目信息", it1["topic"]["name"] == "工程热力学" and it1["topic"]["source"] == "official")

# 驳回 + 驳回意见
r = client.post("/vote/reviews", cookies=u2["cookies"],
                json={"content": "随便写两句话测试驳回", "new_name": "测试课程甲", "sign": "nick"})
rv2 = r.json()
client.post(f"/vote/admin/reviews/moderate?token={TOKEN}",
            json={"id": rv2["id"], "action": "reject", "note": "内容与课程无关"})
r = client.get("/vote/reviews/mine", cookies=u2["cookies"])
mine2 = next(i for i in r.json()["items"] if i["id"] == rv2["id"])
check("驳回后我的评价可见原因", mine2["status"] == "rejected" and "无关" in mine2["reject_note"])

# norm_key 归并：工程训练1 / 工程训练一
r = client.post("/vote/reviews", cookies=u1["cookies"],
                json={"content": "工程训练一内容扎实收获很大", "new_name": "工程训练1", "sign": "nick"})
merged1 = r.json()
check("首次创建自定义条目", merged1.get("merged_to") is None, f"got {merged1}")
topic1_id = merged1["topic_id"]
client.post(f"/vote/admin/reviews/moderate?token={TOKEN}", json={"id": merged1["id"], "action": "approve"})
r = client.post("/vote/reviews", cookies=u2["cookies"],
                json={"content": "工程训练一真的很有意思推荐", "new_name": "工程训练一", "sign": "nick"})
merged2 = r.json()
check("norm_key 相同自动归并到已有条目", merged2.get("merged_to") == "工程训练1" and merged2["topic_id"] == topic1_id, f"got {merged2}")

# 互动：多选 + 互斥
client.post(f"/vote/admin/reviews/moderate?token={TOKEN}", json={"id": merged2["id"], "action": "approve"})
r = client.post("/vote/reviews/react", cookies=u1["cookies"], json={"review_id": merged2["id"], "type": "like", "on": True})
check("点亮点赞", "like" in r.json()["mine"])
r = client.post("/vote/reviews/react", cookies=u1["cookies"], json={"review_id": merged2["id"], "type": "useful", "on": True})
check("四档可多选", sorted(r.json()["mine"]) == ["like", "useful"], f"got {r.json()['mine']}")
r = client.post("/vote/reviews/react", cookies=u1["cookies"], json={"review_id": merged2["id"], "type": "unuseful", "on": True})
check("点不实用清空其他档", r.json()["mine"] == ["unuseful"], f"got {r.json()['mine']}")
r = client.post("/vote/reviews/react", cookies=u1["cookies"], json={"review_id": merged2["id"], "type": "unuseful", "on": False})
check("二击取消不实用", r.json()["mine"] == [] and r.json()["reactions"]["unuseful"] == 0, f"got {r.json()}")

# 热度公式与排序
client.post("/vote/reviews/react", cookies=u1["cookies"], json={"review_id": merged2["id"], "type": "like", "on": True})
client.post("/vote/reviews/react", cookies=u1["cookies"], json={"review_id": merged2["id"], "type": "useful", "on": True})
client.post("/vote/reviews/react", cookies=u2["cookies"], json={"review_id": rv1["id"], "type": "doubt", "on": True})
feed = client.get("/vote/reviews/feed?sort=hot").json()["items"]
h2 = next(i for i in feed if i["id"] == merged2["id"])["hot"]
h1 = next(i for i in feed if i["id"] == rv1["id"])["hot"]
check("热度分 = 点赞+实用*2-(真的吗+不实用*2)+观望", h2 == 3 and h1 == -1, f"h2={h2} h1={h1}")
check("热度排序正确", feed[0]["id"] == merged2["id"])

# featured
r = client.get("/vote/reviews/featured")
check("featured 返回热门与最新", len(r.json()["hot"]) > 0 and len(r.json()["latest"]) > 0)

# 举报：一人一次 + 达入队阈值进队列（不推微信） + 自动软删
client.post(f"/vote/admin/reviews/config?token={TOKEN}", json={"config": {"rv_report_push_n": 2, "rv_report_del_n": 2}})
r = client.post("/vote/reviews/report", cookies=u2["cookies"], json={"review_id": rv1["id"], "reason": "测试举报"})
check("首次举报 200", r.status_code == 200, f"got {r.status_code}")
r = client.post("/vote/reviews/report", cookies=u2["cookies"], json={"review_id": rv1["id"], "reason": "重复举报"})
check("同人重复举报 409", r.status_code == 409, f"got {r.status_code}")
_notify_calls.clear()
client.post("/vote/reviews/report", cookies=u1["cookies"], json={"review_id": merged2["id"], "reason": "x"})
client.post("/vote/reviews/report", cookies=u2["cookies"], json={"review_id": merged2["id"], "reason": "y"})
check("举报不再推微信（仅待审提醒推）", len(_notify_calls) == 0, f"calls={len(_notify_calls)}")
r = client.get(f"/vote/admin/reviews/reports?token={TOKEN}")
rep_ids = [i["id"] for i in r.json()["items"]]
check("达入队阈值进举报队列", merged2["id"] in rep_ids, f"ids={rep_ids}")
check("未达阈值不进举报队列", rv1["id"] not in rep_ids, f"ids={rep_ids}")
r = client.get("/vote/reviews/feed")
check("举报达删除阈值自动软删", all(i["id"] != merged2["id"] for i in r.json()["items"]))
client.post(f"/vote/admin/reviews/reports/seen?token={TOKEN}&id={merged2['id']}")
r = client.get(f"/vote/admin/reviews/reports?token={TOKEN}")
check("忽略后举报队列不再显示", all(i["id"] != merged2["id"] for i in r.json()["items"]))

# 软删可恢复 / 作者删除
r = client.post(f"/vote/admin/reviews/moderate?token={TOKEN}", json={"id": merged2["id"], "action": "restore"})
check("软删帖可恢复", r.status_code == 200, f"got {r.status_code}")
r = client.delete(f"/vote/reviews/{merged2['id']}", cookies=u2["cookies"])
check("作者删除自己的评价", r.status_code == 200, f"got {r.status_code}")
feed = client.get("/vote/reviews/feed").json()["items"]
check("作者删除后信息流不可见", all(i["id"] != merged2["id"] for i in feed))

# 每日上限
client.post(f"/vote/admin/reviews/config?token={TOKEN}", json={"config": {"rv_daily_limit": 2}})
r = client.post("/vote/reviews", cookies=u1["cookies"],
                json={"content": "今日第一条补发测试", "new_name": "测试课程乙", "sign": "nick"})
check("达到每日上限 429", r.status_code == 429, f"got {r.status_code}")
client.post(f"/vote/admin/reviews/config?token={TOKEN}", json={"config": {"rv_daily_limit": 5}})

# 条目合并
r = client.post("/vote/reviews", cookies=u1["cookies"],
                json={"content": "甲乙条目合并用评价内容", "new_name": "测试课程丙", "sign": "nick"})
dup_rev = r.json()
topic_c = dup_rev["topic_id"]
client.post(f"/vote/admin/reviews/moderate?token={TOKEN}", json={"id": dup_rev["id"], "action": "approve"})
r = client.post(f"/vote/admin/reviews/topic/merge?token={TOKEN}&from_id={topic1_id}&to_id={topic_c}")
check("条目合并 200", r.status_code == 200, f"got {r.status_code} {r.text[:120]}")
lst = client.get(f"/vote/reviews/list?topic_id={topic_c}").json()
check("合并后评价随迁", any("工程训练" in i["topic"]["name"] or i["topic"]["id"] == topic_c for i in lst["items"]), f"items={len(lst['items'])}")
lst1 = client.get(f"/vote/reviews/list?topic_id={topic1_id}").json()
check("合并后原条目无评价", lst1["total"] == 0, f"total={lst1['total']}")

# 数量+时效提醒
_notify_calls.clear()
main._set_meta(main._connect(), "rv_remind_base", "0,0")
c = main._connect()
c.execute("INSERT INTO reviews (topic_id, content, author_uid, sign, status, ts) VALUES (?, '滞留测试评价', ?, 'nick', 'pending', ?);",
          (topic_c, u1["uid"], int(_time.time()) - 25 * 3600))
c.commit()
c.close()
main._rv_maybe_notify(main._connect())
check("数量/时效提醒触发推送", len(_notify_calls) > 0, f"calls={len(_notify_calls)}")
main._notify = _orig_notify

# 热度排行榜（月榜/年榜）
r = client.get("/vote/reviews/board?period=month")
board = r.json()["items"]
check("月榜返回 ≤10 条", len(board) <= 10, f"n={len(board)}")
check("月榜按热度降序", all(board[i]["hot"] >= board[i + 1]["hot"] for i in range(len(board) - 1)), "")
check("月榜仅含正热度帖（零/负互动不上榜）", all(i["hot"] > 0 for i in board), f"hots={[i['hot'] for i in board]}")
check("非法 period 422", client.get("/vote/reviews/board?period=bad").status_code == 422, "")

# 站内消息：审核不通过事件 + 公告/私信 + 已读
check("消息未登录 401", client.get("/vote/reviews/messages").status_code == 401, "")
client.post(f"/vote/admin/reviews/config?token={TOKEN}", json={"config": {"rv_daily_limit": 0}})  # 0 = 不限额，避免前序用例耗尽当日额度
r = client.post("/vote/reviews", cookies=u1["cookies"], json={"content": "消息事件测试评价内容", "new_name": "消息测试课程甲", "sign": "nick"})
check("消息事件测试评价提交 200", r.status_code == 200, f"got {r.status_code} {r.text[:200]}")
msg_review = r.json()["id"]
client.post(f"/vote/admin/reviews/moderate?token={TOKEN}", json={"id": msg_review, "action": "reject", "note": "措辞不妥"})
r = client.get("/vote/reviews/messages", cookies=u1["cookies"])
u1_msgs = r.json()
check("驳回后作者收到事件消息", any("未通过审核" in m["title"] for m in u1_msgs["items"]), "")
check("事件消息含驳回意见", any("措辞不妥" in (m["content"] or "") for m in u1_msgs["items"]), "")
unread0 = u1_msgs["unread"]
check("未读数 ≥1", unread0 >= 1, f"unread={unread0}")
target_msg = next(m for m in u1_msgs["items"] if "未通过审核" in m["title"])
client.post("/vote/reviews/messages/read", cookies=u1["cookies"], json={"id": target_msg["id"]})
r = client.get("/vote/reviews/messages", cookies=u1["cookies"])
check("单条已读生效", r.json()["unread"] == unread0 - 1, f"unread={r.json()['unread']}")
client.post(f"/vote/admin/reviews/messages?token={TOKEN}", json={"title": "全体公告测试", "content": "hello all"})
client.post(f"/vote/admin/reviews/messages?token={TOKEN}",
            json={"target_email": "user2@mails.tsinghua.edu.cn", "title": "给u2的私信", "content": "hi"})
check("私信目标邮箱不存在 404", client.post(f"/vote/admin/reviews/messages?token={TOKEN}",
      json={"target_email": "nobody@mails.tsinghua.edu.cn", "title": "x"}).status_code == 404, "")
r = client.get("/vote/reviews/messages", cookies=u1["cookies"])
check("u1 看不到他人私信", all("给u2的私信" not in m["title"] for m in r.json()["items"]), "")
check("u1 能看到全体公告", any("全体公告测试" in m["title"] for m in r.json()["items"]), "")
r = client.get("/vote/reviews/messages", cookies=u2["cookies"])
check("u2 能看到私信", any("给u2的私信" in m["title"] for m in r.json()["items"]), "")
client.post("/vote/reviews/messages/read", cookies=u1["cookies"], json={})
r = client.get("/vote/reviews/messages", cookies=u1["cookies"])
check("全部已读后 unread=0", r.json()["unread"] == 0, f"unread={r.json()['unread']}")
r = client.get(f"/vote/admin/reviews/messages?token={TOKEN}")
check("管理页消息列表含公告", any(i["title"] == "全体公告测试" for i in r.json()["items"]), "")
check("管理页消息列表含私信目标邮箱", any(i["target_email"] == "user2@mails.tsinghua.edu.cn" for i in r.json()["items"]), "")

# 归一化单元
check("norm_key 中文数字归一", main._rv_norm_key("工程训练一") == main._rv_norm_key("工程训练1"), "")
check("norm_key 全角空格括号归一", main._rv_norm_key("大学物理Ｂ（１）") == main._rv_norm_key("大学物理B(1)"), "")
check("首字母索引", main._rv_initial("工程热力学") == "G" and main._rv_initial("Python程序设计") == "P", "")
check("首字母 Z 区完整（综合论文/作/座）", main._rv_initial("综合论文") == "Z"
      and main._rv_initial("综合英语") == "Z" and main._rv_initial("座位安排") == "Z", "")


print(f"\n结果：通过 {_passed} 项，失败 {_failed} 项")
if _failed:
    raise SystemExit(1)
