"""
OfCourses 账号系统（2026-11-14 规划 P2）

设计要点：
  - 身份 = 清华学生邮箱（域白名单，默认 @mails.tsinghua.edu.cn），注册走「邮箱验证码」：
        请求验证码 → 校验验证码（换一次性注册令牌）→ 设密码完成注册
  - 不实名：默认显示名 = 邮箱前缀（清华学生邮箱特有格式）；社交场景显示昵称；
    邮箱本身不出现在任何公开接口里（仅本人 /account/me 可见）
  - 密码：stdlib pbkdf2_hmac（sha256，24 万轮，随机盐）——不引第三方依赖
  - 会话：HttpOnly cookie（oc_sess），服务端只存 sha256(sid)，30 天有效
  - 云端方案：user_schemes 存「整份方案 JSON 快照」，支持多套命名方案；
    写入带 base_updated_at 乐观锁，防止双端互踩
  - 限流：验证码/登录/注册分桶限流（复用 main 的滑动窗口）；同源校验防 CSRF
  - 邮件：SMTP 环境变量注入（ACC_SMTP_*），未配置时请求验证码返回 503（不泄露细节）

路由统一挂 /vote/account/*（nginx 已把 /vote/ 反代到本服务，无需新增 nginx 配置）。
"""

import hashlib
import json
import os
import re
import secrets
import smtplib
import sqlite3
import time
from collections import defaultdict, deque
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Deque, Dict, List

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

# ---------- 配置（全部经 systemd 环境变量注入） ----------
ACC_EMAIL_DOMAINS = [d.strip().lower() for d in os.environ.get("ACC_EMAIL_DOMAINS", "mails.tsinghua.edu.cn").split(",") if d.strip()]
ACC_SMTP_HOST = os.environ.get("ACC_SMTP_HOST", "")
ACC_SMTP_PORT = int(os.environ.get("ACC_SMTP_PORT", "465"))
ACC_SMTP_SSL = os.environ.get("ACC_SMTP_SSL", "1") == "1"      # 1 = SMTP_SSL(465)，0 = STARTTLS(587)
ACC_SMTP_USER = os.environ.get("ACC_SMTP_USER", "")
ACC_SMTP_PASS = os.environ.get("ACC_SMTP_PASS", "")
ACC_SMTP_FROM = os.environ.get("ACC_SMTP_FROM", "")            # 发件人地址（默认取 ACC_SMTP_USER）
ACC_SMTP_FROM_NAME = os.environ.get("ACC_SMTP_FROM_NAME", "OfCourses")
ACC_SESSION_TTL = int(os.environ.get("ACC_SESSION_TTL", str(30 * 86400)))
ACC_CODE_TTL = int(os.environ.get("ACC_CODE_TTL", "600"))       # 验证码有效期（秒）
ACC_REG_TOKEN_TTL = int(os.environ.get("ACC_REG_TOKEN_TTL", "600"))
# 开发模式：把验证码回显在接口响应里（本地联调用；生产环境严禁设置该变量）
ACC_DEV_ECHO_CODE = os.environ.get("ACC_DEV_ECHO_CODE", "") == "1"

# ---------- 发信额度上限（对齐 DirectMail 免费额度，防刷爆额度产生费用） ----------
# DirectMail 免费额度：新账号日 200 封/月 2000 封（随信誉等级提升）；上限留足余量且低于额度线。
# 计数器存 meta 表（跨重启持久）：acc_mail_cnt_YYYYMMDD / acc_mail_cnt_YYYYMM。
ACC_MAIL_DAILY_CAP = int(os.environ.get("ACC_MAIL_DAILY_CAP", "180"))
ACC_MAIL_MONTHLY_CAP = int(os.environ.get("ACC_MAIL_MONTHLY_CAP", "1800"))

# ---------- 算术人机验证（轻量自建，防脚本刷验证码） ----------
ACC_CAPTCHA_TTL = int(os.environ.get("ACC_CAPTCHA_TTL", "300"))  # 题目有效期（秒）
_captchas: Dict[str, list] = {}  # id -> [answer, expires]

SESSION_COOKIE = "oc_sess"
CODE_SALT = "ofcourses-acc-code-v1"

