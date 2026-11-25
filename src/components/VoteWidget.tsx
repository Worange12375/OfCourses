import {useCallback, useEffect, useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {getVoterId} from "../utils/voterId";
import {tierLabel} from "../utils/aiTierLabels";

// 投票后端地址：生产环境由 nginx 把 /vote 反代到本机 FastAPI 服务。
// 本地开发（vite）没有后端时，请求会失败，组件降级为「仅展示」不报错崩溃。
const API_BASE = "/vote";

type Phase = "loading" | "idle" | "voting" | "done" | "error";

const isDev = import.meta.env.DEV;

interface VoteState {
  count: number | null; // null = 统计不可用（后端不可用/被限流/已熔断），与"还没有人投票"区分
  phase: Phase;
  hover: number | null;
  myScore: number | null;
  msg: string;
  submit: (score: number) => void;
  setHover: (n: number | null) => void;
}

/** 单维度投票的全部状态与提交逻辑（review 单维 与 AI 四维共用） */
function useVote(topic: string): VoteState {
  const {locale} = useLocale();
  const zh = locale === "zh";

  const [count, setCount] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [hover, setHover] = useState<number | null>(null);
  const [myScore, setMyScore] = useState<number | null>(null);
  const [msg, setMsg] = useState<string>("");

  // 拉取当前统计（只取参与人数，均分不对外展示）
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/stats?topic=${topic}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: {count: number}) => {
        if (!alive) return;
        setCount(d.count);
        setPhase("idle");
      })
      .catch(() => {
        if (!alive) return;
        setCount(null);
        setPhase("idle"); // 后端不可用时降级，但不再伪装成"还没有人投票"
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

        // 409 = 真的投过票：锁定按钮，如实告知
        if (res.status === 409) {
          setPhase("done");
          setMyScore(typeof data.score === "number" ? data.score : score);
          setMsg(zh ? "你已经投过票了，感谢支持！" : "You have already voted. Thanks for the support!");
          return;
        }
        // 503 = 后端已熔断：功能临时关闭，不锁定，允许稍后重试
        if (res.status === 503) {
          setPhase("error");
          setMsg(
            zh
              ? "投票功能临时维护中，请稍后再来"
              : "Voting is temporarily under maintenance"
          );
          return;
        }
        // 429 = 被限流：票并未写入，绝不能显示"已投过"，且不锁定，保留重试机会
        if (res.status === 429) {
          setPhase("error");
          setMsg(zh ? "当前访问较集中，请稍后再试" : "Server is busy, please try again shortly");
          return;
        }
        // 其余错误：不锁定，如实提示失败
        if (!res.ok) {
          setPhase("error");
          setMsg(zh ? "提交失败，请稍后再试。" : "Submission failed. Please try again later.");
          return;
        }
        setMyScore(score);
        setPhase("done");
        if (typeof data.stats?.count === "number") setCount(data.stats.count);
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
    [phase, topic, zh]
  );

  return {count, phase, hover, myScore, msg, submit, setHover};
}

/** 1–5 分按钮组 */
const ScoreButtons = ({v}: {v: VoteState}) => {
  const locked = v.phase === "done";
  const active = v.hover ?? v.myScore ?? 0;
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = active >= n;
        const isMine = v.myScore === n;
        return (
          <button
            key={n}
            type="button"
            disabled={locked || v.phase === "voting"}
            onClick={() => v.submit(n)}
            onMouseEnter={() => !locked && v.setHover(n)}
            onMouseLeave={() => !locked && v.setHover(null)}
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
    </div>
  );
};

