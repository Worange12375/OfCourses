import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getVisitorId } from "../utils/visitorId";
import {
  loadWorkspaceContext,
  loadManualContext,
  saveManualContext,
  parseHistoryJson,
  type AiUserData,
} from "../utils/aiContext";
import { buildRecContext, REC_MAX_ITEMS_STRONG, REC_SEMESTERS, defaultTargetSemester, inferDirection, detectStatedDirection, directionLabel, type RecDirection } from "../utils/recommend";
import { buildDegreeEvalText } from "../utils/degreeEval";
import { saveAiDisplay, tierLabel } from "../utils/aiTierLabels";
import { useAccount } from "../account/AccountContext";
import { useSemester } from "../hooks/SemesterContext";
import { useTName } from "../hooks/useCurriculumData";

// AI 推荐助手：对话式 UI。
// - 会话保存在浏览器 localStorage，仅保留 30 分钟（页内显著提示）；服务器不保存任何对话内容；
// - 每次请求最多携带最近 5 轮历史（服务端还会再截断）；
// - 首次使用需在声明弹窗同意（可选"不同意"，不同意则无法使用；localStorage 记忆选择）；
// - 回复语言跟随站点中英文状态（lang 字段传给后端注入 system prompt）；
// - 流式输出 + 思考过程（reasoning_content）展示，灰色斜体、正文开始后自动折叠；
// - 支持导出对话为 txt（文末自动附使用声明全文）。

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

interface QuotaInfo {
  used: number;
  limit: number;
  ip_exhausted: boolean;
  token_exhausted: boolean;
  enabled: boolean;
  models?: { flash: string; strong: string | null };
  display?: { flash: string; strong: string };
  strong?: {
    enabled: boolean;
    used_valid: number;
    limit_count: number;
    user_tokens_used: number;
    user_tokens_limit: number;
    user_exhausted: boolean;
    global_exhausted: boolean;
    tokens_used: number;   // 全站强模型今日已用 token（当前代次）
    tokens_cap: number;    // 全站强模型日上限（0=不限）
  };
  disclaimer?: { ver: number; zh: string; en: string };
}

type ModelTier = "flash" | "strong";
const TIER_KEY = "oc_ai_tier"; // 用户选择的模型档位（flash=标准档 / strong=高级档）

// 弱模型档免责声明：回复完成后由前端追加在正文末尾（不进上下文、不耗 token，导出 txt 同步附带）。
// 档位名随管理页「模型配置」的显示名称动态替换（strong 名随管理页变化，flash 名为当前档自称）。
const flashDisclaimer = (zh: boolean): string =>
  zh
    ? `（由于本模型能力有限，分析有概率存在错误，请仔细甄别；您可以通过这些方式得到更好的回答质量：（1）表达清晰您的需求并适当降低所问问题的开放性（2）降低单次对话的解答期望，分多次询问（3）更换使用“${tierLabel("strong", true)}”。祝您生活愉快！）`
    : `(This ${tierLabel("flash", false)} model has limited capability and may occasionally make mistakes. Please double-check its output. For better answer quality: (1) state your needs clearly and make your question less open-ended, (2) lower your expectations for a single reply and ask in multiple rounds, (3) switch to the "${tierLabel("strong", false)}". Have a great day!)`;

const DISCLAIMER_KEY = "oc_ai_disclaimer_v2"; // "1"=已同意 "0"=已拒绝
const SIGNED_VER_KEY = "oc_ai_disclaimer_ver"; // 已签署的声明版本号（服务端 ver；-1=签署时版本未知）
const HISTORY_KEY = "oc_ai_chat_v1";          // 本地对话记录（30 分钟有效）
const HISTORY_TTL_MS = 30 * 60 * 1000;        // 30 分钟
const MAX_HISTORY_MSGS = 10;                  // 5 轮历史 + 当前提问
const SAVE_THROTTLE_MS = 800;                 // 流式期间本地保存节流

type Phase = "idle" | "loading" | "streaming";

// —— 正式版使用声明（与 local/helper/scheme/AI助手使用声明.txt 保持同步）——
interface DisclaimerSection {
  h: string;
  body: string;
}

const disclaimerSections = (zh: boolean): DisclaimerSection[] =>
  zh
    ? [
        {
          h: "一、服务性质与准确性",
          body: "本助手由大语言模型驱动，仅基于本站收录的培养方案与课程数据作答。AI 可能出现理解偏差、数据引用错误或推荐不当，所有输出仅供参考，不构成正式的学业规划建议；选课操作与毕业审核请一律以清华大学教务及笃实书院的最新官方通知为准。",
        },
        {
          h: "二、回答范围",
          body: "本助手仅回答与培养方案、课程信息、选课规则、学位评定及本站功能相关的问题；超出范围的问题，助手会如实告知无法作答。",
        },
        {
          h: "三、隐私保护",
          body: "本助手不收集、不保存你的任何对话内容。对话仅保存在你的浏览器本地（30 分钟内），刷新页面不会丢失，超时自动清除；服务器不保存任何对话文本，也不采集明文 IP。",
        },
        {
          h: "四、使用额度",
          body: `AI 调用消耗站长自费购买的 API 额度。${tierLabel("flash", true)}每位用户每日有提问次数上限；${tierLabel("strong", true)}按 token 用量计费，设有人均每日限额。额度用尽后次日自动恢复，请合理使用；若因脚本刷取等滥用行为造成额外消耗，由行为人自行承担相应责任。`,
        },
        {
          h: "五、数据与算法说明",
          body: "个性化推荐与学位进度分析基于本站推荐算法、学位评定算法对你的选课数据的计算结果，模型负责解读与组织这些结果；算法未能覆盖的场景，模型会如实说明而非编造。你上传的选课数据仅随单次提问发送，服务器不落库。",
        },
        {
          h: "六、声明的效力",
          body: "使用本助手即表示你已阅读、理解并同意本声明。本声明可能随功能调整而更新；重要变更会要求你重新阅读并签署。",
        },
      ]
    : [
        {
          h: "1. Nature of Service & Accuracy",
          body: "This assistant is powered by a large language model and answers solely based on the curriculum and course data collected on this site. The AI may misinterpret questions, cite incorrect data, or give inappropriate recommendations. All output is for reference only and does not constitute formal academic-planning advice; course registration and degree audits must follow the latest official notices from Tsinghua University and Dushi College.",
        },
        {
          h: "2. Scope of Answers",
          body: "The assistant only answers questions related to the curriculum, course information, registration rules, degree evaluation, and the features of this site. For anything beyond this scope, it will honestly tell you it cannot help.",
        },
        {
          h: "3. Privacy",
          body: "This assistant does not collect or store any of your conversation content on the server. Conversations are kept only in your browser's local storage for 30 minutes — they survive page refreshes and are cleared automatically afterwards. The server records only anonymous counts of calls and resource consumption (for rate limiting and quota management) — never conversation text or plaintext IP addresses.",
        },
        {
          h: "4. Usage Quota",
          body: `AI calls consume API quota purchased at the site owner's own expense. The ${tierLabel("flash", false)} model has a daily question limit per user; the ${tierLabel("strong", false)} model is metered by token usage with a per-user daily allowance. Quotas reset automatically the next day. Please use responsibly; any extra costs caused by abusive behavior such as scripted flooding shall be borne by the actor.`,
        },
        {
          h: "5. Data & Algorithms",
          body: "Personalized recommendations and degree-progress analysis are based on results computed by this site's recommendation and degree-evaluation algorithms applied to your course record; the model interprets and organizes these results. Where the algorithms cannot help, the model will say so honestly instead of inventing answers. Your uploaded data is attached to individual requests only and is never stored on the server.",
        },
        {
          h: "6. Effect of This Disclaimer",
          body: "By using this assistant you confirm that you have read, understood, and accepted this disclaimer. It may be updated as features evolve; significant changes will ask you to review and accept it again.",
        },
      ];