CODE_RE = re.compile(r"^\d{6}$")
EMAIL_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,63}@[a-z0-9.-]+$")
NICK_RE = re.compile(r"^[\w\u4e00-\u9fff\u3040-\u30ff-]{2,24}$", re.UNICODE)
# cohort：'' 未设 / 'auto' 由邮箱前缀自动推断 / '20XX' 手动指定入学年
COHORT_RE = re.compile(r"^(auto|20[0-9]{2})$")
PBKDF2_ITERS = 240_000

# ---------- 限流桶（独立于 main 的投票桶，互不占用；与 main._hit 配套用 defaultdict） ----------
_code_email_hits: Dict[str, Deque[float]] = defaultdict(deque)  # 同邮箱验证码请求（配合 DB 冷却再限 5 次/时）
_code_ip_hits: Dict[str, Deque[float]] = defaultdict(deque)     # 同 IP 验证码请求 10/时
_verify_ip_hits: Dict[str, Deque[float]] = defaultdict(deque)   # 同 IP 验证码校验 30/时
_register_ip_hits: Dict[str, Deque[float]] = defaultdict(deque) # 同 IP 注册 5/时
_login_email_hits: Dict[str, Deque[float]] = defaultdict(deque) # 同邮箱登录尝试 10/时
_login_ip_hits: Dict[str, Deque[float]] = defaultdict(deque)    # 同 IP 登录尝试 30/时
_scheme_hits: Dict[str, Deque[float]] = defaultdict(deque)      # 同用户方案写入 60/时


# ---------- 工具（运行期从 main 注入，避免循环导入） ----------
_dep: Dict = {}


def register_account_routes() -> None:
    """由 main.py 在文件末尾调用：注入依赖并注册全部 /vote/account/* 路由。"""
    from main import (  # noqa: PLC0415  延迟导入：main 此时已完成定义
        _client_ip, _connect, _hit, _ip_hash, _same_origin, app,
    )

    _dep.update(client_ip=_client_ip, connect=_connect, hit=_hit, ip_hash=_ip_hash, same_origin=_same_origin)

    @app.get("/vote/account/captcha")
    def acc_captcha():
        return _captcha_new()

    @app.post("/vote/account/code")
    def acc_request_code(payload: CodeIn, request: Request):
        return _request_code(payload, request)

    @app.post("/vote/account/verify")
    def acc_verify(payload: VerifyIn, request: Request):
        return _verify(payload, request)

    @app.post("/vote/account/register")
    def acc_register(payload: RegisterIn, request: Request):
        return _register(payload, request)

    @app.post("/vote/account/login")
    def acc_login(payload: LoginIn, request: Request):
        return _login(payload, request)

    @app.post("/vote/account/logout")
    def acc_logout(request: Request):
        return _logout(request)

    @app.get("/vote/account/me")
    def acc_me(request: Request):
        return _me(request)

    @app.post("/vote/account/profile")
    def acc_profile(payload: ProfileIn, request: Request):
        return _profile(payload, request)

    @app.get("/vote/account/schemes")
    def acc_schemes(request: Request):
        return _schemes_list(request)

    @app.post("/vote/account/schemes/save")
    def acc_schemes_save(payload: SchemeSaveIn, request: Request):
        return _schemes_save(payload, request)

    @app.get("/vote/account/schemes/detail")
    def acc_schemes_detail(id: int, request: Request):
        return _schemes_detail(id, request)

    @app.post("/vote/account/schemes/delete")
    def acc_schemes_delete(payload: SchemeDeleteIn, request: Request):
        return _schemes_delete(payload, request)

    @app.post("/vote/account/schemes/rename")
    def acc_schemes_rename(payload: SchemeRenameIn, request: Request):
        return _schemes_rename(payload, request)

    @app.post("/vote/account/password/reset")
    def acc_password_reset(payload: PasswordResetIn, request: Request):
        return _password_reset(payload, request)


# ---------- 请求模型 ----------
class CodeIn(BaseModel):
    email: str = Field(min_length=6, max_length=254)
    captcha_id: str = Field(default="", max_length=64)
    captcha_answer: str = Field(default="", max_length=16)


