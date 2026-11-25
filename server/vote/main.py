"""
OfCourses 后端：未来功能投票 + 站点访问统计

设计要点：
  - 存储：SQLite（/var/lib/ofcourses-vote/votes.db），只存 匿名ID / 主题 / 分值 / 时间 / IP哈希
  - 去重：同一 (voter_id, topic) 只允许投一次（一票定终身），重复提交返回 409
  - 限流：分档限流。只读接口大幅放宽；submit 主限 voter_id，IP 仅作宽松兜底
          （校园网 NAT 下大量用户共享出口 IP，纯 IP 限流会误伤真实用户）
  - 熔断：数据出现异常特征时自动停掉投票（submit 返回 503），状态持久化，
          由管理员在后台确认数据无误后手动恢复，并通过 Server酱 推送微信告警
  - 统计：站点访问统计（UV / PV / 页面 / 设备），查阅方式合并进 /vote/admin
  - 隐私：不存明文 IP，只存 sha256(ip + 固定盐) 的前 16 位用于粗略去重
  - 安全：仅暴露 /vote/stats、/vote/submit、/vote/healthz、/track；
          管理接口受 VOTE_ADMIN_TOKEN 保护

运行（由 systemd 托管，监听 127.0.0.1:8002，由 nginx 反代 /vote/ 与 /track）：
    uvicorn main:app --host 127.0.0.1 --port 8002
"""

import csv
import hashlib
import hmac
import html
import io
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

# ---------- 配置 ----------
DB_PATH = os.environ.get("VOTE_DB_PATH", "/var/lib/ofcourses-vote/votes.db")
IP_SALT = os.environ.get("VOTE_IP_SALT", "ofcourses-vote-salt-change-me")
ADMIN_TOKEN = os.environ.get("VOTE_ADMIN_TOKEN")
ADMIN_PASSWORD = os.environ.get("VOTE_ADMIN_PASSWORD", "")  # 管理页密码（与 token 并存）；须经 systemd 环境变量注入，禁止写入仓库
ADMIN_SESSION_TTL = int(os.environ.get("VOTE_ADMIN_SESSION_TTL", "600"))  # 密码登录设备会话时长（秒）
SCT_KEY = os.environ.get("VOTE_SCT_KEY")  # Server酱 SendKey，留空则不推送

# 投票主题：AI 助手四维（2026-09-29 定稿，旧单维 "ai" 已下线并清零）+ 课程评价
ALLOWED_TOPICS = {"ai_std", "ai_strong", "ai_speed", "ai_overall", "review"}
ALLOWED_CATEGORIES = {"notice", "update"}  # 站内消息分类：网站声明 / 网站更新
ALLOWED_AUDIENCES = {"new", "veteran", "all"}                    # 发布对象：新用户/老用户/全部
TIMELINESS_DAYS = {"day": 1, "3d": 3, "week": 7, "month": 30}    # 时效性 → 天数（发布当天记第 1 天）
FOREVER_EXPIRE = 4102444799                                      # “始终”到期时间（2099 年远期值）

# 限流阈值（分档）
RATE_STATS_PER_HOUR = int(os.environ.get("VOTE_STATS_RATE", "600"))
RATE_SUBMIT_IP_PER_HOUR = int(os.environ.get("VOTE_SUBMIT_IP_RATE", "100"))
RATE_SUBMIT_VOTER_PER_HOUR = int(os.environ.get("VOTE_SUBMIT_VOTER_RATE", "5"))
RATE_TRACK_PER_HOUR = int(os.environ.get("VOTE_TRACK_RATE", "300"))

# AI 推荐助手（Paratera，OpenAI 兼容接口）——双档模型
# 低级档：GLM-4.5-Flash（快、省，日常问答默认档）；高级档：能力更强的模型（推理质量/指令遵循），按需开启。
# key 只经 systemd 环境变量注入（PARATERA_API_KEY），禁止写入仓库；留空则 AI 功能关闭（503）
AI_API_KEY = os.environ.get("PARATERA_API_KEY", "")
AI_BASE_URL = os.environ.get("VOTE_AI_BASE_URL", "https://llmapi.paratera.com/v1")
AI_MODEL = os.environ.get("VOTE_AI_MODEL", "GLM-4.5-Flash")  # 已核实：Paratera 模型名为大写驼峰
AI_MODEL_FLASH = os.environ.get("VOTE_AI_MODEL_FLASH", AI_MODEL)  # 低级档模型（兼容旧 VOTE_AI_MODEL 变量）
AI_MODEL_STRONG = os.environ.get("VOTE_AI_MODEL_STRONG", "")      # 高级档模型；留空 = 高级档关闭（503）
# 高级档独立通道：可走与低级档不同的中转/模型供应商（OpenAI 兼容），默认与低级档同源
AI_STRONG_BASE_URL = os.environ.get("VOTE_AI_STRONG_BASE_URL", "").rstrip("/") or AI_BASE_URL.rstrip("/")
AI_STRONG_KEY = os.environ.get("VOTE_AI_STRONG_KEY", "") or AI_API_KEY  # 高级档独立 key，缺省共用低级档 key
AI_KB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "knowledge_base.txt")
AI_MAX_INPUT_CHARS = 4000    # 单条消息长度上限
AI_MAX_MESSAGES = 10         # 请求最多携带的消息条数（约 5 轮历史 + 当前提问）
AI_MAX_OUTPUT_TOKENS = int(os.environ.get("VOTE_AI_MAX_TOKENS", "12288"))  # 单次回复生成上限（思考过程也计入，需给足；2026-11-15 实测强模型长思考会顶破 8192 把正文截断）
AI_QUOTA_VISITOR_DEF = 20    # 每访客每日提问上限（默认值，可在管理后台改）
AI_QUOTA_IP_DEF = 100        # 每 IP 每日提问上限（校园网 NAT 兜底，默认值，可在管理后台改）
AI_TOKEN_CAP_DEF = 600000    # 全局每日 token 熔断上限（默认值，可在管理后台改；0 = 不限）
AI_WAIT_INTERVAL = int(os.environ.get("VOTE_AI_WAIT_INTERVAL", "10"))  # 上游 429 重试间隔（秒）
AI_WAIT_TOTAL = int(os.environ.get("VOTE_AI_WAIT_TOTAL", "120"))       # 上游 429 总等待上限（秒）
# classify 的 429 等待预算：前端先等 classify 再等 chat，两段等待串行叠加；
# 预算给足（默认 30s）换方向/类别识别成功率，仍远小于 chat 的 120s 上限
AI_CLASSIFY_WAIT_TOTAL = int(os.environ.get("VOTE_AI_CLASSIFY_WAIT_TOTAL", "30"))        # classify 429 总等待上限（秒）
AI_CLASSIFY_WAIT_INTERVAL = int(os.environ.get("VOTE_AI_CLASSIFY_WAIT_INTERVAL", "10"))  # classify 429 重试间隔（秒）
# —— 高级档（强模型）限额：与低级档完全分开记账（ai_usage.model 列区分）——
#   每人每日 token 上限 = 全局强模型日上限 × ai_strong_user_pct%
#   每人每日「有效对话」次数上限：有效 = 单次 completion_tokens ≥ ai_strong_valid_min_tokens（约 50 字）
AI_STRONG_TOKEN_CAP_DEF = 600000   # 强模型全局每日 token 上限（默认值，管理页可改；0 = 不限）
AI_STRONG_USER_PCT_DEF = 10        # 每人每日强模型 token 上限占全局的百分比（默认值，管理页可改）
AI_STRONG_COUNT_DEF = 6            # 每人每日强模型有效对话次数上限（默认值，管理页可改；0 = 不限）
AI_STRONG_VALID_MIN_TOK_DEF = 80   # 有效对话判定：单次回复 completion_tokens 下限（约 50 字）
AI_TOOL_MAX_ROUNDS = int(os.environ.get("VOTE_AI_TOOL_ROUNDS", "2"))  # 工具调用最大轮数（搜索→作答→搜索→作答…）
# 强模型费用估计：元/百万 token（混合单价，含缓存摊薄）。按中转账单实测标定（≈$4.8/M ≈ ¥35/M），管理页可改
AI_STRONG_PRICE_DEF = 35.0
AI_BUSY_ZH = "抱歉，当前模型使用紧张，暂时无法响应，请稍后再试。（AI 助手为免费体验，高峰期请多包涵）"
AI_BUSY_EN = "Sorry — the model is under heavy load and can't respond right now. Please try again later. (The assistant is free; thanks for your patience at peak times.)"

# 熔断判定阈值
CIRCUIT_WINDOW = 600                 # 速率异常统计窗口（秒）
CIRCUIT_MAX_NEW_VOTES = 50           # 窗口内新增票数上限
CIRCUIT_MAX_VOTERS_PER_IP = 20       # 1 小时内单 ip_hash 下不同 voter_id 上限
CIRCUIT_SKEW_RATIO = 0.9             # 某分值占比上限
CIRCUIT_SKEW_MIN_TOTAL = 30          # 分布异常判定的最小样本量

ALLOWED_ORIGINS = [
    "https://www.dushiofcourses.cn",
    "https://dushiofcourses.cn",
]

