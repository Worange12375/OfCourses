// 匿名投票设备标识：首次访问时生成一个随机 UUID 并持久化。
// 仅用于「同一设备只能投一次」的去重，不含任何个人信息。
const STORAGE_KEY = "oc_voter_id";

const randomId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
};

export const getVoterId = (): string => {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // localStorage 不可用（隐私模式等）：退化为会话级随机 ID。
    // 此时无法保证「一票定终身」，但不会因为存储异常导致功能不可用。
    return randomId();
  }
};