class VerifyIn(BaseModel):
    email: str = Field(min_length=6, max_length=254)
    code: str = Field(max_length=16)  # 格式由端点内 CODE_RE 校验（返回统一 400 而非 422）


class RegisterIn(BaseModel):
    email: str = Field(min_length=6, max_length=254)
    reg_token: str = Field(default="", max_length=64)
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(default="", max_length=24)


class LoginIn(BaseModel):
    email: str = Field(min_length=6, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class ProfileIn(BaseModel):
    nickname: str | None = Field(default=None, max_length=24)
    cohort: str | None = Field(default=None, max_length=4)


class SchemeSaveIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    data: str = Field(min_length=2, max_length=256 * 1024)  # 整份方案 JSON 快照
    base_updated_at: int = Field(default=0, ge=0)            # 乐观锁：客户端持有的版本


class SchemeDeleteIn(BaseModel):
    id: int = Field(ge=1)


class SchemeRenameIn(BaseModel):
    id: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=40)


class PasswordResetIn(BaseModel):
    email: str = Field(min_length=6, max_length=254)
    reg_token: str = Field(default="", max_length=64)   # verify 签发的一次性令牌（复用注册验证链路）
    new_password: str = Field(min_length=8, max_length=128)


# ---------- 账号表迁移（main._connect 调用） ----------
def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            email     TEXT NOT NULL UNIQUE,
            prefix    TEXT NOT NULL,
            nickname  TEXT NOT NULL,
            pass_hash TEXT NOT NULL,
            cohort    TEXT NOT NULL DEFAULT '',
            ts        INTEGER NOT NULL
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);")
    # 昵称每日修改限制（2026-11-16）：users 表补 last_nick_change 列（老库迁移）
    cols = [r[1] for r in conn.execute("PRAGMA table_info(users);")]
    if "last_nick_change" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN last_nick_change INTEGER NOT NULL DEFAULT 0;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS acc_sessions (
            sid_hash  TEXT PRIMARY KEY,
            user_id   INTEGER NOT NULL,
            expires   INTEGER NOT NULL,
            ts        INTEGER NOT NULL
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS email_codes (
            email          TEXT PRIMARY KEY,
            code_hash      TEXT NOT NULL,
            tries          INTEGER NOT NULL DEFAULT 0,
            reg_token_hash TEXT NOT NULL DEFAULT '',
            ts             INTEGER NOT NULL
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_schemes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            name       TEXT NOT NULL,
            data       TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(user_id, name)
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_user_schemes_user ON user_schemes(user_id);")


# ---------- 基础工具 ----------
def _norm_email(email: str) -> str:
    return email.strip().lower()


def _meta_get(conn: sqlite3.Connection, key: str, default: str = "0") -> str:
    row = conn.execute("SELECT value FROM meta WHERE key = ?;", (key,)).fetchone()
    return row[0] if row and row[0] is not None else default


def _meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
        (key, value),
    )


def _mail_quota_check(conn: sqlite3.Connection) -> str | None:
    """发信额度检查（对齐 DirectMail 免费额度）。返回 None=可发，否则为拒绝 detail。"""
    day_key = time.strftime("acc_mail_cnt_%Y%m%d")
    mon_key = time.strftime("acc_mail_cnt_%Y%m")
    daily = int(_meta_get(conn, day_key))
    monthly = int(_meta_get(conn, mon_key))
    if daily >= ACC_MAIL_DAILY_CAP or monthly >= ACC_MAIL_MONTHLY_CAP:
        # 触顶只推一次 Server酱（当日标记），避免告警轰炸
        notify_key = time.strftime("acc_mail_notify_%Y%m%d")
        if _meta_get(conn, notify_key) != "1":
            _meta_set(conn, notify_key, "1")
            try:
                from main import _notify  # noqa: PLC0415
                _notify(
                    "OfCourses 邮件额度触顶",
                    f"今日已发 {daily}/{ACC_MAIL_DAILY_CAP}，本月 {monthly}/{ACC_MAIL_MONTHLY_CAP}。\n"
                    "验证码邮件已暂停发放（用户会收到『今日额度已用尽』提示）。",
                )
            except Exception:
                pass
        return "mail_quota_exceeded"
    return None


def _mail_quota_incr(conn: sqlite3.Connection) -> None:
    day_key = time.strftime("acc_mail_cnt_%Y%m%d")
    mon_key = time.strftime("acc_mail_cnt_%Y%m")
    _meta_set(conn, day_key, str(int(_meta_get(conn, day_key)) + 1))
    _meta_set(conn, mon_key, str(int(_meta_get(conn, mon_key)) + 1))


def _captcha_new() -> dict:
    """签发一道算术题（防脚本刷验证码）。内存存储，5 分钟有效，一次性。"""
    now = time.time()
    # 顺手清理过期题（低频接口，直接全扫）
    for k in [k for k, v in _captchas.items() if v[1] < now]:
        _captchas.pop(k, None)
    if len(_captchas) > 10_000:
        _captchas.clear()
    a, b = secrets.randbelow(9) + 1, secrets.randbelow(9) + 1
    cid = secrets.token_hex(12)
    _captchas[cid] = [a + b, now + ACC_CAPTCHA_TTL]
    resp: dict = {"id": cid, "q": f"{a} + {b}"}
    if ACC_DEV_ECHO_CODE:
        resp["dev_answer"] = a + b  # 本地联调：跳过心算
    return resp


def _captcha_check(cid: str, answer: str) -> str | None:
    """校验人机验证。返回 None=通过，否则为拒绝 detail。"""
    item = _captchas.pop(cid, None)  # 一次性：无论对错都作废，重试需换新题
    if item is None:
        return "captcha_expired"
    answer_value, expires = item
    if time.time() > expires:
        return "captcha_expired"
    try:
        if int(answer.strip()) != int(answer_value):
            return "captcha_wrong"
    except ValueError:
        return "captcha_wrong"
    return None


def _email_ok(email: str) -> bool:
    if not EMAIL_RE.match(email):
        return False
    domain = email.split("@", 1)[1]
    return domain in ACC_EMAIL_DOMAINS


def _hash_pw(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERS)
    return f"pbkdf2_sha256${PBKDF2_ITERS}${salt.hex()}${dk.hex()}"


def _check_pw(password: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters))
        return secrets.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def _code_hash(code: str) -> str:
    return hashlib.sha256((CODE_SALT + code).encode("utf-8")).hexdigest()


