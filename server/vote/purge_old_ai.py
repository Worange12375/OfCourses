"""一次性脚本：清零旧单维 "ai" 投票数据（2026-09-29 四维投票上线）。
用法：/opt/ofcourses-vote/venv/bin/python /tmp/purge_old_ai.py
执行前先打印数量供确认，删除后输出删除条数。"""

import sqlite3

DB = "/var/lib/ofcourses-vote/votes.db"

c = sqlite3.connect(DB)
try:
    n = c.execute("SELECT COUNT(*) FROM votes WHERE topic='ai'").fetchone()[0]
    print(f"found {n} old 'ai' vote(s)")
    c.execute("DELETE FROM votes WHERE topic='ai'")
    c.commit()
    print(f"deleted {n} row(s); remaining topics:")
    for topic, cnt in c.execute("SELECT topic, COUNT(*) FROM votes GROUP BY topic;"):
        print(f"  {topic}: {cnt}")
finally:
    c.close()
