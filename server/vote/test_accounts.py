"""OfCourses 账号系统离线自测（2026-11-14 P2）

覆盖：域白名单 / 验证码申请-冷却-限流 / 校验与一次性注册令牌 / 注册-登录-登出 /
会话与 /me / 资料修改（昵称+字班校验）/ 云端方案 CRUD 与乐观锁冲突 / 用户数据隔离。
SMTP 通过 monkeypatch 拦截，不真实发信，不碰生产数据。

运行：
    python test_accounts.py
"""

import os
import tempfile
import time as _time

_TMP = tempfile.mkdtemp(prefix="ofcourses-acc-test-")
os.environ["VOTE_DB_PATH"] = os.path.join(_TMP, "test.db")
os.environ["VOTE_IP_SALT"] = "test-salt"
os.environ["VOTE_ADMIN_TOKEN"] = "test-admin-token"
os.environ["VOTE_ADMIN_PASSWORD"] = "test-admin-pw"
os.environ["VOTE_SCT_KEY"] = ""
os.environ["ACC_EMAIL_DOMAINS"] = "mails.tsinghua.edu.cn"
os.environ["ACC_SMTP_HOST"] = ""  # 未配置 SMTP：先验证 503 分支，测试中段再 monkeypatch
os.environ["ACC_DEV_ECHO_CODE"] = "1"  # 测试：验证码/算术题答案随响应回显
os.environ["ACC_MAIL_DAILY_CAP"] = "5"  # 测试：调低日额度，便于验证触顶 503

import accounts
import main
from fastapi.testclient import TestClient

client = TestClient(main.app)
client2 = TestClient(main.app)  # 第二用户（验证数据隔离）

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


def _fresh_client() -> TestClient:
    return TestClient(main.app)


def send_code(cl: TestClient, email: str):
    """申请验证码（自动过人机验证：开发回显模式题目答案随响应给出）。"""
    cap = cl.get("/vote/account/captcha").json()
    return cl.post("/vote/account/code", json={
        "email": email,
        "captcha_id": cap["id"],
        "captcha_answer": str(cap.get("dev_answer", "")),
    })


print("\n--- 人机验证：缺题/错题被拒 ---")
r = client.post("/vote/account/code", json={"email": "x1@mails.tsinghua.edu.cn"})
check("无人机验证直接请求 400", r.status_code == 400 and r.json()["detail"] == "captcha_expired", f"got {r.status_code} {r.text}")
cap = client.get("/vote/account/captcha").json()
check("验证码题目签发", "id" in cap and "+" in cap["q"], f"got {cap}")
r = client.post("/vote/account/code", json={"email": "x1@mails.tsinghua.edu.cn", "captcha_id": cap["id"], "captcha_answer": "9999"})
check("算术题答错 400（题目一次性作废）", r.status_code == 400 and r.json()["detail"] == "captcha_wrong", f"got {r.status_code}")
r = client.post("/vote/account/code", json={"email": "x1@mails.tsinghua.edu.cn", "captcha_id": cap["id"], "captcha_answer": "1"})
check("同题重用 400（一次性）", r.status_code == 400 and r.json()["detail"] == "captcha_expired", f"got {r.status_code}")

print("\n--- 验证码申请：域白名单 / SMTP 未配置 / 冷却 ---")
r = send_code(client, "someone@qq.com")
check("非清华域邮箱被拒 400", r.status_code == 400 and r.json()["detail"] == "email_domain_not_allowed", f"got {r.status_code} {r.text}")
r = client.post("/vote/account/code", json={"email": "not-an-email", "captcha_id": cap["id"], "captcha_answer": "1"})
check("非法格式邮箱被拒 400", r.status_code == 400, f"got {r.status_code}")

sent: list[tuple[str, str]] = []
accounts._send_code_email = lambda email, code: sent.append((email, code))  # 拦截真实发信

EMAIL_A = "stu01@mails.tsinghua.edu.cn"
r = send_code(client, EMAIL_A)
check("申请验证码 200（开发回显模式带 dev_code）", r.status_code == 200 and len(r.json().get("dev_code", "")) == 6, f"got {r.status_code} {r.text}")
code_a = r.json()["dev_code"]
r = send_code(client, EMAIL_A)
check("同邮箱 60s 冷却 429（人机验证通过后命中冷却）", r.status_code == 429 and r.json()["detail"] == "code_cooldown", f"got {r.status_code}")

EMAIL_B = "stu02@mails.tsinghua.edu.cn"
r = send_code(client, EMAIL_B)
check("其他邮箱不受冷却影响", r.status_code == 200, f"got {r.status_code}")
code_b = r.json()["dev_code"]