def _send_code_email(email: str, code: str) -> None:
    """SMTP 发送验证码邮件。未配置 SMTP 抛 RuntimeError，由调用方转 503。"""
    if not (ACC_SMTP_HOST and ACC_SMTP_USER and ACC_SMTP_PASS):
        raise RuntimeError("smtp_unconfigured")
    sender = ACC_SMTP_FROM or ACC_SMTP_USER
    body = (
        f"你的 OfCourses 验证码是：{code}\n\n"
        f"{ACC_CODE_TTL // 60} 分钟内有效。若非本人操作，请忽略本邮件。\n\n"
        f"— {ACC_SMTP_FROM_NAME}"
    )
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = f"OfCourses 验证码：{code}"
    msg["From"] = formataddr((ACC_SMTP_FROM_NAME, sender))
    msg["To"] = email
    if ACC_SMTP_SSL:
        smtp = smtplib.SMTP_SSL(ACC_SMTP_HOST, ACC_SMTP_PORT, timeout=15)
    else:
        smtp = smtplib.SMTP(ACC_SMTP_HOST, ACC_SMTP_PORT, timeout=15)
        try:
            smtp.starttls()
        except smtplib.SMTPException:
            pass
    try:
        smtp.login(ACC_SMTP_USER, ACC_SMTP_PASS)
        smtp.sendmail(sender, [email], msg.as_string())
    finally:
        smtp.quit()


def _set_session_cookie(resp: Response, user_id: int, request: Request) -> None:
    sid = secrets.token_hex(32)
    now = time.time()
    conn = _dep["connect"]()
    try:
        conn.execute(
            "INSERT INTO acc_sessions (sid_hash, user_id, expires, ts) VALUES (?, ?, ?, ?);",
            (hashlib.sha256(sid.encode()).hexdigest(), user_id, int(now + ACC_SESSION_TTL), int(now)),
        )
        conn.commit()
    finally:
        conn.close()
    resp.set_cookie(
        SESSION_COOKIE, sid,
        max_age=ACC_SESSION_TTL, httponly=True, samesite="lax", path="/vote",
        secure=request.headers.get("x-forwarded-proto") == "https",
    )