app = FastAPI(title="OfCourses Vote API", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# ---------- 内存滑动窗口限流 ----------
_ip_hits: Dict[str, Deque[float]] = defaultdict(deque)
_voter_hits: Dict[str, Deque[float]] = defaultdict(deque)
_ai_visitor_hits: Dict[str, Deque[float]] = defaultdict(deque)  # AI：访客每日提问
_ai_ip_hits: Dict[str, Deque[float]] = defaultdict(deque)       # AI：IP 每日提问（NAT 兜底）
_ai_strong_hits: Dict[str, Deque[float]] = defaultdict(deque)   # AI：高级档 IP 防刷（独立桶，不占低级档次数）
_admin_sessions: Dict[str, float] = {}  # 管理页密码会话：sid -> 过期时间戳
_sweep_counter = {"n": 0}


def _client_ip(request: Request) -> str:
    # 仅信任 nginx 传入的 X-Forwarded-For 首段（nginx 会覆盖客户端伪造值）
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _ip_hash(ip: str) -> str:
    return hashlib.sha256((IP_SALT + ip).encode("utf-8")).hexdigest()[:16]


def _hit(bucket: Dict[str, Deque[float]], key: str, limit: int, window: float = 3600.0) -> bool:
    """记录一次访问，返回 True 表示已超限"""
    now = time.time()
    q = bucket[key]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def _maybe_sweep() -> None:
    """定期清理过期 key，防止长期运行下字典无限增长"""
    _sweep_counter["n"] += 1
    if _sweep_counter["n"] < 500:
        return
    _sweep_counter["n"] = 0
    now = time.time()
    for bucket in (_ip_hits, _voter_hits, _ai_visitor_hits, _ai_ip_hits, _ai_classify_hits, _ai_strong_hits):
        dead = [k for k, q in bucket.items() if not q or now - q[-1] > 3600.0]
        for k in dead:
            del bucket[k]


# ---------- 数据库 ----------
def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS votes (
            voter_id TEXT NOT NULL,
            topic    TEXT NOT NULL,
            score    INTEGER NOT NULL,
            ip_hash  TEXT NOT NULL,
            ua       TEXT,
            ts       INTEGER NOT NULL,
            PRIMARY KEY (voter_id, topic)
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_votes_topic ON votes(topic);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_votes_ts ON votes(ts);")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS visits (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            vid    TEXT NOT NULL,
            path   TEXT,
            mobile INTEGER DEFAULT 0,
            ua     TEXT,
            ts     INTEGER NOT NULL
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(ts);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_visits_vid ON visits(vid);")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            category     TEXT NOT NULL,
            title        TEXT NOT NULL,
            body         TEXT NOT NULL,
            pinned       INTEGER DEFAULT 0,
            ts           INTEGER NOT NULL,
            audience     TEXT NOT NULL DEFAULT 'all',
            timeliness   TEXT NOT NULL DEFAULT 'forever',
            publish_type TEXT NOT NULL DEFAULT 'now',
            publish_at   INTEGER NOT NULL DEFAULT 0,
            expire_at    INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    # 旧库迁移：补齐新版列（已存在则忽略），并把旧行回填为「全部受众 + 始终有效」
    for _ddl in (
        "ALTER TABLE messages ADD COLUMN audience TEXT NOT NULL DEFAULT 'all';",
        "ALTER TABLE messages ADD COLUMN timeliness TEXT NOT NULL DEFAULT 'forever';",
        "ALTER TABLE messages ADD COLUMN publish_type TEXT NOT NULL DEFAULT 'now';",
        "ALTER TABLE messages ADD COLUMN publish_at INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE messages ADD COLUMN expire_at INTEGER NOT NULL DEFAULT 0;",
    ):
        try:
            conn.execute(_ddl)
        except sqlite3.OperationalError:
            pass  # 列已存在
    conn.execute("UPDATE messages SET publish_at = ts WHERE publish_at = 0;")
    conn.execute("UPDATE messages SET expire_at = 4102444799 WHERE expire_at = 0;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_usage (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            visitor_hash  TEXT NOT NULL,
            ip_hash       TEXT NOT NULL,
            prompt_tokens     INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            ts            INTEGER NOT NULL,
            model         TEXT NOT NULL DEFAULT 'flash'
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts);")
    # 旧库迁移：ai_usage 补 model 列（'flash' | 'strong'，分档记账/监控的基础；旧行全部视为 flash）
    try:
        conn.execute("ALTER TABLE ai_usage ADD COLUMN model TEXT NOT NULL DEFAULT 'flash';")
    except sqlite3.OperationalError:
        pass  # 列已存在
    # 旧库迁移：ai_usage 补 gen 列（重置代次）。token 重置不再删除记录（保住累计统计），
    # 而是 gen+1 ——「今日」只统计当前代次，条形图按 gen 分段绘制（每天最多重置 5 次 → ≤6 段）。
    try:
        conn.execute("ALTER TABLE ai_usage ADD COLUMN gen INTEGER NOT NULL DEFAULT 1;")
    except sqlite3.OperationalError:
        pass  # 列已存在
    # 重置事件记录（时间戳 + 重置后的代次 + 档位），供某日详情展示「当日重置 N 次（时刻）」。
    # 旧库无 tier 列时补上（历史记录按 flash 计）。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_resets ("
        " ts INTEGER NOT NULL,"
        " gen INTEGER NOT NULL"
        ");"
    )
    try:
        conn.execute("ALTER TABLE ai_resets ADD COLUMN tier TEXT NOT NULL DEFAULT 'flash';")
    except sqlite3.OperationalError:
        pass  # 列已存在
    # 强模型档独立代次：与标准模型档的重置互不影响
    # 课程评价（2026-11-16）：条目/评价/互动/举报 四表；全量先审后显
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS review_topics (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            source     TEXT NOT NULL DEFAULT 'custom',  -- official（官方收录课）| custom（用户自定义条目）
            course_id  TEXT,                            -- official: kb_courses.json 的课程号
            name       TEXT NOT NULL,                   -- 展示名
            norm_key   TEXT NOT NULL,                   -- 归一化匹配键（疑似重复提示用）
            initial    TEXT NOT NULL DEFAULT '',        -- 首字母（A-Z 索引）
            status     TEXT NOT NULL DEFAULT 'active',  -- active | merged
            merged_into INTEGER,                        -- 合并目标条目 id
            created_by INTEGER,                         -- 创建者 user_id（official 为 NULL）
            ts         INTEGER NOT NULL
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_rv_topics_norm ON review_topics(norm_key);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_rv_topics_status ON review_topics(status);")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS reviews (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id     INTEGER NOT NULL,
            content      TEXT NOT NULL,
            author_uid   INTEGER NOT NULL,               -- 账号 user_id（后台永远可见，前台按 sign 展示）
            sign         TEXT NOT NULL DEFAULT 'nick',   -- real（邮箱前缀实名）| nick（昵称）
            status       TEXT NOT NULL DEFAULT 'pending',-- pending/approved/rejected/deleted_user/removed_report
            reject_note  TEXT NOT NULL DEFAULT '',
            report_count INTEGER NOT NULL DEFAULT 0,
            report_seen  INTEGER NOT NULL DEFAULT 0,     -- 举报队列已标记处理（忽略）
            ai_tag       TEXT NOT NULL DEFAULT '',       -- AI 打标：normal/ad/offtopic/teacher_negative/空(未完成)
            ts           INTEGER NOT NULL,
            approved_at  INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_rv_reviews_topic ON reviews(topic_id, status);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_rv_reviews_status ON reviews(status, ts);")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS review_reactions (
            review_id INTEGER NOT NULL,
            uid       INTEGER NOT NULL,
            type      TEXT NOT NULL,                     -- like/useful/watch/doubt/unuseful
            ts        INTEGER NOT NULL,
            PRIMARY KEY (review_id, uid, type)
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS review_reports (
            review_id INTEGER NOT NULL,
            uid       INTEGER NOT NULL,                  -- 一人一帖一次举报（PK 保证）
            reason    TEXT NOT NULL DEFAULT '',
            ts        INTEGER NOT NULL,
            PRIMARY KEY (review_id, uid)
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rv_msgs (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            target_uid INTEGER,                         -- NULL = 全体公告；否则定向给某用户（含事件通知）
            kind      TEXT NOT NULL DEFAULT 'system',   -- system 公告/私信 | event 事件通知（审核/举报等）
            title     TEXT NOT NULL,
            content   TEXT NOT NULL DEFAULT '',
            ts        INTEGER NOT NULL
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rv_msg_reads (
            msg_id INTEGER NOT NULL,
            uid    INTEGER NOT NULL,
            ts     INTEGER NOT NULL,
            PRIMARY KEY (msg_id, uid)
        );
        """
    )
    # 账号系统表（users / acc_sessions / email_codes / user_schemes，见 accounts.py）
    try:
        import accounts as _accounts
        _accounts.ensure_tables(conn)
    except ImportError:
        pass  # accounts.py 缺失时后端其余功能不受影响
    conn.commit()
    return conn


def _stats(conn: sqlite3.Connection, topic: str) -> dict:
    cur = conn.execute("SELECT COUNT(*), COALESCE(AVG(score), 0) FROM votes WHERE topic = ?;", (topic,))
    count, avg = cur.fetchone()
    return {"count": int(count), "avg": round(float(avg), 2)}


# ---------- 熔断 ----------
def _get_meta(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    cur = conn.execute("SELECT value FROM meta WHERE key = ?;", (key,))
    row = cur.fetchone()
    return row[0] if row else default


def _set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value;",
        (key, value),
    )
    conn.commit()


def _del_meta(conn: sqlite3.Connection, key: str) -> None:
    conn.execute("DELETE FROM meta WHERE key = ?;", (key,))
    conn.commit()


def _circuit_open(conn: sqlite3.Connection) -> bool:
    return _get_meta(conn, "circuit_open") == "1"


def _notify(title: str, content: str) -> None:
    """Server酱推送到微信。失败不得影响主流程。"""
    if not SCT_KEY:
        return
    try:
        urllib.request.urlopen(
            urllib.request.Request(
                f"https://sctapi.ftqq.com/{SCT_KEY}.send",
                data=urllib.parse.urlencode({"title": title, "desp": content}).encode("utf-8"),
            ),
            timeout=5,
        )
    except Exception:
        pass


def _check_abnormal(conn: sqlite3.Connection) -> str | None:
    """返回异常原因，正常则返回 None。

    所有统计均从「最近一次管理员恢复」之后重新计起：否则管理员确认数据无误并恢复后，
    同一批历史数据会立刻再次触发熔断，使手动恢复形同虚设。
    """
    now = int(time.time())
    resume_ts = int(_get_meta(conn, "circuit_resume_ts", "0") or 0)

    # 1. 速率异常：短窗口内新增票数过多
    cur = conn.execute(
        "SELECT COUNT(*) FROM votes WHERE ts > ?;",
        (max(resume_ts, now - CIRCUIT_WINDOW),),
    )
    recent = cur.fetchone()[0]
    if recent > CIRCUIT_MAX_NEW_VOTES:
        return f"{CIRCUIT_WINDOW // 60} 分钟内新增 {recent} 票（阈值 {CIRCUIT_MAX_NEW_VOTES}）"

    # 2. 同源异常：单一来源涌现大量不同投票标识
    cur = conn.execute(
        "SELECT ip_hash, COUNT(DISTINCT voter_id) c FROM votes "
        "WHERE ts > ? GROUP BY ip_hash HAVING c > ? ORDER BY c DESC LIMIT 1;",
        (max(resume_ts, now - 3600), CIRCUIT_MAX_VOTERS_PER_IP),
    )
    row = cur.fetchone()
    if row:
        return f"单一来源出现 {row[1]} 个不同投票标识（阈值 {CIRCUIT_MAX_VOTERS_PER_IP}）"

    # 3. 分布异常：某分值占比过高（同样只统计恢复之后新增的票）
    for topic in ALLOWED_TOPICS:
        cur = conn.execute(
            "SELECT score, COUNT(*) FROM votes WHERE topic = ? AND ts > ? GROUP BY score;",
            (topic, resume_ts),
        )
        rows = cur.fetchall()
        total = sum(r[1] for r in rows)
        if total >= CIRCUIT_SKEW_MIN_TOTAL:
            for score, cnt in rows:
                if cnt / total > CIRCUIT_SKEW_RATIO:
                    return (
                        f"「{_topic_label(topic)}」{score} 分占比 {cnt / total * 100:.0f}%"
                        f"（阈值 {CIRCUIT_SKEW_RATIO * 100:.0f}%）"
                    )
    return None


def _trip_circuit(conn: sqlite3.Connection, reason: str) -> None:
    """触发熔断：持久化状态 + 推送告警"""
    if _circuit_open(conn):
        return
    now = int(time.time())
    _set_meta(conn, "circuit_open", "1")
    _set_meta(conn, "circuit_reason", reason)
    _set_meta(conn, "circuit_ts", str(now))
    _notify(
        "OfCourses 投票已熔断",
        f"触发原因：{reason}\n\n"
        f"时间：{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now))}\n\n"
        f"投票已自动停止，统计仍可查看。请登录后台核对数据后手动恢复。",
    )


# ---------- 接口 ----------
class VoteIn(BaseModel):
    topic: str
    score: int = Field(ge=1, le=5)
    voter_id: str = Field(min_length=8, max_length=128)


class TrackIn(BaseModel):
    vid: str = Field(min_length=8, max_length=128)
    path: str = Field(default="", max_length=200)
    mobile: bool = False


@app.get("/vote/stats")
def stats(topic: str, request: Request):
    _maybe_sweep()
    if _hit(_ip_hits, f"s:{_client_ip(request)}", RATE_STATS_PER_HOUR):
        return JSONResponse({"detail": "rate limited"}, status_code=429, headers={"Retry-After": "60"})
    if topic not in ALLOWED_TOPICS:
        return JSONResponse({"detail": "unknown topic"}, status_code=400)
    conn = _connect()
    try:
        return _stats(conn, topic)
    finally:
        conn.close()


@app.post("/vote/submit")
def submit(payload: VoteIn, request: Request):
    _maybe_sweep()
    ip = _client_ip(request)
    # 主限 voter_id（防脚本重复刷），IP 仅作宽松兜底（NAT 下不误伤真实用户）
    if _hit(_voter_hits, payload.voter_id, RATE_SUBMIT_VOTER_PER_HOUR):
        return JSONResponse({"detail": "rate limited"}, status_code=429, headers={"Retry-After": "60"})
    if _hit(_ip_hits, f"v:{ip}", RATE_SUBMIT_IP_PER_HOUR):
        return JSONResponse({"detail": "rate limited"}, status_code=429, headers={"Retry-After": "60"})
    if payload.topic not in ALLOWED_TOPICS:
        return JSONResponse({"detail": "unknown topic"}, status_code=400)

    conn = _connect()
    try:
        # 熔断期间拒绝投票
        if _circuit_open(conn):
            return JSONResponse({"detail": "circuit open"}, status_code=503)

        existing = conn.execute(
            "SELECT score FROM votes WHERE voter_id = ? AND topic = ?;",
            (payload.voter_id, payload.topic),
        ).fetchone()
        if existing:
            return JSONResponse(
                {"detail": "already voted", "score": existing[0], "stats": _stats(conn, payload.topic)},
                status_code=409,
            )
        conn.execute(
            "INSERT INTO votes (voter_id, topic, score, ip_hash, ua, ts) VALUES (?, ?, ?, ?, ?, ?);",
            (
                payload.voter_id,
                payload.topic,
                payload.score,
                _ip_hash(ip),
                (request.headers.get("user-agent") or "")[:200],
                int(time.time()),
            ),
        )
        conn.commit()
        result = {"ok": True, "stats": _stats(conn, payload.topic)}
        # 写入后检查是否出现异常特征
        reason = _check_abnormal(conn)
        if reason:
            _trip_circuit(conn, reason)
        return result
    finally:
        conn.close()


@app.post("/track")
def track(payload: TrackIn, request: Request):
    """站点访问上报：vid 为前端 localStorage 中的匿名随机 ID"""
    _maybe_sweep()
    if _hit(_ip_hits, f"t:{_client_ip(request)}", RATE_TRACK_PER_HOUR):
        return JSONResponse({"detail": "rate limited"}, status_code=429)
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO visits (vid, path, mobile, ua, ts) VALUES (?, ?, ?, ?, ?);",
            (
                payload.vid,
                payload.path[:200],
                1 if payload.mobile else 0,
                (request.headers.get("user-agent") or "")[:200],
                int(time.time()),
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/vote/healthz")
def healthz():
    return {"ok": True}


# ---------- 站内消息（公告） ----------
class MessageIn(BaseModel):
    category: str
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=8000)
    pinned: bool = False
    audience: str = "all"          # new | veteran | all（对用户不可见）
    timeliness: str = "forever"    # day | 3d | week | month | forever（对用户不可见）
    publish_type: str = "now"      # now | scheduled
    publish_at: str | None = None  # scheduled 时为 "YYYY-MM-DDTHH:MM"（服务器本地时间）


def _in_dead_zone(ts: float) -> bool:
    """每日 23:59:00 - 次日 00:01:00 为发送死区（按服务器本地时间），避免跨天边界 bug"""
    lt = time.localtime(ts)
    mins = lt.tm_hour * 60 + lt.tm_min
    return mins >= 23 * 60 + 59 or mins < 1


def _compute_expire(publish_ts: float, timeliness: str) -> int:
    """时效性到期时间：发布当天记第 1 天，到期 = 第 N 天 23:59:59"""
    if timeliness == "forever":
        return FOREVER_EXPIRE
    days = TIMELINESS_DAYS[timeliness]
    lt = time.localtime(publish_ts)
    day_start = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
    return int(day_start + (days - 1) * 86400 + 23 * 3600 + 59 * 60 + 59)


def _parse_local_dt(s: str) -> float:
    return time.mktime(time.strptime(s, "%Y-%m-%dT%H:%M"))


@app.get("/vote/messages")
def list_messages(request: Request, first_open: int = Query(default=0, ge=0, le=1)):
    """站内消息列表（公网只读）：
    - 只返回处于投放时段（publish_at <= now <= expire_at）的消息
    - 受众过滤：new 仅推给首次打开者、veteran 仅推给老访客（first_open 由前端 localStorage 判定）
    - 未读判定由浏览器 localStorage 完成
    """
    _maybe_sweep()
    if _hit(_ip_hits, f"m:{_client_ip(request)}", RATE_STATS_PER_HOUR):
        return JSONResponse({"detail": "rate limited"}, status_code=429, headers={"Retry-After": "60"})
    now = int(time.time())
    conn = _connect()
    try:
        cur = conn.execute(
            "SELECT id, category, title, body, pinned, ts, audience, timeliness, publish_type, publish_at, expire_at "
            "FROM messages WHERE publish_at <= ? AND expire_at >= ? "
            "ORDER BY pinned DESC, publish_at DESC LIMIT 100;",
            (now, now),
        )
        rows = cur.fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        audience = r[6] or "all"
        if audience == "new" and not first_open:
            continue
        if audience == "veteran" and first_open:
            continue
        out.append(
            {"id": r[0], "category": r[1], "title": r[2], "body": r[3], "pinned": bool(r[4]), "ts": r[5]}
        )
    return {"messages": out}


class AuthIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)


@app.post("/vote/admin/auth")
def admin_auth(payload: AuthIn, request: Request):
    """管理页密码登录：成功后给该设备发 10 分钟会话 cookie（与 ?token= 直链并存）"""
    # 防爆破：每 IP 每小时最多 10 次尝试
    if _hit(_ip_hits, f"a:{_client_ip(request)}", 10):
        return JSONResponse({"detail": "too many attempts"}, status_code=429, headers={"Retry-After": "60"})
    expected = ADMIN_PASSWORD or ""
    if not expected or not hmac.compare_digest(expected.encode(), payload.password.encode()):
        return JSONResponse({"detail": "wrong password"}, status_code=401)
    now = time.time()
    for k in [k for k, v in _admin_sessions.items() if v < now]:
        _admin_sessions.pop(k, None)
    sid = secrets.token_hex(16)
    _admin_sessions[sid] = now + ADMIN_SESSION_TTL
    resp = JSONResponse({"ok": True})
    resp.set_cookie(
        "oc_admin_sess", sid,
        max_age=ADMIN_SESSION_TTL, httponly=True, samesite="lax", path="/vote",
        secure=request.headers.get("x-forwarded-proto") == "https",
    )
    return resp


@app.post("/vote/admin/messages")
def admin_create_message(payload: MessageIn, request: Request, token: str | None = Query(default=None)):
    """管理端发布站内消息（受众/时效/发布时间属性对用户不可见）"""
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="cross-site request blocked")
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    if payload.category not in ALLOWED_CATEGORIES:
        return JSONResponse({"detail": "unknown category"}, status_code=400)
    if payload.audience not in ALLOWED_AUDIENCES:
        return JSONResponse({"detail": "unknown audience"}, status_code=400)
    if payload.timeliness != "forever" and payload.timeliness not in TIMELINESS_DAYS:
        return JSONResponse({"detail": "unknown timeliness"}, status_code=400)
    now = time.time()
    if _in_dead_zone(now):
        return JSONResponse(
            {"detail": "dead_zone", "message": "每日 23:59-0:01 为发送死区，请稍后再发"},
            status_code=400,
        )
    if payload.publish_type == "scheduled":
        if not payload.publish_at:
            return JSONResponse({"detail": "missing publish_at"}, status_code=400)
        try:
            pub = _parse_local_dt(payload.publish_at)
        except ValueError:
            return JSONResponse({"detail": "bad publish_at"}, status_code=400)
        if _in_dead_zone(pub):
            return JSONResponse(
                {"detail": "dead_zone", "message": "预设时间落在发送死区（23:59-0:01），请换个时间"},
                status_code=400,
            )
        if pub <= now:
            return JSONResponse({"detail": "publish_at_past", "message": "预设时间必须晚于当前时间"}, status_code=400)
    else:
        pub = now
    expire = _compute_expire(pub, payload.timeliness)
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO messages (category, title, body, pinned, ts, audience, timeliness, publish_type, publish_at, expire_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (
                payload.category, payload.title, payload.body, 1 if payload.pinned else 0, int(now),
                payload.audience, payload.timeliness, payload.publish_type, int(pub), expire,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "publish_at": int(pub), "expire_at": expire}


# ---------- 管理后台 ----------
def _check_admin_token(token: str | None) -> bool:
    """恒定时间比较，防止时序攻击"""
    if not ADMIN_TOKEN or not token:
        return False
    return hmac.compare_digest(ADMIN_TOKEN, token)


def _check_admin_session(request: Request) -> bool:
    """密码登录后的设备会话（cookie，10 分钟有效）"""
    sid = request.cookies.get("oc_admin_sess", "")
    if not sid:
        return False
    exp = _admin_sessions.get(sid)
    if exp is None or time.time() > exp:
        _admin_sessions.pop(sid, None)
        return False
    return True


def _same_origin(request: Request) -> bool:
    """CSRF 防线：拒绝跨站发起的状态变更请求（带 Sec-Fetch-Site 头的现代浏览器生效，旧浏览器默认放行）"""
    return request.headers.get("sec-fetch-site", "same-origin") in ("same-origin", "same-site", "none")


def _require_admin(request: Request, token: str | None) -> bool:
    """管理鉴权：?token= 直链 与 密码会话 cookie 并存"""
    if token and _check_admin_token(token):
        return True
    return _check_admin_session(request)


def _topic_label(t: str) -> str:
    return {
        "ai_std": "标准模型满意度",
        "ai_strong": "强模型满意度",
        "ai_speed": "标准模型反应时间",
        "ai_overall": "AI助手功能整体",
        "review": "课程评价",
    }.get(t, t)


def _category_label(c: str) -> str:
    return {"notice": "网站声明", "update": "网站更新"}.get(c, c)


def _stats_with_distribution(conn: sqlite3.Connection, topic: str) -> dict:
    total = _stats(conn, topic)
    dist = {}
    for score in range(1, 6):
        cur = conn.execute("SELECT COUNT(*) FROM votes WHERE topic = ? AND score = ?;", (topic, score))
        dist[score] = cur.fetchone()[0]
    return {"count": total["count"], "avg": total["avg"], "distribution": dist}


def _site_stats(conn: sqlite3.Connection) -> dict:
    """站点访问统计：UV / PV / 页面 / 设备"""
    now = int(time.time())
    day = 86400

    def uv_since(ts: int) -> int:
        return conn.execute("SELECT COUNT(DISTINCT vid) FROM visits WHERE ts > ?;", (ts,)).fetchone()[0]

    def pv_since(ts: int) -> int:
        return conn.execute("SELECT COUNT(*) FROM visits WHERE ts > ?;", (ts,)).fetchone()[0]

    uv_24h, uv_7d = uv_since(now - day), uv_since(now - 7 * day)
    pv_7d = pv_since(now - 7 * day)
    total_uv = conn.execute("SELECT COUNT(DISTINCT vid) FROM visits;").fetchone()[0]
    total_pv = conn.execute("SELECT COUNT(*) FROM visits;").fetchone()[0]

    # 近 30 天每日 UV（按服务器本地日期分组）
    rows = conn.execute(
        "SELECT date(ts, 'unixepoch', 'localtime') d, COUNT(DISTINCT vid) c "
        "FROM visits WHERE ts > ? GROUP BY d ORDER BY d;",
        (now - 30 * day,),
    ).fetchall()
    trend = [(r[0], r[1]) for r in rows]

    # 设备占比（按 vid 去重，同一访客取最近一次的设备类型）
    dev = conn.execute(
        "SELECT mobile, COUNT(*) FROM ("
        "  SELECT vid, mobile FROM visits GROUP BY vid"
        ") GROUP BY mobile;"
    ).fetchall()
    dev_map = {r[0]: r[1] for r in dev}
    mobile_uv, pc_uv = dev_map.get(1, 0), dev_map.get(0, 0)

    # 页面 Top 5
    top_pages = conn.execute(
        "SELECT path, COUNT(*) c FROM visits GROUP BY path ORDER BY c DESC LIMIT 5;"
    ).fetchall()

    return {
        "uv_24h": uv_24h,
        "uv_7d": uv_7d,
        "total_uv": total_uv,
        "total_pv": total_pv,
        "pv_7d": pv_7d,
        "trend": trend,
        "mobile_uv": mobile_uv,
        "pc_uv": pc_uv,
        "top_pages": top_pages,
    }


def _sparkline(trend) -> str:
    """近 30 天 UV 趋势折线，纯 SVG 手写，不依赖外部库"""
    if not trend:
        return '<div class="empty">暂无数据</div>'
    w, h = 560, 110
    vals = [v for _, v in trend]
    max_v = max(vals) or 1
    n = len(vals)
    step = w / max(n - 1, 1)
    pts = []
    for i, v in enumerate(vals):
        x = i * step
        y = h - 6 - (v / max_v) * (h - 24)
        pts.append(f"{x:.1f},{y:.1f}")
    poly = " ".join(pts)
    first, last = trend[0][0][5:], trend[-1][0][5:]
    return (
        f'<svg viewBox="0 0 {w} {h}" width="100%" height="{h}" preserveAspectRatio="none">'
        f'<polyline points="{poly}" fill="none" stroke="#4f46e5" stroke-width="2" '
        f'stroke-linejoin="round" stroke-linecap="round"/></svg>'
        f'<div class="trend-axis"><span>{first}</span><span>{last}</span></div>'
    )


def _login_html() -> str:
    """管理页登录页：输入管理密码，成功后本设备 10 分钟免密（cookie 会话）"""
    return """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>OfCourses 管理后台 · 登录</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #f6f7f9; color: #222; }
@media (prefers-color-scheme: dark) { body { background: #0e0e14; color: #eee; } }
.card { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 28px;
    width: min(360px, calc(100vw - 32px)); box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
@media (prefers-color-scheme: dark) { .card { background: #16161f; border-color: rgba(255,255,255,0.08); } }
h1 { margin: 0 0 6px; font-size: 18px; }
p.hint { margin: 0 0 18px; font-size: 12px; color: #888; }
input[type="password"] { width: 100%; padding: 10px 12px; border-radius: 8px;
    border: 1px solid rgba(0,0,0,0.15); font-size: 14px; background: transparent; color: inherit; }
@media (prefers-color-scheme: dark) { input[type="password"] { border-color: rgba(255,255,255,0.18); } }
button { margin-top: 12px; width: 100%; border: none; cursor: pointer; padding: 10px;
    border-radius: 8px; background: #4f46e5; color: #fff; font-size: 14px; }
button:disabled { opacity: 0.5; cursor: default; }
.err { margin-top: 10px; font-size: 12px; color: #a32d2d; min-height: 16px; }
</style>
</head>
<body>
<div class="card">
    <h1>OfCourses 管理后台</h1>
    <p class="hint">请输入管理密码（10 分钟内本设备免密）</p>
    <input type="password" id="pwd" placeholder="管理密码" autocomplete="current-password" />
    <button id="go" type="button">进入</button>
    <div class="err" id="err"></div>
</div>
<script>
(function () {
    var btn = document.getElementById('go');
    function login() {
        var pwd = document.getElementById('pwd').value;
        var err = document.getElementById('err');
        if (!pwd) { err.textContent = '请输入密码'; return; }
        btn.disabled = true;
        err.textContent = '';
        fetch('/vote/admin/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd })
        }).then(function (r) {
            if (r.ok) { location.href = '/vote/admin'; return; }
            err.textContent = r.status === 401 ? '密码错误' : '登录失败（' + r.status + '）';
            btn.disabled = false;
        }).catch(function () {
            err.textContent = '网络错误，请重试';
            btn.disabled = false;
        });
    }
    btn.addEventListener('click', login);
    document.getElementById('pwd').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') login();
    });
})();
</script>
</body>
</html>"""


@app.get("/vote/admin", response_class=HTMLResponse)
def admin_page(request: Request, token: str | None = Query(default=None)):
    if not _require_admin(request, token):
        return _login_html()
    conn = _connect()
    try:
        ai = {t: _stats_with_distribution(conn, t) for t in ("ai_std", "ai_strong", "ai_speed", "ai_overall")}
        review = _stats_with_distribution(conn, "review")
        cur = conn.execute(
            "SELECT topic, score, ip_hash, ts, ua FROM votes ORDER BY ts DESC LIMIT 50;"
        )
        rows = cur.fetchall()
        site = _site_stats(conn)
        cur = conn.execute(
            "SELECT id, category, title, body, pinned, ts, audience, timeliness, publish_type, publish_at, expire_at "
            "FROM messages ORDER BY pinned DESC, publish_at DESC, ts DESC LIMIT 200;"
        )
        msgs = cur.fetchall()
        tripped = _circuit_open(conn)
        reason = _get_meta(conn, "circuit_reason")
        trip_ts = _get_meta(conn, "circuit_ts")
        day0 = _day_start(time.time())
        flash_gen = _ai_cur_gen(conn, "flash")
        strong_gen = _ai_cur_gen(conn, "strong")
        ai_today = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(prompt_tokens + completion_tokens), 0) "
            "FROM ai_usage WHERE ts >= ? AND ((model = 'flash' AND gen = ?) OR (model = 'strong' AND gen = ?));",
            (day0, flash_gen, strong_gen),
        ).fetchone()
        ai_total = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage;"
        ).fetchone()
        ai_by_model = {
            m: {"calls": int(c), "tokens": int(t)}
            for m, c, t in conn.execute(
                "SELECT model, COUNT(*), COALESCE(SUM(prompt_tokens + completion_tokens), 0) "
                "FROM ai_usage WHERE ts >= ? AND ((model = 'flash' AND gen = ?) OR (model = 'strong' AND gen = ?)) GROUP BY model;",
                (day0, flash_gen, strong_gen),
            )
        }
        ai_strong_total_toks = conn.execute(
            "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage WHERE model = 'strong';"
        ).fetchone()[0]
        ai_switches = {
            "master": _ai_master_enabled(conn),
            "flash": _get_meta(conn, "ai_flash_enabled", "1") == "1",
            "strong": _get_meta(conn, "ai_strong_enabled", "1") == "1",
        }
        ai_quotas = {
            "visitor": _ai_quota(conn, "ai_quota_visitor", AI_QUOTA_VISITOR_DEF),
            "ip": _ai_quota(conn, "ai_quota_ip", AI_QUOTA_IP_DEF),
            "guest_ratio": _ai_guest_ratio(conn),
            "token_cap": _ai_quota(conn, "ai_token_daily_cap", AI_TOKEN_CAP_DEF),
            "strong_token_cap": _ai_quota(conn, "ai_strong_token_daily_cap", AI_STRONG_TOKEN_CAP_DEF),
            "strong_user_pct": _ai_quota(conn, "ai_strong_user_pct", AI_STRONG_USER_PCT_DEF),
            "strong_count": _ai_quota(conn, "ai_strong_daily_count", AI_STRONG_COUNT_DEF),
            "strong_valid_min": _ai_quota(conn, "ai_strong_valid_min_tokens", AI_STRONG_VALID_MIN_TOK_DEF),
            "strong_price": _ai_strong_price(conn),
        }
        ai_models_cfg = {
            "flash": _ai_model_cfg(conn, "flash"),
            "strong": _ai_model_cfg(conn, "strong"),
        }
        # 展示用：meta 配置优先，环境变量兜底（未配置的档位 model 为空串）
        strong_up_now = _ai_upstream_cfg(conn, "strong")
        flash_up_now = _ai_upstream_cfg(conn, "flash")
        ai_models_show = {
            "flash": {
                "model": ai_models_cfg["flash"].get("model") or (AI_MODEL_FLASH if flash_up_now else ""),
                "base_url": ai_models_cfg["flash"].get("base_url") or (flash_up_now[1] if flash_up_now else ""),
                "display": ai_models_cfg["flash"].get("display") or "标准模型",
                "source": "meta" if ai_models_cfg["flash"] else ("env" if flash_up_now else "none"),
            },
            "strong": {
                "model": ai_models_cfg["strong"].get("model") or (AI_MODEL_STRONG if strong_up_now else ""),
                "base_url": ai_models_cfg["strong"].get("base_url") or (strong_up_now[1] if strong_up_now else ""),
                "display": ai_models_cfg["strong"].get("display") or "强模型",
                "source": "meta" if ai_models_cfg["strong"] else ("env" if strong_up_now else "none"),
            },
        }
        strong_channel_tag = (
            "（独立通道）" if strong_up_now and flash_up_now and strong_up_now[1] != flash_up_now[1] else ""
        )
        # —— 使用声明管理（空文本 = 前端使用内置默认声明）——
        ai_disclaimer_ver = _ai_quota(conn, "ai_disclaimer_ver", 1)
        ai_disclaimer_zh = _get_meta(conn, "ai_disclaimer_zh", "")
        ai_disclaimer_en = _get_meta(conn, "ai_disclaimer_en", "")
    finally:
        conn.close()

    def _bar(score: int, count: int, total: int) -> str:
        pct = round(count / total * 100, 1) if total else 0
        return (
            f'<div class="bar-row"><span class="bar-label">{score} 分</span>'
            f'<div class="bar-track"><div class="bar-fill" style="width:{pct}%"></div></div>'
            f'<span class="bar-count">{count} ({pct}%)</span></div>'
        )

    def _rows_html() -> str:
        if not rows:
            return '<tr><td colspan="5" class="empty">暂无记录</td></tr>'
        lines = []
        for topic, score, ip_hash, ts, ua in rows:
            dt = time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))
            lines.append(
                f"<tr><td>{_topic_label(topic)}</td><td>{score}</td>"
                f"<td>{ip_hash}</td><td>{dt}</td><td class='ua'>{ua or '-'}</td></tr>"
            )
        return "\n".join(lines)

    def _pages_html() -> str:
        if not site["top_pages"]:
            return '<tr><td colspan="2" class="empty">暂无数据</td></tr>'
        return "\n".join(
            f"<tr><td>{p or '/'}</td><td>{c}</td></tr>" for p, c in site["top_pages"]
        )

    _AUDIENCE_LABELS = {"new": "新用户", "veteran": "老用户", "all": "全部"}
    _TIMELINESS_LABELS = {"day": "仅当天", "3d": "仅3天", "week": "仅一周", "month": "仅一月", "forever": "始终"}

    def _mail_status(publish_at: int, expire_at: int) -> str:
        now = int(time.time())
        if now < publish_at:
            return '<span class="status wait">未开始</span>'
        if now > expire_at:
            return '<span class="status expired">已过期</span>'
        return '<span class="status live">生效中</span>'

    def _mail_rows_html() -> str:
        if not msgs:
            return '<div class="empty">还没有发送过消息</div>'
        lines = []
        for (mid, category, title, body, pinned, ts,
             audience, timeliness, publish_type, publish_at, expire_at) in msgs:
            safe_title = (title or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            safe_body = (body or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            pin = "📌 " if pinned else ""
            pub = publish_at or ts
            exp = expire_at or FOREVER_EXPIRE
            pub_str = time.strftime("%m-%d %H:%M", time.localtime(pub))
            exp_str = "始终" if exp >= FOREVER_EXPIRE else time.strftime("%m-%d %H:%M", time.localtime(exp))
            aud = _AUDIENCE_LABELS.get(audience or "all", audience or "all")
            tml = _TIMELINESS_LABELS.get(timeliness or "forever", timeliness or "forever")
            pub_kind = "立即" if (publish_type or "now") == "now" else "预设"
            del_url = "/vote/admin/messages/delete?id=" + str(mid) + (f"&token={token}" if token else "")
            lines.append(
                f'<div class="msg-item"><div class="msg-head">'
                f'<details class="msg-details">'
                f'<summary><span>{pin}{safe_title}</span>'
                f'<span class="tag">{_category_label(category)}</span>'
                f'<span class="tag">{aud}</span>'
                f'<span class="tag">{tml}</span>'
                f'<span class="tag">{pub_kind} {pub_str}</span>'
                f'{_mail_status(pub, exp)}</summary>'
                f'<div class="msg-body">{safe_body}</div>'
                f'<div class="msg-meta">创建于 {time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))}'
                f' · 投放 {pub_str} ~ {exp_str}</div>'
                f'</details>'
                f'<a class="del-link" href="{del_url}" '
                f'onclick="return confirm(\'确定删除这条消息？\');">删除</a>'
                f'</div></div>'
            )
        return "\n".join(lines)

    # 熔断告警横幅
    if tripped:
        when = (
            time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(int(trip_ts)))
            if trip_ts
            else "-"
        )
        alert = f"""<div class="alert">
            <div class="alert-title">投票已熔断</div>
            <div class="alert-body">触发时间：{when}　原因：{reason}<br/>
            投票提交已停止（返回 503），统计仍可查看。请核对数据无误后再恢复。</div>
            <a class="btn-resume" href="/vote/admin/resume?token={token}">核对完毕，恢复正常</a>
        </div>"""
    else:
        alert = ""

    # 设备占比
    dev_total = site["mobile_uv"] + site["pc_uv"]
    if dev_total:
        m_pct = round(site["mobile_uv"] / dev_total * 100, 1)
        p_pct = round(site["pc_uv"] / dev_total * 100, 1)
    else:
        m_pct = p_pct = 0

    export_url = "/vote/admin/export" + (f"?token={token}" if token else "")
    token_json = json.dumps(token or "")
    today_str = time.strftime("%Y-%m-%d")
    # AI 四维投票：每维一块（维度名 + 参与人数/均分 + 1~5 分布条）
    ai_card = "".join(
        f'<h3 style="margin:14px 0 6px;font-size:13px;color:#666">{_topic_label(t)}</h3>'
        f'<div class="summary"><div>参与人数<strong>{ai[t]["count"]}</strong></div>'
        f'<div>平均分<strong>{ai[t]["avg"]}</strong></div></div>'
        + "".join(_bar(s, ai[t]["distribution"][s], ai[t]["count"]) for s in range(1, 6))
        for t in ("ai_std", "ai_strong", "ai_speed", "ai_overall")
    )
    page = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>OfCourses 管理后台</title>
<style>
:root {{ color-scheme: light dark; }}
* {{ box-sizing: border-box; }}
body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    margin: 0; padding: 24px;
    background: #f6f7f9; color: #222;
}}
@media (prefers-color-scheme: dark) {{
    body {{ background: #0e0e14; color: #eee; }}
    .card {{ background: #16161f; border-color: rgba(255,255,255,0.08); }}
    th, td {{ border-bottom-color: rgba(255,255,255,0.08); }}
    th {{ background: rgba(255,255,255,0.04); }}
    .bar-track {{ background: rgba(255,255,255,0.08); }}
}}
.container {{ max-width: 960px; margin: 0 auto; }}
h1 {{ margin: 0 0 16px; font-size: 20px; }}
h2 {{ margin: 0 0 12px; font-size: 16px; }}
.header {{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }}
a.download {{
    display: inline-block; padding: 6px 12px; border-radius: 6px;
    background: #4f46e5; color: #fff; text-decoration: none; font-size: 13px;
}}
.section-title {{ margin: 28px 0 12px; font-size: 15px; font-weight: 600; }}
.alert {{
    border: 1px solid #f0b4b4; background: #fdecec; border-radius: 12px;
    padding: 14px 16px; margin-bottom: 20px;
}}
@media (prefers-color-scheme: dark) {{
    .alert {{ border-color: #7a2e2e; background: rgba(226,75,74,0.12); }}
}}
.alert-title {{ font-weight: 600; margin-bottom: 6px; color: #a32d2d; }}
@media (prefers-color-scheme: dark) {{ .alert-title {{ color: #f09595; }} }}
.alert-body {{ font-size: 13px; line-height: 1.6; margin-bottom: 10px; }}
.btn-resume {{
    display: inline-block; padding: 6px 12px; border-radius: 6px;
    background: #a32d2d; color: #fff; text-decoration: none; font-size: 13px;
}}
.grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 24px; }}
.grid4 {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 16px; }}
.card {{
    background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 16px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}}
.kpi {{ text-align: center; }}
.kpi .num {{ font-size: 26px; font-weight: 600; display: block; }}
.kpi .lbl {{ font-size: 12px; color: #777; }}
.summary {{ display: flex; gap: 24px; margin-bottom: 12px; font-size: 14px; }}
.summary strong {{ font-size: 20px; display: block; }}
.bar-row {{ display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 13px; }}
.bar-label {{ width: 36px; }}
.bar-track {{ flex: 1; height: 8px; background: rgba(0,0,0,0.08); border-radius: 4px; overflow: hidden; }}
.bar-fill {{ height: 100%; background: #4f46e5; border-radius: 4px; }}
.bar-count {{ width: 90px; text-align: right; color: #666; }}
table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
th, td {{ padding: 8px; text-align: left; border-bottom: 1px solid rgba(0,0,0,0.08); }}
th {{ background: rgba(0,0,0,0.03); }}
.ua {{ max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
.empty {{ text-align: center; color: #888; }}
.trend-axis {{ display: flex; justify-content: space-between; font-size: 11px; color: #888; margin-top: 4px; }}
.dev-row {{ display: flex; gap: 8px; align-items: center; font-size: 13px; margin: 6px 0; }}
.dev-tag {{ width: 60px; }}
.admin-nav {{ display: flex; gap: 8px; margin: 0 0 20px; border-bottom: 1px solid rgba(0,0,0,0.08); }}
.admin-tab {{
    border: none; background: none; cursor: pointer; padding: 10px 14px; font-size: 14px;
    color: #666; border-bottom: 2px solid transparent; margin-bottom: -1px;
}}
.admin-tab.active {{ color: #4f46e5; border-bottom-color: #4f46e5; font-weight: 600; }}
.mail-form {{ display: flex; flex-direction: column; gap: 10px; }}
.mail-form input[type="text"], .mail-form textarea, .mail-form select {{
    width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.15);
    font-size: 13px; background: transparent; color: inherit; font-family: inherit;
}}
.pin-row {{ display: flex; align-items: center; gap: 6px; font-size: 13px; }}
.mail-actions {{ display: flex; align-items: center; gap: 12px; }}
.btn-primary {{
    border: none; cursor: pointer; padding: 8px 18px; border-radius: 8px;
    background: #4f46e5; color: #fff; font-size: 13px;
}}
.btn-primary:disabled {{ opacity: 0.5; cursor: default; }}
.mail-status {{ font-size: 12px; color: #888; }}
.del-link {{ color: #a32d2d; text-decoration: none; font-size: 12px; }}
@media (prefers-color-scheme: dark) {{
    .admin-nav {{ border-bottom-color: rgba(255,255,255,0.08); }}
    .admin-tab {{ color: #999; }}
    .admin-tab.active {{ color: #8b9cf9; border-bottom-color: #8b9cf9; }}
    .mail-form input[type="text"], .mail-form textarea, .mail-form select {{ border-color: rgba(255,255,255,0.18); }}
}}
.mail-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }}
.mail-grid label {{ display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #666; }}
.mail-grid select, .mail-grid input {{
    padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.15);
    font-size: 13px; background: transparent; color: inherit;
}}
.msg-item {{ border-bottom: 1px solid rgba(0,0,0,0.06); padding: 10px 0; }}
.msg-item:last-child {{ border-bottom: none; }}
.msg-head {{ display: flex; align-items: flex-start; gap: 10px; }}
.msg-details {{ flex: 1; min-width: 0; }}
.msg-details summary {{ cursor: pointer; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; }}
.tag {{ font-size: 10px; padding: 2px 6px; border-radius: 999px; background: rgba(79,70,229,0.1); color: #4f46e5; white-space: nowrap; }}
.status {{ font-size: 10px; padding: 2px 6px; border-radius: 999px; white-space: nowrap; }}
.status.live {{ background: rgba(34,197,94,0.15); color: #16a34a; }}
.status.wait {{ background: rgba(234,179,8,0.18); color: #a16207; }}
.status.expired {{ background: rgba(0,0,0,0.06); color: #888; }}
.msg-body {{ margin-top: 8px; font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }}
.msg-meta {{ margin-top: 6px; font-size: 11px; color: #888; }}
.day-query {{ display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }}
.day-query input {{
    padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.15);
    font-size: 13px; background: transparent; color: inherit;
}}
.day-kpis {{ display: flex; flex-wrap: wrap; gap: 18px; font-size: 13px; margin-bottom: 14px; }}
.day-kpis b {{ font-size: 18px; }}
.day-hours {{ display: flex; align-items: flex-end; gap: 3px; height: 84px; margin-bottom: 6px; }}
.hour-col {{ flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }}
.hour-bar {{ width: 100%; background: #4f46e5; border-radius: 2px 2px 0 0; min-height: 1px; }}
.hour-col span {{ font-size: 9px; color: #888; margin-top: 3px; }}
.hour-num {{ font-size: 8px; color: #99a; margin-bottom: 1px; line-height: 1; }}
/* AI 用量走势（近30天）与某日分段条形图 */
.ai-history-chart {{ display: flex; align-items: flex-end; gap: 2px; height: 130px; padding-top: 18px; }}
.ai-col {{ flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }}
.ai-num {{ font-size: 8px; color: #889; line-height: 1.1; margin-bottom: 2px; white-space: nowrap; }}
.ai-bar {{ width: 100%; background: #4f46e5; border-radius: 2px 2px 0 0; min-height: 1px; }}
.ai-col .d {{ font-size: 8px; color: #99a; margin-top: 3px; white-space: nowrap; }}
.ai-seg-bar {{ display: flex; height: 28px; border-radius: 5px; overflow: hidden; border: 1px solid rgba(128,128,128,0.25); }}
.ai-seg {{ display: flex; align-items: center; justify-content: center; font-size: 9px; color: #fff; min-width: 2px; overflow: hidden; white-space: nowrap; }}
.ai-legend {{ font-size: 11px; color: #889; margin-top: 6px; line-height: 1.7; }}
@media (prefers-color-scheme: dark) {{
    .mail-grid label {{ color: #999; }}
    .mail-grid select, .mail-grid input, .day-query input {{ border-color: rgba(255,255,255,0.18); }}
    .tag {{ background: rgba(139,156,249,0.15); color: #8b9cf9; }}
    .msg-item {{ border-bottom-color: rgba(255,255,255,0.06); }}
    .status.expired {{ background: rgba(255,255,255,0.08); color: #999; }}
}}
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>OfCourses 管理后台</h1>
        <a class="download" href="{export_url}">下载投票 CSV</a>
    </div>

    <nav class="admin-nav">
        <button class="admin-tab active" data-tab="stats" type="button">数据情况</button>
        <button class="admin-tab" data-tab="mail" type="button">邮件系统</button>
        <button class="admin-tab" data-tab="ai" type="button">AI 助手</button>
        <button class="admin-tab" data-tab="review" type="button">课程评价</button>
    </nav>

    <div id="tab-stats">
    {alert}

    <div class="section-title">站点访问统计</div>
    <div class="grid4">
        <div class="card kpi"><span class="num">{site["uv_24h"]}</span><span class="lbl">近 24 小时访客</span></div>
        <div class="card kpi"><span class="num">{site["uv_7d"]}</span><span class="lbl">近 7 天访客</span></div>
        <div class="card kpi"><span class="num">{site["total_uv"]}</span><span class="lbl">累计访客</span></div>
        <div class="card kpi"><span class="num">{site["total_pv"]}</span><span class="lbl">累计浏览</span></div>
    </div>
    <div class="grid">
        <div class="card">
            <h2>近 30 天访客趋势</h2>
            {_sparkline(site["trend"])}
        </div>
        <div class="card">
            <h2>设备占比</h2>
            <div class="dev-row"><span class="dev-tag">移动端</span>
                <div class="bar-track"><div class="bar-fill" style="width:{m_pct}%"></div></div>
                <span class="bar-count">{site["mobile_uv"]} ({m_pct}%)</span></div>
            <div class="dev-row"><span class="dev-tag">电脑端</span>
                <div class="bar-track"><div class="bar-fill" style="width:{p_pct}%"></div></div>
                <span class="bar-count">{site["pc_uv"]} ({p_pct}%)</span></div>
            <h2 style="margin-top:18px">热门页面</h2>
            <table><tbody>{_pages_html()}</tbody></table>
        </div>
    </div>

    <div class="card">
        <h2>某一天详情</h2>
        <div class="day-query">
            <input type="date" id="day-input" value="{today_str}" />
            <button id="day-btn" class="btn-primary" type="button">查询</button>
        </div>
        <div id="day-result"><div class="empty">选择日期后点击查询</div></div>
    </div>

    <div class="section-title">功能投票</div>
    <div class="grid">
        <div class="card">
            <h2>AI 推荐助手（四维）</h2>
            {ai_card}
        </div>
        <div class="card">
            <h2>{_topic_label("review")}</h2>
            <div class="summary">
                <div>参与人数<strong>{review["count"]}</strong></div>
                <div>平均分<strong>{review["avg"]}</strong></div>
            </div>
            {''.join(_bar(s, review["distribution"][s], review["count"]) for s in range(1, 6))}
        </div>
    </div>
    <div class="card">
        <h2>最近 50 条投票</h2>
        <table>
            <thead><tr><th>主题</th><th>分数</th><th>IP 哈希</th><th>时间</th><th>UA</th></tr></thead>
            <tbody>{_rows_html()}</tbody>
        </table>
    </div>
    </div>

    <div id="tab-mail" style="display:none">
        <div class="card">
            <h2>发送新消息</h2>
            <div class="mail-form">
                <div class="mail-grid">
                    <label>分类
                        <select id="mail-category">
                            <option value="notice">网站声明</option>
                            <option value="update">网站更新</option>
                        </select>
                    </label>
                    <label>发布对象（对用户不可见）
                        <select id="mail-audience">
                            <option value="all">全部用户</option>
                            <option value="new">新用户（首次打开）</option>
                            <option value="veteran">老用户（用过至少一次）</option>
                        </select>
                    </label>
                    <label>推送时效
                        <select id="mail-timeliness">
                            <option value="forever">始终</option>
                            <option value="day">仅当天</option>
                            <option value="3d">仅3天</option>
                            <option value="week">仅一周</option>
                            <option value="month">仅一月</option>
                        </select>
                    </label>
                    <label>发布时间
                        <select id="mail-publish-type">
                            <option value="now">立即</option>
                            <option value="scheduled">预设时间</option>
                        </select>
                    </label>
                </div>
                <input type="datetime-local" id="mail-publish-at" style="display:none" />
                <input type="text" id="mail-title" placeholder="标题（必填，最多 120 字）" maxlength="120" />
                <textarea id="mail-body" rows="6" placeholder="正文（必填，最多 8000 字）" maxlength="8000"></textarea>
                <label class="pin-row"><input type="checkbox" id="mail-pinned" /> 置顶显示</label>
                <div class="mail-actions">
                    <button id="mail-send" class="btn-primary" type="button">发送</button>
                    <span id="mail-status" class="mail-status"></span>
                </div>
            </div>
        </div>
        <div class="card">
            <h2>已发送消息（{len(msgs)}）</h2>
            {_mail_rows_html()}
        </div>
    </div>

    <div id="tab-ai" style="display:none">
        <div class="grid4">
            <div class="card kpi"><span class="num" id="ai-kpi-today-calls">{ai_today[0]}</span><span class="lbl">今日调用</span></div>
            <div class="card kpi"><span class="num" id="ai-kpi-today-tokens">{ai_today[1]}</span><span class="lbl">今日 token</span></div>
            <div class="card kpi"><span class="num" id="ai-kpi-total-calls">{ai_total[0]}</span><span class="lbl">累计调用</span></div>
            <div class="card kpi"><span class="num" id="ai-kpi-total-tokens">{ai_total[1]}</span><span class="lbl">累计 token</span></div>
        </div>
        <div class="card">
            <h2>今日分档用量</h2>
            <div class="day-kpis">
                <span>低级档 {AI_MODEL_FLASH}：<b id="ai-seg-flash">{ai_by_model.get('flash', {}).get('calls', 0)} 次 / {ai_by_model.get('flash', {}).get('tokens', 0)} token</b></span>
                <span>高级档 {AI_MODEL_STRONG or '（未开启）'}：<b id="ai-seg-strong">{ai_by_model.get('strong', {}).get('calls', 0)} 次 / {ai_by_model.get('strong', {}).get('tokens', 0)} token</b></span>
                <span>高级档费用估计：<b id="ai-seg-strong-fee">今日 ¥{ai_by_model.get('strong', {}).get('tokens', 0) / 1e6 * ai_quotas['strong_price']:.4f} / 累计 ¥{ai_strong_total_toks / 1e6 * ai_quotas['strong_price']:.4f}</b></span>
            </div>
            <div class="msg-body" style="font-size:11px;color:#888">按混合单价 {ai_quotas['strong_price']} 元/百万 token 估算（含缓存摊薄；单价按中转账单实测约 $4.8/M 标定，可在下方限额配置中修改）。实际账单以中转站为准。</div>
        </div>
        <div class="card">
            <h2>Token ↔ 费用换算器</h2>
            <div class="mail-grid">
                <label>单价（元 / 百万 token）
                    <input type="number" id="ai-conv-price" step="0.01" min="0" value="{ai_quotas['strong_price']}" />
                </label>
                <label>Token 数
                    <input type="number" id="ai-conv-tok" step="1" min="0" placeholder="输入 token 数换算金额" />
                </label>
                <label>金额（元）
                    <input type="number" id="ai-conv-fee" step="0.0001" min="0" placeholder="输入金额反推 token" />
                </label>
            </div>
            <div class="msg-body" style="font-size:11px;color:#888;margin-top:6px">任一输入实时换算另一项：金额 = token ÷ 1,000,000 × 单价。默认单价取自下方限额配置的"强模型单价"。</div>
        </div>
        <div class="card">
            <h2>限额配置</h2>
            <div class="day-kpis">
                <span>服务状态：<b>{'已开启' if flash_up_now else '未开启（配置低级档模型或检查 PARATERA_API_KEY）'}</b></span>
                <span>{ai_models_show['flash']['display']}：<b>{ai_models_show['flash']['model'] or '未配置'}</b>{'（管理页配置）' if ai_models_show['flash']['source'] == 'meta' else ''}</span>
                <span>{ai_models_show['strong']['display']}：<b>{ai_models_show['strong']['model'] or '未开启'}</b>{strong_channel_tag}{'' if ai_models_show['strong']['source'] != 'meta' else '（管理页配置）'}</span>
            </div>
            <div class="mail-actions" style="margin-bottom:12px">
                <button id="ai-toggle-master" class="btn-primary" type="button" data-param="ai_enabled={'0' if ai_switches['master'] else '1'}" data-confirm="{'确定一键停用用户端 AI 助手？（两档模型同时拒绝服务）' if ai_switches['master'] else '确定一键启用用户端 AI 助手？'}">{('停用用户端 AI 助手（一键）' if ai_switches['master'] else '已停用——点击一键启用')}</button>
                <button id="ai-toggle-flash" class="btn-primary" type="button" data-param="flash_enabled={'0' if ai_switches['flash'] else '1'}" data-confirm="{'确定停用标准模型档？' if ai_switches['flash'] else '确定启用标准模型档？'}">{('停用' + ai_models_show['flash']['display'] if ai_switches['flash'] else '已停用——启用' + ai_models_show['flash']['display'])}</button>
                <button id="ai-toggle-strong" class="btn-primary" type="button" {'disabled' if not strong_up_now else ''} data-param="strong_enabled={'0' if ai_switches['strong'] else '1'}" data-confirm="{'确定停用强模型档？' if ai_switches['strong'] else '确定启用强模型档？'}">{('停用' + ai_models_show['strong']['display'] if ai_switches['strong'] else '已停用——启用' + ai_models_show['strong']['display'])}</button>
                <span id="ai-toggle-status" class="mail-status"></span>
            </div>
            <div class="mail-grid">
                <label>登录用户每日提问上限
                    <input type="number" id="ai-quota-visitor" min="1" max="500" value="{ai_quotas['visitor']}" />
                </label>
                <label>未登录游客限额倍数（0~1，游客 = 登录上限 × 倍数，至少 1 次）
                    <input type="number" id="ai-guest-ratio" min="0" max="1" step="0.05" value="{ai_quotas['guest_ratio']}" />
                </label>
                <label>每 IP 每日提问上限（游客兜底，登录用户不受限）
                    <input type="number" id="ai-quota-ip" min="1" max="5000" value="{ai_quotas['ip']}" />
                </label>
                <label>低级档全局每日 token 熔断上限（0 = 不限）
                    <input type="number" id="ai-token-cap" min="0" value="{ai_quotas['token_cap']}" />
                </label>
                <label>高级档全局每日 token 上限（0 = 不限）
                    <input type="number" id="ai-strong-token-cap" min="0" value="{ai_quotas['strong_token_cap']}" />
                </label>
                <label>高级档每人每日 token 占全局百分比（%）
                    <input type="number" id="ai-strong-user-pct" min="1" max="100" value="{ai_quotas['strong_user_pct']}" />
                </label>
                <label>高级档每人每日有效对话次数上限（0 = 不限）
                    <input type="number" id="ai-strong-count" min="0" max="200" value="{ai_quotas['strong_count']}" />
                </label>
                <label>有效对话判定阈值（completion tokens，约 50 字 = 80）
                    <input type="number" id="ai-strong-valid-min" min="1" max="100000" value="{ai_quotas['strong_valid_min']}" />
                </label>
                <label>强模型单价（元/百万 token，费用估计用）
                    <input type="number" id="ai-strong-price" min="0" step="0.1" value="{ai_quotas['strong_price']}" />
                </label>
            </div>
            <div class="mail-actions" style="margin-top:12px">
                <button id="ai-save" class="btn-primary" type="button">保存限额</button>
                <span id="ai-status" class="mail-status"></span>
            </div>
        </div>
        <div class="card">
            <h2>模型配置</h2>
            <div class="msg-body" style="font-size:11px;color:#888;margin-bottom:8px">
                配置两档模型的显示名称与 API 信息（OpenAI 兼容接口），保存后立即生效，无需改代码。
                API Key 只写入服务器数据库、保存后不再回显（留空表示沿用原 key）。
                显示名称会同步到用户端所有界面；“恢复默认”清除该档配置，回落到服务器环境变量。
            </div>
            <div class="mail-grid">
                <label>{ai_models_show['flash']['display']} · 显示名称（用户端展示，留空恢复“标准模型”）
                    <input type="text" id="ai-mcfg-flash-display" maxlength="40" value="{ai_models_cfg['flash'].get('display', '')}" placeholder="标准模型" />
                </label>
                <label>{ai_models_show['flash']['display']} · 模型名（model）
                    <input type="text" id="ai-mcfg-flash-model" value="{ai_models_show['flash']['model']}" placeholder="{AI_MODEL_FLASH}" />
                </label>
                <label>{ai_models_show['flash']['display']} · API 地址（base_url，如 https://api.xxx.com/v1）
                    <input type="text" id="ai-mcfg-flash-base" value="{ai_models_show['flash']['base_url']}" placeholder="{AI_BASE_URL}" />
                </label>
                <label>{ai_models_show['flash']['display']} · API Key（留空 = 沿用）
                    <input type="password" id="ai-mcfg-flash-key" autocomplete="new-password" placeholder="{'已配置（不回显）' if ai_models_cfg['flash'].get('key') else '未单独配置'}" />
                </label>
                <label>{ai_models_show['strong']['display']} · 显示名称（用户端展示，留空恢复“强模型”）
                    <input type="text" id="ai-mcfg-strong-display" maxlength="40" value="{ai_models_cfg['strong'].get('display', '')}" placeholder="强模型" />
                </label>
                <label>{ai_models_show['strong']['display']} · 模型名（model）
                    <input type="text" id="ai-mcfg-strong-model" value="{ai_models_show['strong']['model']}" placeholder="{AI_MODEL_STRONG or '（环境变量未配置）'}" />
                </label>
                <label>{ai_models_show['strong']['display']} · API 地址（base_url，可与其他档不同供应商）
                    <input type="text" id="ai-mcfg-strong-base" value="{ai_models_show['strong']['base_url']}" placeholder="{AI_STRONG_BASE_URL}" />
                </label>
                <label>{ai_models_show['strong']['display']} · API Key（留空 = 沿用）
                    <input type="password" id="ai-mcfg-strong-key" autocomplete="new-password" placeholder="{'已配置（不回显）' if ai_models_cfg['strong'].get('key') else '未单独配置'}" />
                </label>
            </div>
            <div class="mail-actions" style="margin-top:12px">
                <button id="ai-mcfg-save" class="btn-primary" type="button">保存模型配置</button>
                <button id="ai-mcfg-reset" class="btn-primary" type="button" style="background:#6b7280">两档均恢复默认（清除管理页配置）</button>
                <span id="ai-mcfg-status" class="mail-status"></span>
            </div>
        </div>
        <div class="card">
            <h2>额度管理</h2>
            <div class="msg-body" style="margin-bottom:10px">
                次数重置会清空限流计数（所有用户当天可重新提问）；<br/>
                token 重置<b>不再删除用量记录</b>：累计统计与历史条形图保持不变，今日统计从新一代重新计数，
                某日详情的条形图会把重置前后的用量按颜色分段累加展示。
            </div>
            <div class="mail-actions">
                <button id="ai-reset-users" class="btn-primary" type="button">重置用户今日次数限额</button>
                <button id="ai-reset-tokens" class="btn-primary" type="button">重置标准模型额度（保留记录）</button>
                <button id="ai-reset-strong" class="btn-primary" type="button">重置强模型额度（保留记录）</button>
                <span id="ai-reset-status" class="mail-status"></span>
            </div>
        </div>
        <div class="card">
            <h2>用量走势（近 30 天）</h2>
            <div id="ai-history-chart" class="ai-history-chart"><div class="empty">加载中…</div></div>
            <div class="msg-body" style="font-size:11px;color:#888;margin-top:6px">柱上数字为当日总 token；悬停可查看分档明细。</div>
            <h2 style="margin-top:16px">某日 AI 用量详情</h2>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
                <input type="date" id="ai-day-input" style="padding:6px 8px" />
                <button id="ai-day-btn" class="btn-primary" type="button">查询</button>
            </div>
            <div id="ai-day-result"><div class="empty">选择日期后查询</div></div>
        </div>
        <div class="card">
            <h2>意图分类测试（终端）</h2>
            <div class="msg-body" style="margin-bottom:10px">
                调用与用户端完全相同的分类链路（含 429 等待重试），SSE 实时推送全过程。测试 token 计入每日熔断。
            </div>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
                <input type="text" id="cls-q" style="flex:1;padding:6px 8px" placeholder="输入测试问题，如：我目前对航空航天方向感兴趣，帮我规划" />
                <button id="cls-run" class="btn-primary" type="button">运行</button>
                <button id="cls-clear" class="btn-primary" type="button" style="background:#6b7280">清屏</button>
            </div>
            <div id="cls-status" class="mail-status"></div>
            <pre id="cls-term" style="display:none;margin:8px 0 0;padding:12px;background:#10141b;color:#d6e2f0;border-radius:8px;min-height:200px;max-height:420px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;font-family:Consolas,'Courier New',monospace;font-size:12px;line-height:1.7"></pre>
        </div>
        <div class="card">
            <h2>使用声明管理</h2>
            <div class="msg-body" style="font-size:11px;color:#888;margin-bottom:8px">
                当前版本：<b id="ai-disclaimer-ver">{ai_disclaimer_ver}</b>。格式约定：以 # 开头的行作为小节标题，其余行为正文，空行忽略；<b>中文或英文留空时，用户端使用站内内置声明</b>。
                修改内容后点"保存声明内容"即对用户即时生效；若希望所有已签署用户重新阅读并签署（如声明条款变更），点"要求用户重新签署"使版本号 +1。
            </div>
            <div class="mail-grid">
                <label>中文声明
                    <textarea id="ai-disclaimer-zh" rows="10" placeholder="留空使用内置中文声明">{html.escape(ai_disclaimer_zh)}</textarea>
                </label>
                <label>英文声明
                    <textarea id="ai-disclaimer-en" rows="10" placeholder="留空使用内置英文声明">{html.escape(ai_disclaimer_en)}</textarea>
                </label>
            </div>
            <div class="mail-actions">
                <button id="ai-disclaimer-save" class="btn-primary" type="button">保存声明内容</button>
                <button id="ai-disclaimer-reagree" class="btn-primary" type="button">要求用户重新签署（版本 +1）</button>
                <span id="ai-disclaimer-status" class="mail-status"></span>
            </div>
        </div>
        <div class="card">
            <h2>说明</h2>
            <div class="msg-body">
                - AI 助手每天零点自动重置限额；全局 token 触顶后当日停止服务并推送 Server酱 告警，次日自动恢复。<br/>
                - 双档模型分开记账：低级档（Flash）按次数+全局 token 熔断；高级档（强模型）按每人 token 百分比+有效对话次数+独立全局池。<br/>
                - 服务器只记录调用次数与 token 消耗，不保存任何对话内容。<br/>
                - 知识库由 server/vote/build_knowledge.py 生成，培养方案数据更新后重新执行即可。
            </div>
        </div>
    </div>

    <div id="tab-review" style="display:none">
        <div class="section-title">课程评价审核</div>
        <div class="card">
            <h2>待审队列 <span id="rv-pending-count" style="font-size:12px;color:#888"></span></h2>
            <div class="msg-body" style="font-size:11px;color:#888;margin-bottom:8px">
                全部评价先审后显。AI 标签仅供参考（灰=无标签/红=疑似广告或无关/橙=疑似负面涉师）；
                新自定义课程条目会显示「疑似重复条目」，确认重复时请在下方「条目管理」合并后再通过评价。
                审核尺度：客观陈述事实（作业量/考核方式/给分风格）可以，针对教师个人的负面评价驳回。
            </div>
            <div id="rv-pending-list" class="rv-list"></div>
        </div>
        <div class="card">
            <h2>举报队列 <span id="rv-report-count" style="font-size:12px;color:#888"></span></h2>
            <div class="msg-body" style="font-size:11px;color:#888;margin-bottom:8px">
                仅显示举报数达到「举报入队阈值」的评价（不推微信）；忽略后帖子保留、退出队列，再次被举报会重新出现。
            </div>
            <div id="rv-report-list" class="rv-list"></div>
        </div>
        <div class="card">
            <h2>提醒与阈值配置</h2>
            <div class="msg-body" style="font-size:11px;color:#888;margin-bottom:8px">
                举报入队/自动下架、待审提醒的阈值与时效都在这里改（Server酱仅用于待审/举报队列累计提醒，额度有限按需调整）。
                热度时间衰减引力越大，旧评价热度衰减越快；0 表示不衰减。
            </div>
            <div class="mail-grid">
                <label>举报入队阈值（达到该条数进入举报队列）
                    <input type="number" id="rv-cfg-report-push" min="1" max="100" />
                </label>
                <label>举报自动下架阈值（达到该条数软删）
                    <input type="number" id="rv-cfg-report-del" min="1" max="100" />
                </label>
                <label>待审提醒阈值（新待审+新举报累计增量）
                    <input type="number" id="rv-cfg-remind-count" min="1" max="100" />
                </label>
                <label>待审时效提醒（滞留小时数，0 = 关闭）
                    <input type="number" id="rv-cfg-remind-stale" min="0" max="720" />
                </label>
                <label>每人每日发表上限
                    <input type="number" id="rv-cfg-daily-limit" min="1" max="50" />
                </label>
                <label>热度时间衰减引力（0 = 不衰减）
                    <input type="number" id="rv-cfg-gravity" min="0" max="3" step="0.1" />
                </label>
            </div>
            <div class="mail-actions" style="margin-top:12px">
                <button id="rv-cfg-save" class="btn-primary" type="button">保存配置</button>
                <span id="rv-cfg-status" class="mail-status"></span>
            </div>
        </div>
        <div class="card">
            <h2>已发布管理 <span id="rv-pub-count" style="font-size:12px;color:#888"></span></h2>
            <div class="mail-actions" style="margin-bottom:8px">
                <input type="text" id="rv-pub-query" placeholder="按内容或课程名搜索" style="flex:1" />
                <button id="rv-pub-search" class="btn-primary" type="button">搜索</button>
            </div>
            <div id="rv-pub-list" class="rv-list"></div>
            <div class="mail-actions" style="margin-top:8px">
                <button id="rv-pub-prev" class="btn-primary" type="button" style="background:#6b7280">上一页</button>
                <span id="rv-pub-page" style="font-size:12px;color:#888;align-self:center"></span>
                <button id="rv-pub-next" class="btn-primary" type="button" style="background:#6b7280">下一页</button>
            </div>
        </div>
        <div class="card">
            <h2>条目管理（合并重复课程）</h2>
            <div class="msg-body" style="font-size:11px;color:#888;margin-bottom:8px">
                同一门课可能被不同同学创建了名字不同的条目（如「工程训练1」和「工程训练一」），会分成两个独立讨论区。
                下面自动找出「名字归一化后相同」的重复条目组：点「合并」即把同组其他条目的评价全部归到保留条目
                （保留官方条目或评价数最多者），其余条目下线（软操作可追溯）。合并后评价不受影响，只是换了归属课程。
            </div>
            <div id="rv-dups-list" class="rv-list"></div>
            <div class="msg-body" style="font-size:11px;color:#888;margin:10px 0 8px;border-top:1px solid #eee;padding-top:8px">
                手动合并（按 id，适用于自动检测没覆盖的情况）：把「来源条目」的全部评价挂到「保留条目」。
            </div>
            <div class="mail-actions" style="margin-bottom:8px">
                <input type="number" id="rv-merge-from" placeholder="来源条目 id" style="width:140px" />
                <input type="number" id="rv-merge-to" placeholder="保留条目 id" style="width:140px" />
                <button id="rv-merge-btn" class="btn-primary" type="button">合并</button>
                <span id="rv-merge-status" class="mail-status"></span>
            </div>
            <div id="rv-topic-list" class="rv-list"></div>
        </div>
        <div class="card">
            <h2>社区消息 <span id="rv-msg-count" style="font-size:12px;color:#888"></span></h2>
            <div class="msg-body" style="font-size:11px;color:#888;margin-bottom:8px">
                发送到评价页右上角「消息」。收件人留空 = 全体公告；填邮箱 = 定向私信。
                审核不通过 / 被下架等事件通知会自动发给作者，无需手动发。
            </div>
            <div class="mail-actions" style="margin-bottom:6px">
                <input type="text" id="rv-msg-email" placeholder="收件人邮箱（留空 = 全体公告）" style="flex:1" />
                <input type="text" id="rv-msg-title" placeholder="标题" style="flex:1" />
            </div>
            <div class="mail-actions" style="margin-bottom:6px">
                <textarea id="rv-msg-content" rows="3" placeholder="正文（可选）" style="flex:1;font:inherit"></textarea>
            </div>
            <div class="mail-actions" style="margin-bottom:10px">
                <button id="rv-msg-send" class="btn-primary" type="button">发送</button>
                <span id="rv-msg-status" class="mail-status"></span>
            </div>
            <div id="rv-msg-list" class="rv-list"></div>
        </div>
    </div>
</div>
<script>
(function () {{
    var TOKEN = {token_json};
    var tabs = document.querySelectorAll('.admin-tab');
    function activate(name) {{
        tabs.forEach(function (t) {{ t.classList.toggle('active', t.dataset.tab === name); }});
        var s = document.getElementById('tab-stats');
        var m = document.getElementById('tab-mail');
        var a = document.getElementById('tab-ai');
        var rv = document.getElementById('tab-review');
        if (s) s.style.display = name === 'stats' ? '' : 'none';
        if (m) m.style.display = name === 'mail' ? '' : 'none';
        if (a) a.style.display = name === 'ai' ? '' : 'none';
        if (rv) rv.style.display = name === 'review' ? '' : 'none';
        if (name === 'review' && !window._rvLoaded) {{ window._rvLoaded = true; rvLoadAll(); }}
    }}
    tabs.forEach(function (t) {{ t.addEventListener('click', function () {{ activate(t.dataset.tab); }}); }});
    if (location.hash === '#mail') activate('mail');
    if (location.hash === '#ai') activate('ai');
    if (location.hash === '#review') activate('review');

    function esc(s) {{ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }}

    // 统一读取 fetch 响应：保留真实 HTTP 状态码与原始文本（非 JSON 响应也能看到内容）
    function readResp(r) {{
        return r.text().catch(function () {{ return ''; }}).then(function (t) {{
            var d = null;
            try {{ d = JSON.parse(t); }} catch (e) {{ d = null; }}
            return {{ status: r.status, ok: r.ok, d: d, text: t }};
        }});
    }}

    // —— 发布时间：立即 / 预设 ——
    var pubSel = document.getElementById('mail-publish-type');
    if (pubSel) pubSel.addEventListener('change', function () {{
        document.getElementById('mail-publish-at').style.display =
            pubSel.value === 'scheduled' ? '' : 'none';
    }});

    // —— 发送新消息 ——
    var btn = document.getElementById('mail-send');
    if (btn) btn.addEventListener('click', function () {{
        var cat = document.getElementById('mail-category').value;
        var audience = document.getElementById('mail-audience').value;
        var timeliness = document.getElementById('mail-timeliness').value;
        var pubType = document.getElementById('mail-publish-type').value;
        var pubAt = document.getElementById('mail-publish-at').value;
        var title = document.getElementById('mail-title').value.trim();
        var body = document.getElementById('mail-body').value.trim();
        var pinned = document.getElementById('mail-pinned').checked;
        var status = document.getElementById('mail-status');
        if (!title || !body) {{ status.textContent = '标题和正文不能为空'; return; }}
        if (pubType === 'scheduled' && !pubAt) {{ status.textContent = '请选择预设发布时间'; return; }}
        btn.disabled = true;
        status.textContent = '发送中…';
        var url = '/vote/admin/messages';
        if (TOKEN) url += '?token=' + encodeURIComponent(TOKEN);
        fetch(url, {{
            method: 'POST',
            headers: {{ 'Content-Type': 'application/json' }},
            body: JSON.stringify({{
                category: cat, title: title, body: body, pinned: pinned,
                audience: audience, timeliness: timeliness,
                publish_type: pubType, publish_at: pubType === 'scheduled' ? pubAt : null
            }})
        }}).then(readResp).then(function (res) {{
            if (res.ok) {{
                status.textContent = '已发送';
                setTimeout(function () {{
                    location.href = location.pathname + (TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '') + '#mail';
                }}, 400);
            }} else {{
                var msg = (res.d && (res.d.message || res.d.detail)) || (res.text ? String(res.text).slice(0, 200) : '');
                status.textContent = '发送失败：HTTP ' + res.status + (msg ? ' — ' + msg : '');
                btn.disabled = false;
            }}
        }}).catch(function () {{
            status.textContent = '网络错误，请重试';
            btn.disabled = false;
        }});
    }});

    // —— 意图分类测试（SSE 终端：实时推送全过程，与用户端同一调用链路）——
    var clsBtn = document.getElementById('cls-run');
    var clsClear = document.getElementById('cls-clear');
    var clsTerm = document.getElementById('cls-term');
    var clsStatus = document.getElementById('cls-status');

    function clsLine(s, color) {{
        var ts = new Date().toTimeString().slice(0, 8);
        var line = document.createElement('div');
        line.textContent = '[' + ts + '] ' + s;
        if (color) line.style.color = color;
        clsTerm.appendChild(line);
        clsTerm.scrollTop = clsTerm.scrollHeight;
    }}
    if (clsClear) clsClear.addEventListener('click', function () {{ clsTerm.textContent = ''; }});

    function clsRenderEv(ev) {{
        if (ev.type === 'start') {{
            clsLine('等待预算 ' + ev.budget_s + 's / 重试间隔 ' + ev.interval_s + 's', '#9ab0c9');
        }} else if (ev.type === 'attempt_start') {{
            clsLine('尝试 #' + ev.n + ' … 发送请求到上游');
        }} else if (ev.type === 'attempt_done') {{
            if (ev.status === 200) clsLine('尝试 #' + ev.n + ' ✓ HTTP 200（' + ev.elapsed_ms + 'ms）', '#7fd18c');
            else clsLine('尝试 #' + ev.n + ' ✗ HTTP ' + ev.status + '（' + ev.elapsed_ms + 'ms）', '#ffb36b');
        }} else if (ev.type === 'wait') {{
            clsLine('上游 429，' + ev.interval_s + 's 后重试（已等 ' + ev.waited_s + 's / 预算 ' + ev.budget_s + 's）', '#ffb36b');
        }} else if (ev.type === 'result') {{
            clsLine('── 汇总 ──', '#9ab0c9');
            clsLine('结果：' + (ev.ok ? '成功' : '失败（已回退全量）') + '，总耗时 ' + ev.elapsed_ms + 'ms', ev.ok ? '#7fd18c' : '#ff8a8a');
            clsLine('尝试序列：' + ((ev.attempts || []).length
                ? ev.attempts.map(function (a) {{ return 'HTTP ' + a.status + '（' + a.elapsed_ms + 'ms）'; }}).join(' → ')
                : '（无）'));
            if (ev.error) clsLine('失败原因：' + ev.error, '#ff8a8a');
            clsLine('解析结果：' + JSON.stringify(ev.result));
            if (ev.content_raw) clsLine('上游原始输出：' + ev.content_raw);
        }} else if (ev.type === 'error') {{
            clsLine('✗ ' + ev.message, '#ff8a8a');
        }}
    }}

    if (clsBtn) clsBtn.addEventListener('click', function () {{
        var q = document.getElementById('cls-q').value.trim();
        if (!q) {{ clsStatus.textContent = '请输入测试问题'; return; }}
        clsStatus.textContent = '';
        clsBtn.disabled = true;
        clsTerm.style.display = '';
        clsLine('▶ 开始分类：' + q, '#7fd18c');
        var url = '/vote/admin/ai/classify-test-stream';
        if (TOKEN) url += '?token=' + encodeURIComponent(TOKEN);
        fetch(url, {{
            method: 'POST',
            headers: {{ 'Content-Type': 'application/json' }},
            body: JSON.stringify({{ question: q }})
        }}).then(function (r) {{
            if (!r.ok || !r.body) {{
                return r.text().then(function (t) {{
                    clsLine('✗ HTTP ' + r.status + ' — ' + String(t).slice(0, 200), '#ff8a8a');
                    clsBtn.disabled = false;
                    return null;
                }});
            }}
            return r.body;
        }}).then(function (body) {{
            if (!body) return;
            var reader = body.getReader();
            var dec = new TextDecoder();
            var buf = '';
            function pump() {{
                return reader.read().then(function (chunk) {{
                    if (chunk.done) {{
                        clsBtn.disabled = false;
                        clsLine('■ 结束', '#7fd18c');
                        return;
                    }}
                    buf += dec.decode(chunk.value, {{ stream: true }});
                    var parts = buf.split('\\n\\n');
                    buf = parts.pop();
                    parts.forEach(function (p) {{
                        if (p.indexOf('data: ') !== 0) return;
                        var payload = p.slice(6);
                        if (payload === '[DONE]') return;
                        var ev = null;
                        try {{ ev = JSON.parse(payload); }} catch (e) {{ return; }}
                        clsRenderEv(ev);
                    }});
                    return pump();
                }});
            }}
            return pump();
        }}).catch(function (e) {{
            clsBtn.disabled = false;
            clsLine('✗ 网络错误：' + e, '#ff8a8a');
        }});
    }});

    // —— 某一天详情查询 ——
    function renderDay(d) {{
        var max = 1;
        d.hourly.forEach(function (c) {{ if (c > max) max = c; }});
        var html = '<div class="day-kpis">'
            + '<span>UV <b>' + d.uv + '</b></span>'
            + '<span>PV <b>' + d.pv + '</b></span>'
            + '<span>移动端 <b>' + d.mobile_uv + '</b></span>'
            + '<span>电脑端 <b>' + d.pc_uv + '</b></span></div>';
        html += '<div class="day-hours">';
        d.hourly.forEach(function (c, h) {{
            html += '<div class="hour-col" title="' + h + ':00 · ' + c + ' 次">'
                + '<span class="hour-num">' + c + '</span>'
                + '<div class="hour-bar" style="height:' + Math.max(1, Math.round(c / max * 64)) + 'px"></div>'
                + '<span>' + h + '</span></div>';
        }});
        html += '</div>';
        if (d.top_pages && d.top_pages.length) {{
            html += '<table><tbody>' + d.top_pages.map(function (p) {{
                return '<tr><td>' + esc(p[0] || '/') + '</td><td>' + p[1] + '</td></tr>';
            }}).join('') + '</tbody></table>';
        }} else {{
            html += '<div class="empty">当日无页面访问</div>';
        }}
        document.getElementById('day-result').innerHTML = html;
    }}
    var dayBtn = document.getElementById('day-btn');
    if (dayBtn) dayBtn.addEventListener('click', function () {{
        var day = document.getElementById('day-input').value;
        if (!day) return;
        var box = document.getElementById('day-result');
        box.innerHTML = '<div class="empty">查询中…</div>';
        var url = '/vote/admin/day?day=' + encodeURIComponent(day);
        if (TOKEN) url += '&token=' + encodeURIComponent(TOKEN);
        fetch(url).then(function (r) {{
            return r.json().catch(function () {{ return {{}}; }}).then(function (d) {{ return {{ ok: r.ok, d: d }}; }});
        }}).then(function (res) {{
            if (res.ok) {{ renderDay(res.d); }}
            else {{ box.innerHTML = '<div class="empty">查询失败：' + esc((res.d && res.d.detail) || res.status) + '</div>'; }}
        }}).catch(function () {{
            box.innerHTML = '<div class="empty">网络错误，请重试</div>';
        }});
    }});

    // —— AI 限额保存 ——
    var aiSave = document.getElementById('ai-save');
    if (aiSave) aiSave.addEventListener('click', function () {{
        var v = parseInt(document.getElementById('ai-quota-visitor').value, 10);
        var i = parseInt(document.getElementById('ai-quota-ip').value, 10);
        var c = parseInt(document.getElementById('ai-token-cap').value, 10);
        var sc = parseInt(document.getElementById('ai-strong-token-cap').value, 10);
        var sp = parseInt(document.getElementById('ai-strong-user-pct').value, 10);
        var sn = parseInt(document.getElementById('ai-strong-count').value, 10);
        var sm = parseInt(document.getElementById('ai-strong-valid-min').value, 10);
        var sp2 = parseFloat(document.getElementById('ai-strong-price').value);
        var gr = parseFloat(document.getElementById('ai-guest-ratio').value);
        var status = document.getElementById('ai-status');
        if (!(v > 0) || !(i > 0) || !(c >= 0) || !(sc >= 0) || !(sp >= 1) || !(sn >= 0) || !(sm >= 1) || !(sp2 >= 0) || !(gr >= 0 && gr <= 1)) {{ status.textContent = '请填写有效的数值'; return; }}
        aiSave.disabled = true;
        status.textContent = '保存中…';
        var url = '/vote/admin/ai/config?visitor=' + v + '&ip=' + i + '&token_cap=' + c
            + '&strong_token_cap=' + sc + '&strong_user_pct=' + sp + '&strong_count=' + sn + '&strong_valid_min=' + sm
            + '&strong_price=' + sp2 + '&guest_ratio=' + gr;
        if (TOKEN) url += '&token=' + encodeURIComponent(TOKEN);
        fetch(url, {{ method: 'POST' }}).then(function (r) {{
            if (r.ok) {{
                status.textContent = '已保存，立即生效';
            }} else {{
                status.textContent = '保存失败：HTTP ' + r.status;
            }}
            aiSave.disabled = false;
        }}).catch(function () {{
            status.textContent = '网络错误，请重试';
            aiSave.disabled = false;
        }});
    }});

    // —— 模型配置保存 / 恢复默认 ——
    var mcfgSave = document.getElementById('ai-mcfg-save');
    if (mcfgSave) mcfgSave.addEventListener('click', function () {{
        var status = document.getElementById('ai-mcfg-status');
        function readTier(tier) {{
            return {{
                tier: tier,
                display: document.getElementById('ai-mcfg-' + tier + '-display').value.trim(),
                model: document.getElementById('ai-mcfg-' + tier + '-model').value.trim(),
                base_url: document.getElementById('ai-mcfg-' + tier + '-base').value.trim(),
                key: document.getElementById('ai-mcfg-' + tier + '-key').value.trim()
            }};
        }}
        var bodies = [readTier('flash'), readTier('strong')];
        mcfgSave.disabled = true;
        status.textContent = '保存中…';
        Promise.all(bodies.map(function (b) {{
            var url = '/vote/admin/ai/models';
            if (TOKEN) url += '?token=' + encodeURIComponent(TOKEN);
            return fetch(url, {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify(b) }});
        }})).then(function (rs) {{
            if (rs.every(function (r) {{ return r.ok; }})) {{
                status.textContent = '已保存，立即生效';
                setTimeout(function () {{ location.reload(); }}, 800);
            }} else {{
                status.textContent = '保存失败：HTTP ' + rs.map(function (r) {{ return r.status; }}).join('/');
                mcfgSave.disabled = false;
            }}
        }}).catch(function () {{
            status.textContent = '网络错误，请重试';
            mcfgSave.disabled = false;
        }});
    }});
    var mcfgReset = document.getElementById('ai-mcfg-reset');
    if (mcfgReset) mcfgReset.addEventListener('click', function () {{
        if (!confirm('确定清除两档的管理页模型配置？（回落到服务器环境变量，立即生效）')) return;
        var status = document.getElementById('ai-mcfg-status');
        mcfgReset.disabled = true;
        status.textContent = '处理中…';
        Promise.all(['flash', 'strong'].map(function (t) {{
            var url = '/vote/admin/ai/models';
            if (TOKEN) url += '?token=' + encodeURIComponent(TOKEN);
            return fetch(url, {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify({{ tier: t, reset: true }}) }});
        }})).then(function (rs) {{
            if (rs.every(function (r) {{ return r.ok; }})) {{
                status.textContent = '已恢复默认';
                setTimeout(function () {{ location.reload(); }}, 800);
            }} else {{
                status.textContent = '操作失败：HTTP ' + rs.map(function (r) {{ return r.status; }}).join('/');
                mcfgReset.disabled = false;
            }}
        }}).catch(function () {{
            status.textContent = '网络错误，请重试';
            mcfgReset.disabled = false;
        }});
    }});

    // —— AI 额度重置 ——
    // 重置成功后立即拉取最新统计，局部刷新 KPI 卡与分档用量（无需整页刷新）
    function refreshAiKpis() {{
        var url = '/vote/admin/ai/stats';
        if (TOKEN) url += '?token=' + encodeURIComponent(TOKEN);
        fetch(url).then(function (r) {{ return r.ok ? r.json() : null; }}).then(function (d) {{
            if (!d) return;
            function set(id, v) {{ var el = document.getElementById(id); if (el) el.textContent = v; }}
            set('ai-kpi-today-calls', d.today_calls);
            set('ai-kpi-today-tokens', d.today_tokens);
            set('ai-kpi-total-calls', d.total_calls);
            set('ai-kpi-total-tokens', d.total_tokens);
            var fm = (d.by_model && d.by_model.flash) || {{}};
            var sm = (d.by_model && d.by_model.strong) || {{}};
            set('ai-seg-flash', (fm.calls || 0) + ' 次 / ' + (fm.tokens || 0) + ' token');
            set('ai-seg-strong', (sm.calls || 0) + ' 次 / ' + (sm.tokens || 0) + ' token');
            var price = d.strong_price || 0;
            set('ai-seg-strong-fee', '今日 ¥' + ((sm.tokens || 0) / 1e6 * price).toFixed(4) + ' / 累计 ¥' + ((d.strong_total_tokens || 0) / 1e6 * price).toFixed(4));
        }}).catch(function () {{}});
    }}
    function bindReset(btnId, scope, confirmText) {{
        var btn = document.getElementById(btnId);
        if (!btn) return;
        btn.addEventListener('click', function () {{
            if (!confirm(confirmText)) return;
            var status = document.getElementById('ai-reset-status');
            btn.disabled = true;
            status.textContent = '处理中…';
            var url = '/vote/admin/ai/reset?scope=' + scope;
            if (TOKEN) url += '&token=' + encodeURIComponent(TOKEN);
            fetch(url, {{ method: 'POST' }}).then(function (r) {{
                return r.json().catch(function () {{ return {{}}; }}).then(function (d) {{ return {{ ok: r.ok, d: d }}; }});
            }}).then(function (res) {{
                status.textContent = res.ok
                    ? '已重置（今日统计从新一代重新计数，累计与记录未变动）'
                    : '重置失败：HTTP ' + res.status;
                btn.disabled = false;
                if (res.ok) refreshAiKpis();
            }}).catch(function () {{
                status.textContent = '网络错误，请重试';
                btn.disabled = false;
            }});
        }});
    }}
    bindReset('ai-reset-users', 'users', '确定重置所有用户今日提问次数限额？');
    bindReset('ai-reset-tokens', 'tokens', '确定重置「标准模型档」今日额度？记录会保留（累计不变），该档今日从新一代重新计数；强模型档不受影响。');
    bindReset('ai-reset-strong', 'strong_tokens', '确定重置「强模型档」今日额度？记录会保留（累计不变），该档今日从新一代重新计数；标准模型档不受影响。');

    // —— Token ↔ 费用换算器 ——
    (function () {{
        var p = document.getElementById('ai-conv-price');
        var t = document.getElementById('ai-conv-tok');
        var f = document.getElementById('ai-conv-fee');
        if (!p || !t || !f) return;
        function calcFee() {{
            var v = parseFloat(t.value); var pr = parseFloat(p.value);
            return (isFinite(v) && isFinite(pr) && pr > 0 && v >= 0) ? v / 1e6 * pr : NaN;
        }}
        function calcTok() {{
            var v = parseFloat(f.value); var pr = parseFloat(p.value);
            return (isFinite(v) && isFinite(pr) && pr > 0 && v >= 0) ? v / pr * 1e6 : NaN;
        }}
        t.addEventListener('input', function () {{
            var x = calcFee();
            f.value = isFinite(x) ? x.toFixed(4) : '';
        }});
        f.addEventListener('input', function () {{
            var x = calcTok();
            t.value = isFinite(x) ? String(Math.round(x)) : '';
        }});
        p.addEventListener('input', function () {{
            if (t.value === '') return;
            var x = calcFee();
            f.value = isFinite(x) ? x.toFixed(4) : '';
        }});
    }})();

    // —— 使用声明管理 ——
    (function () {{
        var saveBtn = document.getElementById('ai-disclaimer-save');
        var reagreeBtn = document.getElementById('ai-disclaimer-reagree');
        if (!saveBtn || !reagreeBtn) return;
        var status = document.getElementById('ai-disclaimer-status');
        saveBtn.addEventListener('click', function () {{
            saveBtn.disabled = true;
            status.textContent = '保存中…';
            var url = '/vote/admin/ai/disclaimer';
            if (TOKEN) url += '?token=' + encodeURIComponent(TOKEN);
            fetch(url, {{
                method: 'POST',
                headers: {{ 'Content-Type': 'application/json' }},
                body: JSON.stringify({{
                    zh: document.getElementById('ai-disclaimer-zh').value,
                    en: document.getElementById('ai-disclaimer-en').value
                }})
            }}).then(function (r) {{
                return r.json().catch(function () {{ return {{}}; }}).then(function (d) {{ return {{ ok: r.ok, d: d }}; }});
            }}).then(function (res) {{
                if (res.ok) {{
                    status.textContent = '已保存（对用户即时生效；当前版本 ' + (res.d && res.d.ver ? res.d.ver : '?') + '）';
                    var verEl = document.getElementById('ai-disclaimer-ver');
                    if (verEl && res.d && res.d.ver) verEl.textContent = res.d.ver;
                }} else {{
                    status.textContent = '保存失败：HTTP ' + res.status;
                }}
                saveBtn.disabled = false;
            }}).catch(function () {{
                status.textContent = '网络错误，请重试';
                saveBtn.disabled = false;
            }});
        }});
        reagreeBtn.addEventListener('click', function () {{
            if (!confirm('确定要求所有用户重新签署使用声明？版本号 +1，已签署用户下次打开 AI 助手时会重新弹出声明。')) return;
            reagreeBtn.disabled = true;
            status.textContent = '处理中…';
            var url = '/vote/admin/ai/disclaimer/reagree';
            if (TOKEN) url += '?token=' + encodeURIComponent(TOKEN);
            fetch(url, {{ method: 'POST' }}).then(function (r) {{
                return r.json().catch(function () {{ return {{}}; }}).then(function (d) {{ return {{ ok: r.ok, d: d }}; }});
            }}).then(function (res) {{
                if (res.ok) {{
                    status.textContent = '已要求重新签署（当前版本 ' + (res.d && res.d.ver ? res.d.ver : '?') + '）';
                    var verEl = document.getElementById('ai-disclaimer-ver');
                    if (verEl && res.d && res.d.ver) verEl.textContent = res.d.ver;
                }} else {{
                    status.textContent = '操作失败：HTTP ' + res.status;
                }}
                reagreeBtn.disabled = false;
            }}).catch(function () {{
                status.textContent = '网络错误，请重试';
                reagreeBtn.disabled = false;
            }});
        }});
    }})();

    // —— AI 开关（一键停用 / 分档停用）：data-param 由服务端按当前状态渲染（点击即切到相反状态）——
    ['ai-toggle-master', 'ai-toggle-flash', 'ai-toggle-strong'].forEach(function (id) {{
        var btn = document.getElementById(id);
        if (!btn || btn.disabled) return;
        btn.addEventListener('click', function () {{
            var param = btn.dataset.param;
            if (!param) return;
            if (!confirm(btn.dataset.confirm || '确定切换开关状态？')) return;
            var status = document.getElementById('ai-toggle-status');
            btn.disabled = true;
            status.textContent = '处理中…';
            var url = '/vote/admin/ai/config?' + param + (TOKEN ? '&token=' + encodeURIComponent(TOKEN) : '');
            fetch(url, {{ method: 'POST' }}).then(function (r) {{
                if (r.ok) {{ location.reload(); }}
                else {{ status.textContent = '操作失败：HTTP ' + r.status; btn.disabled = false; }}
            }}).catch(function () {{
                status.textContent = '网络错误，请重试';
                btn.disabled = false;
            }});
        }});
    }});

    // —— AI 用量走势（近30天）——
    var SEG_COLORS = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e3a8a'];
    function fmtNum(n) {{
        return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    }}
    (function loadAiHistory() {{
        var box = document.getElementById('ai-history-chart');
        if (!box) return;
        var url = '/vote/admin/ai/history?days=30' + (TOKEN ? '&token=' + encodeURIComponent(TOKEN) : '');
        fetch(url).then(function (r) {{ return r.json().catch(function () {{ return {{}}; }}); }}).then(function (d) {{
            if (!d.days || !d.days.length) {{ box.innerHTML = '<div class="empty">暂无数据</div>'; return; }}
            var max = 1;
            d.days.forEach(function (x) {{ if (x.tokens > max) max = x.tokens; }});
            var html = '';
            d.days.forEach(function (x) {{
                var h = Math.max(1, Math.round(x.tokens / max * 100));
                var tip = x.day + '：' + x.tokens + ' token（低级档 ' + x.flash_tokens + ' / 高级档 ' + x.strong_tokens + '，' + x.calls + ' 次）';
                html += '<div class="ai-col" title="' + tip + '">'
                    + '<span class="ai-num">' + (x.tokens > 0 ? fmtNum(x.tokens) : '') + '</span>'
                    + '<div class="ai-bar" style="height:' + h + 'px' + (x.strong_tokens > 0 ? ';background:linear-gradient(to top,#4f46e5 ' + Math.round(x.flash_tokens / Math.max(1, x.tokens) * 100) + '%,#f59e0b ' + Math.round(x.flash_tokens / Math.max(1, x.tokens) * 100) + '%)' : '') + '"></div>'
                    + '<span class="d">' + x.day.slice(5) + '</span></div>';
            }});
            box.innerHTML = html;
        }}).catch(function () {{ box.innerHTML = '<div class="empty">加载失败，请刷新重试</div>'; }});
    }})();

    // —— 某日 AI 用量详情（含重置分段条形图；分段按 档位+代次，两档重置互相独立）——
    function renderAiDay(d) {{
        var tierName = function (t) {{ return t === 'strong' ? '强模型' : '标准'; }};
        var html = '<div class="day-kpis">'
            + '<span>调用 <b>' + d.calls + '</b> 次</span>'
            + '<span>token <b>' + d.tokens + '</b></span>'
            + '<span>低级档 <b>' + d.flash.calls + ' 次 / ' + d.flash.tokens + '</b></span>'
            + '<span>高级档 <b>' + d.strong.calls + ' 次 / ' + d.strong.tokens + '</b></span>'
            + '<span>重置 <b>' + (d.resets.length) + '</b> 次</span></div>';
        if (d.resets.length) html += '<div class="ai-legend">重置时刻：' + d.resets.map(function (r) {{ return r.time + '（' + tierName(r.tier) + '）'; }}).join('、') + '</div>';
        if (d.tokens > 0) {{
            html += '<div class="ai-seg-bar">';
            d.segments.forEach(function (s, i) {{
                var w = Math.max(2, Math.round(s.tokens / d.tokens * 100));
                var color = SEG_COLORS[Math.min(i, SEG_COLORS.length - 1)];
                var label = fmtNum(s.tokens);
                html += '<div class="ai-seg" style="width:' + w + '%;background:' + color + '" title="' + tierName(s.model) + '第 ' + s.gen + ' 代：' + s.calls + ' 次 / ' + s.tokens + ' token">' + (w >= 12 ? label : '') + '</div>';
            }});
            html += '</div>';
            html += '<div class="ai-legend">';
            d.segments.forEach(function (s, i) {{
                html += '<div>' + tierName(s.model) + '第 ' + s.gen + ' 代（' + s.model + '）：' + s.calls + ' 次 / ' + s.tokens + ' token</div>';
            }});
            html += '</div>';
        }} else {{
            html += '<div class="empty">当日无 AI 用量</div>';
        }}
        document.getElementById('ai-day-result').innerHTML = html;
    }}
    var aiDayBtn = document.getElementById('ai-day-btn');
    if (aiDayBtn) aiDayBtn.addEventListener('click', function () {{
        var day = document.getElementById('ai-day-input').value;
        if (!day) return;
        var box = document.getElementById('ai-day-result');
        box.innerHTML = '<div class="empty">查询中…</div>';
        var url = '/vote/admin/ai/day?day=' + encodeURIComponent(day) + (TOKEN ? '&token=' + encodeURIComponent(TOKEN) : '');
        fetch(url).then(function (r) {{
            return r.json().catch(function () {{ return {{}}; }}).then(function (d) {{ return {{ ok: r.ok, d: d }}; }});
        }}).then(function (res) {{
            if (res.ok) {{ renderAiDay(res.d); }}
            else {{ box.innerHTML = '<div class="empty">查询失败：' + esc((res.d && res.d.detail) || res.status) + '</div>'; }}
        }}).catch(function () {{
            box.innerHTML = '<div class="empty">网络错误，请重试</div>';
        }});
    }});

    // —— 课程评价审核（2026-11-16）——
    var RV_TAG_STYLE = {{
        normal: '',
        ad: 'color:#dc2626;font-weight:600',
        offtopic: 'color:#dc2626;font-weight:600',
        teacher_negative: 'color:#d97706;font-weight:600'
    }};
    var RV_TAG_NAME = {{
        normal: 'AI: 正常',
        ad: 'AI: 疑似广告',
        offtopic: 'AI: 疑似无关',
        teacher_negative: 'AI: 疑似负面涉师'
    }};
    function rvCard(inner) {{
        return '<div class="rv-card" style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px;font-size:12px">' + inner + '</div>';
    }}
    function rvItem(d, opts) {{
        opts = opts || {{}};
        var tag = d.ai_tag ? '<span style="' + (RV_TAG_STYLE[d.ai_tag] || '') + '">' + (RV_TAG_NAME[d.ai_tag] || d.ai_tag) + '</span> · ' : '';
        var topic = esc(d.topic && d.topic.name || '');
        var dup = (d.dup_hints && d.dup_hints.length)
            ? '<div style="color:#d97706;margin-top:4px">疑似重复条目：' + d.dup_hints.map(function (h) {{
                return '#' + h.id + ' ' + esc(h.name);
              }}).join('、') + '</div>' : '';
        var reports = (d.reports && d.reports.length)
            ? '<div style="color:#888;margin-top:4px">举报理由：' + d.reports.map(function (x) {{
                return esc(x.reason || '（无理由）');
              }}).join(' / ') + '</div>' : '';
        var note = d.reject_note ? '<div style="color:#888;margin-top:4px">驳回意见：' + esc(d.reject_note) + '</div>' : '';
        var head = '<div style="color:#888">#' + d.id + ' · ' + topic
            + (d.topic && d.topic.source === 'custom' ? '（自定义）' : '')
            + ' · ' + esc(d.author_name || '')
            + (d.prefix || d.nickname ? '（实名 ' + esc(d.prefix || '-') + ' / 昵称 ' + esc(d.nickname || '-') + '）' : '')
            + ' · ' + new Date((d.approved_at || d.ts) * 1000).toLocaleString()
            + ' · 举报 ' + d.report_count + '</div>';
        var body = '<div style="margin:6px 0;white-space:pre-wrap">' + esc(d.content) + '</div>';
        var btns = '';
        if (opts.mode === 'pending') {{
            btns = '<div class="mail-actions" data-rid="' + d.id + '">'
                + '<button class="btn-primary rv-ok" type="button">通过</button>'
                + '<button class="btn-primary rv-no" type="button" style="background:#6b7280">驳回</button>'
                + '<input type="text" class="rv-note" placeholder="驳回意见（可选）" style="flex:1" /></div>';
        }} else if (opts.mode === 'report') {{
            btns = '<div class="mail-actions" data-rid="' + d.id + '">'
                + '<button class="btn-primary rv-remove" type="button">下架</button>'
                + '<button class="btn-primary rv-ignore" type="button" style="background:#6b7280">忽略举报</button>'
                + '<button class="btn-primary rv-forever" type="button" style="background:#6b7280">彻底删除</button></div>';
        }} else if (opts.mode === 'published') {{
            var st = d.status === 'approved' ? '已发布' : d.status;
            btns = '<div class="mail-actions" data-rid="' + d.id + '"><span style="color:#888;align-self:center">' + st + '</span>'
                + (d.status === 'approved'
                    ? '<button class="btn-primary rv-remove" type="button">下架</button>'
                    : '<button class="btn-primary rv-restore" type="button">恢复</button>'
                      + '<button class="btn-primary rv-forever" type="button" style="background:#6b7280">彻底删除</button>')
                + '</div>';
        }}
        return rvCard(tag + head + body + dup + reports + note + btns);
    }}
    function rvBindActions(box, mode, reload) {{
        box.querySelectorAll('.mail-actions[data-rid]').forEach(function (row) {{
            var rid = Number(row.dataset.rid);
            function act(action, note) {{
                fetch('/vote/admin/reviews/moderate?token=' + encodeURIComponent(TOKEN), {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ id: rid, action: action, note: note || '' }})
                }}).then(readResp).then(function () {{ reload(); }}).catch(function () {{ alert('操作失败，请重试'); }});
            }}
            var ok = row.querySelector('.rv-ok');
            var no = row.querySelector('.rv-no');
            var noteInput = row.querySelector('.rv-note');
            if (ok) ok.addEventListener('click', function () {{ act('approve'); }});
            if (no) no.addEventListener('click', function () {{
                act('reject', noteInput ? noteInput.value : '');
            }});
            var rm = row.querySelector('.rv-remove');
            if (rm) rm.addEventListener('click', function () {{ if (confirm('下架这条评价？（软删，可恢复）')) act('remove'); }});
            var rs = row.querySelector('.rv-restore');
            if (rs) rs.addEventListener('click', function () {{ act('restore'); }});
            var fg = row.querySelector('.rv-forever');
            if (fg) fg.addEventListener('click', function () {{
                if (confirm('彻底删除？不可恢复！')) act('delete_forever');
            }});
            var ig = row.querySelector('.rv-ignore');
            if (ig) ig.addEventListener('click', function () {{
                fetch('/vote/admin/reviews/reports/seen?id=' + rid + '&token=' + encodeURIComponent(TOKEN), {{ method: 'POST' }})
                    .then(readResp).then(function () {{ reload(); }}).catch(function () {{}});
            }});
        }});
    }}
    function rvLoadAll() {{
        // 待审队列
        var pendBox = document.getElementById('rv-pending-list');
        pendBox.innerHTML = '<div class="empty">加载中…</div>';
        fetch('/vote/admin/reviews/pending?token=' + encodeURIComponent(TOKEN)).then(function (r) {{ return r.json(); }}).then(function (d) {{
            document.getElementById('rv-pending-count').textContent = '共 ' + (d.items || []).length + ' 条待审';
            pendBox.innerHTML = (d.items || []).length
                ? d.items.map(function (x) {{ return rvItem(x, {{ mode: 'pending' }}); }}).join('')
                : '<div class="empty">暂无待审评价</div>';
            rvBindActions(pendBox, 'pending', rvLoadAll);
        }}).catch(function () {{ pendBox.innerHTML = '<div class="empty">加载失败</div>'; }});
        // 举报队列
        var repBox = document.getElementById('rv-report-list');
        fetch('/vote/admin/reviews/reports?token=' + encodeURIComponent(TOKEN)).then(function (r) {{ return r.json(); }}).then(function (d) {{
            document.getElementById('rv-report-count').textContent = '共 ' + (d.items || []).length + ' 条待处理';
            repBox.innerHTML = (d.items || []).length
                ? d.items.map(function (x) {{ return rvItem(x, {{ mode: 'report' }}); }}).join('')
                : '<div class="empty">暂无待处理举报</div>';
            rvBindActions(repBox, 'report', rvLoadAll);
        }}).catch(function () {{ repBox.innerHTML = '<div class="empty">加载失败</div>'; }});
        // 配置
        fetch('/vote/admin/reviews/config?token=' + encodeURIComponent(TOKEN)).then(function (r) {{ return r.json(); }}).then(function (d) {{
            var c = d.config || {{}};
            document.getElementById('rv-cfg-report-push').value = c.rv_report_push_n;
            document.getElementById('rv-cfg-report-del').value = c.rv_report_del_n;
            document.getElementById('rv-cfg-remind-count').value = c.rv_remind_count_n;
            document.getElementById('rv-cfg-remind-stale').value = c.rv_remind_stale_h;
            document.getElementById('rv-cfg-daily-limit').value = c.rv_daily_limit;
            document.getElementById('rv-cfg-gravity').value = c.rv_hot_gravity;
        }}).catch(function () {{}});
        rvLoadPublished();
        rvLoadDups();
        rvLoadMsgs();
    }}
    function rvLoadMsgs() {{
        var box = document.getElementById('rv-msg-list');
        fetch('/vote/admin/reviews/messages?token=' + encodeURIComponent(TOKEN)).then(function (r) {{ return r.json(); }}).then(function (d) {{
            var items = d.items || [];
            document.getElementById('rv-msg-count').textContent = '已发 ' + items.length + ' 条';
            box.innerHTML = items.length
                ? items.map(function (x) {{
                    return rvCard('<div style="color:#888">#' + x.id + ' · '
                        + (x.to_all ? '全体公告' : '私信 ' + esc(x.target_email))
                        + ' · ' + new Date(x.ts * 1000).toLocaleString() + '</div>'
                        + '<div style="font-weight:600;margin:4px 0">' + esc(x.title) + '</div>'
                        + (x.content ? '<div style="white-space:pre-wrap">' + esc(x.content) + '</div>' : ''));
                  }}).join('')
                : '<div class="empty">还没有发送过消息</div>';
        }}).catch(function () {{ box.innerHTML = '<div class="empty">加载失败</div>'; }});
    }}
    var rvMsgSend = document.getElementById('rv-msg-send');
    if (rvMsgSend) rvMsgSend.addEventListener('click', function () {{
        var title = document.getElementById('rv-msg-title').value.trim();
        if (!title) {{ document.getElementById('rv-msg-status').textContent = '标题不能为空'; return; }}
        fetch('/vote/admin/reviews/messages?token=' + encodeURIComponent(TOKEN), {{
            method: 'POST',
            headers: {{ 'Content-Type': 'application/json' }},
            body: JSON.stringify({{
                target_email: document.getElementById('rv-msg-email').value.trim(),
                title: title,
                content: document.getElementById('rv-msg-content').value.trim()
            }})
        }}).then(function (r) {{ return r.json().then(function (d) {{ return {{ ok: r.ok, d: d }}; }}); }}).then(function (res) {{
            var st = document.getElementById('rv-msg-status');
            if (res.ok) {{
                st.textContent = res.d.to_all ? '已发给全体' : '已发给 ' + res.d.target_email;
                document.getElementById('rv-msg-title').value = '';
                document.getElementById('rv-msg-content').value = '';
                document.getElementById('rv-msg-email').value = '';
                rvLoadMsgs();
            }} else {{
                st.textContent = (res.d && res.d.detail) || '发送失败';
            }}
        }}).catch(function () {{ document.getElementById('rv-msg-status').textContent = '网络错误'; }});
    }});
    function rvLoadPublished() {{
        var box = document.getElementById('rv-pub-list');
        var q = document.getElementById('rv-pub-query').value || '';
        fetch('/vote/admin/reviews/published?query=' + encodeURIComponent(q) + '&token=' + encodeURIComponent(TOKEN))
            .then(function (r) {{ return r.json(); }}).then(function (d) {{
            rvPubItems = d.items || [];
            rvPubPage = 1;
            rvRenderPublished();
        }}).catch(function () {{ box.innerHTML = '<div class="empty">加载失败</div>'; }});
    }}
    var rvPubItems = [];
    var rvPubPage = 1;
    var RV_PUB_PAGE_SIZE = 20;
    function rvRenderPublished() {{
        var box = document.getElementById('rv-pub-list');
        var total = rvPubItems.length;
        var pages = Math.max(1, Math.ceil(total / RV_PUB_PAGE_SIZE));
        if (rvPubPage > pages) rvPubPage = pages;
        document.getElementById('rv-pub-count').textContent = '共 ' + total + ' 条';
        document.getElementById('rv-pub-page').textContent = '第 ' + rvPubPage + ' / ' + pages + ' 页';
        document.getElementById('rv-pub-prev').disabled = rvPubPage <= 1;
        document.getElementById('rv-pub-next').disabled = rvPubPage >= pages;
        var slice = rvPubItems.slice((rvPubPage - 1) * RV_PUB_PAGE_SIZE, rvPubPage * RV_PUB_PAGE_SIZE);
        box.innerHTML = slice.length
            ? slice.map(function (x) {{ return rvItem(x, {{ mode: 'published' }}); }}).join('')
            : '<div class="empty">无匹配评价</div>';
        rvBindActions(box, 'published', rvLoadPublished);
    }}
    // 重复条目组（一键合并）
    function rvLoadDups() {{
        var box = document.getElementById('rv-dups-list');
        fetch('/vote/admin/reviews/topic/dups?token=' + encodeURIComponent(TOKEN)).then(function (r) {{ return r.json(); }}).then(function (d) {{
            var groups = d.groups || [];
            if (!groups.length) {{
                box.innerHTML = '<div class="empty">当前没有检测到重复条目</div>';
                return;
            }}
            box.innerHTML = groups.map(function (g) {{
                var keep = g.items.reduce(function (best, x) {{
                    if (!best) return x;
                    if (best.source !== 'official' && x.source === 'official') return x;
                    if (x.review_count > best.review_count) return x;
                    return best;
                }}, null);
                var others = g.items.filter(function (x) {{ return keep && x.id !== keep.id; }});
                return rvCard('<div style="margin-bottom:4px">' + g.items.map(function (x) {{
                        return '#' + x.id + ' ' + esc(x.name) + (x.source === 'official' ? '（官方）' : '') + ' · ' + x.review_count + ' 条评价'
                            + (keep && x.id === keep.id ? ' <b style="color:#059669">← 保留</b>' : '');
                    }}).join('<br>') + '</div>'
                    + (keep && others.length
                        ? '<button class="btn-primary rv-dup-merge" data-from="' + others.map(function (x) {{ return x.id; }}).join(',') + '" data-to="' + keep.id + '" type="button">合并这 ' + (others.length + 1) + ' 个条目</button>'
                        : '<span style="color:#888">组内无可合并项</span>'));
            }}).join('');
            box.querySelectorAll('.rv-dup-merge').forEach(function (btn) {{
                btn.addEventListener('click', function () {{
                    var froms = btn.dataset.from.split(',');
                    var to = btn.dataset.to;
                    if (!confirm('确认把组内其余条目的评价全部合并到保留条目？')) return;
                    var chain = Promise.resolve();
                    froms.forEach(function (fid) {{
                        chain = chain.then(function () {{
                            return fetch('/vote/admin/reviews/topic/merge?from_id=' + fid + '&to_id=' + to + '&token=' + encodeURIComponent(TOKEN), {{ method: 'POST' }});
                        }});
                    }});
                    chain.then(function () {{ rvLoadDups(); }}).catch(function () {{ alert('合并失败，请重试'); }});
                }});
            }});
        }}).catch(function () {{ box.innerHTML = '<div class="empty">加载失败</div>'; }});
    }}
    var rvCfgSave = document.getElementById('rv-cfg-save');
    if (rvCfgSave) rvCfgSave.addEventListener('click', function () {{
        var cfg = {{
            rv_report_push_n: Number(document.getElementById('rv-cfg-report-push').value),
            rv_report_del_n: Number(document.getElementById('rv-cfg-report-del').value),
            rv_remind_count_n: Number(document.getElementById('rv-cfg-remind-count').value),
            rv_remind_stale_h: Number(document.getElementById('rv-cfg-remind-stale').value),
            rv_daily_limit: Number(document.getElementById('rv-cfg-daily-limit').value),
            rv_hot_gravity: Number(document.getElementById('rv-cfg-gravity').value)
        }};
        fetch('/vote/admin/reviews/config?token=' + encodeURIComponent(TOKEN), {{
            method: 'POST',
            headers: {{ 'Content-Type': 'application/json' }},
            body: JSON.stringify({{ config: cfg }})
        }}).then(readResp).then(function (res) {{
            document.getElementById('rv-cfg-status').textContent = res.ok ? '已保存' : '保存失败';
        }}).catch(function () {{ document.getElementById('rv-cfg-status').textContent = '网络错误'; }});
    }});
    var rvPubSearch = document.getElementById('rv-pub-search');
    if (rvPubSearch) rvPubSearch.addEventListener('click', rvLoadPublished);
    var rvPubPrev = document.getElementById('rv-pub-prev');
    if (rvPubPrev) rvPubPrev.addEventListener('click', function () {{ rvPubPage -= 1; rvRenderPublished(); }});
    var rvPubNext = document.getElementById('rv-pub-next');
    if (rvPubNext) rvPubNext.addEventListener('click', function () {{ rvPubPage += 1; rvRenderPublished(); }});
    var rvMergeBtn = document.getElementById('rv-merge-btn');
    if (rvMergeBtn) rvMergeBtn.addEventListener('click', function () {{
        var from = document.getElementById('rv-merge-from').value;
        var to = document.getElementById('rv-merge-to').value;
        if (!from || !to) return;
        fetch('/vote/admin/reviews/topic/merge?from_id=' + from + '&to_id=' + to + '&token=' + encodeURIComponent(TOKEN), {{ method: 'POST' }})
            .then(readResp).then(function (res) {{
            document.getElementById('rv-merge-status').textContent = res.ok ? '已合并' : '合并失败：' + ((res.d && res.d.detail) || '');
            if (res.ok) rvLoadAll();
        }}).catch(function () {{ document.getElementById('rv-merge-status').textContent = '网络错误'; }});
    }});
}})();
</script>
</body>
</html>"""
    return page


@app.get("/vote/admin/resume")
def admin_resume(request: Request, token: str | None = Query(default=None)):
    """管理员核对数据后手动解除熔断"""
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="cross-site request blocked")
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    conn = _connect()
    try:
        _set_meta(conn, "circuit_open", "0")
        # 记录恢复时刻：异常检测此后从该时刻重新计起，避免被同一批历史数据立刻再次熔断
        _set_meta(conn, "circuit_resume_ts", str(int(time.time())))
    finally:
        conn.close()
    return RedirectResponse(url=f"/vote/admin?token={token}" if token else "/vote/admin")


@app.post("/vote/admin/messages")
def admin_create_message(payload: MessageIn, token: str | None = Query(default=None)):
    """管理端发布站内消息（公网站点导航栏邮件图标展示）"""
    if not _check_admin_token(token):
        raise HTTPException(status_code=401, detail="unauthorized")
    if payload.category not in ALLOWED_CATEGORIES:
        return JSONResponse({"detail": "unknown category"}, status_code=400)
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO messages (category, title, body, pinned, ts) VALUES (?, ?, ?, ?, ?);",
            (payload.category, payload.title, payload.body, 1 if payload.pinned else 0, int(time.time())),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/vote/admin/messages/delete")
def admin_delete_message(request: Request, id: int = Query(default=0), token: str | None = Query(default=None)):
    """管理端删除站内消息（token 与密码会话均可）"""
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="cross-site request blocked")
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    if id > 0:
        conn = _connect()
        try:
            conn.execute("DELETE FROM messages WHERE id = ?;", (id,))
            conn.commit()
        finally:
            conn.close()
    return RedirectResponse(url=f"/vote/admin?token={token}#mail" if token else "/vote/admin#mail")


@app.get("/vote/admin/export")
def admin_export(request: Request, token: str | None = Query(default=None)):
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    conn = _connect()
    try:
        cur = conn.execute(
            "SELECT topic, score, voter_id, ip_hash, ua, ts FROM votes ORDER BY ts DESC;"
        )
        rows = cur.fetchall()
    finally:
        conn.close()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["topic", "score", "voter_id", "ip_hash", "ua", "ts"])
    writer.writerows(rows)
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ofcourses-votes.csv"},
    )


@app.get("/vote/admin/day")
def admin_day(request: Request, day: str = Query(default=""), token: str | None = Query(default=None)):
    """某一天的数据详情：UV / PV / 设备 / 热门页面 / 逐小时分布（token 与密码会话均可）"""
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        start = time.mktime(time.strptime(day, "%Y-%m-%d"))
    except ValueError:
        return JSONResponse({"detail": "bad day format"}, status_code=400)
    end = start + 86400
    conn = _connect()
    try:
        uv = conn.execute(
            "SELECT COUNT(DISTINCT vid) FROM visits WHERE ts >= ? AND ts < ?;", (start, end)
        ).fetchone()[0]
        pv = conn.execute(
            "SELECT COUNT(*) FROM visits WHERE ts >= ? AND ts < ?;", (start, end)
        ).fetchone()[0]
        dev = conn.execute(
            "SELECT mobile, COUNT(DISTINCT vid) FROM visits WHERE ts >= ? AND ts < ? GROUP BY mobile;",
            (start, end),
        ).fetchall()
        pages = conn.execute(
            "SELECT path, COUNT(*) c FROM visits WHERE ts >= ? AND ts < ? "
            "GROUP BY path ORDER BY c DESC LIMIT 5;",
            (start, end),
        ).fetchall()
        hourly = conn.execute(
            "SELECT CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER) h, COUNT(*) "
            "FROM visits WHERE ts >= ? AND ts < ? GROUP BY h;",
            (start, end),
        ).fetchall()
    finally:
        conn.close()
    dev_map = {r[0]: r[1] for r in dev}
    hours = [0] * 24
    for h, c in hourly:
        hours[h] = c
    return {
        "day": day,
        "uv": uv,
        "pv": pv,
        "mobile_uv": dev_map.get(1, 0),
        "pc_uv": dev_map.get(0, 0),
        "top_pages": pages,
        "hourly": hours,
    }


# ==================== AI 推荐助手 ====================
# 设计：浏览器 -> /vote/ai/chat -> Paratera（OpenAI 兼容 SSE），逐段转发给前端。
# 隐私：服务器只记录 每次调用的 token 消耗（visitor 哈希/IP 哈希/tokens），不保存任何对话内容。
# 限额（都可在管理后台调整，存 meta 表）：
#   ai_quota_visitor   每访客每日提问次数（主限额，默认 20）
#   ai_quota_ip        每 IP 每日提问次数（校园网 NAT 兜底，默认 100）
#   ai_token_daily_cap 全局每日 token 熔断（默认 60 万，触顶 429 + Server酱推送，次日自动恢复）

_KB_DOCS: dict[str, str] = {}

# 需求类别 → 注入的知识文档（build_knowledge.py 生成）
_CATEGORY_DOCS: dict[str, list[str]] = {
    "plan": ["core", "plan", "curriculum"],       # 选课推荐/多学期规划/退课/负荷/学位进度
    "curriculum": ["core", "curriculum"],         # 培养方案事实查询
    "site": ["core", "site"],                     # 站点功能/页面/操作
    "invalid": ["core"],                          # 无效问题
    "all": ["core", "plan", "curriculum", "site"],  # 兼容回退：全量
}


def _load_kb_docs() -> dict[str, str]:
    """加载知识文档（build_knowledge.py 生成），启动后缓存；
    主要文件缺失时回退到旧版单文件 knowledge_base.txt。"""
    if not _KB_DOCS:
        try:
            for name, fname in (
                ("core", "kb_core.txt"),
                ("strong", "kb_strong.txt"),
                ("plan", "kb_plan.txt"),
                ("curriculum", "kb_curriculum.txt"),
                ("site", "kb_site.txt"),
            ):
                with open(os.path.join(os.path.dirname(AI_KB_PATH), fname), encoding="utf-8") as f:
                    _KB_DOCS[name] = f.read()
        except OSError:
            try:
                with open(AI_KB_PATH, encoding="utf-8") as f:
                    _KB_DOCS["legacy"] = f.read()
            except OSError:
                _KB_DOCS["legacy"] = (
                    "你是 OfCourses 选课助手。知识库文件缺失，只回答通用性的选课建议，"
                    "不确定的数据请引导用户查阅网站对应页面，绝不编造。"
                )
    return _KB_DOCS


def _ai_system_prompt(category: str = "all", tier: str = "flash") -> str:
    """组装系统提示。
    弱档：core 恒注入 + 类别对应文档（未知类别回退全量）；
    强档：独立 skill（kb_strong.txt，不注入弱模型面向两段式分类的规则架构）+ 全量知识文档；
    strong 文档缺失时回退 core（部署漏传文件的降级路径）。"""
    docs = _load_kb_docs()
    if "legacy" in docs:
        return docs["legacy"]
    if tier == "strong":
        strong_core = docs.get("strong") or docs.get("core", "")
        parts = [strong_core] + [docs[n] for n in ("plan", "curriculum", "site") if n in docs]
        return "\n\n".join(parts)
    names = _CATEGORY_DOCS.get(category) or _CATEGORY_DOCS["all"]
    parts = [docs[n] for n in names if n in docs]
    return "\n\n".join(parts) if parts else docs.get("core", "")


# —— 工具调用：课程搜索（确定性检索，解决模型凭记忆列举课程漏课的问题）——
# kb_courses.json 由 build_knowledge.py 从 structured_data.json 生成，与知识库文档一同部署。
_TOOL_ATTR_ZH = {"required": "必修", "restricted": "限选", "elective": "任选", "prof_required": "专业必修"}

_TOOL_SEARCH_SPEC = {
    "type": "function",
    "function": {
        "name": "search_courses",
        "description": (
            "在 OfCourses 完整课程目录中按条件搜索课程（数据与培养方案完全同步，结果完整可靠）。"
            "凡是需要列举、查找、确认课程是否存在时，必须调用本工具，严禁凭记忆枚举课程清单。"
            "多个条件为「且」关系；所有条件都可省略。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "课程名称关键词（子串匹配，如：计算机、流体）"},
                "attr": {
                    "type": "string",
                    "enum": ["required", "restricted", "elective", "prof_required"],
                    "description": "修读属性：required 必修 / restricted 限选 / elective 任选 / prof_required 专业必修",
                },
                "semester": {
                    "type": "string",
                    "enum": ["大一·秋季", "大一·春季", "大一·夏季", "大二·秋季", "大二·春季", "大二·夏季",
                             "大三·秋季", "大三·春季", "大三·夏季", "大四·秋季", "大四·春季"],
                    "description": "按推荐开课学期筛选",
                },
            },
        },
    },
}

_courses_index_cache: list | None = None


def _load_courses_index() -> list:
    """加载课程搜索索引（kb_courses.json，build_knowledge.py 生成）；缺失时返回空表（工具优雅降级）。"""
    global _courses_index_cache
    if _courses_index_cache is None:
        try:
            path = os.path.join(os.path.dirname(AI_KB_PATH), "kb_courses.json")
            with open(path, encoding="utf-8") as f:
                _courses_index_cache = json.load(f)
        except (OSError, ValueError):
            _courses_index_cache = []
    return _courses_index_cache


def _tool_search_courses(args: dict) -> dict:
    """search_courses 工具执行体：keyword/attr/semester 与关系过滤，返回紧凑结果行。"""
    courses = _load_courses_index()
    kw = str(args.get("keyword") or "").strip().lower()
    attr = str(args.get("attr") or "").strip()
    semester = str(args.get("semester") or "").strip()
    hits = []
    for c in courses:
        if kw and kw not in str(c.get("name", "")).lower() and kw not in str(c.get("course_id", "")):
            continue
        if attr and c.get("attr") != attr:
            continue
        if semester and semester not in (c.get("semesters") or []):
            continue
        hits.append(c)
    total = len(hits)
    shown = hits[:40]
    lines = []
    for c in shown:
        attr_zh = _TOOL_ATTR_ZH.get(c.get("attr") or "", "")
        line = f"{c.get('name', '')}（{c.get('course_id', '')}，{c.get('credits', '?')}学分，{attr_zh or '属性未知'}"
        if c.get("attr") == "prof_required" and c.get("prof_note"):
            line += f"·{c['prof_note']}"
        sems = c.get("semesters") or []
        if sems:
            line += f"，开课：{'/'.join(sems)}"
        if c.get("groups"):
            line += f"，课组：{'/'.join(c['groups'])}"
        line += "）"
        lines.append(line)
    result = {"total": total, "shown": len(lines), "courses": lines}
    if total > len(lines):
        result["note"] = f"共 {total} 门，仅显示前 {len(lines)} 门，请让用户缩小条件"
    if not lines:
        result["note"] = "没有匹配的课程，请检查关键词/属性/学期后重试"
    return result


def _day_start(ts: float) -> int:
    lt = time.localtime(ts)
    return int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))


def _seconds_until_midnight() -> float:
    """本地时区到今日零点的剩余秒数（AI 每日限额的滑动窗口长度）"""
    lt = time.localtime()
    midnight = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)) + 86400
    return max(60.0, midnight - time.time())