print("\n--- 验证码校验：错码 / 对码换注册令牌 ---")
r = client.post("/vote/account/verify", json={"email": EMAIL_A, "code": "000000"})
check("错误验证码 400", r.status_code == 400 and r.json()["detail"] == "code_wrong", f"got {r.status_code}")
r = client.post("/vote/account/verify", json={"email": EMAIL_A, "code": "12345"})
check("非 6 位码 400", r.status_code == 400 and r.json()["detail"] == "bad_code", f"got {r.status_code}")
r = client.post("/vote/account/verify", json={"email": EMAIL_A, "code": code_a})
check("正确验证码返回一次性注册令牌", r.status_code == 200 and len(r.json().get("reg_token", "")) >= 16, f"got {r.status_code} {r.text}")
reg_token_a = r.json()["reg_token"]

print("\n--- 注册：令牌校验 / 重复邮箱 / 会话 ---")
r = client.post("/vote/account/register", json={"email": EMAIL_A, "reg_token": "wrong-token-wrong-!", "password": "Passw0rd!234"})
check("错误注册令牌 400", r.status_code == 400 and r.json()["detail"] == "reg_token_wrong", f"got {r.status_code}")
r = client.post("/vote/account/register", json={"email": EMAIL_A, "password": "Passw0rd!234"})
check("缺少/无效注册令牌 400", r.status_code == 400 and r.json()["detail"] in ("reg_token_required", "reg_token_wrong", "reg_token_expired"), f"got {r.status_code} {r.text}")
r = client.post("/vote/account/register", json={"email": EMAIL_A, "reg_token": reg_token_a, "password": "Passw0rd!234"})
check("注册成功并种会话 cookie", r.status_code == 200 and "oc_sess" in client.cookies, f"got {r.status_code} {r.text}")
check("默认昵称 = 邮箱前缀", r.json().get("nickname") == "stu01", f"got {r.json()}")
r = client2.post("/vote/account/register", json={"email": EMAIL_A, "reg_token": reg_token_a, "password": "Passw0rd!234"})
check("同邮箱重复注册 409", r.status_code == 409, f"got {r.status_code}")

print("\n--- 会话：/me / 登录 / 登出 ---")
r = client.get("/vote/account/me")
check("登录态 /me 返回邮箱与前缀", r.status_code == 200 and r.json()["email"] == EMAIL_A and r.json()["prefix"] == "stu01", f"got {r.status_code} {r.text}")
r = _fresh_client().get("/vote/account/me")
check("未登录 /me 401", r.status_code == 401, f"got {r.status_code}")
r = client.post("/vote/account/login", json={"email": EMAIL_A, "password": "wrong-password"})
check("错误密码登录 401", r.status_code == 401 and r.json()["detail"] == "wrong_credentials", f"got {r.status_code}")
r = client.post("/vote/account/login", json={"email": EMAIL_A.upper(), "password": "Passw0rd!234"})
check("邮箱大小写不敏感登录 200", r.status_code == 200, f"got {r.status_code} {r.text}")
r = client.post("/vote/account/logout")
check("登出 200", r.status_code == 200)
r = client.get("/vote/account/me")
check("登出后 /me 401", r.status_code == 401, f"got {r.status_code}")
r = client.post("/vote/account/login", json={"email": EMAIL_A, "password": "Passw0rd!234"})
check("重新登录 200", r.status_code == 200 and "oc_sess" in client.cookies, f"got {r.status_code}")

print("\n--- 资料：昵称与字班校验 ---")
r = client.post("/vote/account/profile", json={"nickname": "知更鸟"})
check("改昵称 200", r.status_code == 200 and r.json()["nickname"] == "知更鸟", f"got {r.status_code} {r.text}")
r = client.post("/vote/account/profile", json={"cohort": "2024"})
check("设字班 200", r.status_code == 200 and r.json()["cohort"] == "2024", f"got {r.status_code}")
r = client.post("/vote/account/profile", json={"cohort": "abcd"})
check("非法字班 400", r.status_code == 400 and r.json()["detail"] == "bad_cohort", f"got {r.status_code}")
r = client.post("/vote/account/profile", json={"nickname": "x"})
check("过短昵称 400", r.status_code == 400 and r.json()["detail"] == "bad_nickname", f"got {r.status_code}")

# 昵称每日修改限制（2026-11-16）
r = client.post("/vote/account/profile", json={"nickname": "知更鸟二号"})
check("同日二次改昵称 429", r.status_code == 429 and r.json()["detail"] == "nickname_daily_limit", f"got {r.status_code} {r.text}")
r = client.post("/vote/account/profile", json={"nickname": "知更鸟"})
check("同日改回原昵称不计数 200", r.status_code == 200, f"got {r.status_code} {r.text}")
c = main._connect()
c.execute("UPDATE users SET last_nick_change=? WHERE email=?;", (int(_time.time()) - 2 * 86400, EMAIL_A))
c.commit()
c.close()
r = client.post("/vote/account/profile", json={"nickname": "知更鸟二号"})
check("隔日可再改昵称 200", r.status_code == 200 and r.json()["nickname"] == "知更鸟二号", f"got {r.status_code} {r.text}")
check("/me 带回 last_nick_change", "last_nick_change" in client.get("/vote/account/me").json(), "")