def _current_user(request: Request) -> dict | None:
    sid = request.cookies.get(SESSION_COOKIE, "")
    if not sid:
        return None
    sid_hash = hashlib.sha256(sid.encode()).hexdigest()
    conn = _dep["connect"]()
    try:
        row = conn.execute(
            "SELECT s.user_id, s.expires, u.email, u.prefix, u.nickname, u.cohort, u.ts, u.last_nick_change "
            "FROM acc_sessions s JOIN users u ON u.id = s.user_id WHERE s.sid_hash = ?;",
            (sid_hash,),
        ).fetchone()
        if not row or time.time() > row[1]:
            return None
        return {"user_id": row[0], "email": row[2], "prefix": row[3], "nickname": row[4], "cohort": row[5],
                "created_ts": row[6], "last_nick_change": row[7] or 0}
    finally:
        conn.close()


def _unauthorized() -> JSONResponse:
    return JSONResponse({"detail": "unauthorized"}, status_code=401)


# ---------- 端点实现 ----------
def _request_code(payload: CodeIn, request: Request):
    if not _dep["same_origin"](request):
        return JSONResponse({"detail": "cross-site request blocked"}, status_code=403)
    # 人机验证：先于一切业务校验（防脚本低成本探测）
    captcha_err = _captcha_check(payload.captcha_id, payload.captcha_answer)
    if captcha_err:
        return JSONResponse({"detail": captcha_err}, status_code=400)
    email = _norm_email(payload.email)
    if not _email_ok(email):
        return JSONResponse({"detail": "email_domain_not_allowed"}, status_code=400)
    # 限流：同邮箱 60s 1 次 / 每小时 5 次；同 IP 每小时 10 次
    conn = _dep["connect"]()
    try:
        row = conn.execute("SELECT ts FROM email_codes WHERE email = ?;", (email,)).fetchone()
    finally:
        conn.close()
    now = time.time()
    if row and now - row[0] < 60:
        return JSONResponse({"detail": "code_cooldown"}, status_code=429, headers={"Retry-After": "60"})
    if _dep["hit"](_code_email_hits, f"e:{email}", 5):
        return JSONResponse({"detail": "too many requests"}, status_code=429)
    if _dep["hit"](_code_ip_hits, _dep["client_ip"](request), 10):
        return JSONResponse({"detail": "too many requests"}, status_code=429)
    # 发信额度（对齐 DirectMail 免费额度，超出即停发并告警管理员）
    conn = _dep["connect"]()
    try:
        quota_err = _mail_quota_check(conn)
    finally:
        conn.close()
    if quota_err:
        return JSONResponse({"detail": quota_err}, status_code=503)
    code = f"{secrets.randbelow(1_000_000):06d}"
    if ACC_DEV_ECHO_CODE:
        pass  # 开发回显模式：跳过真实发信，验证码随响应返回
    else:
        try:
            _send_code_email(email, code)
        except RuntimeError:
            return JSONResponse({"detail": "email_service_unconfigured"}, status_code=503)
        except Exception:
            return JSONResponse({"detail": "email_send_failed"}, status_code=502)
    conn = _dep["connect"]()
    try:
        conn.execute(
            "INSERT INTO email_codes (email, code_hash, tries, reg_token_hash, ts) VALUES (?, ?, 0, '', ?) "
            "ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, tries = 0, reg_token_hash = '', ts = excluded.ts;",
            (email, _code_hash(code), int(now)),
        )
        if not ACC_DEV_ECHO_CODE:
            _mail_quota_incr(conn)  # 只计真实发信；开发回显不计
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "expires_in": ACC_CODE_TTL, **({"dev_code": code} if ACC_DEV_ECHO_CODE else {})}