def _ai_quota(conn: sqlite3.Connection, key: str, default: int) -> int:
    try:
        return int(_get_meta(conn, key, str(default)))
    except (TypeError, ValueError):
        return default


# —— 档位模型配置（2026-11-15：管理页可视化配置，存 meta，优先于环境变量；key 只入库、接口永不回显）——
def _ai_model_cfg(conn: sqlite3.Connection, tier: str) -> dict:
    """档位模型配置：{display, model, base_url, key}；未配置/损坏返回空 dict"""
    raw = _get_meta(conn, f"ai_model_{tier}", "")
    if raw:
        try:
            o = json.loads(raw)
            if isinstance(o, dict):
                return {k: str(o.get(k) or "").strip() for k in ("display", "model", "base_url", "key")}
        except Exception:
            pass
    return {}


def _ai_upstream_cfg(conn: sqlite3.Connection, tier: str) -> tuple[str, str, str] | None:
    """档位上游三元组 (model, base_url, api_key)：meta 配置优先、环境变量兜底；三元不全返回 None（对应档位不可用）"""
    cfg = _ai_model_cfg(conn, tier)
    if tier == "strong":
        model = cfg.get("model") or AI_MODEL_STRONG
        base = (cfg.get("base_url").rstrip("/") if cfg.get("base_url") else "") or AI_STRONG_BASE_URL
        key = cfg.get("key") or AI_STRONG_KEY
    else:
        model = cfg.get("model") or AI_MODEL_FLASH
        base = (cfg.get("base_url").rstrip("/") if cfg.get("base_url") else "") or AI_BASE_URL.rstrip("/")
        key = cfg.get("key") or AI_API_KEY
    if not (model and base and key):
        return None
    return model, base, key