print("\n--- 云端方案：CRUD / 乐观锁 / 数据隔离 ---")
r = client.get("/vote/account/schemes")
check("空方案列表 200", r.status_code == 200 and r.json()["schemes"] == [], f"got {r.status_code} {r.text}")
r = client.post("/vote/account/schemes/save", json={"name": "默认方案", "data": "{\"history\": {}, \"custom\": {}}"})
check("首存方案 200 并返回 id/updated_at", r.status_code == 200 and r.json().get("id", 0) > 0, f"got {r.status_code} {r.text}")
scheme_id = r.json()["id"]
v1 = r.json()["updated_at"]
r = client.post("/vote/account/schemes/save", json={"name": "默认方案", "data": "{\"history\": {\"2024-秋\": [\"301\"]}, \"custom\": {}}", "base_updated_at": v1})
check("基于最新版本写入 200", r.status_code == 200, f"got {r.status_code} {r.text}")
v2 = r.json()["updated_at"]
r = client.post("/vote/account/schemes/save", json={"name": "默认方案", "data": "{\"stale\": true}", "base_updated_at": v1})
check("基于旧版本写入 409 冲突并回带服务器版本", r.status_code == 409 and r.json().get("server_updated_at") == v2, f"got {r.status_code} {r.text}")
r = client.post("/vote/account/schemes/save", json={"name": "默认方案", "data": "not-json"})
check("非法 JSON 数据 400", r.status_code == 400 and r.json()["detail"] == "bad_data", f"got {r.status_code}")
r = client.get(f"/vote/account/schemes/detail?id={scheme_id}")
check("拉取方案详情含数据与版本", r.status_code == 200 and "2024-秋" in r.json()["data"] and r.json()["updated_at"] == v2, f"got {r.status_code} {r.text}")
r = client.post("/vote/account/schemes/save", json={"name": "方案 B", "data": "{\"x\": 1}"})
check("多套方案可并存", r.status_code == 200, f"got {r.status_code}")
r = client.get("/vote/account/schemes")
check("列表含两套方案", r.status_code == 200 and {s["name"] for s in r.json()["schemes"]} == {"默认方案", "方案 B"}, f"got {r.json()}")

r = client2.post("/vote/account/login", json={"email": EMAIL_B, "password": "x"})
check("未注册邮箱登录 401（B 尚未注册）", r.status_code == 401, f"got {r.status_code}")
# B 走完整注册流程（用其验证码）
r = client2.post("/vote/account/verify", json={"email": EMAIL_B, "code": code_b})
reg_token_b = r.json()["reg_token"]
r = client2.post("/vote/account/register", json={"email": EMAIL_B, "reg_token": reg_token_b, "password": "Passw0rd!456"})
check("第二用户注册 200", r.status_code == 200, f"got {r.status_code} {r.text}")
r = client2.get(f"/vote/account/schemes/detail?id={scheme_id}")
check("用户 B 无法读取用户 A 的方案 404", r.status_code == 404, f"got {r.status_code}")
r = client2.post("/vote/account/schemes/delete", json={"id": scheme_id})
check("用户 B 无法删除用户 A 的方案（删 0 行不报错）", r.status_code == 200, f"got {r.status_code}")
r = client.get(f"/vote/account/schemes/detail?id={scheme_id}")
check("B 的越权删除对 A 无效（方案仍在）", r.status_code == 200, f"got {r.status_code}")

r = client.post("/vote/account/schemes/delete", json={"id": scheme_id})
check("属主删除方案 200", r.status_code == 200)
r = client.get(f"/vote/account/schemes/detail?id={scheme_id}")
check("删除后详情 404", r.status_code == 404, f"got {r.status_code}")

print("\n--- 同源校验（CSRF 防线） ---")
r = client.post("/vote/account/login", json={"email": EMAIL_B, "password": "Passw0rd!456"}, headers={"Sec-Fetch-Site": "cross-site"})
check("跨站状态变更请求被拒 403", r.status_code == 403 and r.json()["detail"] == "cross-site request blocked", f"got {r.status_code}")

print("\n--- 发信额度触顶（对齐 DirectMail 免费额度） ---")
day_key = __import__("time").strftime("acc_mail_cnt_%Y%m%d")
c = main._connect()
try:
    main._set_meta(c, day_key, "5")  # 直接把当日计数打到上限（ACC_MAIL_DAILY_CAP=5）
    c.commit()
finally:
    c.close()
r = send_code(client, "quota-test@mails.tsinghua.edu.cn")
check("日额度触顶后拒绝发信 503", r.status_code == 503 and r.json()["detail"] == "mail_quota_exceeded", f"got {r.status_code} {r.text}")
c = main._connect()
try:
    cnt = main._get_meta(c, day_key)
finally:
    c.close()
check("触顶不消耗额度（计数仍为 5）", cnt == "5", f"got {cnt}")
r = client2.post("/vote/account/login", json={"email": EMAIL_B, "password": "Passw0rd!456"})
check("额度触顶不影响登录（仅拦验证码发放）", r.status_code == 200, f"got {r.status_code}")

print(f"\n结果：通过 {_passed} 项，失败 {_failed} 项")
if _failed:
    raise SystemExit(1)