def _verify(payload: VerifyIn, request: Request):
    if not _dep["same_origin"](request):
        return JSONResponse({"detail": "cross-site request blocked"}, status_code=403)
    email = _norm_email(payload.email)
    if not CODE_RE.match(payload.code):
        return JSONResponse({"detail": "bad_code"}, status_code=400)
    if _dep["hit"](_verify_ip_hits, _dep["client_ip"](request), 30):
        return JSONResponse({"detail": "too many requests"}, status_code=429)
    conn = _dep["connect"]()
    try:
        row = conn.execute("SELECT code_hash, tries, ts FROM email_codes WHERE email = ?;", (email,)).fetchone()
        if not row:
            return JSONResponse({"detail": "no_code"}, status_code=400)
        code_hash, tries, ts = row
        if time.time() - ts > ACC_CODE_TTL:
            return JSONResponse({"detail": "code_expired"}, status_code=400)
        if tries >= 5:
            return JSONResponse({"detail": "code_locked"}, status_code=400)
        if not secrets.compare_digest(code_hash, _code_hash(payload.code)):
            conn.execute("UPDATE email_codes SET tries = tries + 1 WHERE email = ?;", (email,))
            conn.commit()
            return JSONResponse({"detail": "code_wrong"}, status_code=400)
        # 通过：签发一次性注册令牌（10 分钟），绑定该邮箱
        reg_token = secrets.token_hex(16)
        conn.execute(
            "UPDATE email_codes SET reg_token_hash = ?, ts = ? WHERE email = ?;",
            (hashlib.sha256(reg_token.encode()).hexdigest(), int(time.time()), email),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "reg_token": reg_token, "expires_in": ACC_REG_TOKEN_TTL}


def _register(payload: RegisterIn, request: Request):
    if not _dep["same_origin"](request):
        return JSONResponse({"detail": "cross-site request blocked"}, status_code=403)
    email = _norm_email(payload.email)
    if not _email_ok(email):
        return JSONResponse({"detail": "email_domain_not_allowed"}, status_code=400)
    if _dep["hit"](_register_ip_hits, _dep["client_ip"](request), 5):
        return JSONResponse({"detail": "too many requests"}, status_code=429)
    nickname = payload.nickname.strip()
    if nickname and not NICK_RE.match(nickname):
        return JSONResponse({"detail": "bad_nickname"}, status_code=400)
    prefix = email.split("@", 1)[0]
    conn = _dep["connect"]()
    try:
        # 已注册邮箱优先判定（即使令牌校验也放前面，避免泄露令牌有效性）
        if conn.execute("SELECT id FROM users WHERE email = ?;", (email,)).fetchone():
            return JSONResponse({"detail": "email_taken"}, status_code=409)
        row = conn.execute("SELECT reg_token_hash, ts FROM email_codes WHERE email = ?;", (email,)).fetchone()
        if not row or not row[0]:
            return JSONResponse({"detail": "reg_token_required"}, status_code=400)
        if time.time() - row[1] > ACC_REG_TOKEN_TTL:
            return JSONResponse({"detail": "reg_token_expired"}, status_code=400)
        if not secrets.compare_digest(row[0], hashlib.sha256(payload.reg_token.encode()).hexdigest()):
            return JSONResponse({"detail": "reg_token_wrong"}, status_code=400)
        now = int(time.time())
        cur = conn.execute(
            "INSERT INTO users (email, prefix, nickname, pass_hash, cohort, ts) VALUES (?, ?, ?, ?, '', ?);",
            (email, prefix, nickname or prefix, _hash_pw(payload.password), now),
        )
        user_id = cur.lastrowid
        conn.execute("DELETE FROM email_codes WHERE email = ?;", (email,))
        conn.commit()
    finally:
        conn.close()
    resp = JSONResponse({"ok": True, "nickname": nickname or prefix})
    _set_session_cookie(resp, user_id, request)
    return resp


def _login(payload: LoginIn, request: Request):
    if not _dep["same_origin"](request):
        return JSONResponse({"detail": "cross-site request blocked"}, status_code=403)
    email = _norm_email(payload.email)
    # 防爆破：同邮箱 10 次/时 + 同 IP 30 次/时
    if _dep["hit"](_login_email_hits, f"l:{email}", 10):
        return JSONResponse({"detail": "too many requests"}, status_code=429)
    if _dep["hit"](_login_ip_hits, _dep["client_ip"](request), 30):
        return JSONResponse({"detail": "too many requests"}, status_code=429)
    conn = _dep["connect"]()
    try:
        row = conn.execute("SELECT id, pass_hash FROM users WHERE email = ?;", (email,)).fetchone()
    finally:
        conn.close()
    if not row or not _check_pw(payload.password, row[1]):
        return JSONResponse({"detail": "wrong_credentials"}, status_code=401)
    resp = JSONResponse({"ok": True})
    _set_session_cookie(resp, row[0], request)
    return resp