// 管理端自定义声明解析：# 开头的行 = 小节标题，其余 = 正文（按空行/换行合并）；空内容回退内置默认
function parseDisclaimerText(text: string): DisclaimerSection[] {
  const out: DisclaimerSection[] = [];
  let cur: DisclaimerSection | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      cur = { h: line.replace(/^#+\s*/, ""), body: "" };
      out.push(cur);
    } else if (cur) {
      cur.body = cur.body ? `${cur.body} ${line}` : line;
    } else {
      cur = { h: "", body: line };
      out.push(cur);
    }
  }
  return out;
}

// 从 localStorage 读取 30 分钟内的本地对话记录
const loadLocalHistory = (): ChatMsg[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const obj = JSON.parse(raw) as { ts: number; msgs: ChatMsg[] };
    if (!obj || !Array.isArray(obj.msgs)) return [];
    if (Date.now() - (obj.ts || 0) > HISTORY_TTL_MS) {
      localStorage.removeItem(HISTORY_KEY);
      return [];
    }
    return obj.msgs.filter((m) => m && (m.role === "user" || m.role === "assistant"));
  } catch {
    return [];
  }
};

const saveLocalHistory = (msgs: ChatMsg[]) => {
  try {
    if (msgs.length === 0) {
      localStorage.removeItem(HISTORY_KEY);
    } else {
      localStorage.setItem(HISTORY_KEY, JSON.stringify({ ts: Date.now(), msgs }));
    }
  } catch {
    /* 存储不可用时静默 */
  }
};

const pad2 = (n: number) => String(n).padStart(2, "0");

// —— 429 等待安慰文案：超过 20 秒后显示，每 20 秒换一条 ——
const COMFORT_ZH = [
  "慢慢来，选课咱得慢慢规划～",
  "别急，模型刚刚说了很多，正在吃润喉糖……",
  "模型在培养方案的星海里为你捞课程，快了快了。",
  "它正在翻自己的课表小本本，马上就来。",
  "这段等待刚好够你回忆一下微积分A(1)学了啥。",
  "服务器正在努力搬砖——砖是知识做的。",
  "深呼吸，比选课更难的事你都挺过来了。",
];
const COMFORT_EN = [
  "Hang tight — good planning takes a moment…",
  "The model just said a lot and is sipping some throat tea…",
  "It's sprinting through the curriculum database for you…",
  "Almost there — your plan will be worth the wait.",
];

const comfortText = (waited: number, zh: boolean): string => {
  const list = zh ? COMFORT_ZH : COMFORT_EN;
  if (waited < 20) return "";
  return list[Math.floor((waited - 20) / 20) % list.length];
};

