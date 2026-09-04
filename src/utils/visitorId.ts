// 匿名访客标识：首次访问时生成一个随机 UUID 并持久化，用于统计独立访客数（UV）。
// 与 voterId 相互独立：voterId 用于投票去重，visitorId 用于站点统计，互不干扰。
// 不含任何个人信息，也不采集 IP（IP 只在服务端以加盐哈希形式粗略记录）。
const STORAGE_KEY = "oc_visitor_id";

const randomId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
};

// localStorage 不可用（隐私模式等）时的会话级兜底 ID，保证同一次访问内 ID 稳定
let sessionId: string | null = null;

export const getVisitorId = (): string => {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    if (!sessionId) sessionId = randomId();
    return sessionId;
  }
};

/**
 * 上报一次访问（PV）。服务端按 vid 去重得到 UV。
 * 任何失败都静默吞掉——统计功能绝不能影响主功能可用性。
 */
export const reportVisit = (path: string, mobile: boolean): void => {
  try {
    // 本地开发没有后端，不上报
    if (import.meta.env.DEV) return;
    void fetch("/track", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({vid: getVisitorId(), path, mobile}),
    }).catch(() => {});
  } catch {
    // 忽略
  }
};