def _logout(request: Request):
    sid = request.cookies.get(SESSION_COOKIE, "")
    if sid:
        conn = _dep["connect"]()
        try:
            conn.execute("DELETE FROM acc_sessions WHERE sid_hash = ?;", (hashlib.sha256(sid.encode()).hexdigest(),))
            conn.commit()
        finally:
            conn.close()
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE, path="/vote")
    return resp


def _me(request: Request):
    user = _current_user(request)
    if not user:
        return _unauthorized()
    return {"email": user["email"], "prefix": user["prefix"], "nickname": user["nickname"],
            "cohort": user["cohort"], "created_ts": user["created_ts"],
            "last_nick_change": user.get("last_nick_change", 0)}


def _profile(payload: ProfileIn, request: Request):
    if not _dep["same_origin"](request):
        return JSONResponse({"detail": "cross-site request blocked"}, status_code=403)
    user = _current_user(request)
    if not user:
        return _unauthorized()
    sets: List[str] = []
    vals: List = []
    if payload.nickname is not None:
        nickname = payload.nickname.strip()
        if not NICK_RE.match(nickname):
            return JSONResponse({"detail": "bad_nickname"}, status_code=400)
        if nickname != user["nickname"]:
            # 昵称每天最多修改一次（真实改动才计数；86400s 滚动窗口）
            if time.time() - user.get("last_nick_change", 0) < 86400:
                return JSONResponse({"detail": "nickname_daily_limit"}, status_code=429)
            sets.append("last_nick_change = ?")
            vals.append(int(time.time()))
        sets.append("nickname = ?")
        vals.append(nickname)
    if payload.cohort is not None:
        cohort = payload.cohort.strip()
        if cohort and not COHORT_RE.match(cohort):
            return JSONResponse({"detail": "bad_cohort"}, status_code=400)
        sets.append("cohort = ?")
        vals.append(cohort)
    if sets:
        conn = _dep["connect"]()
        try:
            conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?;", (*vals, user["user_id"]))
            conn.commit()
        finally:
            conn.close()
    return _me(request)


def _schemes_list(request: Request):
    user = _current_user(request)
    if not user:
        return _unauthorized()
    conn = _dep["connect"]()
    try:
        rows = conn.execute(
            "SELECT id, name, updated_at FROM user_schemes WHERE user_id = ? ORDER BY updated_at DESC, id DESC;",
            (user["user_id"],),
        ).fetchall()
    finally:
        conn.close()
    return {"schemes": [{"id": r[0], "name": r[1], "updated_at": r[2]} for r in rows]}


def _schemes_save(payload: SchemeSaveIn, request: Request):
    if not _dep["same_origin"](request):
        return JSONResponse({"detail": "cross-site request blocked"}, status_code=403)
    user = _current_user(request)
    if not user:
        return _unauthorized()
    try:
        json.loads(payload.data)  # 只做合法性校验，原样存储
    except Exception:
        return JSONResponse({"detail": "bad_data"}, status_code=400)
    if _dep["hit"](_scheme_hits, f"u:{user['user_id']}", 60):
        return JSONResponse({"detail": "too many requests"}, status_code=429)
    now = int(time.time())
    conn = _dep["connect"]()
    try:
        row = conn.execute(
            "SELECT id, updated_at FROM user_schemes WHERE user_id = ? AND name = ?;",
            (user["user_id"], payload.name),
        ).fetchone()
        if row:
            scheme_id, server_updated = row
            # 版本单调递增：同秒内连续保存也保证 updated_at 严格增加，否则乐观锁失效
            now = max(now, server_updated + 1)
            # 乐观锁：客户端基于旧版本写入 → 409，让前端决定覆盖方向
            if payload.base_updated_at and server_updated > payload.base_updated_at:
                return JSONResponse(
                    {"detail": "conflict", "server_updated_at": server_updated},
                    status_code=409,
                )
            conn.execute(
                "UPDATE user_schemes SET data = ?, updated_at = ? WHERE id = ?;",
                (payload.data, now, scheme_id),
            )
        else:
            cur = conn.execute(
                "INSERT INTO user_schemes (user_id, name, data, updated_at) VALUES (?, ?, ?, ?);",
                (user["user_id"], payload.name, payload.data, now),
            )
            scheme_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "id": scheme_id, "updated_at": now}


