import {useCallback, useEffect, useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {getVoterId} from "../utils/voterId";

// 投票后端地址：生产环境由 nginx 把 /vote 反代到本机 FastAPI 服务。
// 本地开发（vite）没有后端时，请求会失败，组件降级为「仅展示」不报错崩溃。
const API_BASE = "/vote";

export type VoteTopic = "ai" | "review";

interface Stats {
  count: number;
  avg: number;
}

type Phase = "loading" | "idle" | "voting" | "done" | "error";

const isDev = import.meta.env.DEV;

export const VoteWidget = ({topic}: {topic: VoteTopic}) => {
  const {locale} = useLocale();
  const zh = locale === "zh";

  const [stats, setStats] = useState<Stats | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [hover, setHover] = useState<number | null>(null);
  const [myScore, setMyScore] = useState<number | null>(null);
  const [msg, setMsg] = useState<string>("");

  // 拉取当前统计
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/stats?topic=${topic}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Stats) => {
        if (!alive) return;
        setStats(d);
        setPhase("idle");
      })
      .catch(() => {
        if (!alive) return;
        setPhase("idle"); // 后端不可用时静默降级，不阻塞页面
      });
    return () => {
      alive = false;
    };
  }, [topic]);

  const submit = useCallback(
    async (score: number) => {
      if (phase === "voting" || phase === "done") return;
      setPhase("voting");
      setMsg("");
      try {
        const res = await fetch(`${API_BASE}/submit`, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({topic, score, voter_id: getVoterId()}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // 已投过票：后端返回 409，前端锁定并给出提示
          setPhase("done");
          setMyScore(typeof data.score === "number" ? data.score : score);
          setMsg(zh ? "你已经投过票了，感谢支持！" : "You have already voted. Thanks for the support!");
          return;
        }
        setMyScore(score);
        setPhase("done");
        setStats(typeof data.stats?.count === "number" ? data.stats : stats);
      } catch {
        setPhase("error");
        setMsg(
          isDev
            ? zh
              ? "本地开发环境未连接投票后端，提交未生效。"
              : "Vote backend is not connected in local dev; submission did not take effect."
            : zh
              ? "提交失败，请稍后再试。"
              : "Submission failed. Please try again later."
        );
      }
    },
    [phase, stats, topic, zh]
  );

  const locked = phase === "done";
  const active = hover ?? myScore ?? 0;

  return (
    <div className="flex flex-col gap-2">
      {/* 1–5 分 */}
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = active >= n;
          const isMine = myScore === n;
          return (
            <button
              key={n}
              type="button"
              disabled={locked || phase === "voting"}
              onClick={() => submit(n)}
              onMouseEnter={() => !locked && setHover(n)}
              onMouseLeave={() => !locked && setHover(null)}
              className={`h-8 w-8 rounded-md border text-xs font-semibold transition-all ${
                locked && !isMine
                  ? "cursor-default border-gray-300/40 text-gray-400/50 dark:border-white/10 dark:text-white/25"
                  : "cursor-pointer"
              } ${
                !locked && on
                  ? "border-blue-500 bg-blue-500 text-white"
                  : !locked
                    ? "border-gray-300 text-gray-600 hover:border-blue-400 dark:border-white/20 dark:text-white/70"
                    : ""
              } ${isMine ? "border-blue-500 bg-blue-500 text-white" : ""}`}
            >
              {n}
            </button>
          );
        })}
        <span className="ml-1 text-[11px] text-gray-500 dark:text-white/45">
          {zh ? "（1 = 不太期待，5 = 非常期待）" : "(1 = not interested, 5 = can't wait)"}
        </span>
      </div>

      {/* 统计 / 结果提示 */}
      <div className="text-[11px] text-gray-500 dark:text-white/50">
        {phase === "loading" && (zh ? "加载中…" : "Loading…")}
        {phase !== "loading" && stats && stats.count > 0 && (
          <span>
            {zh
              ? `已有 ${stats.count} 人参与`
              : `${stats.count} vote(s) so far`}
          </span>
        )}
        {phase !== "loading" && (!stats || stats.count === 0) && !msg && (
          <span>{zh ? "还没有人投票，来做第一个吧" : "No votes yet — be the first"}</span>
        )}
        {msg && <span>{msg}</span>}
      </div>

      {/* 投票后致谢 */}
      {locked && (
        <div className="mt-1 rounded-md bg-blue-500/10 px-3 py-2 text-[11px] leading-relaxed text-blue-700 dark:text-blue-300">
          {zh
            ? "感谢你的评分！如果有任何想法或建议，欢迎随时联系开发者——我们珍视你的每一条意见。"
            : "Thanks for rating! If you have any thoughts or suggestions, feel free to contact the developers — we truly value your feedback."}
        </div>
      )}
    </div>
  );
};