def _ai_display(conn: sqlite3.Connection, tier: str) -> str:
    """档位显示名称（全站统一使用；管理页可改，默认「标准模型/强模型」）"""
    cfg = _ai_model_cfg(conn, tier)
    return cfg.get("display") or ("标准模型" if tier == "flash" else "强模型")


def _ai_guest_ratio(conn: sqlite3.Connection) -> float:
    """未登录用户低级档限额 = 登录限额 × 该倍数（管理页可改，默认 0.3，结果至少 1 次）"""
    raw = _get_meta(conn, "ai_quota_guest_ratio", "").strip()
    try:
        r = float(raw) if raw else 0.3
    except ValueError:
        r = 0.3
    return min(1.0, max(0.0, r))


def _ai_identity(request: Request, visitor_id: str) -> tuple[str, str | None]:
    """AI 用量身份：登录用户按账号（跨设备共享、比匿名 cookie 更难重置），游客按匿名 visitor。
    返回 (identity_hash, 登录邮箱或 None)。哈希前缀区分来源，切换身份口径后旧计数自然失效（代次按日重置）。"""
    acc = None
    try:
        from accounts import _current_user as _acc_current_user
        acc = _acc_current_user(request)
    except Exception:
        acc = None
    if acc and acc.get("email"):
        h = hashlib.sha256((IP_SALT + "acc|" + acc["email"]).encode("utf-8")).hexdigest()[:16]
        return h, str(acc["email"])
    h = hashlib.sha256((IP_SALT + "vid|" + (visitor_id or "")).encode("utf-8")).hexdigest()[:16]
    return h, None