export default function AiAssistant({
  locale,
  isDark,
}: {
  locale: string;
  isDark: boolean;
}) {
  const zh = locale === "zh";
  const { semester: currentSemester } = useSemester(); // 当前学期：区分已修/在修/预选
  const { tSemester } = useTName(); // 学期名中英文（下拉框选项适配）
  const { user, schemes, currentSchemeId, fetchSchemeData } = useAccount(); // 云端方案数据源
  const [agreed, setAgreed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISCLAIMER_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [declined, setDeclined] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISCLAIMER_KEY) === "0";
    } catch {
      return false;
    }
  });
  const [showModal, setShowModal] = useState<boolean>(false); // 只在用户尝试发送且需要签署时弹出，不进页自动弹
  // 使用声明：管理端自定义文本（空 = 用内置默认）与版本号（用于"要求重新签署"）
  const [disclaimerOverride, setDisclaimerOverride] = useState<{ zh: string; en: string } | null>(null);
  const [signedVer, setSignedVer] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(SIGNED_VER_KEY);
      return v === null ? null : Number(v);
    } catch {
      return null;
    }
  });
  const [showTutorial, setShowTutorial] = useState(false); // 简易使用教程弹层
  const [messages, setMessages] = useState<ChatMsg[]>(() => loadLocalHistory());
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [waitInfo, setWaitInfo] = useState<number | null>(null); // 上游 429 等待中：已等待秒数
  const [toolHint, setToolHint] = useState<string>(""); // 工具调用中：给用户的进行时提示
  // 模型档位：flash 低级档（默认，快且省）/ strong 高级档（强模型，独立限额）。本地记住选择。
  const [tier, setTier] = useState<ModelTier>(() => {
    try {
      return localStorage.getItem(TIER_KEY) === "strong" ? "strong" : "flash";
    } catch {
      return "flash";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TIER_KEY, tier);
    } catch {
      /* ignore */
    }
  }, [tier]);
  const [thinkOpen, setThinkOpen] = useState<Record<number, boolean>>({});
  // —— 个人选课数据（工作台自动关联 或 上传 JSON），随提问发给模型、服务器不落库 ——
  const [ctxData, setCtxData] = useState<AiUserData | null>(() => loadManualContext(currentSemester) ?? loadWorkspaceContext(currentSemester));
  // 数据来源：workspace = 本浏览器工作台实时数据（自动关联）；file = 上传的本地 JSON（localStorage 持久）；
  // cloud = 账号云端方案快照（仅当前会话内存有效，刷新后回退工作台/本地来源）
  const [ctxSource, setCtxSource] = useState<"workspace" | "file" | "cloud">(() => (loadManualContext() ? "file" : "workspace"));
  const [ctxCloudName, setCtxCloudName] = useState<string | null>(null);
  const [ctxCloudOpen, setCtxCloudOpen] = useState(false);
  const [includeCtx, setIncludeCtx] = useState(true);
  const [ctxErr, setCtxErr] = useState("");
  const [targetSem, setTargetSem] = useState<string>(""); // 推荐目标学期（空 = 自动：跟随工作台当前学期）
  const ctxFileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSaveRef = useRef(0);

  // 自动滚动到底部（新内容 / 思考过程更新时）
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, phase]);

  const refreshQuota = useCallback(() => {
    fetch(`/vote/ai/quota?visitor_id=${encodeURIComponent(getVisitorId())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setQuota(d);
        // 管理端自定义声明文本（zh/en 任一非空即生效；否则回退内置默认）
        const dis = d?.disclaimer;
        setDisclaimerOverride(dis && (dis.zh || dis.en) ? { zh: dis.zh || "", en: dis.en || "" } : null);
        // 档位显示名称下发（管理页「模型配置」可改）：缓存供全站使用
        saveAiDisplay(d?.display);
      })
      .catch(() => setQuota(null));
  }, []);

  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  // 是否需要签署：未同意过，或服务端声明版本高于本地已签署版本（后台点了"要求重新签署"）。
  // 需要签署时不自动弹窗，只在输入区上方显示提示条；用户尝试发送时才弹出签署。
  const needSign = useMemo(() => {
    if (!agreed) return true;
    const ver = quota?.disclaimer?.ver;
    if (!ver) return false;
    return signedVer === null || (signedVer !== ver && signedVer !== -1);
  }, [agreed, quota, signedVer]);

  // 本地历史保存：流式期间节流，结束/停止/清空时立即保存
  const persist = useCallback(
    (force = false) => {
      const now = Date.now();
      if (!force && now - lastSaveRef.current < SAVE_THROTTLE_MS) return;
      lastSaveRef.current = now;
      saveLocalHistory(messages);
    },
    [messages],
  );
  useEffect(() => {
    if (phase === "streaming") persist();
  }, [messages, phase, persist]);
  useEffect(() => {
    if (phase === "idle") persist(true);
  }, [phase, persist]);
  useEffect(() => {
    const onSave = () => saveLocalHistory(messages);
    window.addEventListener("beforeunload", onSave);
    return () => window.removeEventListener("beforeunload", onSave);
  }, [messages]);

  const starterPrompts = useMemo(
    () =>
      zh
        ? ["帮我解释一下学位评定进度是怎么算的", "结合我的情况，推荐下学期选哪些课？", "微积分A(1) 之后能选哪些课？"]
        : ["How is my degree progress calculated?", "Based on my record, what should I take next term?", "What can I take after Calculus A(1)?"],
    [zh],
  );

  // —— 站内推荐算法结果：发送时按当次会话类别/档位即时构建候选（见 handleSend 内 activeRec）——
  // direction：两段式第一段识别 / 从已修第二门方向课推断；变化时候选按方向重算
  const [direction, setDirection] = useState<RecDirection | null>(null);
  const recAutoSem = useMemo(() => (ctxData ? defaultTargetSemester(ctxData.history, currentSemester) : ""), [ctxData, currentSemester]);

  // —— 站内学位评定算法结果：七轨道（含 CED）精确进度注入上下文，模型只引用数字、不自行重算 ——
  const degCtx = useMemo(() => {
    if (!ctxData || !includeCtx) return "";
    return buildDegreeEvalText(ctxData.history, currentSemester);
  }, [ctxData, includeCtx, currentSemester]);

  // 生效的使用声明：管理端自定义（# 标题行格式）> 内置默认
  const activeDisclaimerSections = useMemo(() => {
    if (disclaimerOverride) {
      const parsed = parseDisclaimerText(zh ? disclaimerOverride.zh : disclaimerOverride.en);
      if (parsed.length > 0) return parsed;
    }
    return disclaimerSections(zh);
  }, [disclaimerOverride, zh]);

  const agree = () => {
    try {
      localStorage.setItem(DISCLAIMER_KEY, "1");
      // 记录签署时的声明版本（quota 未加载时存 -1：本次会话不再重复弹，下次按服务端版本判定）
      const ver = quota?.disclaimer?.ver ?? -1;
      localStorage.setItem(SIGNED_VER_KEY, String(ver));
      setSignedVer(ver);
    } catch {
      /* 忽略 */
    }
    setAgreed(true);
    setDeclined(false);
    setShowModal(false);
  };

  const decline = () => {
    try {
      localStorage.setItem(DISCLAIMER_KEY, "0");
    } catch {
      /* 忽略 */
    }
    setAgreed(false);
    setDeclined(true);
    setShowModal(false);
  };

  const newChat = () => {
    if (phase !== "idle") return;
    setMessages([]);
    setThinkOpen({});
    setError("");
    saveLocalHistory([]);
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setMessages((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last && last.role === "assistant" && last.content === "") {
        next[next.length - 1] = { ...last, content: zh ? "（已停止生成）" : "(stopped)" };
      }
      saveLocalHistory(next);
      return next;
    });
  };

  const exportTxt = () => {
    if (messages.length === 0) return;
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
    const lines: string[] = [];
    lines.push(zh ? "OfCourses AI 选课助手 — 对话记录" : "OfCourses AI Assistant — Conversation Export");
    lines.push(zh ? `导出时间：${now.toLocaleString()}` : `Exported at: ${now.toLocaleString()}`);
    lines.push(zh
        ? "提示：对话仅保存在浏览器本地 30 分钟；导出的文本是唯一长期留存方式。"
        : "Note: conversations are kept in your browser for 30 minutes only; this exported file is the only long-term copy.");
    lines.push("");
    for (const m of messages) {
      lines.push(m.role === "user" ? (zh ? "【你】" : "[You]") : (zh ? "【AI】" : "[AI]"));
      // 弱模型档导出同样附免责声明（与页面展示一致）
      const body =
        m.role === "assistant" && tier === "flash" && m.content
          ? `${m.content}\n\n${flashDisclaimer(zh)}`
          : m.content;
      lines.push(body || (zh ? "（无正文）" : "(no content)"));
      lines.push("");
    }
    // 注：【算法推荐候选】【学位评定进度】等系统内部注入数据块不随导出输出（2026-09-30 用户要求，
    // 导出文件仅保留对话正文与使用声明，避免暴露站内实现细节）。
    lines.push("════════════════════════════════════");
    lines.push(zh ? "附：OfCourses AI 选课助手使用声明" : "Appendix: OfCourses AI Assistant — Terms of Use");
    lines.push("");
    for (const s of activeDisclaimerSections) {
      lines.push(s.h);
      lines.push(s.body);
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ofcourses-ai-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // —— 个人选课数据：上传 JSON / 恢复工作台关联 ——
  const onCtxFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = parseHistoryJson(String(reader.result ?? ""), currentSemester);
      if (!data) {
        setCtxErr(zh ? "JSON 格式不正确：需为工作台导出的 { history: {...} } 文件" : "Invalid JSON: expected { history: {...} } export");
        return;
      }
      setCtxErr("");
      setCtxData(data);
      setCtxSource("file");
      saveManualContext(data);
      setIncludeCtx(true);
    };
    reader.readAsText(f);
  };

  const restoreWorkspaceCtx = () => {
    const d = loadWorkspaceContext(currentSemester);
    setCtxData(d);
    setCtxSource("workspace");
    setCtxCloudName(null);
    saveManualContext(null);
    setCtxErr("");
  };

  // 云端方案作为 AI 上下文：读取账号下某方案快照，转包为 { history } 后复用统一解析。
  // 仅存会话内存（不写 localStorage），刷新后回退工作台/本地来源，避免覆盖用户的本地持久数据。
  const applyCloudCtx = async (id: number, name: string) => {
    const raw = await fetchSchemeData(id);
    if (!raw) {
      setCtxErr(zh ? "云端方案读取失败，请检查网络后重试。" : "Failed to load the cloud plan; check your connection and retry.");
      return;
    }
    try {
      const obj = JSON.parse(raw) as { h?: unknown; history?: unknown };
      const hist = obj.h ?? obj.history;
      if (!hist || typeof hist !== "object") throw new Error("bad shape");
      const data = parseHistoryJson(JSON.stringify({ history: hist }), currentSemester);
      if (!data) throw new Error("parse failed");
      setCtxErr("");
      setCtxData(data);
      setCtxSource("cloud");
      setCtxCloudName(name);
      setCtxCloudOpen(false);
      setIncludeCtx(true);
    } catch {
      setCtxErr(zh ? "云端方案数据格式异常，未导入。" : "Cloud plan data looks invalid; not imported.");
    }
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || phase !== "idle") return;
    // 需要签署时先弹声明，不清空已输入内容；同意后用户直接再点发送即可
    if (needSign) {
      setShowModal(true);
      return;
    }
    setError("");
    setInput("");
    const history = [...messages, { role: "user" as const, content }];
    setMessages([...history, { role: "assistant", content: "", reasoning: "" }]);
    setPhase("loading");

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let got = false;
    let streamErr = "";

    try {
      // —— 两段式第一段：轻量分类（需求类别 + 对话方向意图 + 学期意图）。失败静默回退 ——
      // 高级档（强模型）跳过本段：不走 Flash 分类调用（避免其 429 等待卡住强档链路），
      // 类别固定注入全量，方向识别交给 关键词兜底 + 会话延续 + 已修推断（下方解析链）。
      let category = "all";
      let passDirection: RecDirection | null = null;
      let semHint = "";
      if (tier === "flash") {
        try {
          const cres = await fetch(`/vote/ai/classify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: ctrl.signal,
            body: JSON.stringify({ question: content, visitor_id: getVisitorId(), lang: zh ? "zh" : "en" }),
          });
          if (cres.ok) {
            const cj = await cres.json();
            if (cj && typeof cj.category === "string") category = cj.category;
            if (cj?.direction === "aero" || cj?.direction === "soft" || cj?.direction === "ie") passDirection = cj.direction;
            if (typeof cj?.semester === "string") semHint = cj.semester;
          }
        } catch {
          /* 分类失败：按全量回退，不阻塞提问 */
        }
      }

      // 方向解析：对话明示 > 问题原文关键词兜底 > 会话内已确认方向 > 已修"基础加强第二门"推断 > 无方向
      // （会话内方向：上一次已确认过方向时延续，classify 偶发失败不再退回无方向的错误滚动）
      let dir: RecDirection | null = passDirection;
      if (!dir) dir = detectStatedDirection(content);
      if (!dir) dir = direction;
      if (!dir && ctxData) dir = inferDirection(ctxData.history);
      setDirection(dir);

      // 学期意图：用户下拉未手选且第一段识别到目标学期时，跟随识别结果
      const semValid = (REC_SEMESTERS as readonly string[]).includes(semHint);
      const effSem = targetSem || (semValid ? semHint : "");
      if (!targetSem && semValid) setTargetSem(semHint);

      // 方向化重建候选（推荐/规划类才附上下文与数据块；功能/查询类按规则忽略）
      const ctxAllowed = includeCtx && ctxData && (category === "plan" || category === "all");
      const activeRec = ctxAllowed && ctxData
        ? buildRecContext(ctxData.history, ctxData.custom, effSem || undefined, currentSemester, dir ?? undefined, {
            preferNative: zh,
            allowDirectionSwitch: tier === "strong",
            maxItems: tier === "strong" ? REC_MAX_ITEMS_STRONG : 15,
          })
        : null;
      const activeDeg = ctxAllowed ? degCtx : "";

      const res = await fetch(`/vote/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          visitor_id: getVisitorId(),
          lang: zh ? "zh" : "en",
          category,
          tier,
          context: ctxAllowed && ctxData ? [ctxData.text, activeRec?.text, activeDeg].filter(Boolean).join("\n\n") : "",
          messages: history.slice(-MAX_HISTORY_MSGS).map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok || !res.body) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          // detail 可能是字符串（HTTPException）或数组/对象（422 校验错误）——统一转字符串避免 "[object Object]"
          if (typeof j.detail === "string" && j.detail) detail = j.detail;
          else if (j.detail) detail = JSON.stringify(j.detail);
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }

      setPhase("streaming");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const obj = JSON.parse(data);
            if (obj.error) {
              streamErr = obj.error;
            } else if (obj.status === "wait") {
              // 上游限频重试中：显示等待动效
              setWaitInfo(typeof obj.waited === "number" ? obj.waited : 0);
            } else if (obj.status === "tool") {
              // 模型正在调用课程搜索工具：给用户进行时提示
              setToolHint(
                zh ? `正在检索课程数据（命中 ${obj.total ?? "?"} 门）…` : `Searching course catalog (${obj.total ?? "?"} hits)…`,
              );
            } else if (typeof obj.t === "string" && obj.t.length > 0) {
              got = true;
              setWaitInfo(null);
              setToolHint("");
              const delta = obj.t;
              setMessages((prev) => {
                // 纯更新：StrictMode 下更新函数会被执行两次，原地累加会导致内容重复
                const next = prev.slice();
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, content: last.content + delta };
                }
                return next;
              });
            } else if (typeof obj.r === "string" && obj.r.length > 0) {
              const delta = obj.r;
              setWaitInfo(null);
              setMessages((prev) => {
                const next = prev.slice();
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, reasoning: (last.reasoning || "") + delta };
                }
                return next;
              });
            }
          } catch {
            /* 忽略无法解析的片段 */
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        const raw = (e as Error).message || "";
        // fetch 层的连接中断（network error / Failed to fetch）给出友好提示
        streamErr = raw && !/network error|failed to fetch|load failed/i.test(raw)
          ? raw
          : zh ? "连接中断，请稍后重试" : "Connection lost, please try again later";
      }
    } finally {
      abortRef.current = null;
      setPhase("idle");
      setWaitInfo(null);
      setToolHint("");
      refreshQuota();
      if (streamErr) {
        setError(streamErr);
        if (!got) {
          // 完全没有生成内容：把空气泡移除
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant" && !last.content) next.pop();
            saveLocalHistory(next);
            return next;
          });
        }
      }
    }
  };

  const bubbleCls = (role: ChatMsg["role"]) =>
    role === "user"
      ? `ml-auto ${isDark ? "bg-blue-600/80 text-white" : "bg-blue-600 text-white"}`
      : `${isDark ? "bg-white/[0.06] text-white/90" : "bg-gray-100 text-gray-800"}`;

  const canSend = phase === "idle" && input.trim().length > 0;

  // 限額提示文案（按当前档位显示对应限额：低级档次数 / 高级档有效对话与个人 token）
  const quotaText = useMemo(() => {
    if (!quota || !quota.enabled) return null;
    if (quota.token_exhausted) return zh ? "今日全站额度已用完，请明天再来" : "Site-wide daily quota exhausted, come back tomorrow";
    if (quota.ip_exhausted) return zh ? "当前网络今日次数已达上限" : "Daily limit reached for this network";
    if (tier === "strong" && quota.strong?.enabled) {
      const s = quota.strong;
      // 百分比 = 使用量 / 当日限额量。对用户真正起约束作用的是个人限额（全局上限 × 个人占比），
      // 故优先展示个人口径；个人不限额时退回全站口径（实测分母误用全站 600k 会显示 13% 的错误值）。
      const gPct = s.tokens_cap > 0 ? Math.round((s.tokens_used / s.tokens_cap) * 100) : null;
      const uPct = s.user_tokens_limit > 0 ? Math.round((s.user_tokens_used / s.user_tokens_limit) * 100) : null;
      if (s.global_exhausted) {
        return zh
          ? `今日${tierLabel("strong", zh)}额度已用完（已用 ${gPct ?? "100+"}%），明天自动恢复`
          : `${tierLabel("strong", zh)} quota exhausted (${gPct ?? "100+"}% used), resets tomorrow`;
      }
      if (s.user_exhausted) {
        return zh
          ? `今日${tierLabel("strong", zh)}个人额度已用完（已用 ${uPct ?? "100+"}%），明天自动恢复`
          : `Your ${tierLabel("strong", zh)} quota is used up today (${uPct ?? "100+"}% used), resets tomorrow`;
      }
      if (uPct !== null) {
        return zh ? `${tierLabel("strong", zh)}今日额度已用 ${uPct}%` : `${tierLabel("strong", zh)} quota: ${uPct}% used today`;
      }
      if (gPct !== null) {
        return zh ? `${tierLabel("strong", zh)}今日全站额度已用 ${gPct}%` : `${tierLabel("strong", zh)} site-wide quota: ${gPct}% used today`;
      }
      if (s.limit_count > 0) {
        return zh ? `${tierLabel("strong", zh)}今日已用 ${s.used_valid}/${s.limit_count} 次` : `${tierLabel("strong", zh)}: used ${s.used_valid}/${s.limit_count} today`;
      }
      return zh ? `${tierLabel("strong", zh)}今日已用 ${s.user_tokens_used}/${s.user_tokens_limit} token` : `${tierLabel("strong", zh)}: ${s.user_tokens_used}/${s.user_tokens_limit} tokens today`;
    }
    return zh ? `今日已用 ${quota.used}/${quota.limit} 次` : `Used ${quota.used}/${quota.limit} today`;
  }, [quota, zh, tier]);

  return (
    <div className="flex flex-col gap-3">
      {/* 工具行 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={newChat}
          disabled={phase !== "idle"}
          className={`cursor-pointer rounded-lg border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
            isDark ? "border-white/20 text-white/80 hover:bg-white/5" : "border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          {zh ? "＋ 开启新对话" : "＋ New chat"}
        </button>
        <button
          onClick={exportTxt}
          disabled={messages.length === 0}
          className={`cursor-pointer rounded-lg border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
            isDark ? "border-white/20 text-white/80 hover:bg-white/5" : "border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          {zh ? "导出对话 txt" : "Export txt"}
        </button>
        <button
          onClick={() => setShowTutorial(true)}
          className={`cursor-pointer rounded-lg border px-3 py-1 text-xs font-medium ${
            isDark ? "border-white/20 text-white/80 hover:bg-white/5" : "border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          {zh ? "教程" : "Guide"}
        </button>
        <button
          onClick={() => setShowModal(true)}
          className={`cursor-pointer rounded-lg border px-3 py-1 text-xs font-medium ${
            isDark ? "border-white/20 text-white/80 hover:bg-white/5" : "border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          {zh ? "使用声明" : "Terms"}
        </button>
        {quota?.strong?.enabled && (
          /* 模型档位切换：服务端开启强模型档后出现；选择本地记忆 */
          <div
            className={`flex overflow-hidden rounded-lg border text-xs ${isDark ? "border-white/20" : "border-gray-300"}`}
            role="group"
            aria-label={zh ? "模型档位" : "Model tier"}
          >
            {(["flash", "strong"] as ModelTier[]).map((t) => (
              <button
                key={t}
                onClick={() => setTier(t)}
                disabled={phase !== "idle"}
                title={t === "flash" ? quota?.models?.flash : quota?.models?.strong || ""}
                className={`cursor-pointer px-2.5 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                  tier === t
                    ? isDark
                      ? "bg-blue-600/80 text-white"
                      : "bg-blue-600 text-white"
                    : isDark
                      ? "text-white/70 hover:bg-white/5"
                      : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {tierLabel(t, zh)}
              </button>
            ))}
          </div>
        )}
        {quotaText && (
          <span className={`ml-auto text-[11px] ${isDark ? "text-white/45" : "text-gray-400"}`}>{quotaText}</span>
        )}
      </div>

      {/* 个人选课数据关联面板 */}
      <div className={`rounded-lg border px-3 py-2 text-xs ${isDark ? "border-white/10 bg-white/[0.02] text-white/70" : "border-gray-200 bg-gray-50 text-gray-600"}`}>
        <input
          ref={ctxFileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onCtxFile(f);
            e.target.value = "";
          }}
        />
        {ctxData ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">
                {zh
                  ? `已关联选课历史：${ctxData.semesters} 学期 / ${ctxData.courses} 门课 / ${ctxData.credits} 学分`
                  : `History linked: ${ctxData.semesters} terms / ${ctxData.courses} courses / ${ctxData.credits} credits`}
                {ctxSource === "cloud" && ctxCloudName && (zh ? `（云端方案：${ctxCloudName}）` : ` (cloud plan: ${ctxCloudName})`)}
                {ctxSource === "file" && (zh ? "（来自上传 JSON）" : " (from uploaded JSON)")}
              </span>
              <label className="flex cursor-pointer items-center gap-1">
                <input type="checkbox" checked={includeCtx} onChange={(e) => setIncludeCtx(e.target.checked)} />
                {zh ? "提问时附带" : "Attach to questions"}
              </label>
              {ctxSource === "workspace" && (
                <button
                  onClick={() => setCtxData(loadWorkspaceContext(currentSemester))}
                  className="cursor-pointer border-none bg-transparent p-0 text-blue-500 underline"
                >
                  {zh ? "刷新" : "Refresh"}
                </button>
              )}
            </div>
            {/* 数据来源切换：工作台实时 / 云端方案快照 / 上传 JSON；当前来源高亮。窄屏放不下，「数据来源」标签后换行让胶囊独占一行 */}
            <div>
              <span className={isDark ? "text-white/50" : "text-gray-500"}>{zh ? "数据来源" : "Source"}</span>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {([
                  ["workspace", zh ? "工作台" : "Workspace"],
                  ["cloud", zh ? "云端方案" : "Cloud plan"],
                  ["file", zh ? "本地文件" : "Local file"],
                ] as const).map(([src, label]) => (
                  <button
                    key={src}
                    onClick={() => {
                      if (src === "workspace") {
                        restoreWorkspaceCtx();
                      } else if (src === "cloud") {
                        if (!user) {
                          setCtxErr(zh ? "云端方案需要登录后使用。" : "Sign in to use cloud plans.");
                        } else if (schemes.length === 0) {
                          setCtxErr(zh ? "账号下暂无云端方案——先在工具页保存一个方案。" : "No cloud plans yet — save one on the Tools page first.");
                        } else {
                          setCtxErr("");
                          setCtxCloudOpen(true);
                        }
                      } else {
                        ctxFileRef.current?.click();
                      }
                    }}
                    className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                      ctxSource === src
                        ? isDark
                          ? "border-blue-500/60 bg-blue-500/20 text-blue-200"
                          : "border-blue-500 bg-blue-50 text-blue-700"
                        : isDark
                          ? "border-white/10 text-white/60 hover:bg-white/5"
                          : "border-gray-300 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {/* 推荐目标学期：默认跟随工作台当前学期，站内推荐算法按此学期计算 Top 候选并注入上下文。标签后换行，下拉框独占一行 */}
            <div>
              <span className={isDark ? "text-white/50" : "text-gray-500"}>{zh ? "推荐目标学期" : "Target semester"}</span>
              <div className="mt-1">
                <select
                  value={targetSem || recAutoSem}
                  onChange={(e) => setTargetSem(e.target.value)}
                  className={`w-full max-w-[260px] cursor-pointer rounded border px-1.5 py-1 text-xs outline-none ${isDark ? "border-white/20 bg-[#1e1e2a] text-white/90" : "border-gray-300 bg-white text-gray-800"}`}
                >
                  {REC_SEMESTERS.map((s) => (
                    <option key={s} value={s}>
                      {tSemester(s)}
                      {s === recAutoSem ? (zh ? "（自动·当前学期）" : " (auto·current)") : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* 方向指示：当前推荐是否已按某方向定向（对话明示/第二门课推断），便于用户确认与纠偏 */}
            <span className={`text-xs ${isDark ? "text-white/50" : "text-gray-500"}`}>
              {direction
                ? zh
                  ? `已按「${directionLabel(direction)}」方向生成推荐`
                  : `Recommendations tuned to ${directionLabel(direction)}`
                : zh
                  ? "未识别到方向（通用推荐）"
                  : "No direction detected (general)"}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {zh
                ? "未关联选课历史——在工作台录入课程后自动关联，或登录后使用云端方案，也可上传工作台导出的 JSON。"
                : "No history linked — record courses in the workspace (auto-linked), sign in to use a cloud plan, or upload your workspace JSON export."}
            </span>
            <button
              onClick={() => {
                if (!user) {
                  setCtxErr(zh ? "云端方案需要登录后使用。" : "Sign in to use cloud plans.");
                } else if (schemes.length === 0) {
                  setCtxErr(zh ? "账号下暂无云端方案——先在工具页保存一个方案。" : "No cloud plans yet — save one on the Tools page first.");
                } else {
                  setCtxErr("");
                  setCtxCloudOpen(true);
                }
              }}
              className="cursor-pointer border-none bg-transparent p-0 font-medium text-blue-500 underline"
            >
              {zh ? "使用云端方案" : "Use a cloud plan"}
            </button>
            <button
              onClick={() => ctxFileRef.current?.click()}
              className="cursor-pointer border-none bg-transparent p-0 font-medium text-blue-500 underline"
            >
              {zh ? "上传 JSON" : "Upload JSON"}
            </button>
          </div>
        )}
        {ctxErr && <div className={`mt-1 ${isDark ? "text-red-400" : "text-red-600"}`}>{ctxErr}</div>}
        {ctxData && includeCtx && (
          <div className={`mt-1 text-[11px] ${isDark ? "text-white/40" : "text-gray-400"}`}>
            {zh
              ? "提问时会附带以上数据供模型分析（仅本次请求使用，服务器不保存）。推荐类问题将基于站内推荐算法的计算结果作答。"
              : "Your data is attached to each question for analysis (per-request only; the server stores nothing). Recommendation questions are answered based on this site's recommendation algorithm."}
          </div>
        )}
      </div>

      {/* 云端方案选择弹窗（AI 上下文来源：读取快照，不切换当前方案、不写本地存储） */}
      {ctxCloudOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{background: "rgba(0,0,0,0.45)"}} onClick={() => setCtxCloudOpen(false)}>
          <div
            className={`w-full max-w-sm rounded-xl border shadow-2xl ${isDark ? "border-white/10 bg-[#1e1e2a]" : "border-gray-200 bg-white"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between border-b px-4 py-3 ${isDark ? "border-white/10" : "border-gray-200"}`}>
              <span className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-800"}`}>
                {zh ? "选择要使用的云端方案" : "Choose a cloud plan"}
              </span>
              <button onClick={() => setCtxCloudOpen(false)} className={`cursor-pointer text-sm opacity-60 hover:opacity-100 ${isDark ? "text-white" : "text-gray-800"}`}>✕</button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {schemes.map((s) => {
                const active = s.id === currentSchemeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => applyCloudCtx(s.id, s.name)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-none px-3 py-2.5 text-left text-xs transition-colors ${
                      isDark ? "text-white/85 hover:bg-white/5" : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {s.name}
                      {active && (
                        <span className={`ml-2 shrink-0 rounded px-1 py-0.5 text-[9px] ${isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-700"}`}>
                          {zh ? "当前" : "current"}
                        </span>
                      )}
                    </span>
                    <span className={`shrink-0 text-[10px] ${isDark ? "text-white/35" : "text-gray-400"}`}>
                      {new Date(s.updated_at * 1000).toLocaleDateString(zh ? "zh-CN" : "en-US")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 未签署：整个功能区不渲染，仅显示签署引导卡（点击按钮才弹出声明，无任何自动弹窗） */}
      {needSign ? (
        <div className={`flex h-[420px] flex-col items-center justify-center gap-4 rounded-lg border p-6 text-center ${isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white"}`}>
          <div className={`text-sm font-medium ${isDark ? "text-white/80" : "text-gray-700"}`}>
            {zh
              ? declined
                ? "你尚未同意使用声明，AI 助手暂不可用"
                : "首次使用 AI 助手，请先阅读并签署使用声明"
              : declined
                ? "The Terms of Use haven't been accepted — the assistant is unavailable"
                : "First time here? Please read and accept the Terms of Use"}
          </div>
          <div className={`max-w-md text-xs leading-relaxed ${isDark ? "text-white/50" : "text-gray-500"}`}>
            {zh
              ? "使用 AI 助手前需要同意《使用声明》，其中说明了服务范围、隐私保护与使用额度等事项。同意后即可开始提问。"
              : "You need to accept the Terms of Use before using the assistant — it covers the scope of service, privacy, and usage quota. Once accepted you can start asking."}
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="cursor-pointer rounded-lg border-none bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
          >
            {zh ? "阅读并签署使用声明" : "Read & accept the Terms"}
          </button>
        </div>
      ) : (
      <>
      {/* 对话区 */}
      <div
        ref={scrollRef}
        className={`h-[420px] overflow-y-auto rounded-lg border p-3 ${isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white"}`}
      >
        {messages.length === 0 && (
          <div className={`flex h-full flex-col items-center justify-center gap-3 text-center`}>
            <div className={`text-sm font-medium ${isDark ? "text-white/80" : "text-gray-700"}`}>
              {zh ? "你好，我是 OfCourses AI 选课助手 👋" : "Hi, I'm the OfCourses AI assistant 👋"}
            </div>
            <div className={`max-w-md text-xs leading-relaxed ${isDark ? "text-white/50" : "text-gray-500"}`}>
              {zh
                ? "我可以基于本站的培养方案与课程数据，帮你解答选课、学位评定、课程推荐等问题。"
                : "I can answer course-planning and degree-evaluation questions based on this site's curriculum data."}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {starterPrompts.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                    isDark
                      ? "border-white/15 text-white/70 hover:bg-white/5"
                      : "border-gray-300 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const thinking = isLast && phase !== "idle" && m.role === "assistant" && !m.content && !!m.reasoning;
          const open = thinking || thinkOpen[i];
          return (
            <div key={i} className="mb-3 flex">
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${bubbleCls(m.role)}`}>
                {/* 思考过程（业内惯例：灰色斜体小字，可折叠，正文开始后自动折叠） */}
                {m.role === "assistant" && !!m.reasoning && (
                  <div className={`mb-2 rounded-lg border ${isDark ? "border-white/10 bg-white/[0.03]" : "border-gray-200 bg-gray-50"}`}>
                    <button
                      onClick={() => setThinkOpen((prev) => ({ ...prev, [i]: !prev[i] }))}
                      className={`flex w-full cursor-pointer items-center gap-1 border-none bg-transparent px-2 py-1 text-left text-[11px] font-medium ${
                        isDark ? "text-white/50" : "text-gray-500"
                      }`}
                    >
                      <span>{open ? "▾" : "▸"}</span>
                      {zh ? "思考过程" : "Thinking"}
                      {thinking && <span className={isDark ? "text-white/40" : "text-gray-400"}>…</span>}
                    </button>
                    {open && (
                      <div
                        className={`max-h-48 overflow-y-auto whitespace-pre-wrap px-2 pb-2 text-[11px] italic leading-relaxed ${
                          isDark ? "text-white/45" : "text-gray-500"
                        }`}
                      >
                        {m.reasoning}
                      </div>
                    )}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">
                  {/* 弱模型档：回复完成后正文末尾追加免责声明（纯展示层，不进上下文） */}
                  {m.role === "assistant" && tier === "flash" && m.content &&
                  !(phase !== "idle" && isLast)
                    ? `${m.content}\n\n${flashDisclaimer(zh)}`
                    : m.content}
                  {/* 等待/输出/结束三态：429 等待动效 → 流式光标 → 完成后光标消失 */}
                  {phase !== "idle" && isLast && m.role === "assistant" && (
                    m.content ? (
                      <span className={`ml-0.5 inline-block animate-pulse ${isDark ? "text-white/80" : "text-blue-600"}`}>▌</span>
                    ) : waitInfo !== null ? (
                      <span className={`inline-flex flex-col gap-1 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block animate-spin">|</span>
                          {zh ? "等待模型响应…" : "Waiting for the model…"}
                          {waitInfo >= 10 && (
                            <span className={isDark ? "text-white/40" : "text-gray-400"}>
                              {zh ? `（已等待 ${waitInfo} 秒）` : `(${waitInfo}s)`}
                            </span>
                          )}
                        </span>
                        {comfortText(waitInfo, zh) && (
                          <span className={`text-[11px] italic ${isDark ? "text-white/45" : "text-gray-400"}`}>
                            {comfortText(waitInfo, zh)}
                          </span>
                        )}
                      </span>
                    ) : toolHint ? (
                      <span className={`inline-flex items-center gap-1 ${isDark ? "text-white/60" : "text-gray-500"}`}>
                        <span className="inline-block animate-spin">|</span>
                        {toolHint}
                      </span>
                    ) : (
                      !m.reasoning && (zh ? "思考中…" : "Thinking…")
                    )
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className={`text-xs ${isDark ? "text-red-400" : "text-red-600"}`}>{error}</div>
      )}

      {/* 输入区 */}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) void send(input);
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder={
            zh ? "输入你的选课问题…（Enter 发送，Shift+Enter 换行）" : "Ask a course-planning question… (Enter to send)"
          }
          className={`flex-1 resize-none rounded-lg border px-3 py-2 text-xs outline-none ${
            isDark
              ? "border-white/15 bg-white/[0.04] text-white placeholder:text-white/30 focus:border-blue-400/60"
              : "border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-blue-500"
          }`}
        />
        {phase === "idle" ? (
          <button
            onClick={() => void send(input)}
            disabled={!canSend}
            className="cursor-pointer rounded-lg border-none bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {zh ? "发送" : "Send"}
          </button>
        ) : (
          <button
            onClick={stop}
            className={`cursor-pointer rounded-lg border px-4 py-2 text-xs font-medium ${
              isDark ? "border-white/20 text-white/80 hover:bg-white/5" : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {zh ? "停止" : "Stop"}
          </button>
        )}
      </div>
      </>
      )}

      {/* 底部小字 */}
      <div className={`flex items-center justify-between text-[11px] ${isDark ? "text-white/40" : "text-gray-400"}`}>
        <span>
          {zh
            ? "所有对话内容仅保存在你的浏览器本地 30 分钟，服务器不保存任何对话内容。"
            : "Conversations are kept only in your browser for 30 minutes; the server stores nothing."}
        </span>
        <button
          onClick={() => setShowModal(true)}
          className="cursor-pointer border-none bg-transparent p-0 underline"
        >
          {zh ? "使用声明" : "Terms"}
        </button>
      </div>

      {/* 声明弹窗（Portal 到 body，避免被父级 overflow 裁剪） */}
      {showModal &&
        createPortal(
          <DisclaimerModal
            zh={zh}
            isDark={isDark}
            agreed={!needSign}
            sections={activeDisclaimerSections}
            onAgree={agree}
            onDecline={decline}
            onClose={() => setShowModal(false)}
            />,
          document.body,
        )}
      {/* 简易使用教程弹窗 */}
      {showTutorial &&
        createPortal(<TutorialModal zh={zh} isDark={isDark} onClose={() => setShowTutorial(false)} />, document.body)}
    </div>
  );
}

function TutorialModal({
  zh,
  isDark,
  onClose,
}: {
  zh: boolean;
  isDark: boolean;
  onClose: () => void;
}) {
  const steps: Array<{ h: string; body: string }> = zh
    ? [
        {
          h: "① 它能做什么",
          body: "基于本站收录的培养方案与课程数据：解释选课规则与学位评定口径；结合你的选课历史评估进度；推荐下学期课程；模拟多学期规划；分析退课、推迟与换向的影响。",
        },
        {
          h: "② 三步上手",
          body: "1）建议先在工作台录入或核对课程，并导出 JSON；2）回到本页自动关联工作台数据（也可在“学位评定”页用「导入本地数据」上传 JSON 文件，或登录后用「导入云端方案」读取云端方案），并按需调整“推荐目标学期”；3）直接提问即可。对话不保留历史（仅本地 30 分钟），重要结论请及时“导出对话 txt”。",
        },
        {
          h: "③ 两个模型怎么选",
          body: `${tierLabel("flash", true)}：限额宽松，但响应稍慢，且模型质量平平，适合规则查询、课程信息等日常问题。${tierLabel("strong", true)}：响应更快，准确性更高，支持在对话中直接换方向重新规划；但额度按 token 计费，每人每天大约可以问 3~4 个问题（全站还有共享总量），建议留给复杂的规划与体检类问题。`,
        },
        {
          h: "④ 提问技巧",
          body: "需求表达清晰、适当降低问题的开放性；复杂问题拆开分多次问；推荐/规划类回答基于站内推荐算法计算出的候选列表，可以追问每一门课的推荐理由。",
        },
        {
          h: "⑤ 注意事项",
          body: "所有输出仅供参考，选课以教务与书院的最新官方通知为准。遇到明显的分析错误，欢迎通过“关于我们”页的联系方式反馈。",
        },
      ]
    : [
        {
          h: "① What it can do",
          body: "Based on the curriculum data on this site: explain registration rules and degree-evaluation logic; assess your progress from your course record; recommend courses for next term; simulate multi-term plans; analyze the impact of dropping, deferring, or switching directions.",
        },
        {
          h: "② Three steps to start",
          body: "1) (Recommended) Record or review your courses in the Workspace and export the JSON; 2) Come back here and your Workspace data is linked automatically (you can also upload the JSON file via “Import local data” on the Degree Evaluation page, or use “Import cloud plan” when signed in), and adjust the target semester if needed; 3) Just ask. Conversations are not kept (local only, 30 minutes) — export important conclusions as txt.",
        },
        {
          h: "③ Which model to pick",
          body: `${tierLabel("flash", false)}: generous quota but slower response and average model quality — good for rule lookups and quick course info. ${tierLabel("strong", false)}: faster response and higher accuracy, can re-plan with a different direction in conversation; but it is metered by tokens — roughly 3-4 questions per person per day (plus a site-wide shared cap). Save it for complex planning questions.`,
        },
        {
          h: "④ Asking tips",
          body: "State your needs clearly and keep questions focused; split complex problems into several asks; recommendation/planning answers are based on this site's recommendation algorithm — you can ask why each course was recommended.",
        },
        {
          h: "⑤ Notes",
          body: "All output is for reference only; registration follows the latest official notices. If you spot an obvious analysis error, feedback is welcome via the contact info on the About page.",
        },
      ];
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl shadow-2xl ${
          isDark ? "bg-[#1a1a26] text-white/90" : "bg-white text-gray-800"
        }`}
      >
        <div className={`border-b px-5 py-3 text-sm font-semibold ${isDark ? "border-white/10" : "border-gray-200"}`}>
          {zh ? "AI 选课助手 · 简易教程" : "AI Assistant — Quick Guide"}
        </div>
        <div className={`flex-1 overflow-y-auto px-5 py-4 text-xs leading-relaxed ${isDark ? "text-white/75" : "text-gray-600"}`}>
          {steps.map((s) => (
            <div key={s.h} className="mb-3">
              <div className={`mb-1 text-xs font-semibold ${isDark ? "text-white" : "text-gray-800"}`}>{s.h}</div>
              <div>{s.body}</div>
            </div>
          ))}
        </div>
        <div className={`flex items-center px-5 py-3 ${isDark ? "border-white/10" : "border-gray-200"}`}>
          <button
            onClick={onClose}
            className="ml-auto cursor-pointer rounded-lg border-none bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            {zh ? "开始使用" : "Get started"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DisclaimerModal({
  zh,
  isDark,
  agreed,
  sections,
  onAgree,
  onDecline,
  onClose,
}: {
  zh: boolean;
  isDark: boolean;
  agreed: boolean;
  sections: DisclaimerSection[];
  onAgree: () => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4"
      onClick={agreed ? onClose : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl shadow-2xl ${
          isDark ? "bg-[#1a1a26] text-white/90" : "bg-white text-gray-800"
        }`}
      >
        <div className={`border-b px-5 py-3 text-sm font-semibold ${isDark ? "border-white/10" : "border-gray-200"}`}>
          {zh ? "OfCourses AI 选课助手使用声明" : "OfCourses AI Assistant — Terms of Use"}
        </div>
        <div className={`flex-1 overflow-y-auto px-5 py-4 text-xs leading-relaxed ${isDark ? "text-white/75" : "text-gray-600"}`}>
          <p className="mb-3">
            {zh
              ? "在使用本助手前，请仔细阅读以下条款。"
              : "Please read the following terms carefully before using this assistant."}
          </p>
          {sections.map((s) => (
            <div key={s.h} className="mb-3">
              <div className={`mb-1 text-xs font-semibold ${isDark ? "text-white" : "text-gray-800"}`}>{s.h}</div>
              <div>{s.body}</div>
            </div>
          ))}
        </div>
        <div className={`flex items-center gap-2 px-5 py-3 ${isDark ? "border-white/10" : "border-gray-200"}`}>
          {agreed ? (
            <button
              onClick={onClose}
              className={`ml-auto cursor-pointer rounded-lg border px-4 py-1.5 text-xs font-medium ${
                isDark ? "border-white/20 text-white/80 hover:bg-white/5" : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {zh ? "关闭" : "Close"}
            </button>
          ) : (
            <>
              <button
                onClick={onDecline}
                className={`cursor-pointer rounded-lg border px-4 py-1.5 text-xs font-medium ${
                  isDark ? "border-white/20 text-white/60 hover:bg-white/5" : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {zh ? "不同意" : "Decline"}
              </button>
              <span className={`mr-auto text-[11px] ${isDark ? "text-white/40" : "text-gray-400"}`}>
                {zh ? "不同意则无法使用" : "Required to use the assistant"}
              </span>
              <button
                onClick={onAgree}
                className="cursor-pointer rounded-lg border-none bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
              >
                {zh ? "我已阅读并同意" : "I have read and agree"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