/** 维度下的状态/结果小字（不展示均分） */
const VoteMeta = ({v, thanks}: {v: VoteState; thanks?: boolean}) => {
  const {locale} = useLocale();
  const zh = locale === "zh";
  return (
  <span className="text-[11px] text-gray-500 dark:text-white/45">
    {v.phase === "loading" && (zh ? "加载中…" : "Loading…")}
    {v.phase !== "loading" && v.count !== null && v.count > 0 && !v.msg && (
      <span>{zh ? `已有 ${v.count} 人参与` : `${v.count} vote(s) so far`}</span>
    )}
    {v.phase !== "loading" && v.count === null && !v.msg && (
      <span>{zh ? "统计暂时无法加载" : "Stats unavailable right now"}</span>
    )}
    {v.phase !== "loading" && v.count === 0 && !v.msg && (
      <span>{zh ? "还没有人投票，来做第一个吧" : "No votes yet — be the first!"}</span>
    )}
    {v.msg && <span>{v.msg}</span>}
    {v.msg === "" && thanks && v.phase === "done" && (
      <span>{zh ? "感谢你的评分！" : "Thanks for your rating!"}</span>
    )}
  </span>
  );
};

/** 课程评价页的单维投票（topic=review） */
export const VoteWidget = ({topic}: {topic: string}) => {
  const {locale} = useLocale();
  const zh = locale === "zh";
  const v = useVote(topic);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <ScoreButtons v={v} />
        <span className="ml-1 text-[11px] text-gray-500 dark:text-white/45">
          {zh ? "（1 = 不太期待，5 = 非常期待）" : "(1 = not interested, 5 = can't wait)"}
        </span>
      </div>
      <div>
        <VoteMeta v={v} thanks />
      </div>

      {/* 投票后致谢 */}
      {v.phase === "done" && (
        <div className="mt-1 rounded-md bg-blue-500/10 px-3 py-2 text-[11px] leading-relaxed text-blue-700 dark:text-blue-300">
          {zh
            ? "感谢你的评分！如果有任何想法或建议，欢迎随时联系开发者——我们珍视你的每一条意见。"
            : "Thanks for rating! If you have any thoughts or suggestions, feel free to contact the developers — we truly value your feedback."}
        </div>
      )}
    </div>
  );
};

// —— AI 助手四维投票：各维度独立展示、独立即时提交、独立锁定（2026-09-29 用户定稿）——
// 没用过强模型的用户可以不投该维度，四个维度互不影响。
// 档位名用 tierLabel 动态取（管理页「模型配置」可改显示名称）。

export type AiVoteDimension = "ai_std" | "ai_strong" | "ai_speed" | "ai_overall";

const AI_DIMENSIONS: Array<{key: AiVoteDimension; label: (zh: boolean) => string}> = [
  {key: "ai_std", label: (zh) => `你对${tierLabel("flash", zh)}的整体满意程度`},
  {key: "ai_strong", label: (zh) => `你对${tierLabel("strong", zh)}的整体满意程度`},
  {key: "ai_speed", label: (zh) => `你对${tierLabel("flash", zh)}反应时间的接受程度`},
  {key: "ai_overall", label: (zh) => (zh ? "你对 AI 助手功能的整体满意程度" : "Overall satisfaction with the assistant's features")},
];

const AiVoteRow = ({dim, zh, last}: {dim: (typeof AI_DIMENSIONS)[number]; zh: boolean; last: boolean}) => {
  const v = useVote(dim.key);
  return (
    <div className={`flex flex-col gap-1.5 py-2.5 ${last ? "" : "border-b border-gray-100 dark:border-white/10"}`}>
      <div className="text-xs font-medium text-gray-700 dark:text-white/80">{dim.label(zh)}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ScoreButtons v={v} />
        <VoteMeta v={v} thanks />
      </div>
    </div>
  );
};

/** AI 助手页的四维投票 */
export const AiVoteWidget = () => {
  const {locale} = useLocale();
  const zh = locale === "zh";
  return (
    <div className="flex flex-col">
      {AI_DIMENSIONS.map((d, i) => (
        <AiVoteRow key={d.key} dim={d} zh={zh} last={i === AI_DIMENSIONS.length - 1} />
      ))}
      <div className="mt-1 text-[11px] text-gray-500 dark:text-white/45">
        {zh
          ? "（各维度均为 1~5 分：1 = 很不满意，5 = 非常满意；没用过的维度可以不投，各维度每人一票）"
          : "(Each dimension is rated 1-5: 1 = poor, 5 = excellent. Skip dimensions you haven't used; one vote per dimension.)"}
      </div>
    </div>
  );
};