def _ai_flash_upstream() -> tuple[str, str, str] | None:
    """低级档上游三元组（classify 等非 conn 上下文用；每次现查，配置改动即时生效）"""
    conn = _connect()
    try:
        return _ai_upstream_cfg(conn, "flash")
    finally:
        conn.close()


def _ai_cur_gen(conn: sqlite3.Connection, tier: str = "flash") -> int:
    """当前用量代次（按档位独立）：token 重置时对应档位 +1，「今日」统计只算当前代次
    （记录永不删除，累计不受重置影响）。flash 存 meta ai_usage_gen，strong 存 ai_strong_gen。"""
    key = "ai_strong_gen" if tier == "strong" else "ai_usage_gen"
    try:
        return max(1, int(_get_meta(conn, key, "1") or 1))
    except (TypeError, ValueError):
        return 1


def _ai_master_enabled(conn: sqlite3.Connection) -> bool:
    return _get_meta(conn, "ai_master_enabled", "1") == "1"


def _ai_tier_enabled(conn: sqlite3.Connection, tier: str) -> bool:
    """用户端 AI 开关（管理页可停用）：总开关 + 分档开关 + 环境前提。"""
    if not _ai_master_enabled(conn):
        return False
    if tier == "flash":
        return _get_meta(conn, "ai_flash_enabled", "1") == "1" and bool(AI_API_KEY)
    return _get_meta(conn, "ai_strong_enabled", "1") == "1" and bool(AI_MODEL_STRONG)


def _ai_strong_price(conn: sqlite3.Connection) -> float:
    try:
        v = float(_get_meta(conn, "ai_strong_price_yuan", str(AI_STRONG_PRICE_DEF)))
        return v if v >= 0 else AI_STRONG_PRICE_DEF
    except (TypeError, ValueError):
        return AI_STRONG_PRICE_DEF


def _ai_notify_cap_once(day_key: str) -> None:
    """全局 token 触顶当天只推一次 Server酱"""
    conn = _connect()
    try:
        flag = f"ai_cap_notified_{day_key}"
        if _get_meta(conn, flag) == "1":
            return
        _set_meta(conn, flag, "1")
    finally:
        conn.close()
    _notify(
        "OfCourses AI 额度告警",
        "今日 AI token 总量已触上限，AI 助手暂时停止服务，次日自动恢复。\n"
        "可在管理后台「AI 助手」页签调整限额。",
    )


def _ai_notify_strong_cap_once(day_key: str) -> None:
    """强模型全局 token 触顶当天只推一次 Server酱（与低级档告警分开）"""
    conn = _connect()
    try:
        flag = f"ai_strong_cap_notified_{day_key}"
        if _get_meta(conn, flag) == "1":
            return
        _set_meta(conn, flag, "1")
    finally:
        conn.close()
    _notify(
        "OfCourses 强模型额度告警",
        "今日强模型（高级档）token 总量已触上限，高级档暂时停止服务，次日自动恢复。\n"
        "可在管理后台「AI 助手」页签调整强模型限额。",
    )


def _open_upstream(body: dict, base_url: str = "", api_key: str = ""):
    """单次建立与上游的 SSE 连接（429 重试循环由调用方处理，HTTPError 原样抛出）。
    base_url/api_key 缺省时使用低级档全局配置（Paratera）；高级档传 AI_STRONG_* 独立通道。"""
    req = urllib.request.Request(
        (base_url or AI_BASE_URL).rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key or AI_API_KEY}",
        },
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=120)


class AiChatIn(BaseModel):
    messages: list[dict[str, str]] = Field(default_factory=list)
    visitor_id: str = Field(default="", max_length=64)
    lang: str = Field(default="zh", max_length=8)   # 回复语言，跟随站点中英文状态
    context: str = Field(default="", max_length=24000)  # 用户个人选课数据（前端工作台整理，不落库）；完整本科规划+强档候选可达 1.5 万字符，8000 会 422
    category: str = Field(default="all", max_length=16)  # 需求类别（第一段分类结果，决定注入哪些知识文档）
    tier: str = Field(default="flash", max_length=8)     # 模型档位：flash 低级档（默认）/ strong 高级档


_AI_LANG_DIRECTIVE = {
    "zh": "\n\n【回复语言】本次会话请一律使用简体中文回答。",
    "en": "\n\n[Reply Language] Respond in English throughout this conversation.",
}

# —— 第一段轻量分类（两段式架构）——
_ai_classify_hits: Dict[str, Deque[float]] = defaultdict(deque)  # 分类调用限频（IP，不占提问次数）

_AI_CLASSIFY_SYSTEM = """你是 OfCourses 选课助手的意图分类器。阅读用户问题，只输出一个 JSON 对象，格式：
{"category": "...", "direction": "...", "direction_source": "...", "semester": "..."}
字段说明：
- category（需求类别）取值：
  "plan" —— 选课推荐、多学期规划、退课/减负、学分负荷、学位进度与方向选择类问题；
  "curriculum" —— 培养方案事实查询：某门课的归属/学分/先修/开课学期、某课组或模块有哪些课、学位轨道要求等；
  "site" —— 网站功能、页面入口、操作方法、教程、开发者与联系信息；
  "invalid" —— 与选课、培养方案、本站功能无关的问题。
- direction（用户在问题中明确表达的方向倾向）取值："aero"（航空航天/力学相关）/ "soft"（软件/计算机相关）/ "ie"（工业工程/统计/物流相关）；问题未表达任何方向时为 "none"。注意：只依据问题原文判断，不要猜测。
- direction_source：direction 非 none 时为 "stated"，否则为 "none"。
- semester：问题中明确提到的目标学期，转换成标准名（如"大三下"→"大三·春季"、"大二下"→"大二·春季"）；未提到则为 ""。
严禁输出 JSON 以外的任何内容。"""


def _classify_parse(content: str) -> dict:
    """解析分类模型输出；无 JSON/解析失败/非法类别时 fallback=True。"""
    result = {"category": "all", "direction": "none", "direction_source": "none", "semester": "", "fallback": False}
    try:
        m = re.search(r"\{.*\}", content, re.S)
        if m:
            parsed = json.loads(m.group(0))
            cat = str(parsed.get("category", "")).strip().lower()
            if cat in _CATEGORY_DOCS:
                result["category"] = cat
            else:
                result["fallback"] = True  # 非法类别等同分类失败
            d = str(parsed.get("direction", "")).strip().lower()
            if d in ("aero", "soft", "ie", "none"):
                result["direction"] = d
            ds = str(parsed.get("direction_source", "")).strip().lower()
            if ds in ("stated", "none"):
                result["direction_source"] = ds
            sem = str(parsed.get("semester", "")).strip()
            if sem:
                result["semester"] = sem[:16]
        else:
            result["fallback"] = True  # 输出里没有可解析的 JSON
    except Exception:
        result["fallback"] = True
    return result


def _classify_upstream_stream(question: str):
    """与 Paratera 的分类调用（含 429 deadline 等待重试），以事件流形式产出全过程。
    事件：attempt_start{n} / attempt_done{n,status,elapsed_ms} / wait{...429等待...} / done{diag}
    done 事件的 diag：{content, prompt_toks, completion_toks, attempts: [{status, elapsed_ms}], error}
    error 非 None 表示调用失败（含 429 等待预算耗尽）。
    用户端 /vote/ai/classify（取最终结果）与管理端 SSE 终端（逐事件实时推送）共用此生成器。"""
    up = _ai_flash_upstream()  # 分类固定走低级档上游（meta 配置优先，环境变量兜底）
    body = {
        "model": up[0] if up else AI_MODEL_FLASH,
        "messages": [
            {"role": "system", "content": _AI_CLASSIFY_SYSTEM},
            {"role": "user", "content": question},
        ],
        "stream": False,
        "max_tokens": 300,
        "temperature": 0.2,
    }
    diag: dict = {"content": "", "prompt_toks": 0, "completion_toks": 0, "attempts": [], "error": None}
    deadline = time.monotonic() + AI_CLASSIFY_WAIT_TOTAL
    attempt_n = 0
    while True:
        attempt_n += 1
        t0 = time.monotonic()
        yield {"type": "attempt_start", "n": attempt_n}
        if up is None:
            diag["error"] = "flash upstream not configured"
            yield {"type": "done", "diag": diag}
            return
        try:
            req = urllib.request.Request(
                up[1].rstrip("/") + "/chat/completions",
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {up[2]}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                obj = json.loads(resp.read().decode("utf-8", "replace"))
            usage = obj.get("usage") or {}
            diag["prompt_toks"] = int(usage.get("prompt_tokens") or 0)
            diag["completion_toks"] = int(usage.get("completion_tokens") or 0)
            diag["content"] = ((obj.get("choices") or [{}])[0].get("message") or {}).get("content", "") or ""
            if not diag["prompt_toks"] and not diag["completion_toks"]:
                diag["prompt_toks"] = (len(_AI_CLASSIFY_SYSTEM) + len(question)) // 2
                diag["completion_toks"] = len(diag["content"]) // 2
            elapsed = int((time.monotonic() - t0) * 1000)
            diag["attempts"].append({"status": 200, "elapsed_ms": elapsed})
            yield {"type": "attempt_done", "n": attempt_n, "status": 200, "elapsed_ms": elapsed}
            yield {"type": "done", "diag": diag}
            return
        except urllib.error.HTTPError as exc:
            elapsed = int((time.monotonic() - t0) * 1000)
            diag["attempts"].append({"status": exc.code, "elapsed_ms": elapsed})
            yield {"type": "attempt_done", "n": attempt_n, "status": exc.code, "elapsed_ms": elapsed}
            remaining = deadline - time.monotonic()
            if exc.code == 429 and remaining > 0:
                waited = AI_CLASSIFY_WAIT_TOTAL - remaining
                print(f"[ai] classify 上游 429，已等待{waited:.0f}s/{AI_CLASSIFY_WAIT_TOTAL}s，{AI_CLASSIFY_WAIT_INTERVAL}s 后重试", flush=True)
                interval = min(AI_CLASSIFY_WAIT_INTERVAL, remaining)
                yield {
                    "type": "wait",
                    "waited_s": round(waited, 1),
                    "budget_s": AI_CLASSIFY_WAIT_TOTAL,
                    "interval_s": interval,
                }
                time.sleep(interval)
                continue
            diag["error"] = f"HTTP {exc.code}: {exc.reason}"
            yield {"type": "done", "diag": diag}
            return
        except Exception as exc:
            elapsed = int((time.monotonic() - t0) * 1000)
            diag["attempts"].append({"status": "error", "elapsed_ms": elapsed})
            yield {"type": "attempt_done", "n": attempt_n, "status": "error", "elapsed_ms": elapsed}
            diag["error"] = str(exc)
            yield {"type": "done", "diag": diag}
            return


def _classify_upstream_call(question: str) -> dict:
    """消费事件流取最终结果（用户端非流式路径用）。"""
    diag: dict = {"content": "", "prompt_toks": 0, "completion_toks": 0, "attempts": [], "error": None}
    for ev in _classify_upstream_stream(question):
        if ev["type"] == "done":
            diag = ev["diag"]
    return diag


def _classify_usage_log(visitor: str, ip_hash: str, prompt_toks: int, completion_toks: int) -> None:
    """classify 用量记账（模型记为 flash，计入低级档全局每日 token 熔断）。"""
    try:
        c = _connect()
        c.execute(
            "INSERT INTO ai_usage (visitor_hash, ip_hash, prompt_tokens, completion_tokens, ts, model) "
            "VALUES (?, ?, ?, ?, ?, 'flash');",
            (visitor, ip_hash, prompt_toks, completion_toks, int(time.time())),
        )
        c.commit()
        c.close()
    except Exception:
        pass


class AiClassifyIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    visitor_id: str = Field(default="", max_length=64)
    lang: str = Field(default="zh", max_length=8)


@app.post("/vote/ai/classify")
def ai_classify(payload: AiClassifyIn, request: Request):
    """两段式第一段：轻量分类（需求类别 + 方向倾向 + 目标学期意图）。
    不占提问次数（有独立的宽松限频），token 计入每日总量熔断；任何失败都回退 category=all，前端照常请求。"""
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="cross-site request blocked")
    if not AI_API_KEY:
        raise HTTPException(status_code=503, detail="AI 功能暂未开启")

    ip = _client_ip(request)
    ip_hash = _ip_hash(ip)
    visitor = hashlib.sha256((IP_SALT + (payload.visitor_id or "")).encode("utf-8")).hexdigest()[:16]

    conn = _connect()
    try:
        # 标准模型档被管理端停用（或总开关关闭）时直接回退，前端照常按全量注入请求
        if not _ai_tier_enabled(conn, "flash"):
            return {"category": "all", "direction": "none", "direction_source": "none", "semester": "", "fallback": True}
        quota_ip = _ai_quota(conn, "ai_quota_ip", AI_QUOTA_IP_DEF)
        token_cap = _ai_quota(conn, "ai_token_daily_cap", AI_TOKEN_CAP_DEF)
        start = _day_start(time.time())
        cur_gen = _ai_cur_gen(conn)
        used_tokens = conn.execute(
            "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage WHERE ts >= ? AND gen = ?;",
            (start, cur_gen),
        ).fetchone()[0]
    finally:
        conn.close()
    if token_cap > 0 and used_tokens >= token_cap:
        raise HTTPException(status_code=429, detail="今日 AI 额度已用完，请明天再来")
    win = _seconds_until_midnight()
    if _hit(_ai_classify_hits, ip_hash, max(60, quota_ip * 3), win):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    fallback = {
        "category": "all",
        "direction": "none",
        "direction_source": "none",
        "semester": "",
        "fallback": True,
    }

    # 上游 429 deadline 式等待：前端先等 classify（默认预算 30s）再进入 chat 的流内等待；
    # 超过预算仍 429 则回退全量（前端有关键词方向兜底接住方向识别）。
    diag = _classify_upstream_call(payload.question[:2000])
    if diag["error"]:
        print(f"[ai] classify 失败，回退全量: {diag['error']}", flush=True)
        result = dict(fallback)
    else:
        result = _classify_parse(diag["content"])
    _classify_usage_log(visitor, ip_hash, diag["prompt_toks"], diag["completion_toks"])
    return result


class AiClassifyTestIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


@app.post("/vote/admin/ai/classify-test")
def ai_classify_test(payload: AiClassifyTestIn, request: Request, token: str | None = Query(default=None)):
    """管理端：意图分类测试。与用户端 /vote/ai/classify 走完全相同的调用链路与等待预算，
    额外返回每次尝试的状态/耗时、失败原因、上游原始输出与解析结果，便于排查方向/类别识别问题。"""
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    wait_budget = {"total": AI_CLASSIFY_WAIT_TOTAL, "interval": AI_CLASSIFY_WAIT_INTERVAL}
    if not AI_API_KEY:
        return {
            "ok": False,
            "error": "未配置 PARATERA_API_KEY（AI 功能未开启）",
            "attempts": [],
            "elapsed_ms": 0,
            "content_raw": "",
            "result": None,
            "wait_budget": wait_budget,
        }
    t0 = time.monotonic()
    diag = _classify_upstream_call(payload.question[:2000])
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    if diag["error"]:
        result = {"category": "all", "direction": "none", "direction_source": "none", "semester": "", "fallback": True}
    else:
        result = _classify_parse(diag["content"])
    # 与正式调用同样计入每日 token 熔断（visitor_hash 标记为 admin-test 便于区分）
    _classify_usage_log("admin-classify-test", "admin-classify-test", diag["prompt_toks"], diag["completion_toks"])
    return {
        "ok": diag["error"] is None,
        "elapsed_ms": elapsed_ms,
        "attempts": diag["attempts"],
        "error": diag["error"],
        "content_raw": diag["content"],
        "result": result,
        "wait_budget": wait_budget,
    }


@app.post("/vote/admin/ai/classify-test-stream")
def ai_classify_test_stream(payload: AiClassifyTestIn, request: Request, token: str | None = Query(default=None)):
    """管理端：意图分类测试（SSE 终端版）。与用户端同一调用链路，逐事件实时推送全过程：
    start（等待预算）→ attempt_start/attempt_done（每次上游尝试）→ wait（429 等待）→ result（汇总）。
    流式响应让 nginx 代理全程有字节流动，避免非流式长等待触发 504。"""
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")

    def gen():
        if not AI_API_KEY:
            yield 'data: {"type": "error", "message": "未配置 PARATERA_API_KEY（AI 功能未开启）"}\n\n'
            yield "data: [DONE]\n\n"
            return
        started = time.monotonic()
        yield (
            "data: "
            + json.dumps(
                {"type": "start", "budget_s": AI_CLASSIFY_WAIT_TOTAL, "interval_s": AI_CLASSIFY_WAIT_INTERVAL},
                ensure_ascii=False,
            )
            + "\n\n"
        )
        diag: dict = {}
        for ev in _classify_upstream_stream(payload.question[:2000]):
            if ev["type"] == "done":
                diag = ev["diag"]
            else:
                yield "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if diag.get("error"):
            result = {"category": "all", "direction": "none", "direction_source": "none", "semester": "", "fallback": True}
        else:
            result = _classify_parse(diag.get("content", ""))
        _classify_usage_log("admin-classify-test", "admin-classify-test", diag.get("prompt_toks", 0), diag.get("completion_toks", 0))
        final = {
            "type": "result",
            "ok": diag.get("error") is None,
            "elapsed_ms": elapsed_ms,
            "attempts": diag.get("attempts", []),
            "error": diag.get("error"),
            "content_raw": diag.get("content", ""),
            "result": result,
        }
        yield "data: " + json.dumps(final, ensure_ascii=False) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/vote/ai/chat")
def ai_chat(payload: AiChatIn, request: Request):
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="cross-site request blocked")

    # —— 清洗消息：只保留 user/assistant，截断超长，最后一条必须是 user ——
    msgs = []
    for m in payload.messages[-AI_MAX_MESSAGES:]:
        role = m.get("role")
        content = (m.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            msgs.append({"role": role, "content": content[:AI_MAX_INPUT_CHARS]})
    if not msgs or msgs[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="bad messages")

    # —— 个人选课数据：拼到最后一条用户消息（仅本次请求，不落库）——
    user_ctx = payload.context.strip()
    if user_ctx:
        last = msgs[-1]
        msgs[-1] = {
            "role": "user",
            "content": last["content"]
            + "\n\n【用户选课数据】\n"
            + user_ctx[:8000]
            + "\n【/用户选课数据】",
        }

    ip = _client_ip(request)
    ip_hash = _ip_hash(ip)
    # 用量身份：登录用户按账号（跨设备共享、不占游客 IP 池），游客按匿名 visitor
    identity, acc_email = _ai_identity(request, payload.visitor_id)

    # —— 档位解析 + 上游配置（管理页模型配置优先，环境变量兜底）——
    tier = payload.tier if payload.tier in ("flash", "strong") else "flash"

    # —— 配额检查（提前于扣减，未通过不消耗次数；两档完全分开记账）——
    conn = _connect()
    try:
        start = _day_start(time.time())
        upstream_cfg = _ai_upstream_cfg(conn, tier)
        if not upstream_cfg:
            raise HTTPException(
                status_code=503,
                detail=("强模型档暂未开启" if tier == "strong" else "AI 功能暂未开启"),
            )
        disp = _ai_display(conn, tier)
        # 管理端停用开关：总开关关闭或对应档位停用时拒绝服务
        if not _ai_tier_enabled(conn, tier):
            if not _ai_master_enabled(conn):
                raise HTTPException(status_code=503, detail="AI 助手当前已停用")
            raise HTTPException(
                status_code=503,
                detail=f"{disp}档当前已停用，请切换模型后重试",
            )
        cur_gen = _ai_cur_gen(conn, tier)
        quota_ip = _ai_quota(conn, "ai_quota_ip", AI_QUOTA_IP_DEF)
        if tier == "flash":
            # 低级档次数：登录用户按登录限额；未登录 = 登录限额 × 游客倍数（至少 1 次）
            quota_v = _ai_quota(conn, "ai_quota_visitor", AI_QUOTA_VISITOR_DEF)
            personal_quota = quota_v if acc_email else max(1, int(quota_v * _ai_guest_ratio(conn)))
            token_cap = _ai_quota(conn, "ai_token_daily_cap", AI_TOKEN_CAP_DEF)
            used_tokens = conn.execute(
                "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage "
                "WHERE ts >= ? AND model = 'flash' AND gen = ?;",
                (start, cur_gen),
            ).fetchone()[0]
        else:
            strong_cap = _ai_quota(conn, "ai_strong_token_daily_cap", AI_STRONG_TOKEN_CAP_DEF)
            strong_pct = _ai_quota(conn, "ai_strong_user_pct", AI_STRONG_USER_PCT_DEF)
            strong_cnt = _ai_quota(conn, "ai_strong_daily_count", AI_STRONG_COUNT_DEF)
            strong_min = _ai_quota(conn, "ai_strong_valid_min_tokens", AI_STRONG_VALID_MIN_TOK_DEF)
            strong_all = conn.execute(
                "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage "
                "WHERE ts >= ? AND model = 'strong' AND gen = ?;",
                (start, cur_gen),
            ).fetchone()[0]
            strong_user = conn.execute(
                "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage "
                "WHERE ts >= ? AND model = 'strong' AND visitor_hash = ? AND gen = ?;",
                (start, identity, cur_gen),
            ).fetchone()[0]
            strong_valid = conn.execute(
                "SELECT COUNT(*) FROM ai_usage WHERE ts >= ? AND model = 'strong' "
                "AND visitor_hash = ? AND completion_tokens >= ? AND gen = ?;",
                (start, identity, strong_min, cur_gen),
            ).fetchone()[0]
    finally:
        conn.close()
    if tier == "flash":
        if token_cap > 0 and used_tokens >= token_cap:
            _ai_notify_cap_once(time.strftime("%Y%m%d"))
            raise HTTPException(status_code=429, detail="今日 AI 额度已用完，请明天再来")
    else:
        user_cap = strong_cap * max(0, min(strong_pct, 100)) // 100
        if strong_cap > 0 and strong_all >= strong_cap:
            _ai_notify_strong_cap_once(time.strftime("%Y%m%d"))
            raise HTTPException(status_code=429, detail=f"今日{disp}额度已用完，请明天再来")
        if user_cap > 0 and strong_user >= user_cap:
            raise HTTPException(status_code=429, detail=f"今日{disp}个人额度已用完，请明天再来")
        if strong_cnt > 0 and strong_valid >= strong_cnt:
            raise HTTPException(status_code=429, detail=f"今日{disp}对话次数已达上限，请明天再来")
    win = _seconds_until_midnight()
    if tier == "flash":
        if _hit(_ai_visitor_hits, identity, personal_quota, win):
            raise HTTPException(status_code=429, detail="今日提问次数已达上限，请明天再来")
        if not acc_email and _hit(_ai_ip_hits, ip_hash, quota_ip, win):
            raise HTTPException(status_code=429, detail="当前网络今日提问次数已达上限，请明天再来")
    elif _hit(_ai_strong_hits, ip_hash, quota_ip, win):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    # —— 上游连接与流式转发 ——
    # 上游 429（平台瞬时限频）：在 SSE 流内每 AI_WAIT_INTERVAL 秒重试一次，
    # 总等待不超过 AI_WAIT_TOTAL 秒；期间持续下发 {"status":"wait"} 事件供前端展示等待动效，
    # 也保证中间有数据流动（nginx read timeout 不会掐断连接）。
    lang_directive = _AI_LANG_DIRECTIVE.get(payload.lang if payload.lang in _AI_LANG_DIRECTIVE else "zh", "")
    is_en = payload.lang == "en"
    # 高级档不经过 classify（预留，后续看情况再接）：为保证知识覆盖，固定注入全量文档；
    # 低级档沿用两段式注入（category 由 classify 决定）；强档走独立 skill。
    category = "all" if tier == "strong" else payload.category
    system_text = _ai_system_prompt(category, tier)
    # 搜索工具：规划/培养方案类问题挂载（site/invalid 无需查课）
    use_tools = category in ("plan", "curriculum", "all")
    model_name, up_base, up_key = upstream_cfg
    body = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_text + f"\n\n【当前驱动模型】{model_name}" + lang_directive}
        ] + msgs,
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_tokens": AI_MAX_OUTPUT_TOKENS,
        "temperature": 0.6,
    }
    if use_tools:
        body["tools"] = [_TOOL_SEARCH_SPEC]
        body["tool_choice"] = "auto"

    def _record_usage(visitor: str, ip_hash: str, prompt_toks: int, completion_toks: int) -> None:
        # visitor 形参实际传入 identity（登录=acc 哈希 / 游客=vid 哈希），保持列名不变
        try:
            c = _connect()
            c.execute(
                "INSERT INTO ai_usage (visitor_hash, ip_hash, prompt_tokens, completion_tokens, ts, model, gen) "
                "VALUES (?, ?, ?, ?, ?, ?, ?);",
                (visitor, ip_hash, prompt_toks, completion_toks, int(time.time()), tier, cur_gen),
            )
            c.commit()
            c.close()
        except Exception:
            pass  # 统计失败不影响回复

    def gen():
        prompt_toks = 0
        completion_toks = 0
        reply_chars = 0
        think_chars = 0
        # —— 内联 <think> 思考适配（GLM-Z1 等模型把思考包在 content 里而非 reasoning_content 字段）——
        # 流式增量中可能被切断标签（如 "<thi" + "nk>"），用 pending 缓存尾部长度内的潜在半截标签
        inline_think = False   # True = 当前处于 <think>...</think> 内部
        think_pending = ""     # 尚未判定的缓冲（最多保留一个标签长度）
        THINK_OPEN, THINK_CLOSE = "<think>", "</think>"

        def _split_inline_think(chunk: str):
            """把一段 content 拆成 (正文部分, 思考部分)，按 inline_think 状态机处理。
            缓冲比标签还短时整段留在 pending（可能还是半截标签），待下一增量继续判定。"""
            nonlocal inline_think, think_pending
            buf = think_pending + chunk
            out_text, out_think = [], []
            open_len, close_len = len(THINK_OPEN), len(THINK_CLOSE)
            progressed = True
            while buf and progressed:
                progressed = False
                if inline_think:
                    end = buf.find(THINK_CLOSE)
                    if end >= 0:
                        out_think.append(buf[:end])
                        buf = buf[end + close_len:]
                        inline_think = False
                        if buf.startswith("\n"):  # 思考结束后的首个换行不属于正文
                            buf = buf[1:]
                        progressed = True
                    elif len(buf) >= close_len:
                        cut = len(buf) - (close_len - 1)  # 尾部可能是半截闭合标签，留待下轮
                        out_think.append(buf[:cut])
                        buf = buf[cut:]
                        progressed = True
                else:
                    start = buf.find(THINK_OPEN)
                    if start >= 0:
                        out_text.append(buf[:start])
                        buf = buf[start + open_len:]
                        inline_think = True
                        progressed = True
                    elif len(buf) >= open_len:
                        cut = len(buf) - (open_len - 1)
                        out_text.append(buf[:cut])
                        buf = buf[cut:]
                        progressed = True
            think_pending = buf
            return "".join(out_text), "".join(out_think)

        length_truncated = False
        est_prompt_base = len(system_text) + sum(len(m["content"]) for m in msgs)
        tool_round = 0
        work_msgs = list(body["messages"])
        finished = False
        while not finished:
            round_body = dict(body)
            round_body["messages"] = work_msgs
            if tool_round >= AI_TOOL_MAX_ROUNDS:
                # 达到工具轮数上限：摘掉工具强制收尾，避免无限循环
                round_body.pop("tools", None)
                round_body.pop("tool_choice", None)
            round_tool_calls: dict[int, dict] = {}
            round_content = ""
            round_finish = None
            upstream = None
            waited = 0
            deadline = time.monotonic() + AI_WAIT_TOTAL
            # —— 建立上游连接：429 每 10 秒重试，总等待上限 2 分钟 ——
            while True:
                try:
                    upstream = _open_upstream(round_body, base_url=up_base, api_key=up_key)
                    break
                except urllib.error.HTTPError as e:
                    if e.code == 429:
                        if time.monotonic() < deadline:
                            waited += AI_WAIT_INTERVAL
                            print(f"[ai] 上游 429，已等待 {waited}s，继续重试", flush=True)
                            yield "data: " + json.dumps({"status": "wait", "waited": waited}, ensure_ascii=False) + "\n\n"
                            time.sleep(AI_WAIT_INTERVAL)
                            continue
                        print("[ai] 上游 429：等待超时，放弃", flush=True)
                        yield "data: " + json.dumps(
                            {"error": AI_BUSY_EN if is_en else AI_BUSY_ZH}, ensure_ascii=False,
                        ) + "\n\n"
                        break
                    try:
                        detail = e.read().decode("utf-8", "replace")[:500]
                    except Exception:
                        detail = ""
                    print(f"[ai] 上游 HTTP {e.code}: {detail}", flush=True)
                    yield "data: " + json.dumps(
                        {"error": f"AI service unavailable (upstream {e.code}), please retry later."
                         if is_en else f"AI 服务暂时不可用（上游 {e.code}），请稍后再试。"},
                        ensure_ascii=False,
                    ) + "\n\n"
                    break
                except Exception as exc:
                    print(f"[ai] 连接失败: {exc}", flush=True)
                    yield "data: " + json.dumps(
                        {"error": "AI service unavailable, please retry later."
                         if is_en else "AI 服务暂时不可用，请稍后再试。"},
                        ensure_ascii=False,
                    ) + "\n\n"
                    break
            if upstream is None:
                # 未能建立连接：本次提问也计入配额（按估算 prompt 记账），防止刷重试
                est = est_prompt_base // 2
                _record_usage(identity, ip_hash, est, 0)
                return
            try:
                for raw in upstream:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                    except ValueError:
                        continue
                    usage = obj.get("usage")
                    if usage:
                        prompt_toks += int(usage.get("prompt_tokens") or 0)
                        completion_toks += int(usage.get("completion_tokens") or 0)
                        yield "data: " + json.dumps(
                            {"usage": {"prompt_tokens": prompt_toks, "completion_tokens": completion_toks}},
                            ensure_ascii=False,
                        ) + "\n\n"
                        continue
                    choices = obj.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    # 思考过程（GLM-4.5 / DeepSeek 风格的 reasoning_content），单独事件转发
                    reasoning = delta.get("reasoning_content")
                    if reasoning:
                        think_chars += len(reasoning)
                        yield "data: " + json.dumps({"r": reasoning}, ensure_ascii=False) + "\n\n"
                    content = delta.get("content")
                    if content:
                        # 内联 <think> 适配：正文与思考分流（无 <think> 的模型原样透传，行为不变）
                        content, inline_think_part = _split_inline_think(content)
                        if inline_think_part:
                            think_chars += len(inline_think_part)
                            yield "data: " + json.dumps({"r": inline_think_part}, ensure_ascii=False) + "\n\n"
                        if content:
                            round_content += content
                            reply_chars += len(content)
                            yield "data: " + json.dumps({"t": content}, ensure_ascii=False) + "\n\n"
                    # 工具调用片段（按 index 分片拼装）
                    for tcd in delta.get("tool_calls") or []:
                        try:
                            idx = int(tcd.get("index") or 0)
                        except (TypeError, ValueError):
                            idx = 0
                        slot = round_tool_calls.setdefault(
                            idx, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
                        )
                        if tcd.get("id"):
                            slot["id"] = tcd["id"]
                        fn = tcd.get("function") or {}
                        if fn.get("name"):
                            slot["function"]["name"] += fn["name"]
                        if fn.get("arguments"):
                            slot["function"]["arguments"] += fn["arguments"]
                    # 思考/正文用尽 max_tokens 会被截断：给用户明确提示而非无声消失
                    if choices[0].get("finish_reason"):
                        round_finish = choices[0]["finish_reason"]
                        if round_finish == "length":
                            length_truncated = True
            except Exception:
                yield "data: " + json.dumps({"error": "AI 回复中断，请重试"}, ensure_ascii=False) + "\n\n"
                finished = True
            finally:
                try:
                    upstream.close()
                except Exception:
                    pass
            if finished:
                break
            # —— 工具调用轮：执行工具 → 回填消息 → 下一轮续答 ——
            if round_finish == "tool_calls" and round_tool_calls and tool_round < AI_TOOL_MAX_ROUNDS:
                tc_list = [round_tool_calls[i] for i in sorted(round_tool_calls)]
                work_msgs.append({"role": "assistant", "content": round_content or None, "tool_calls": tc_list})
                for tc in tc_list:
                    name = tc["function"]["name"]
                    try:
                        args = json.loads(tc["function"].get("arguments") or "{}")
                    except ValueError:
                        args = {}
                    if name == "search_courses":
                        result = _tool_search_courses(args)
                    else:
                        result = {"error": f"未知工具 {name}"}
                    yield "data: " + json.dumps(
                        {"status": "tool", "name": name, "total": result.get("total")}, ensure_ascii=False,
                    ) + "\n\n"
                    print(f"[ai] 工具调用 {name}({args}) -> {result.get('total', '?')} 条", flush=True)
                    work_msgs.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id") or "",
                        "content": json.dumps(result, ensure_ascii=False),
                    })
                tool_round += 1
                continue
            finished = True
        # 流结束仍有未判定缓冲：按正文补发（防止半截标签吞字）
        if think_pending:
            tail = think_pending
            think_pending = ""
            round_content += tail
            reply_chars += len(tail)
            yield "data: " + json.dumps({"t": tail}, ensure_ascii=False) + "\n\n"
        if length_truncated:
            note = (
                "（Note: this reply was cut off by the length limit — try again or ask a more specific question.）"
                if is_en
                else "（提示：本次回复因模型思考过长被截断，可重试一次，或把问题拆小后再问。）"
            )
            yield "data: " + json.dumps({"t": note}, ensure_ascii=False) + "\n\n"
        # 上游未回 usage 时的粗略估算（中文 ~2 字符/token），保证熔断统计不漏计
        if not prompt_toks and not completion_toks:
            extra = sum(len(str(m.get("content") or "")) for m in work_msgs[len(body["messages"]):])
            prompt_toks = (est_prompt_base + extra) // 2
            completion_toks = (reply_chars + think_chars) // 2
        _record_usage(identity, ip_hash, prompt_toks, completion_toks)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/vote/ai/quota")
def ai_quota(request: Request, visitor_id: str = Query(default="", max_length=64)):
    """用户侧限额查询：今日已用/上限（页面显示用），含 IP/全局触顶提示；两档模型分开返回。
    统计身份与 chat 一致：登录用户按账号 identity，游客按匿名 visitor。"""
    ip_hash = _ip_hash(_client_ip(request))
    identity, acc_email = _ai_identity(request, visitor_id)
    conn = _connect()
    try:
        start = _day_start(time.time())
        flash_gen = _ai_cur_gen(conn, "flash")
        strong_gen = _ai_cur_gen(conn, "strong")
        master_on = _ai_master_enabled(conn)
        flash_on = _ai_tier_enabled(conn, "flash")
        strong_upstream = _ai_upstream_cfg(conn, "strong")
        strong_on = _ai_tier_enabled(conn, "strong") and strong_upstream is not None
        flash_upstream = _ai_upstream_cfg(conn, "flash")
        flash_on = flash_on and flash_upstream is not None
        quota_v = _ai_quota(conn, "ai_quota_visitor", AI_QUOTA_VISITOR_DEF)
        quota_ip = _ai_quota(conn, "ai_quota_ip", AI_QUOTA_IP_DEF)
        cap = _ai_quota(conn, "ai_token_daily_cap", AI_TOKEN_CAP_DEF)
        # 低级档个人限额：登录用户按登录限额；游客 = 登录限额 × 倍数（至少 1 次）
        personal_limit = quota_v if acc_email else max(1, int(quota_v * _ai_guest_ratio(conn)))
        used = conn.execute(
            "SELECT COUNT(*) FROM ai_usage WHERE visitor_hash = ? AND ts >= ? AND gen = ?;",
            (identity, start, flash_gen),
        ).fetchone()[0]
        ip_used = conn.execute(
            "SELECT COUNT(*) FROM ai_usage WHERE ip_hash = ? AND ts >= ? AND gen = ?;",
            (ip_hash, start, flash_gen),
        ).fetchone()[0]
        tokens_today = conn.execute(
            "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage "
            "WHERE ts >= ? AND model = 'flash' AND gen = ?;",
            (start, flash_gen),
        ).fetchone()[0]
        # —— 高级档（强模型）配额 ——
        strong_cap = _ai_quota(conn, "ai_strong_token_daily_cap", AI_STRONG_TOKEN_CAP_DEF)
        strong_pct = _ai_quota(conn, "ai_strong_user_pct", AI_STRONG_USER_PCT_DEF)
        strong_cnt = _ai_quota(conn, "ai_strong_daily_count", AI_STRONG_COUNT_DEF)
        strong_min = _ai_quota(conn, "ai_strong_valid_min_tokens", AI_STRONG_VALID_MIN_TOK_DEF)
        strong_user = conn.execute(
            "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage "
            "WHERE ts >= ? AND model = 'strong' AND visitor_hash = ? AND gen = ?;",
            (start, identity, strong_gen),
        ).fetchone()[0]
        strong_valid = conn.execute(
            "SELECT COUNT(*) FROM ai_usage WHERE ts >= ? AND model = 'strong' "
            "AND visitor_hash = ? AND completion_tokens >= ? AND gen = ?;",
            (start, identity, strong_min, strong_gen),
        ).fetchone()[0]
        strong_all = conn.execute(
            "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage "
            "WHERE ts >= ? AND model = 'strong' AND gen = ?;",
            (start, strong_gen),
        ).fetchone()[0]
        # 使用声明：版本号用于"要求重新签署"；zh/en 为管理端自定义文本（空 = 前端使用内置默认）
        disclaimer = {
            "ver": int(_ai_quota(conn, "ai_disclaimer_ver", 1)),
            "zh": _get_meta(conn, "ai_disclaimer_zh", ""),
            "en": _get_meta(conn, "ai_disclaimer_en", ""),
        }
        disp_flash = _ai_display(conn, "flash")
        disp_strong = _ai_display(conn, "strong")
    finally:
        conn.close()
    user_cap = strong_cap * max(0, min(strong_pct, 100)) // 100
    return {
        "used": int(used),
        "limit": personal_limit,
        "logged_in": bool(acc_email),
        "ip_exhausted": not acc_email and quota_ip > 0 and ip_used >= quota_ip,
        "token_exhausted": cap > 0 and tokens_today >= cap,
        "enabled": flash_on,
        "master_enabled": master_on,
        "flash_enabled": flash_on,
        "display": {"flash": disp_flash, "strong": disp_strong},
        "models": {
            "flash": (flash_upstream[0] if flash_upstream else None),
            "strong": (strong_upstream[0] if strong_upstream else None),
        },
        "strong": {
            "enabled": strong_on,
            "used_valid": int(strong_valid),
            "limit_count": strong_cnt,
            "user_tokens_used": int(strong_user),
            "user_tokens_limit": int(user_cap),
            "user_exhausted": user_cap > 0 and strong_user >= user_cap,
            "global_exhausted": strong_cap > 0 and strong_all >= strong_cap,
            "tokens_used": int(strong_all),
            "tokens_cap": int(strong_cap),
        },
        "disclaimer": disclaimer,
    }


@app.post("/vote/admin/ai/reset")
def admin_ai_reset(
    request: Request,
    scope: str = Query(default="all"),
    token: str | None = Query(default=None),
):
    """管理端重置今日限额（标准模型档与强模型档的代次互相独立、互不影响）：
    scope=users          清空用户/IP 次数限流计数（内存桶）
    scope=tokens         标准模型档（flash）用量代次 +1
    scope=strong_tokens  强模型档（strong）用量代次 +1
    scope=all            users + 两档代次都做（默认）
    """
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="cross-site request blocked")
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    if scope not in ("users", "tokens", "strong_tokens", "all"):
        return JSONResponse({"detail": "bad scope"}, status_code=400)
    if scope in ("users", "all"):
        _ai_visitor_hits.clear()
        _ai_ip_hits.clear()
        _ai_strong_hits.clear()
    conn = _connect()
    try:
        new_gen = 0
        now = int(time.time())
        if scope in ("tokens", "all"):
            new_gen = _ai_cur_gen(conn, "flash") + 1
            conn.execute(
                "INSERT INTO ai_resets (ts, gen, tier) VALUES (?, ?, 'flash');", (now, new_gen)
            )
            _set_meta(conn, "ai_usage_gen", str(new_gen))
            conn.commit()
        if scope in ("strong_tokens", "all"):
            new_gen = _ai_cur_gen(conn, "strong") + 1
            conn.execute(
                "INSERT INTO ai_resets (ts, gen, tier) VALUES (?, ?, 'strong');", (now, new_gen)
            )
            _set_meta(conn, "ai_strong_gen", str(new_gen))
            conn.commit()
    finally:
        conn.close()
    return {"ok": True, "gen": new_gen}