def _schemes_detail(id: int, request: Request):
    user = _current_user(request)
    if not user:
        return _unauthorized()
    conn = _dep["connect"]()
    try:
        row = conn.execute(
            "SELECT id, name, data, updated_at FROM user_schemes WHERE id = ? AND user_id = ?;",
            (id, user["user_id"]),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return JSONResponse({"detail": "not_found"}, status_code=404)
    return {"id": row[0], "name": row[1], "data": row[2], "updated_at": row[3]}


def _schemes_delete(payload: SchemeDeleteIn, request: Request):
    if not _dep["same_origin"](request):
        return JSONResponse({"detail": "cross-site request blocked"}, status_code=403)
    user = _current_user(request)
    if not user:
        return _unauthorized()
    conn = _dep["connect"]()
    try:
        conn.execute("DELETE FROM user_schemes WHERE id = ? AND user_id = ?;", (payload.id, user["user_id"]))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


def _schemes_rename(payload: SchemeRenameIn, request: Request):
    if not _dep["same_origin"](request):
        return JSONResponse({"detail": "cross-site request blocked"}, status_code=403)
    user = _current_user(request)
    if not user:
        return _unauthorized()
    conn = _dep["connect"]()
    try:
        # 目标名已存在同用户方案 → 拒绝重命名（保持乐观锁语义干净）
        dup = conn.execute(
            "SELECT id FROM user_schemes WHERE user_id = ? AND name = ?;",
            (user["user_id"], payload.name),
        ).fetchone()
        if dup and dup[0] != payload.id:
            return JSONResponse({"detail": "name_taken"}, status_code=409)
        conn.execute(
            "UPDATE user_schemes SET name = ? WHERE id = ? AND user_id = ?;",
            (payload.name, payload.id, user["user_id"]),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


def _password_reset(payload: PasswordResetIn, request: Request):
    """忘记密码：复用验证码链路（code → verify 换 reg_token）→ 直接设置新密码并登录。"""
    if not _dep["same_origin"](request):
        return JSONResponse({"detail": "cross-site request blocked"}, status_code=403)
    email = _norm_email(payload.email)
    if _dep["hit"](_register_ip_hits, _dep["client_ip"](request), 10):
        return JSONResponse({"detail": "too many requests"}, status_code=429)
    conn = _dep["connect"]()
    try:
        row = conn.execute("SELECT id FROM users WHERE email = ?;", (email,)).fetchone()
        if not row:
            return JSONResponse({"detail": "email_not_registered"}, status_code=404)
        user_id = row[0]
        tok = conn.execute("SELECT reg_token_hash, ts FROM email_codes WHERE email = ?;", (email,)).fetchone()
        if not tok or not tok[0]:
            return JSONResponse({"detail": "reg_token_required"}, status_code=400)
        if time.time() - tok[1] > ACC_REG_TOKEN_TTL:
            return JSONResponse({"detail": "reg_token_expired"}, status_code=400)
        if not secrets.compare_digest(tok[0], hashlib.sha256(payload.reg_token.encode()).hexdigest()):
            return JSONResponse({"detail": "reg_token_wrong"}, status_code=400)
        conn.execute(
            "UPDATE users SET pass_hash = ? WHERE id = ?;",
            (_hash_pw(payload.new_password), user_id),
        )
        # 令牌用后即焚 + 清空该用户全部旧会话（改密后强制重新登录）
        conn.execute("DELETE FROM email_codes WHERE email = ?;", (email,))
        conn.execute("DELETE FROM acc_sessions WHERE user_id = ?;", (user_id,))
        conn.commit()
    finally:
        conn.close()
    resp = JSONResponse({"ok": True})
    _set_session_cookie(resp, user_id, request)
    return resp
