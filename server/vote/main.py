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
import io
import os
import sqlite3
import time
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field

# ---------- 配置 ----------
DB_PATH = os.environ.get("VOTE_DB_PATH", "/var/lib/ofcourses-vote/votes.db")
IP_SALT = os.environ.get("VOTE_IP_SALT", "ofcourses-vote-salt-change-me")
ADMIN_TOKEN = os.environ.get("VOTE_ADMIN_TOKEN")
SCT_KEY = os.environ.get("VOTE_SCT_KEY")  # Server酱 SendKey，留空则不推送

ALLOWED_TOPICS = {"ai", "review"}

# 限流阈值（分档）
RATE_STATS_PER_HOUR = int(os.environ.get("VOTE_STATS_RATE", "600"))
RATE_SUBMIT_IP_PER_HOUR = int(os.environ.get("VOTE_SUBMIT_IP_RATE", "100"))
RATE_SUBMIT_VOTER_PER_HOUR = int(os.environ.get("VOTE_SUBMIT_VOTER_RATE", "5"))
RATE_TRACK_PER_HOUR = int(os.environ.get("VOTE_TRACK_RATE", "300"))

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
    for bucket in (_ip_hits, _voter_hits):
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


# ---------- 管理后台 ----------
def _check_admin_token(token: str | None) -> bool:
    """恒定时间比较，防止时序攻击"""
    if not ADMIN_TOKEN or not token:
        return False
    return hmac.compare_digest(ADMIN_TOKEN, token)


def _topic_label(t: str) -> str:
    return {"ai": "AI 推荐助手", "review": "课程评价"}.get(t, t)


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


@app.get("/vote/admin", response_class=HTMLResponse)
def admin_page(token: str | None = Query(default=None)):
    if not _check_admin_token(token):
        raise HTTPException(status_code=401, detail="unauthorized")
    conn = _connect()
    try:
        ai = _stats_with_distribution(conn, "ai")
        review = _stats_with_distribution(conn, "review")
        cur = conn.execute(
            "SELECT topic, score, ip_hash, ts, ua FROM votes ORDER BY ts DESC LIMIT 50;"
        )
        rows = cur.fetchall()
        site = _site_stats(conn)
        tripped = _circuit_open(conn)
        reason = _get_meta(conn, "circuit_reason")
        trip_ts = _get_meta(conn, "circuit_ts")
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

    export_url = f"/vote/admin/export?token={token}"
    html = f"""<!doctype html>
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
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>OfCourses 管理后台</h1>
        <a class="download" href="{export_url}">下载投票 CSV</a>
    </div>

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

    <div class="section-title">功能投票</div>
    <div class="grid">
        <div class="card">
            <h2>{_topic_label("ai")}</h2>
            <div class="summary">
                <div>参与人数<strong>{ai["count"]}</strong></div>
                <div>平均分<strong>{ai["avg"]}</strong></div>
            </div>
            {''.join(_bar(s, ai["distribution"][s], ai["count"]) for s in range(1, 6))}
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
</body>
</html>"""
    return html


@app.get("/vote/admin/resume")
def admin_resume(token: str | None = Query(default=None)):
    """管理员核对数据后手动解除熔断"""
    if not _check_admin_token(token):
        raise HTTPException(status_code=401, detail="unauthorized")
    conn = _connect()
    try:
        _set_meta(conn, "circuit_open", "0")
        # 记录恢复时刻：异常检测此后从该时刻重新计起，避免被同一批历史数据立刻再次熔断
        _set_meta(conn, "circuit_resume_ts", str(int(time.time())))
    finally:
        conn.close()
    return RedirectResponse(url=f"/vote/admin?token={token}")


@app.get("/vote/admin/export")
def admin_export(token: str | None = Query(default=None)):
    if not _check_admin_token(token):
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