@app.post("/vote/admin/ai/disclaimer")
async def admin_ai_disclaimer(request: Request, token: str | None = Query(default=None)):
    """管理端保存 AI 助手使用声明全文（zh/en；空字符串 = 前端回退到内置默认声明）。
    内容对用户即时生效（quota 端点随每次拉取返回）；如需让已签署用户重新签署，另调 reagree。"""
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="cross-site request blocked")
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"detail": "bad body"}, status_code=400)
    zh_text = payload.get("zh") if isinstance(payload, dict) else None
    en_text = payload.get("en") if isinstance(payload, dict) else None
    if not isinstance(zh_text, str) or not isinstance(en_text, str):
        return JSONResponse({"detail": "zh/en must be strings"}, status_code=400)
    if len(zh_text) > 20000 or len(en_text) > 20000:
        return JSONResponse({"detail": "text too long (max 20000 chars)"}, status_code=400)
    conn = _connect()
    try:
        _set_meta(conn, "ai_disclaimer_zh", zh_text.strip())
        _set_meta(conn, "ai_disclaimer_en", en_text.strip())
        conn.commit()
        ver = _ai_quota(conn, "ai_disclaimer_ver", 1)
    finally:
        conn.close()
    return {"ok": True, "ver": ver}


@app.post("/vote/admin/ai/disclaimer/reagree")
def admin_ai_disclaimer_reagree(request: Request, token: str | None = Query(default=None)):
    """管理端要求所有用户重新签署使用声明：版本号 +1，
    前端发现 quota 返回版本高于本地已签署版本时重新弹出声明。"""
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="cross-site request blocked")
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    conn = _connect()
    try:
        ver = _ai_quota(conn, "ai_disclaimer_ver", 1) + 1
        _set_meta(conn, "ai_disclaimer_ver", str(ver))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "ver": ver}


@app.post("/vote/admin/ai/config")
def admin_ai_config(
    request: Request,
    visitor: int = Query(default=-1, ge=-1, le=500),
    ip: int = Query(default=-1, ge=-1, le=5000),
    token_cap: int = Query(default=-1, ge=-1, le=50000000),
    strong_token_cap: int = Query(default=-1, ge=-1, le=50000000),
    strong_user_pct: int = Query(default=-1, ge=-1, le=100),
    strong_count: int = Query(default=-1, ge=-1, le=200),
    strong_valid_min: int = Query(default=-1, ge=-1, le=100000),
    strong_price: float = Query(default=-1.0, ge=-1.0, le=100000),
    guest_ratio: float = Query(default=-1.0, ge=-1.0, le=1.0),
    ai_enabled: int = Query(default=-1, ge=-1, le=1),
    flash_enabled: int = Query(default=-1, ge=-1, le=1),
    strong_enabled: int = Query(default=-1, ge=-1, le=1),
    token: str | None = Query(default=None),
):
    """管理后台调整 AI 限额与开关（-1 表示不修改；cap 0 表示不限制）。
    强模型参数：strong_token_cap 全局日上限 / strong_user_pct 每人占全局百分比 /
    strong_count 每人每日有效对话次数 / strong_valid_min 有效对话 completion tokens 下限 /
    strong_price 费用估计单价（元/百万 token）。
    guest_ratio 未登录用户低级档限额 = 登录限额 × 该倍数（0~1，结果至少 1 次）。
    开关：ai_enabled 总开关（一键停用用户端 AI 助手）/ flash_enabled 标准模型档 / strong_enabled 强模型档。"""
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="cross-site request blocked")
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    if all(v < 0 for v in (visitor, ip, token_cap, strong_token_cap, strong_user_pct, strong_count, strong_valid_min, strong_price, guest_ratio, ai_enabled, flash_enabled, strong_enabled)):
        return JSONResponse({"detail": "nothing to update"}, status_code=400)
    conn = _connect()
    try:
        if visitor >= 0:
            _set_meta(conn, "ai_quota_visitor", str(visitor))
        if ip >= 0:
            _set_meta(conn, "ai_quota_ip", str(ip))
        if token_cap >= 0:
            _set_meta(conn, "ai_token_daily_cap", str(token_cap))
        if strong_token_cap >= 0:
            _set_meta(conn, "ai_strong_token_daily_cap", str(strong_token_cap))
        if strong_user_pct >= 0:
            _set_meta(conn, "ai_strong_user_pct", str(strong_user_pct))
        if strong_count >= 0:
            _set_meta(conn, "ai_strong_daily_count", str(strong_count))
        if strong_valid_min >= 0:
            _set_meta(conn, "ai_strong_valid_min_tokens", str(strong_valid_min))
        if strong_price >= 0:
            _set_meta(conn, "ai_strong_price_yuan", str(round(strong_price, 4)))
        if guest_ratio >= 0:
            _set_meta(conn, "ai_quota_guest_ratio", str(round(guest_ratio, 4)))
        if ai_enabled >= 0:
            _set_meta(conn, "ai_master_enabled", "1" if ai_enabled else "0")
        if flash_enabled >= 0:
            _set_meta(conn, "ai_flash_enabled", "1" if flash_enabled else "0")
        if strong_enabled >= 0:
            _set_meta(conn, "ai_strong_enabled", "1" if strong_enabled else "0")
    finally:
        conn.close()
    return {"ok": True}


@app.post("/vote/admin/ai/models")
async def admin_ai_models(request: Request, token: str | None = Query(default=None)):
    """管理端保存档位模型配置：body JSON {tier, display, model, base_url, key, reset}。
    存 meta ai_model_{tier}（JSON：display/model/base_url/key，key 不回显）。
    前端表单应预填当前值整体提交；key 留空 = 沿用旧 key；reset=true = 删除整份配置回落环境变量/内置显示名。"""
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="cross-site request blocked")
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"detail": "bad json"}, status_code=400)
    tier = str(payload.get("tier", "")).strip()
    if tier not in ("flash", "strong"):
        return JSONResponse({"detail": "bad tier"}, status_code=400)
    conn = _connect()
    try:
        if payload.get("reset"):
            _del_meta(conn, f"ai_model_{tier}")
            return {"ok": True}
        old = _ai_model_cfg(conn, tier)
        display = str(payload.get("display", "")).strip()[:40]
        model = str(payload.get("model", "")).strip()[:120]
        base_url = str(payload.get("base_url", "")).strip()[:300]
        key = str(payload.get("key", "")).strip()[:300]
        if base_url and not base_url.lower().startswith("http"):
            return JSONResponse({"detail": "base_url must start with http(s)://"}, status_code=400)
        base_url = base_url.rstrip("/")
        cfg = {
            "display": display,
            "model": model or old.get("model", ""),
            "base_url": base_url or old.get("base_url", ""),
            "key": key or old.get("key", ""),
        }
        _set_meta(conn, f"ai_model_{tier}", json.dumps(cfg, ensure_ascii=False))
    finally:
        conn.close()
    return {"ok": True}


@app.get("/vote/admin/ai/stats")
def admin_ai_stats(request: Request, token: str | None = Query(default=None)):
    """AI 用量统计：今日/累计调用数与 token（按模型分档），当前限额配置"""
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    conn = _connect()
    try:
        start = _day_start(time.time())
        flash_gen = _ai_cur_gen(conn, "flash")
        strong_gen = _ai_cur_gen(conn, "strong")
        strong_min = _ai_quota(conn, "ai_strong_valid_min_tokens", AI_STRONG_VALID_MIN_TOK_DEF)
        # 今日口径 = 各档各自当前代次（两档代次互相独立）
        row = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(prompt_tokens + completion_tokens), 0) "
            "FROM ai_usage WHERE ts >= ? AND ((model = 'flash' AND gen = ?) OR (model = 'strong' AND gen = ?));",
            (start, flash_gen, strong_gen),
        ).fetchone()
        total = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage;"
        ).fetchone()
        # 按模型分档统计（今日调用数/token + 强模型有效对话数；今日口径 = 各档当前代次）
        by_model: dict[str, dict] = {}
        for m, calls, toks in conn.execute(
            "SELECT model, COUNT(*), COALESCE(SUM(prompt_tokens + completion_tokens), 0) "
            "FROM ai_usage WHERE ts >= ? AND ((model = 'flash' AND gen = ?) OR (model = 'strong' AND gen = ?)) GROUP BY model;",
            (start, flash_gen, strong_gen),
        ):
            by_model[m] = {"calls": int(calls), "tokens": int(toks)}
        strong_valid_today = conn.execute(
            "SELECT COUNT(*) FROM ai_usage WHERE ts >= ? AND model = 'strong' AND completion_tokens >= ? AND gen = ?;",
            (start, strong_min, strong_gen),
        ).fetchone()[0]
        strong_total_toks = conn.execute(
            "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) FROM ai_usage WHERE model = 'strong';"
        ).fetchone()[0]
        disclaimer_ver = _ai_quota(conn, "ai_disclaimer_ver", 1)
        price = _ai_strong_price(conn)
        # 模型配置回显：key 只给掩码，不回传明文；来源标记 env = 当前由环境变量兜底
        def _model_view(tier: str, env_model: str) -> dict:
            cfg = _ai_model_cfg(conn, tier)
            up = _ai_upstream_cfg(conn, tier)
            key = cfg.get("key", "")
            return {
                "display": _ai_display(conn, tier),
                "model": cfg.get("model", "") or (env_model if up else ""),
                "base_url": cfg.get("base_url", ""),
                "key_masked": (key[:4] + "****" + key[-4:]) if len(key) > 8 else ("****" if key else ""),
                "has_key": bool(key),
                "source": "meta" if cfg else "env",
                "active": up[0] if up else "",
            }
        models_cfg = {
            "flash": _model_view("flash", AI_MODEL_FLASH),
            "strong": _model_view("strong", AI_MODEL_STRONG),
        }
        switches = {
            "master": _ai_master_enabled(conn),
            "flash": _get_meta(conn, "ai_flash_enabled", "1") == "1",
            "strong": _get_meta(conn, "ai_strong_enabled", "1") == "1",
        }
        quotas = {
            "visitor": _ai_quota(conn, "ai_quota_visitor", AI_QUOTA_VISITOR_DEF),
            "ip": _ai_quota(conn, "ai_quota_ip", AI_QUOTA_IP_DEF),
            "guest_ratio": _ai_guest_ratio(conn),
            "token_cap": _ai_quota(conn, "ai_token_daily_cap", AI_TOKEN_CAP_DEF),
            "strong_token_cap": _ai_quota(conn, "ai_strong_token_daily_cap", AI_STRONG_TOKEN_CAP_DEF),
            "strong_user_pct": _ai_quota(conn, "ai_strong_user_pct", AI_STRONG_USER_PCT_DEF),
            "strong_count": _ai_quota(conn, "ai_strong_daily_count", AI_STRONG_COUNT_DEF),
            "strong_valid_min": strong_min,
            "strong_price": price,
        }
    finally:
        conn.close()
    return {
        "today_calls": int(row[0]),
        "today_tokens": int(row[1]),
        "total_calls": int(total[0]),
        "total_tokens": int(total[1]),
        "by_model": by_model,
        "strong_valid_today": int(strong_valid_today),
        "strong_total_tokens": int(strong_total_toks),
        "strong_price": price,
        "strong_cost_today": round(by_model.get("strong", {}).get("tokens", 0) / 1e6 * price, 4),
        "strong_cost_total": round(int(strong_total_toks) / 1e6 * price, 4),
        "disclaimer_ver": int(disclaimer_ver),
        "switches": switches,
        "enabled": bool(models_cfg["flash"]["active"]) and switches["master"] and switches["flash"],
        "models": {"flash": AI_MODEL_FLASH, "strong": AI_MODEL_STRONG or None},
        "models_cfg": models_cfg,
        "guest_ratio": quotas["guest_ratio"],
    }


@app.get("/vote/admin/ai/history")
def admin_ai_history(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    token: str | None = Query(default=None),
):
    """近 N 天每日 AI 用量（含分档），管理页条形图数据源；缺失日期补零，保证连续。"""
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT date(ts, 'unixepoch', 'localtime') d, model, COUNT(*), "
            "COALESCE(SUM(prompt_tokens + completion_tokens), 0) "
            "FROM ai_usage WHERE ts >= ? GROUP BY d, model ORDER BY d;",
            (time.time() - days * 86400,),
        ).fetchall()
    finally:
        conn.close()
    by_day: dict[str, dict] = {}
    for d, m, c, t in rows:
        slot = by_day.setdefault(d, {"calls": 0, "tokens": 0, "flash_calls": 0, "flash_tokens": 0, "strong_calls": 0, "strong_tokens": 0})
        slot["calls"] += int(c)
        slot["tokens"] += int(t)
        if m == "flash":
            slot["flash_calls"] += int(c)
            slot["flash_tokens"] += int(t)
        elif m == "strong":
            slot["strong_calls"] += int(c)
            slot["strong_tokens"] += int(t)
    out = []
    today = time.localtime()
    for i in range(days - 1, -1, -1):
        lt = time.localtime(time.mktime((today.tm_year, today.tm_mon, today.tm_mday, 0, 0, 0, 0, 0, -1)) - i * 86400)
        key = time.strftime("%Y-%m-%d", lt)
        out.append({"day": key, **by_day.get(key, {"calls": 0, "tokens": 0, "flash_calls": 0, "flash_tokens": 0, "strong_calls": 0, "strong_tokens": 0})})
    return {"days": out}


@app.get("/vote/admin/ai/day")
def admin_ai_day(
    request: Request,
    day: str = Query(default=""),
    token: str | None = Query(default=None),
):
    """某一天的 AI 用量详情：分档统计 + 按重置代次分段（条形图分段绘制数据源）+ 当日重置时刻。"""
    if not _require_admin(request, token):
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        start = time.mktime(time.strptime(day, "%Y-%m-%d"))
    except ValueError:
        return JSONResponse({"detail": "bad day format"}, status_code=400)
    end = start + 86400
    conn = _connect()
    try:
        by_model = {
            m: {"calls": int(c), "tokens": int(t)}
            for m, c, t in conn.execute(
                "SELECT model, COUNT(*), COALESCE(SUM(prompt_tokens + completion_tokens), 0) "
                "FROM ai_usage WHERE ts >= ? AND ts < ? GROUP BY model;",
                (start, end),
            )
        }
        segments = [
            {"model": m, "gen": int(g), "calls": int(c), "tokens": int(t)}
            for m, g, c, t in conn.execute(
                "SELECT model, gen, COUNT(*), COALESCE(SUM(prompt_tokens + completion_tokens), 0) "
                "FROM ai_usage WHERE ts >= ? AND ts < ? GROUP BY model, gen ORDER BY model, gen;",
                (start, end),
            )
        ]
        resets = [
            {"time": time.strftime("%H:%M", time.localtime(ts)), "tier": tier}
            for ts, tier in conn.execute(
                "SELECT ts, tier FROM ai_resets WHERE ts >= ? AND ts < ? ORDER BY ts;",
                (start, end),
            )
        ]
    finally:
        conn.close()
    calls = sum(s["calls"] for s in segments)
    tokens = sum(s["tokens"] for s in segments)
    return {
        "day": day,
        "calls": calls,
        "tokens": tokens,
        "flash": by_model.get("flash", {"calls": 0, "tokens": 0}),
        "strong": by_model.get("strong", {"calls": 0, "tokens": 0}),
        "segments": segments,
        "resets": resets,
    }


# ---------- 课程评价（2026-11-16）----------
# 两层模型：review_topics（课程条目：官方收录 + 用户自定义）与 reviews（评价）分离；
# 评价只挂条目。全量先审后显；通过后不可编辑只可删除；互动五档（不实用与其余四档互斥）。
_RV_REACTIONS = ("like", "useful", "watch", "doubt", "unuseful")  # 点赞/实用！/观望中/真的吗？/不实用
_RV_NEGATIVE = "unuseful"  # 与其余四档互斥

# —— 管理页可改配置（meta 键 → 默认值）——
_RV_CFG_DEFAULTS = {
    "rv_report_push_n": 3,      # 举报数达到该值 → 进入管理页举报队列（不推微信）
    "rv_report_del_n": 10,      # 举报数达到该值 → 自动软删（removed_report）
    "rv_remind_count_n": 5,     # 待审+未处理举报累计增量达到该值 → 提醒
    "rv_remind_stale_h": 24,    # 最早待审评价滞留超过该小时数 → 时效提醒（0 = 关闭）
    "rv_daily_limit": 5,        # 每人每日发评价上限
    "rv_hot_gravity": 1.5,      # 热度时间衰减引力（0 = 不衰减）
}


def _rv_cfg(conn: sqlite3.Connection, key: str) -> float:
    default = _RV_CFG_DEFAULTS.get(key, 0)
    try:
        return float(_get_meta(conn, key, str(default)) or default)
    except (TypeError, ValueError):
        return float(default)


_CN_DIGITS = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6,
              "七": 7, "八": 8, "九": 9, "十": 10, "百": 100}


def _rv_cn_to_arabic(s: str) -> str:
    """常见中文数字转阿拉伯（课程名场景：工程训练一↔工程训练1）。仅处理纯序列，不做复杂位值。"""
    out = []
    i = 0
    while i < len(s):
        ch = s[i]
        if ch in _CN_DIGITS:
            j = i
            seq = []
            while j < len(s) and s[j] in _CN_DIGITS:
                seq.append(_CN_DIGITS[s[j]])
                j += 1
            # 位值合成：…百 十 X 等简单组合；超过三位数保持原样（课程名不出现）
            if len(seq) == 1:
                out.append(str(seq[0]))
            elif seq[-1] == 10:
                tens = seq[0] * 10 if seq[0] != 10 else 10
                if len(seq) == 3 and seq[1] == 10:  # 一百零几/一百几
                    tens = seq[0] * 100 + seq[2]
                out.append(str(tens))
            elif len(seq) == 2 and seq[0] == 10:  # 十Y
                out.append(str(10 + seq[1]))
            else:
                out.append("".join(str(v) for v in seq))
            i = j
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _rv_norm_key(name: str) -> str:
    """条目归一化键：全角→半角、去空白、括号统一、小写、中文数字→阿拉伯。
    只用于「疑似重复」匹配提示与完全同名自动归并，展示名一律保留原样。"""
    s = (name or "").strip().lower()
    # 全角 ASCII → 半角
    s = "".join(chr(ord(c) - 0xFEE0) if 0xFF01 <= ord(c) <= 0xFF5E else c for c in s)
    s = s.replace("（", "(").replace("）", ")").replace("《", "<").replace("》", ">")
    s = re.sub(r"[\s\u3000·・]+", "", s)
    s = _rv_cn_to_arabic(s)
    return s


# GB2312 区位 → 拼音首字母（经典区间表，覆盖常用汉字）
_RV_PY_RANGES = [
    (0xB0A1, 0xB0C4, "A"), (0xB0C5, 0xB2C0, "B"), (0xB2C1, 0xB4ED, "C"), (0xB4EE, 0xB6E9, "D"),
    (0xB6EA, 0xB7A1, "E"), (0xB7A2, 0xB8C0, "F"), (0xB8C1, 0xB9FD, "G"), (0xB9FE, 0xBBF6, "H"),
    (0xBBF7, 0xBFA5, "J"), (0xBFA6, 0xC0AB, "K"), (0xC0AC, 0xC2E7, "L"), (0xC2E8, 0xC4C2, "M"),
    (0xC4C3, 0xC5B5, "N"), (0xC5B6, 0xC5BD, "O"), (0xC5BE, 0xC6D9, "P"), (0xC6DA, 0xC8BA, "Q"),
    (0xC8BB, 0xC8F5, "R"), (0xC8F6, 0xCBFE, "S"), (0xCBFF, 0xCDC4, "T"), (0xCDC5, 0xD0B5, "W"),
    (0xD0B6, 0xD4C3, "X"), (0xD4C4, 0xD7BB, "Y"), (0xD7BC, 0xD7F9, "Z"),
]


def _rv_initial(name: str) -> str:
    """条目首字母：汉字取拼音首字母（GB2312 区间近似），英文/数字取首字符大写。"""
    for ch in (name or "").strip():
        u = ord(ch)
        if 0x4E00 <= u <= 0x9FFF:
            try:
                c = ch.encode("gb2312")
                code = c[0] * 256 + c[1]
                for lo, hi, letter in _RV_PY_RANGES:
                    if lo <= code <= hi:
                        return letter
            except (UnicodeEncodeError, IndexError):
                pass
            return "#"  # 生僻字
        if ch.isascii() and ch.isalnum():
            return ch.upper()
        if ch in "·・ ":
            continue
        return "#"
    return "#"


_rv_official_lock = threading.Lock()
_rv_official_done = False  # 进程级一次性标记：重启服务后重新对齐 kb_courses.json


def _rv_ensure_official() -> None:
    """把 kb_courses.json 的官方课程 upsert 进 review_topics（source=official）。
    按 course_id 匹配更新，条目 id 稳定（已挂评价不受数据更新影响）；新课程插入；下架课程保留不动。"""
    global _rv_official_done
    if _rv_official_done:
        return
    courses = _load_courses_index()
    if not courses:
        return
    with _rv_official_lock:
        if _rv_official_done:
            return
        conn = _connect()
        try:
            now = int(time.time())
            by_cid = {}
            for row in conn.execute(
                    "SELECT id, course_id FROM review_topics WHERE source='official' AND course_id IS NOT NULL;"):
                by_cid[row[1]] = row[0]
            for c in courses:
                cid = str(c.get("course_id") or "")
                name = str(c.get("name") or "").strip()
                if not cid or not name:
                    continue
                nk = _rv_norm_key(name)
                init = _rv_initial(name)
                if cid in by_cid:
                    conn.execute(
                        "UPDATE review_topics SET name=?, norm_key=?, initial=? WHERE id=?;",
                        (name, nk, init, by_cid[cid]))
                else:
                    conn.execute(
                        "INSERT INTO review_topics (source, course_id, name, norm_key, initial, status, created_by, ts) "
                        "VALUES ('official', ?, ?, ?, ?, 'active', NULL, ?);",
                        (cid, name, nk, init, now))
            # 规范课程名变化后，曾有旧名重复的 custom 条目可能变成 norm_key 相同——这里不做自动合并，留审核处理。
            conn.commit()
            _rv_official_done = True
        finally:
            conn.close()


_RV_TAG_SYSTEM = """你是课程评价社区的审核辅助打标器。阅读一条待审核的课程评价，只输出一个 JSON 对象：
{"tag": "..."}
tag 取值：
- "normal" —— 正常的课程评价（选课建议、课程内容、 workload、给分风格等，含客观批评）
- "ad" —— 广告、引流、推销、二维码/联系方式
- "offtopic" —— 与课程/选课完全无关的内容
- "teacher_negative" —— 疑似针对具体教师个人的负面评价（出现教师姓名、姓名缩写如 zw、或明确指向某位老师的负面表述）
判定 teacher_negative 时注意：提到老师名字但内容中性/正面 → normal；泛泛说"老师给分严"不指向具体个人 → normal。
严禁输出 JSON 以外的任何内容。"""


def _rv_ai_tag_worker(review_id: int, content: str) -> None:
    """后台线程：调低级档上游给评价打标（AI 只辅助归类排序，不拦截不拒稿）。失败静默留空标签。"""
    try:
        up = _ai_flash_upstream()
        if not up:
            return
        _, base_url, api_key = up
        body = {
            "model": up[0],
            "messages": [
                {"role": "system", "content": _RV_TAG_SYSTEM},
                {"role": "user", "content": content[:1500]},
            ],
            "max_tokens": 60,
            "temperature": 0.1,
            "stream": False,
        }
        resp = _open_upstream(body, base_url=base_url, api_key=api_key)
        data = json.loads(resp.read().decode("utf-8"))
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        usage = data.get("usage") or {}
        m = re.search(r"\{[^}]*\}", text)
        tag = ""
        if m:
            try:
                tag = str(json.loads(m.group(0)).get("tag") or "").strip()
            except ValueError:
                tag = ""
        if tag not in ("normal", "ad", "offtopic", "teacher_negative"):
            tag = ""
        conn = _connect()
        try:
            conn.execute("UPDATE reviews SET ai_tag=? WHERE id=?;", (tag, review_id))
            # 打标消耗极小，但照实记账（flash 档），保持全局熔断口径完整
            try:
                conn.execute(
                    "INSERT INTO ai_usage (visitor_hash, ip_hash, prompt_tokens, completion_tokens, ts, model) "
                    "VALUES ('rv-tag', '', ?, ?, ?, 'flash');",
                    (int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0), int(time.time())),
                )
            except sqlite3.Error:
                pass
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass  # 打标失败不影响主流程，标签留空由人工审


def _rv_topic_review_counts(conn: sqlite3.Connection) -> dict:
    rows = conn.execute(
        "SELECT topic_id, COUNT(*) FROM reviews WHERE status='approved' GROUP BY topic_id;").fetchall()
    return {r[0]: r[1] for r in rows}


def _rv_author_name(sign: str, prefix: str | None, nickname: str | None) -> str:
    if sign == "real":
        return prefix or "同学"
    return (nickname or "").strip() or "同学"


_RV_REVIEW_ROW_SQL = (
    "SELECT r.id, r.topic_id, r.content, r.sign, r.status, r.reject_note, r.report_count, "
    "       r.ai_tag, r.ts, r.approved_at, r.author_uid, "
    "       u.prefix, u.nickname, "
    "       t.name, t.source, t.course_id, t.initial "
    "FROM reviews r "
    "JOIN review_topics t ON t.id = r.topic_id "
    "LEFT JOIN users u ON u.id = r.author_uid "
)


def _rv_review_dict(conn: sqlite3.Connection, row: tuple, viewer_uid: int | None,
                    with_user: bool = False) -> dict:
    (rid, topic_id, content, sign, status, reject_note, report_count,
     ai_tag, ts, approved_at, author_uid, prefix, nickname,
     tname, tsource, tcid, tinit) = row
    counts = {}
    for r in conn.execute(
            "SELECT type, COUNT(*) FROM review_reactions WHERE review_id=? GROUP BY type;", (rid,)):
        counts[r[0]] = r[1]
    mine = set()
    if viewer_uid:
        mine = {r[0] for r in conn.execute(
            "SELECT type FROM review_reactions WHERE review_id=? AND uid=?;", (rid, viewer_uid))}
    like2 = counts.get("like", 0) + counts.get("useful", 0) * 2
    neg = counts.get("doubt", 0) + counts.get("unuseful", 0) * 2
    hot = like2 - neg + counts.get("watch", 0)
    d = {
        "id": rid, "topic_id": topic_id, "content": content, "sign": sign,
        "status": status,
        "author_name": _rv_author_name(sign, prefix, nickname) if status != "pending" else "",
        "ts": ts, "approved_at": approved_at,
        "topic": {"id": topic_id, "name": tname, "source": tsource, "course_id": tcid},
        "reactions": {k: counts.get(k, 0) for k in _RV_REACTIONS},
        "mine": sorted(mine),
        "hot": hot,
        "own": viewer_uid is not None and author_uid == viewer_uid,
    }
    if with_user:
        d["author_uid"] = author_uid
        d["ai_tag"] = ai_tag
        d["reject_note"] = reject_note
        d["report_count"] = report_count
    return d


def _rv_hot_score(hot: int, approved_at: int, gravity: float) -> float:
    age_h = max(0.0, (time.time() - (approved_at or 0)) / 3600.0)
    if gravity <= 0:
        return float(hot)
    return hot / ((age_h + 2.0) ** gravity)


