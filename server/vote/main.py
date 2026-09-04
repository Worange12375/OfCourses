"""
OfCourses 未来功能投票后端（极简、无个人信息、只读统计 + 一次性提交）

设计要点：
  - 存储：SQLite（/var/lib/ofcourses-vote/votes.db），只存 匿名设备ID / 主题 / 分值 / 时间 / IP哈希
  - 去重：同一 (voter_id, topic) 只允许投一次（一票定终身），重复提交返回 409
  - 限流：内存中对来源 IP 做滑动窗口（默认 20 次/小时），防脚本轰炸
  - 隐私：不存明文 IP，只存 sha256(ip + 固定盐) 的前 16 位用于粗略去重
  - 安全：无鉴权、无删改接口；仅暴露 /vote/stats、/vote/submit、/vote/healthz
  - 管理：/vote/admin 与 /vote/admin/export 受 VOTE_ADMIN_TOKEN 保护，不向公众暴露

运行（由 systemd 托管，监听 127.0.0.1:8002，由 nginx 反代 /vote/）：
    uvicorn main:app --host 127.0.0.1 --port 8002
"""

import csv
import hmac
import io
import os
import sqlite3
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response
from pydantic import BaseModel, Field

# ---------- 配置 ----------
DB_PATH = os.environ.get("VOTE_DB_PATH", "/var/lib/ofcourses-vote/votes.db")
IP_SALT = os.environ.get("VOTE_IP_SALT", "ofcourses-vote-salt-change-me")
ADMIN_TOKEN = os.environ.get("VOTE_ADMIN_TOKEN")
ALLOWED_TOPICS = {"ai", "review"}
RATE_LIMIT_PER_HOUR = int(os.environ.get("VOTE_RATE_LIMIT", "20"))  # 单 IP 每小时请求上限
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


def _client_ip(request: Request) -> str:
    # 仅信任 nginx 传入的 X-Forwarded-For 首段（nginx 会覆盖客户端伪造值）
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(ip: str) -> bool:
    now = time.time()
    window = 3600.0
    q = _ip_hits[ip]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= RATE_LIMIT_PER_HOUR:
        return True
    q.append(now)
    return False


def _ip_hash(ip: str) -> str:
    return hashlib.sha256((IP_SALT + ip).encode("utf-8")).hexdigest()[:16]


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
    conn.commit()
    return conn


def _stats(conn: sqlite3.Connection, topic: str) -> dict:
    cur = conn.execute("SELECT COUNT(*), COALESCE(AVG(score), 0) FROM votes WHERE topic = ?;", (topic,))
    count, avg = cur.fetchone()
    return {"count": int(count), "avg": round(float(avg), 2)}


# ---------- 接口 ----------
class VoteIn(BaseModel):
    topic: str
    score: int = Field(ge=1, le=5)
    voter_id: str = Field(min_length=8, max_length=128)


@app.get("/vote/stats")
def stats(topic: str, request: Request):
    if _rate_limited(_client_ip(request)):
        return JSONResponse({"detail": "rate limited"}, status_code=429)
    if topic not in ALLOWED_TOPICS:
        return JSONResponse({"detail": "unknown topic"}, status_code=400)
    conn = _connect()
    try:
        return _stats(conn, topic)
    finally:
        conn.close()


@app.post("/vote/submit")
def submit(payload: VoteIn, request: Request):
    ip = _client_ip(request)
    if _rate_limited(ip):
        return JSONResponse({"detail": "rate limited"}, status_code=429)
    if payload.topic not in ALLOWED_TOPICS:
        return JSONResponse({"detail": "unknown topic"}, status_code=400)

    conn = _connect()
    try:
        existing = conn.execute(
            "SELECT score FROM votes WHERE voter_id = ? AND topic = ?;",
            (payload.voter_id, payload.topic),
        ).fetchone()
        if existing:
            # 一票定终身：已投过则拒绝修改
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
        return {"ok": True, "stats": _stats(conn, payload.topic)}
    finally:
        conn.close()


# ---------- 管理后台 ----------
def _check_admin_token(token: str | None) -> bool:
    """恒定时间比较，防止时序攻击"""
    if not ADMIN_TOKEN or not token:
        return False
    return hmac.compare_digest(ADMIN_TOKEN, token)


def _stats_with_distribution(conn: sqlite3.Connection, topic: str) -> dict:
    total = _stats(conn, topic)
    dist = {}
    for score in range(1, 6):
        cur = conn.execute(
            "SELECT COUNT(*) FROM votes WHERE topic = ? AND score = ?;",
            (topic, score),
        )
        dist[score] = cur.fetchone()[0]
    return {"count": total["count"], "avg": total["avg"], "distribution": dist}


@app.get("/vote/admin", response_class=HTMLResponse)
def admin_page(token: str | None = Query(default=None)):
    if not _check_admin_token(token):
        raise HTTPException(status_code=401, detail="unauthorized")
    conn = _connect()
    try:
        ai = _stats_with_distribution(conn, "ai")
        review = _stats_with_distribution(conn, "review")
        cur = conn.execute(
            """
            SELECT topic, score, ip_hash, ts, ua
            FROM votes
            ORDER BY ts DESC
            LIMIT 50;
            """
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    def _topic_label(t: str) -> str:
        return {"ai": "AI 推荐助手", "review": "课程评价"}.get(t, t)

    def _bar(score: int, count: int, total: int) -> str:
        pct = round(count / total * 100, 1) if total else 0
        return (
            f'<div class="bar-row"><span class="bar-label">{score} 分</span>'
            f'<div class="bar-track"><div class="bar-fill" style="width:{pct}%"></div></span>'
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

    export_url = f"/vote/admin/export?token={token}"
    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>OfCourses 投票管理后台</title>
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
.header {{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }}
a.download {{
    display: inline-block; padding: 6px 12px; border-radius: 6px;
    background: #4f46e5; color: #fff; text-decoration: none; font-size: 13px;
}}
.grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 24px; }}
.card {{
    background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 16px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}}
.card h2 {{ margin: 0 0 12px; font-size: 16px; }}
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
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>OfCourses 投票管理后台</h1>
        <a class="download" href="{export_url}">下载 CSV</a>
    </div>
    <div class="grid">
        <div class="card">
            <h2>{_topic_label("ai")}</h2>
            <div class="summary">
                <div>参与人数<strong>{ai["count"]}</strong></div>
                <div>平均分<strong>{ai["avg"]}</strong></div>
            </div>
            {''.join(_bar(s, ai["distribution"][s], ai["count"]) for s in range(1,6))}
        </div>
        <div class="card">
            <h2>{_topic_label("review")}</h2>
            <div class="summary">
                <div>参与人数<strong>{review["count"]}</strong></div>
                <div>平均分<strong>{review["avg"]}</strong></div>
            </div>
            {''.join(_bar(s, review["distribution"][s], review["count"]) for s in range(1,6))}
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


@app.get("/vote/healthz")
def healthz():
    return {"ok": True}
