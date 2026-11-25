"""本地演示数据种子（可反复跑；重置请先删除 _demo.db）。仅供本地联调，勿用于生产。"""
import time

import accounts
import main

now = int(time.time())
DAY = 86400
PW = "Demo123456"


def reset_db() -> None:
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)


import os  # noqa: E402

DB_PATH = os.environ["VOTE_DB_PATH"]


def mk_user(email: str, prefix: str, nickname: str, nick_change_days_ago: float | None = None) -> int:
    c = main._connect()
    try:
        c.execute(
            "INSERT INTO users (email, prefix, nickname, pass_hash, cohort, ts, last_nick_change) "
            "VALUES (?, ?, ?, ?, '2024', ?, ?);",
            (email, prefix, nickname, accounts._hash_pw(PW), now,
             int(now - nick_change_days_ago * DAY) if nick_change_days_ago else 0))
        uid = c.execute("SELECT last_insert_rowid();").fetchone()[0]
        c.commit()
        return uid
    finally:
        c.close()


def topic_id_by_name(name: str) -> int:
    c = main._connect()
    try:
        row = c.execute("SELECT id FROM review_topics WHERE name=? AND status='active';", (name,)).fetchone()
        if row:
            return row[0]
        like = c.execute("SELECT id FROM review_topics WHERE name LIKE ? AND status='active' ORDER BY id LIMIT 1;",
                         (name[:4] + "%",)).fetchone()
        if like:
            print(f"  [seed] '{name}' 未精确命中，回退到 id={like[0]}")
            return like[0]
        any_row = c.execute("SELECT id FROM review_topics WHERE status='active' ORDER BY id LIMIT 1;").fetchone()
        print(f"  [seed] '{name}' 未命中，使用任意条目 id={any_row[0]}")
        return any_row[0]
    finally:
        c.close()


def add_review(uid: int, topic: int, content: str, sign: str, age_days: float,
               status: str = "approved", reject_note: str = "") -> int:
    c = main._connect()
    try:
        ts = int(now - age_days * DAY)
        c.execute(
            "INSERT INTO reviews (topic_id, content, author_uid, sign, status, reject_note, ts, approved_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
            (topic, content, uid, sign, status, reject_note, ts, ts if status == "approved" else 0))
        rid = c.execute("SELECT last_insert_rowid();").fetchone()[0]
        c.commit()
        return rid
    finally:
        c.close()


def react(uid: int, rid: int, rtype: str) -> None:
    c = main._connect()
    try:
        c.execute("INSERT OR IGNORE INTO review_reactions (review_id, uid, type, ts) VALUES (?, ?, ?, ?);",
                  (rid, uid, rtype, now))
        c.commit()
    finally:
        c.close()


def send_msg(target_uid, kind, title, content, age_h: float) -> None:
    c = main._connect()
    try:
        c.execute("INSERT INTO rv_msgs (target_uid, kind, title, content, ts) VALUES (?, ?, ?, ?, ?);",
                  (target_uid, kind, title, content, int(now - age_h * 3600)))
        c.commit()
    finally:
        c.close()


main._rv_ensure_official()

u1 = mk_user("demo1@mails.tsinghua.edu.cn", "demo1", "晚风轻起", nick_change_days_ago=3)
u2 = mk_user("demo2@mails.tsinghua.edu.cn", "demo2", "山止川行")
u3 = mk_user("demo3@mails.tsinghua.edu.cn", "demo3", "栗子同学")

t_re = topic_id_by_name("工程热力学")
t_ds = topic_id_by_name("数据结构")
t_prob = topic_id_by_name("概率论与数理统计")
t_phy = topic_id_by_name("大学物理B(1)")
t_train = topic_id_by_name("工程训练1")

r1 = add_review(u2, t_re, "老师讲得非常清晰，作业量适中，期末以大作业为主给分不错。配套的习题课很有帮助，强烈推荐！", "nick", 2)
r2 = add_review(u3, t_re, "内容硬核但讲义写得好，跟着走没问题。给分风格偏宽松，认真完成作业就有不错的成绩。", "real", 6)
react(u1, r1, "like"); react(u1, r1, "useful"); react(u3, r1, "like"); react(u2, r1, "watch")
react(u1, r2, "like"); react(u2, r2, "useful")
r3 = add_review(u1, t_phy, "这门课的任务量是真的重，每周实验报告写到深夜，给分也一般，选课前请做好心理准备。", "nick", 30)
react(u2, r3, "doubt"); react(u3, r3, "unuseful"); react(u1, r3, "watch")
r4 = add_review(u1, t_ds, "项目作业很有挑战性，助教负责，答疑及时。考核以编程项目为主，动手能力提升明显。", "real", 12)
react(u2, r4, "like"); react(u3, r4, "useful"); react(u2, r4, "useful")
r5 = add_review(u3, t_prob, "概念讲解清楚，例题选得好，考试不超纲。建议配合课后习题巩固。", "nick", 50)
react(u1, r5, "like")
r6 = add_review(u2, t_train, "动手环节有趣，钳工和 3D 打印体验不错，报告别拖到最后交。", "nick", 80)
react(u1, r6, "like"); react(u3, r6, "watch")

c = main._connect()
c.execute("INSERT INTO review_topics (source, course_id, name, norm_key, initial, status, created_by, ts) "
          "VALUES ('custom', NULL, '综合论文', ?, 'Z', 'active', ?, ?);",
          (main._rv_norm_key("综合论文"), u1, now))
t_thesis = c.execute("SELECT last_insert_rowid();").fetchone()[0]
c.commit()
c.close()
r7 = add_review(u2, t_thesis, "选题阶段多和导师沟通，中期检查前把实验框架搭好会轻松很多，写作规范提前看模板。", "real", 9)
react(u1, r7, "useful"); react(u3, r7, "like")

add_review(u1, t_ds, "这门课我在读期间的体验记录，等待审核展示。", "nick", 0.2, status="pending")
add_review(u1, t_prob, "期中之后节奏明显加快，建议提前规划时间。", "nick", 5, status="rejected",
           reject_note="表述过于简略，请补充具体内容后重新发表")

send_msg(None, "system", "欢迎来到课程评价社区", "大家可以在这里分享真实上课体验，所有评价先审后显。祝选课顺利！", 20)
send_msg(u1, "event", "你的评价未通过审核",
         "你关于《概率论与数理统计》的评价未通过审核，未公开展示。驳回意见：表述过于简略，请补充具体内容后重新发表。", 5)
send_msg(u1, "system", "月榜更新提醒", "本期热度月榜已更新，快来看看大家推荐的好课吧。", 2)

print(f"seed done: demo1/demo2/demo3（密码 {PW}），users u1={u1} u2={u2} u3={u3}")