def _rv_pending_count(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM reviews WHERE status='pending';").fetchone()[0])


def _rv_open_report_count(conn: sqlite3.Connection) -> int:
    """举报队列待处理条数：举报数达到入队阈值且未标记处理的评价（管理页「忽略」后不再计入提醒）。"""
    push_n = int(_rv_cfg(conn, "rv_report_push_n"))
    if push_n <= 0:
        return 0
    return int(conn.execute(
        "SELECT COUNT(*) FROM reviews WHERE report_count>=? AND report_seen=0 "
        "AND status IN ('approved','removed_report');", (push_n,)).fetchone()[0])


def _rv_msg_push(conn: sqlite3.Connection, target_uid: int | None, kind: str,
                 title: str, content: str = "") -> None:
    """写一条评价社区站内消息（target_uid=None 为全体公告）。失败静默不影响主流程。"""
    try:
        conn.execute(
            "INSERT INTO rv_msgs (target_uid, kind, title, content, ts) VALUES (?, ?, ?, ?, ?);",
            (target_uid, kind, title, content, int(time.time())))
    except sqlite3.Error:
        pass


def _rv_topic_name_by_review(conn: sqlite3.Connection, review_id: int) -> str:
    row = conn.execute(
        "SELECT t.name FROM reviews r JOIN review_topics t ON t.id=r.topic_id WHERE r.id=?;",
        (review_id,)).fetchone()
    return row[0] if row else "课程评价"


def _rv_maybe_notify(conn: sqlite3.Connection) -> None:
    """审核事件提醒（Server酱）：数量阈值 + 时效阈值。在产生新评价/新举报后调用。失败静默。"""
    try:
        pend = _rv_pending_count(conn)
        reports = _rv_open_report_count(conn)
        base = _get_meta(conn, "rv_remind_base", "0,0")
        try:
            base_p, base_r = (int(x) for x in base.split(","))
        except ValueError:
            base_p = base_r = 0
        count_n = int(_rv_cfg(conn, "rv_remind_count_n"))
        delta = max(0, pend - base_p) + max(0, reports - base_r)
        stale_h = _rv_cfg(conn, "rv_remind_stale_h")
        stale_hit = False
        if pend > 0 and stale_h > 0:
            oldest = conn.execute(
                "SELECT MIN(ts) FROM reviews WHERE status='pending';").fetchone()[0]
            if oldest and (time.time() - oldest) > stale_h * 3600:
                stale_hit = _get_meta(conn, "rv_stale_flag", "") != str(oldest)
        if delta >= count_n or stale_hit:
            _notify(
                "OfCourses 课程评价待审核",
                f"待审评价：{pend} 条\n待处理举报：{reports} 条\n"
                + ("（存在滞留超时的待审内容）" if stale_hit else "")
                + "\n请到管理页处理：/vote/admin",
            )
            _set_meta(conn, "rv_remind_base", f"{pend},{reports}")
            if stale_hit:
                oldest = conn.execute(
                    "SELECT MIN(ts) FROM reviews WHERE status='pending';").fetchone()[0]
                if oldest:
                    _set_meta(conn, "rv_stale_flag", str(oldest))
    except Exception:
        pass


class ReviewIn(BaseModel):
    content: str = Field(min_length=5, max_length=2000)
    topic_id: int | None = None                       # 挂到已有条目
    new_name: str = Field(default="", max_length=80)  # 新建自定义条目名
    sign: str = Field(default="nick", max_length=8)   # real | nick


class ReviewReactIn(BaseModel):
    review_id: int
    type: str = Field(max_length=16)   # _RV_REACTIONS 之一
    on: bool = True                    # true=点亮/切换，false=取消


class ReviewReportIn(BaseModel):
    review_id: int
    reason: str = Field(default="", max_length=500)


@app.get("/vote/reviews/init")
def reviews_init(request: Request):
    """条目总表（搜索/首字母索引数据源）：官方条目全量 + 有已发布评价的自定义条目。
    letters 只返回非空首字母（无评价的字母不出现，避免空索引）。"""
    from accounts import _current_user  # noqa: E402 延迟导入避免循环
    _rv_ensure_official()
    conn = _connect()
    try:
        user = _current_user(request)
        counts = _rv_topic_review_counts(conn)
        out = []
        for row in conn.execute(
                "SELECT id, source, course_id, name, initial, status FROM review_topics "
                "WHERE status='active' ORDER BY name;").fetchall():
            tid, source, cid, name, init, _ = row
            n = counts.get(tid, 0)
            if source != "official" and n == 0:
                continue  # 无已发布评价的自定义条目不进入公共列表
            out.append({"id": tid, "source": source, "course_id": cid, "name": name,
                        "initial": init, "review_count": n})
        # letters 只取「已有至少 1 条已发布评价」的条目首字母（无评价的字母不出现，避免空索引）
        letters = sorted({t["initial"] for t in out if t["initial"] and t["review_count"] > 0})
        return {"topics": out, "letters": letters, "logged_in": bool(user)}
    finally:
        conn.close()


def _rv_sort_key(sort: str, gravity: float):
    if sort == "hot":

        def key(d):
            return (-_rv_hot_score(d["hot"], d["approved_at"], gravity), -d["ts"])
    else:

        def key(d):
            return (-d["approved_at"],)
    return key


@app.get("/vote/reviews/feed")
def reviews_feed(request: Request, sort: str = Query(default="time", max_length=8),
                 limit: int = Query(default=20, ge=1, le=50),
                 offset: int = Query(default=0, ge=0)):
    """全站评价流（仅已发布）。sort=time|hot；前端在加载时取一次快照，不自动轮询刷新。"""
    from accounts import _current_user  # noqa: E402
    conn = _connect()
    try:
        user = _current_user(request)
        uid = user["user_id"] if user else None
        rows = conn.execute(
            _RV_REVIEW_ROW_SQL + "WHERE r.status='approved' ORDER BY r.approved_at DESC LIMIT 300;"
        ).fetchall()
        items = [_rv_review_dict(conn, r, uid) for r in rows]
        gravity = _rv_cfg(conn, "rv_hot_gravity")
        items.sort(key=_rv_sort_key(sort, gravity))
        return {"items": items[offset:offset + limit], "total": len(items)}
    finally:
        conn.close()


@app.get("/vote/reviews/list")
def reviews_list(request: Request, topic_id: int, sort: str = Query(default="time", max_length=8),
                 limit: int = Query(default=20, ge=1, le=50),
                 offset: int = Query(default=0, ge=0)):
    """单条目的已发布评价列表。"""
    from accounts import _current_user  # noqa: E402
    conn = _connect()
    try:
        user = _current_user(request)
        uid = user["user_id"] if user else None
        rows = conn.execute(
            _RV_REVIEW_ROW_SQL + "WHERE r.status='approved' AND r.topic_id=? ORDER BY r.approved_at DESC;",
            (topic_id,)).fetchall()
        items = [_rv_review_dict(conn, r, uid) for r in rows]
        gravity = _rv_cfg(conn, "rv_hot_gravity")
        items.sort(key=_rv_sort_key(sort, gravity))
        return {"items": items[offset:offset + limit], "total": len(items)}
    finally:
        conn.close()


@app.get("/vote/reviews/featured")
def reviews_featured(request: Request):
    """工具入口推送卡数据：热门 Top5 + 最新 5 条（仅已发布）。"""
    from accounts import _current_user  # noqa: E402
    conn = _connect()
    try:
        user = _current_user(request)
        uid = user["user_id"] if user else None
        rows = conn.execute(
            _RV_REVIEW_ROW_SQL + "WHERE r.status='approved' ORDER BY r.approved_at DESC LIMIT 300;"
        ).fetchall()
        items = [_rv_review_dict(conn, r, uid) for r in rows]
        gravity = _rv_cfg(conn, "rv_hot_gravity")
        items.sort(key=_rv_sort_key("hot", gravity))
        hot = items[:5]
        latest = sorted(items, key=lambda d: -d["approved_at"])[:5]
        return {"hot": hot, "latest": latest}
    finally:
        conn.close()


@app.get("/vote/reviews/mine")
def reviews_mine(request: Request):
    """我的评价（全部状态，含驳回意见）——驳回时用户能看到原因。"""
    from accounts import _current_user  # noqa: E402
    conn = _connect()
    try:
        user = _current_user(request)
        if not user:
            return JSONResponse({"detail": "需要登录"}, status_code=401)
        rows = conn.execute(
            _RV_REVIEW_ROW_SQL + "WHERE r.author_uid=? ORDER BY r.ts DESC LIMIT 100;",
            (user["user_id"],)).fetchall()
        return {"items": [_rv_review_dict(conn, r, user["user_id"], with_user=True) for r in rows]}
    finally:
        conn.close()


@app.get("/vote/reviews/board")
def reviews_board(request: Request, period: str = Query(default="month", max_length=8)):
    """热度排行榜：月榜/年榜（滚动窗口内、热度分>0 的已发布评价按热度分取前 10，并列时新的在前）。
    热度 = 点赞+实用×2+观望 −(真的吗+不实用×2)；零互动/负分帖不上榜，保证榜单反映「最热的帖子」。"""
    conn = _connect()
    try:
        days = 30 if period == "month" else 365 if period == "year" else 0
        if days == 0:
            return JSONResponse({"detail": "period 须为 month 或 year"}, status_code=422)
        since = int(time.time()) - days * 86400
        rows = conn.execute(
            _RV_REVIEW_ROW_SQL + "WHERE r.status='approved' AND r.approved_at>=?;",
            (since,)).fetchall()
        items = [_rv_review_dict(conn, r, None) for r in rows]
        items = [d for d in items if d["hot"] > 0]  # 只有真实获得正向互动的帖子才算「热」
        items.sort(key=lambda d: (-d["hot"], -d["approved_at"]))
        return {"items": items[:10]}
    finally:
        conn.close()


@app.get("/vote/reviews/messages")
def reviews_messages(request: Request):
    """评价社区站内消息：全体公告 + 发给我的（含事件通知：审核不通过/被下架等）。"""
    from accounts import _current_user  # noqa: E402
    user = _current_user(request)
    if not user:
        return JSONResponse({"detail": "需要登录"}, status_code=401)
    conn = _connect()
    try:
        uid = user["user_id"]
        rows = conn.execute(
            "SELECT id, target_uid, kind, title, content, ts FROM rv_msgs "
            "WHERE target_uid IS NULL OR target_uid=? ORDER BY ts DESC LIMIT 100;", (uid,)).fetchall()
        read = {r[0] for r in conn.execute(
            "SELECT msg_id FROM rv_msg_reads WHERE uid=?;", (uid,))}
        items = [{"id": m[0], "kind": m[2], "title": m[3], "content": m[4], "ts": m[5],
                  "read": m[0] in read} for m in rows]
        return {"items": items, "unread": sum(1 for i in items if not i["read"])}
    finally:
        conn.close()


class RvMsgReadIn(BaseModel):
    id: int | None = None   # 空 = 全部已读


@app.post("/vote/reviews/messages/read")
def reviews_messages_read(payload: RvMsgReadIn, request: Request):
    from accounts import _current_user  # noqa: E402
    user = _current_user(request)
    if not user:
        return JSONResponse({"detail": "需要登录"}, status_code=401)
    conn = _connect()
    try:
        uid = user["user_id"]
        now = int(time.time())
        if payload.id is None:
            for (mid,) in conn.execute(
                    "SELECT id FROM rv_msgs WHERE target_uid IS NULL OR target_uid=?;", (uid,)):
                conn.execute(
                    "INSERT OR IGNORE INTO rv_msg_reads (msg_id, uid, ts) VALUES (?, ?, ?);",
                    (mid, uid, now))
        else:
            m = conn.execute(
                "SELECT id FROM rv_msgs WHERE id=? AND (target_uid IS NULL OR target_uid=?);",
                (payload.id, uid)).fetchone()
            if not m:
                return JSONResponse({"detail": "消息不存在"}, status_code=404)
            conn.execute(
                "INSERT OR IGNORE INTO rv_msg_reads (msg_id, uid, ts) VALUES (?, ?, ?);",
                (payload.id, uid, now))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.post("/vote/reviews")
def reviews_create(payload: ReviewIn, request: Request):
    """发表评价：全量先审后显。挂已有条目 / 新建自定义条目（norm_key 完全相同则静默归并到已有条目）。"""
    from accounts import _current_user  # noqa: E402
    user = _current_user(request)
    if not user:
        return JSONResponse({"detail": "发表评价需要登录"}, status_code=401)
    if not _same_origin(request):
        return JSONResponse({"detail": "拒绝跨站请求"}, status_code=403)
    if _hit(_ai_classify_hits, f"rv:{_client_ip(request)}", 20):
        return JSONResponse({"detail": "操作过于频繁，请稍后再试"}, status_code=429)
    content = payload.content.strip()
    if len(content) < 5:
        return JSONResponse({"detail": "评价内容太短"}, status_code=422)
    conn = _connect()
    try:
        today = _day_start(time.time())
        posted = conn.execute(
            "SELECT COUNT(*) FROM reviews WHERE author_uid=? AND ts>=? AND status!='deleted_user';",
            (user["user_id"], today)).fetchone()[0]
        limit = int(_rv_cfg(conn, "rv_daily_limit"))
        if limit > 0 and posted >= limit:
            return JSONResponse(
                {"detail": f"今日发表已达上限（{limit} 条），请明天再来"}, status_code=429)
        topic_id = payload.topic_id
        merged_note = ""
        if topic_id:
            t = conn.execute(
                "SELECT id FROM review_topics WHERE id=? AND status='active';", (topic_id,)).fetchone()
            if not t:
                return JSONResponse({"detail": "课程条目不存在"}, status_code=404)
        else:
            name = payload.new_name.strip()
            if not name:
                return JSONResponse({"detail": "请选择已有课程或填写课程名"}, status_code=422)
            nk = _rv_norm_key(name)
            exist = conn.execute(
                "SELECT id, name FROM review_topics WHERE norm_key=? AND status='active' "
                "ORDER BY CASE WHEN source='official' THEN 0 ELSE 1 END, id LIMIT 1;", (nk,)).fetchone()
            if exist:
                topic_id, merged_note = exist[0], exist[1]  # norm_key 完全相同 → 归并到已有条目
            else:
                cur = conn.execute(
                    "INSERT INTO review_topics (source, course_id, name, norm_key, initial, status, created_by, ts) "
                    "VALUES ('custom', NULL, ?, ?, ?, 'active', ?, ?);",
                    (name, nk, _rv_initial(name), user["user_id"], int(time.time())))
                topic_id = cur.lastrowid
        conn.execute(
            "INSERT INTO reviews (topic_id, content, author_uid, sign, status, ts) "
            "VALUES (?, ?, ?, ?, 'pending', ?);",
            (topic_id, content, user["user_id"], payload.sign if payload.sign in ("real", "nick") else "nick",
             int(time.time())))
        rid = conn.execute("SELECT last_insert_rowid();").fetchone()[0]
        conn.commit()
        threading.Thread(target=_rv_ai_tag_worker, args=(rid, content), daemon=True).start()
        _rv_maybe_notify(conn)
        return {"ok": True, "id": rid, "topic_id": topic_id, "merged_to": merged_note or None,
                "detail": f"已提交，审核通过后展示" + (f"（课程已归入「{merged_note}」）" if merged_note else "")}
    finally:
        conn.close()


@app.post("/vote/reviews/react")
def reviews_react(payload: ReviewReactIn, request: Request):
    """互动：五档；「不实用」与其余四档互斥（点亮它清掉本用户其余四档，反之亦然）；再点一次取消由 on=false。"""
    from accounts import _current_user  # noqa: E402
    user = _current_user(request)
    if not user:
        return JSONResponse({"detail": "互动需要登录"}, status_code=401)
    if not _same_origin(request):
        return JSONResponse({"detail": "拒绝跨站请求"}, status_code=403)
    if payload.type not in _RV_REACTIONS:
        return JSONResponse({"detail": "未知互动类型"}, status_code=422)
    if _hit(_ai_classify_hits, f"rr:{_client_ip(request)}", 60):
        return JSONResponse({"detail": "操作过于频繁，请稍后再试"}, status_code=429)
    conn = _connect()
    try:
        r = conn.execute("SELECT id FROM reviews WHERE id=? AND status='approved';",
                         (payload.review_id,)).fetchone()
        if not r:
            return JSONResponse({"detail": "评价不存在或未发布"}, status_code=404)
        uid = user["user_id"]
        if not payload.on:
            conn.execute("DELETE FROM review_reactions WHERE review_id=? AND uid=? AND type=?;",
                         (payload.review_id, uid, payload.type))
        elif payload.type == _RV_NEGATIVE:
            conn.execute("DELETE FROM review_reactions WHERE review_id=? AND uid=? AND type!=?;",
                         (payload.review_id, uid, _RV_NEGATIVE))
            conn.execute(
                "INSERT INTO review_reactions (review_id, uid, type, ts) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(review_id, uid, type) DO UPDATE SET ts=excluded.ts;",
                (payload.review_id, uid, payload.type, int(time.time())))
        else:
            conn.execute("DELETE FROM review_reactions WHERE review_id=? AND uid=? AND type=?;",
                         (payload.review_id, uid, _RV_NEGATIVE))
            conn.execute(
                "INSERT INTO review_reactions (review_id, uid, type, ts) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(review_id, uid, type) DO UPDATE SET ts=excluded.ts;",
                (payload.review_id, uid, payload.type, int(time.time())))
        conn.commit()
        counts = {k: 0 for k in _RV_REACTIONS}
        for rr in conn.execute(
                "SELECT type, COUNT(*) FROM review_reactions WHERE review_id=? GROUP BY type;",
                (payload.review_id,)):
            counts[rr[0]] = rr[1]
        mine = [x[0] for x in conn.execute(
            "SELECT type FROM review_reactions WHERE review_id=? AND uid=?;", (payload.review_id, uid))]
        return {"ok": True, "reactions": counts, "mine": sorted(mine)}
    finally:
        conn.close()


@app.post("/vote/reviews/report")
def reviews_report(payload: ReviewReportIn, request: Request):
    """举报：一人一帖一次；达推送阈值推 Server酱；达删除阈值自动软删（数据保留）。"""
    from accounts import _current_user  # noqa: E402
    user = _current_user(request)
    if not user:
        return JSONResponse({"detail": "举报需要登录"}, status_code=401)
    if not _same_origin(request):
        return JSONResponse({"detail": "拒绝跨站请求"}, status_code=403)
    if _hit(_ai_classify_hits, f"rp:{_client_ip(request)}", 30):
        return JSONResponse({"detail": "操作过于频繁，请稍后再试"}, status_code=429)
    conn = _connect()
    try:
        r = conn.execute(
            "SELECT id, report_count, status, author_uid FROM reviews WHERE id=? AND status IN ('approved','removed_report');",
            (payload.review_id,)).fetchone()
        if not r:
            return JSONResponse({"detail": "评价不存在"}, status_code=404)
        try:
            conn.execute(
                "INSERT INTO review_reports (review_id, uid, reason, ts) VALUES (?, ?, ?, ?);",
                (payload.review_id, user["user_id"], payload.reason.strip(), int(time.time())))
        except sqlite3.IntegrityError:
            return JSONResponse({"detail": "你已举报过这条评价"}, status_code=409)
        count = int(conn.execute(
            "SELECT COUNT(*) FROM review_reports WHERE review_id=?;", (payload.review_id,)).fetchone()[0])
        del_n = int(_rv_cfg(conn, "rv_report_del_n"))
        status = r[2]
        author_uid = r[3]
        removed = False
        if del_n > 0 and count >= del_n and status == "approved":
            status = "removed_report"
            removed = True
        conn.execute("UPDATE reviews SET report_count=?, report_seen=0, status=? WHERE id=?;",
                     (count, status, payload.review_id))
        if removed:
            # 被举报下架 → 给作者发事件消息（数据保留，可申诉恢复）
            _rv_msg_push(conn, author_uid, "event", "你的评价因多次举报被下架",
                         f"你发布的一条评价（《{_rv_topic_name_by_review(conn, payload.review_id)}》）被举报达 {count} 次，已暂时下架。"
                         "如认为有误，请通过邮箱联系我们申诉。")
        conn.commit()
        # 举报只入管理页队列（达到入队阈值），不再推送微信
        _rv_maybe_notify(conn)
        return {"ok": True, "report_count": count, "status": status}
    finally:
        conn.close()


@app.delete("/vote/reviews/{review_id}")
def reviews_delete(review_id: int, request: Request):
    """作者删除自己的评价（软删，数据保留）。"""
    from accounts import _current_user  # noqa: E402
    user = _current_user(request)
    if not user:
        return JSONResponse({"detail": "需要登录"}, status_code=401)
    if not _same_origin(request):
        return JSONResponse({"detail": "拒绝跨站请求"}, status_code=403)
    conn = _connect()
    try:
        cur = conn.execute(
            "UPDATE reviews SET status='deleted_user' WHERE id=? AND author_uid=? AND status IN ('pending','approved','rejected');",
            (review_id, user["user_id"]))
        conn.commit()
        if cur.rowcount == 0:
            return JSONResponse({"detail": "评价不存在或无权删除"}, status_code=404)
        return {"ok": True}
    finally:
        conn.close()


# —— 管理端（复用 _require_admin 鉴权）——

def _rv_dup_hints(conn: sqlite3.Connection, topic_id: int) -> list[dict]:
    """某条目的疑似重复条目（norm_key 相同的其他 active 条目）。"""
    t = conn.execute("SELECT norm_key FROM review_topics WHERE id=?;", (topic_id,)).fetchone()
    if not t:
        return []
    rows = conn.execute(
        "SELECT id, name, source, status FROM review_topics WHERE norm_key=? AND id!=? AND status='active' LIMIT 5;",
        (t[0], topic_id)).fetchall()
    return [{"id": r[0], "name": r[1], "source": r[2]} for r in rows]


@app.get("/vote/admin/reviews/pending")
def admin_reviews_pending(request: Request, token: str | None = Query(default=None)):
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    conn = _connect()
    try:
        rows = conn.execute(
            _RV_REVIEW_ROW_SQL + "WHERE r.status='pending' ORDER BY r.ts ASC LIMIT 200;").fetchall()
        out = []
        for r in rows:
            d = _rv_review_dict(conn, r, None, with_user=True)
            d["dup_hints"] = _rv_dup_hints(conn, d["topic_id"])
            u = conn.execute("SELECT email, prefix, nickname FROM users WHERE id=?;", (r[10],)).fetchone()
            d["email"] = u[0] if u else ""
            d["prefix"] = (u[1] if u else "") or ""
            d["nickname"] = (u[2] if u else "") or ""
            out.append(d)
        return {"items": out, "pending": len(out)}
    finally:
        conn.close()


class ReviewModerateIn(BaseModel):
    id: int
    action: str = Field(max_length=16)  # approve/reject/remove/restore/delete_forever/topic_delete
    note: str = Field(default="", max_length=300)


@app.post("/vote/admin/reviews/moderate")
def admin_reviews_moderate(payload: ReviewModerateIn, request: Request,
                           token: str | None = Query(default=None)):
    """审核与治理动作。approve/reject（附可选驳回意见）；remove/restore（软删/恢复）；delete_forever 仅对已软删生效。"""
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    conn = _connect()
    try:
        r = conn.execute("SELECT id, status, author_uid FROM reviews WHERE id=?;", (payload.id,)).fetchone()
        if not r:
            return JSONResponse({"detail": "评价不存在"}, status_code=404)
        cur_status = r[1]
        author_uid = r[2]
        action = payload.action
        if action == "approve":
            conn.execute(
                "UPDATE reviews SET status='approved', approved_at=?, reject_note='' WHERE id=?;",
                (int(time.time()), payload.id))
        elif action == "reject":
            conn.execute(
                "UPDATE reviews SET status='rejected', reject_note=? WHERE id=?;",
                (payload.note.strip(), payload.id))
            _rv_msg_push(conn, author_uid, "event", "你的评价未通过审核",
                         f"你关于《{_rv_topic_name_by_review(conn, payload.id)}》的评价未通过审核，未公开展示。"
                         + (f"驳回意见：{payload.note.strip()}" if payload.note.strip() else "如有疑问请通过邮箱联系我们。")
                         + "欢迎修改内容后重新发表。")
        elif action == "remove":
            if cur_status != "approved":
                return JSONResponse({"detail": "仅已发布的评价可下架"}, status_code=422)
            conn.execute("UPDATE reviews SET status='removed_admin' WHERE id=?;", (payload.id,))
            _rv_msg_push(conn, author_uid, "event", "你的评价被管理员下架",
                         f"你关于《{_rv_topic_name_by_review(conn, payload.id)}》的评价已被管理员下架，暂不公开展示。"
                         "如认为有误，请通过邮箱联系我们申诉。")
        elif action == "restore":
            if cur_status not in ("removed_admin", "removed_report", "deleted_user"):
                return JSONResponse({"detail": "该评价不在软删状态"}, status_code=422)
            conn.execute("UPDATE reviews SET status='approved' WHERE id=?;", (payload.id,))
        elif action == "delete_forever":
            if not cur_status.startswith(("removed_", "deleted_", "rejected")):
                return JSONResponse({"detail": "请先下架再彻底删除"}, status_code=422)
            conn.execute("DELETE FROM reviews WHERE id=?;", (payload.id,))
            conn.execute("DELETE FROM review_reactions WHERE review_id=?;", (payload.id,))
            conn.execute("DELETE FROM review_reports WHERE review_id=?;", (payload.id,))
        else:
            return JSONResponse({"detail": "未知操作"}, status_code=422)
        conn.commit()
        # 审核清零后重置时效提醒标记与基准
        if action in ("approve", "reject", "remove", "delete_forever") and _rv_pending_count(conn) == 0:
            _set_meta(conn, "rv_stale_flag", "")
            _set_meta(conn, "rv_remind_base", f"0,{_rv_open_report_count(conn)}")
        return {"ok": True}
    finally:
        conn.close()


@app.get("/vote/admin/reviews/reports")
def admin_reviews_reports(request: Request, token: str | None = Query(default=None)):
    """举报队列：仅举报数达到入队阈值（rv_report_push_n）且未标记处理的评价（含自动软删的）。"""
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    conn = _connect()
    try:
        push_n = int(_rv_cfg(conn, "rv_report_push_n"))
        if push_n <= 0:
            return {"items": []}
        rows = conn.execute(
            _RV_REVIEW_ROW_SQL + f"WHERE r.report_count>={push_n} AND r.report_seen=0 "
            "AND r.status IN ('approved','removed_report') ORDER BY r.report_count DESC LIMIT 100;"
        ).fetchall()
        out = []
        for r in rows:
            d = _rv_review_dict(conn, r, None, with_user=True)
            d["reports"] = [
                {"reason": x[0], "ts": x[1]}
                for x in conn.execute(
                    "SELECT reason, ts FROM review_reports WHERE review_id=? ORDER BY ts;", (r[0],))
            ]
            out.append(d)
        return {"items": out}
    finally:
        conn.close()


@app.post("/vote/admin/reviews/reports/seen")
def admin_reviews_reports_seen(request: Request, id: int = Query(...),
                               token: str | None = Query(default=None)):
    """忽略举报（帖子保留，从举报队列消失；再次被举报会重新出现）。"""
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    conn = _connect()
    try:
        conn.execute("UPDATE reviews SET report_seen=1 WHERE id=?;", (id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


class RvAdminMsgIn(BaseModel):
    target_email: str = Field(default="", max_length=254)  # 空 = 全体公告
    title: str = Field(min_length=1, max_length=80)
    content: str = Field(default="", max_length=2000)


@app.post("/vote/admin/reviews/messages")
def admin_reviews_msg_send(payload: RvAdminMsgIn, request: Request,
                           token: str | None = Query(default=None)):
    """管理页发评价社区消息：全体公告或按邮箱定向私信。"""
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    conn = _connect()
    try:
        title = payload.title.strip()
        if not title:
            return JSONResponse({"detail": "标题不能为空"}, status_code=422)
        target_uid = None
        if payload.target_email.strip():
            u = conn.execute("SELECT id FROM users WHERE email=?;",
                             (payload.target_email.strip().lower(),)).fetchone()
            if not u:
                return JSONResponse({"detail": "该邮箱未注册"}, status_code=404)
            target_uid = u[0]
        _rv_msg_push(conn, target_uid, "system", title, payload.content.strip())
        conn.commit()
        return {"ok": True, "to_all": target_uid is None}
    finally:
        conn.close()


@app.get("/vote/admin/reviews/messages")
def admin_reviews_msg_list(request: Request, token: str | None = Query(default=None)):
    """已发消息列表（最近 100 条）。"""
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT m.id, m.target_uid, m.kind, m.title, m.content, m.ts, u.email "
            "FROM rv_msgs m LEFT JOIN users u ON u.id=m.target_uid "
            "ORDER BY m.ts DESC LIMIT 100;").fetchall()
        return {"items": [
            {"id": r[0], "to_all": r[1] is None, "kind": r[2], "title": r[3],
             "content": r[4], "ts": r[5], "target_email": r[6] or ""}
            for r in rows
        ]}
    finally:
        conn.close()


@app.get("/vote/admin/reviews/published")
def admin_reviews_published(request: Request, query: str = Query(default="", max_length=80),
                            token: str | None = Query(default=None)):
    """已发布/已下架评价管理（软删数据保留可查可恢复）。"""
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    conn = _connect()
    try:
        q = f"%{query.strip()}%"
        rows = conn.execute(
            _RV_REVIEW_ROW_SQL + "WHERE r.status IN ('approved','removed_admin','removed_report','deleted_user') "
            "AND (r.content LIKE ? OR t.name LIKE ?) ORDER BY r.approved_at DESC LIMIT 200;",
            (q, q)).fetchall()
        return {"items": [_rv_review_dict(conn, r, None, with_user=True) for r in rows]}
    finally:
        conn.close()


@app.get("/vote/admin/reviews/topic/dups")
def admin_reviews_topic_dups(request: Request, token: str | None = Query(default=None)):
    """疑似重复条目组：norm_key 相同且条目数 > 1 的分组（合并去重的候选，供一键合并）。"""
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    conn = _connect()
    try:
        keys = conn.execute(
            "SELECT norm_key FROM review_topics WHERE status='active' GROUP BY norm_key HAVING COUNT(*)>1;"
        ).fetchall()
        groups = []
        for (nk,) in keys:
            items = conn.execute(
                "SELECT t.id, t.name, t.source, t.initial, "
                "  (SELECT COUNT(*) FROM reviews r WHERE r.topic_id=t.id AND r.status='approved') "
                "FROM review_topics t WHERE t.norm_key=? AND t.status='active' ORDER BY t.id;", (nk,)).fetchall()
            groups.append({"items": [
                {"id": i[0], "name": i[1], "source": i[2], "initial": i[3], "review_count": i[4]}
                for i in items
            ]})
        return {"groups": groups}
    finally:
        conn.close()


@app.post("/vote/admin/reviews/topic/merge")
def admin_reviews_topic_merge(request: Request, from_id: int = Query(...), to_id: int = Query(...),
                              token: str | None = Query(default=None)):
    """合并重复条目：from 的评价挂到 to，from 标记 merged（软操作，可追溯）。"""
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    if from_id == to_id:
        return JSONResponse({"detail": "不能合并到自身"}, status_code=422)
    conn = _connect()
    try:
        src = conn.execute("SELECT id, status FROM review_topics WHERE id=?;", (from_id,)).fetchone()
        dst = conn.execute("SELECT id, status FROM review_topics WHERE id=?;", (to_id,)).fetchone()
        if not src or not dst or dst[1] != "active":
            return JSONResponse({"detail": "条目不存在或目标不可用"}, status_code=404)
        conn.execute("UPDATE reviews SET topic_id=? WHERE topic_id=?;", (to_id, from_id))
        conn.execute("UPDATE review_topics SET status='merged', merged_into=? WHERE id=?;", (to_id, from_id))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.get("/vote/admin/reviews/config")
def admin_reviews_config(request: Request, token: str | None = Query(default=None)):
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    conn = _connect()
    try:
        cfg = {k: _rv_cfg(conn, k) for k in _RV_CFG_DEFAULTS}
        pend = _rv_pending_count(conn)
        return {"config": cfg,
                "counts": {"pending": pend,
                           "open_reports": int(conn.execute(
                               "SELECT COUNT(*) FROM review_reports rr JOIN reviews r ON r.id=rr.review_id "
                               "WHERE r.report_seen=0 AND r.status IN ('approved','removed_report');").fetchone()[0])}}
    finally:
        conn.close()


class ReviewConfigIn(BaseModel):
    config: dict[str, float]


@app.post("/vote/admin/reviews/config")
def admin_reviews_config_save(payload: ReviewConfigIn, request: Request,
                              token: str | None = Query(default=None)):
    if not _require_admin(request, token):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    conn = _connect()
    try:
        for k, v in payload.config.items():
            if k not in _RV_CFG_DEFAULTS:
                return JSONResponse({"detail": f"未知配置项 {k}"}, status_code=422)
            try:
                fv = float(v)
            except (TypeError, ValueError):
                return JSONResponse({"detail": f"{k} 不是数字"}, status_code=422)
            if fv < 0:
                return JSONResponse({"detail": f"{k} 不能为负"}, status_code=422)
            _set_meta(conn, k, str(fv))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ---------- 账号系统（accounts.py，2026-11-14 P2） ----------
# 必须在主应用与全部工具函数定义完成后注册（accounts 内部延迟导入 main 的依赖），
# 故置于文件末尾；/vote/account/* 路由见 accounts.py。
from accounts import register_account_routes as _register_account_routes  # noqa: E402

_register_account_routes()
