/**
 * 登录/注册/重置密码弹窗（三步：邮箱 → 验证码 → 设密码；或直接登录）
 *
 * 体验与安全设计（2026-11-14 用户反馈落地）：
 * - 邮箱输入框与固定后缀 @mails.tsinghua.edu.cn 同行对齐（业内惯例），粘贴完整邮箱自动截取前缀
 * - 注册第 2 步可返回第 1 步改邮箱；改邮箱即清前端冷却提示（服务端 60s 冷却按邮箱独立计算）
 * - 第 2 步「重新发送」需重新过人机验证（题目自动拉取，答完才可重发）
 * - 第 3 步密码需二次输入确认，无返回（流程单向收敛）
 * - 忘记密码：登录页入口 → 复用三步流程，重置成功自动登录
 * - 后端 422 数组类错误统一映射为可读文案，杜绝 [object Object] 泄露
 */

import {useCallback, useEffect, useRef, useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useAccount} from "./AccountContext";
import {AccountError} from "../api/account";

const EMAIL_SUFFIX = "@mails.tsinghua.edu.cn";

const ERR_ZH: Record<string, string> = {
    email_domain_not_allowed: "仅支持清华学生邮箱（@mails.tsinghua.edu.cn）",
    email_taken: "该邮箱已注册，请直接登录",
    code_cooldown: "发送太频繁，请稍等 1 分钟再试",
    code_wrong: "验证码错误",
    code_expired: "验证码已过期，请重新发送",
    code_locked: "错误次数过多，请重新发送验证码",
    no_code: "请先获取验证码",
    reg_token_expired: "验证会话已过期，请重新验证",
    reg_token_wrong: "验证会话无效，请重新验证",
    reg_token_required: "请先完成邮箱验证",
    wrong_credentials: "邮箱或密码错误",
    bad_nickname: "昵称需 2~24 个字符（中英文/数字/下划线/连字符）",
    bad_cohort: "字班格式不正确",
    network_error: "网络异常，请检查连接后重试",
    email_service_unconfigured: "邮件服务暂未配置，请联系管理员",
    email_send_failed: "邮件发送失败，请稍后重试",
    mail_quota_exceeded: "今日验证码发放额度已用尽，请明天再试",
    captcha_wrong: "算术题答案不对，请重试",
    captcha_expired: "验证已过期，请换一题",
    name_taken: "该方案名已被使用",
    email_not_registered: "该邮箱尚未注册，请先注册",
    too_many_requests: "操作太频繁，请稍后再试",
};

const ERR_EN: Record<string, string> = {
    email_domain_not_allowed: "Only Tsinghua student emails (@mails.tsinghua.edu.cn) are allowed",
    email_taken: "This email is already registered, please log in",
    code_cooldown: "Too frequent — wait 1 minute and retry",
    code_wrong: "Incorrect verification code",
    code_expired: "Code expired, please request a new one",
    code_locked: "Too many attempts, please request a new code",
    no_code: "Please request a verification code first",
    reg_token_expired: "Verification session expired, please verify again",
    reg_token_wrong: "Invalid verification session, please verify again",
    reg_token_required: "Please complete email verification first",
    wrong_credentials: "Wrong email or password",
    bad_nickname: "Nickname must be 2-24 chars (letters/digits/underscore/hyphen/CJK)",
    bad_cohort: "Invalid cohort format",
    network_error: "Network error, please check your connection",
    email_service_unconfigured: "Email service not configured yet, contact the admin",
    email_send_failed: "Failed to send email, please retry later",
    mail_quota_exceeded: "Daily email quota exhausted — please try tomorrow",
    captcha_wrong: "Wrong answer, please retry",
    captcha_expired: "Challenge expired, please get a new one",
    name_taken: "Plan name already in use",
    email_not_registered: "This email is not registered yet, please sign up first",
    too_many_requests: "Too many requests, please slow down",
};

export const AuthModal = () => {
    const {locale} = useLocale();
    const {theme} = useAppTheme();
    const isDark = theme === "dark";
    const {authModalOpen, closeAuthModal, login, register, requestCode, verifyCode, resetPassword} = useAccount();
    const zh = locale === "zh";

    const [mode, setMode] = useState<"login" | "register" | "reset">("login");
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [emailName, setEmailName] = useState("");       // 只存 @ 前缀
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [password2, setPassword2] = useState("");
    const [nickname, setNickname] = useState("");
    const [regToken, setRegToken] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [cooldown, setCooldown] = useState(0);
    const [captcha, setCaptcha] = useState<{id: string; q: string} | null>(null);
    const [captchaAnswer, setCaptchaAnswer] = useState("");
    const [needCaptcha, setNeedCaptcha] = useState(false); // 点击「获取验证码」且邮箱判定通过后才弹人机验证
    const timerRef = useRef<number | null>(null);
    const lastSentEmailRef = useRef(""); // 上次成功发码的邮箱；邮箱改动即清前端冷却提示

    const email = `${emailName}${EMAIL_SUFFIX}`;
    const emailNameOk = /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(emailName);

    useEffect(() => {
        if (authModalOpen) {
            setMode("login");
            setStep(1);
            setEmailName("");
            setCode("");
            setPassword("");
            setPassword2("");
            setNickname("");
            setRegToken("");
            setErr("");
            setCooldown(0);
            setCaptcha(null);
            setCaptchaAnswer("");
            setNeedCaptcha(false);
            lastSentEmailRef.current = "";
        }
    }, [authModalOpen]);

    useEffect(() => () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
    }, []);

    const startCooldown = useCallback((sec: number) => {
        setCooldown(sec);
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = window.setInterval(() => {
            setCooldown((c) => {
                if (c <= 1 && timerRef.current) window.clearInterval(timerRef.current);
                return c - 1;
            });
        }, 1000);
    }, []);

    const fetchCaptcha = useCallback(() => {
        setCaptchaAnswer("");
        fetch("/vote/account/captcha", {credentials: "same-origin"})
            .then((r) => r.json())
            .then((d) => setCaptcha({id: d.id, q: d.q}))
            .catch(() => setCaptcha(null));
    }, []);

    // 人机验证题改为点击「获取验证码」后才拉取，不再自动预取

    if (!authModalOpen) return null;

    const errText = (e: unknown) => {
        let detail: unknown = "network_error";
        if (e instanceof AccountError) detail = e.detail;
        if (Array.isArray(detail)) {
            // FastAPI 422 校验错误数组 → 人话（杜绝 [object Object]）
            return zh ? "输入格式有误，请检查邮箱与密码（密码至少 8 位）" : "Invalid input — check email and password (min 8 chars)";
        }
        const key = typeof detail === "string" ? detail : "network_error";
        return (zh ? ERR_ZH[key] : ERR_EN[key]) ?? key;
    };

    const handleEmailName = (v: string) => {
        // 允许直接粘贴完整邮箱：截取 @ 前缀
        const name = v.includes("@") ? v.split("@")[0] : v;
        setEmailName(name);
        // 邮箱改动后清掉前端冷却提示：服务端 60s 冷却按邮箱独立计算，换邮箱可立即发码
        if (lastSentEmailRef.current && `${name}${EMAIL_SUFFIX}` !== lastSentEmailRef.current) {
            if (timerRef.current) window.clearInterval(timerRef.current);
            setCooldown(0);
        }
        // 前缀改动后重新走邮箱判定，人机验证行收回
        setNeedCaptcha(false);
    };

    // 「获取验证码」点击：先做本地邮箱判定，通过后才弹人机验证行
    const handleRequestCode = () => {
        setErr("");
        if (!emailNameOk) {
            setErr(zh ? "请输入正确的邮箱前缀（字母/数字开头，2~64 位）" : "Invalid email prefix (starts with a letter/digit, 2-64 chars)");
            return;
        }
        fetchCaptcha();
        setNeedCaptcha(true);
    };

    const sendCode = async () => {
        setErr("");
        if (!captcha) {
            // 尚无人机验证题（如 step2 点重发）：自动拉题，待用户作答后按钮才可用
            fetchCaptcha();
            setNeedCaptcha(true);
            setErr(zh ? "请先完成人机验证" : "Please complete the human check first");
            return;
        }
        if (captchaAnswer === "") {
            setErr(zh ? "请先填写算术题答案" : "Please answer the question first");
            return;
        }
        setBusy(true);
        try {
            const r = await requestCode(email, captcha.id, captchaAnswer);
            startCooldown(Math.min(60, Math.max(10, Math.floor(r.expires_in / 10))));
            lastSentEmailRef.current = email;
            setCaptcha(null);
            setCaptchaAnswer("");
            setNeedCaptcha(false);
            setStep(2);
        } catch (e) {
            setErr(errText(e));
            fetchCaptcha(); // 失败换一题重试
        } finally {
            setBusy(false);
        }
    };

    const doVerify = async () => {
        setErr("");
        setBusy(true);
        try {
            setRegToken(await verifyCode(email, code));
            setStep(3);
        } catch (e) {
            setErr(errText(e));
        } finally {
            setBusy(false);
        }
    };

    const doRegister = async () => {
        setErr("");
        if (password !== password2) {
            setErr(zh ? "两次输入的密码不一致" : "Passwords do not match");
            return;
        }
        setBusy(true);
        try {
            if (mode === "reset") {
                // 重置密码：成功后后端清空旧会话，context 会自动重新登录并关闭弹窗
                await resetPassword(email, regToken, password);
            } else {
                await register(email, regToken, password, nickname);
            }
        } catch (e) {
            setErr(errText(e));
        } finally {
            setBusy(false);
        }
    };

    const doLogin = async () => {
        setErr("");
        setBusy(true);
        try {
            await login(email, password);
        } catch (e) {
            setErr(errText(e));
        } finally {
            setBusy(false);
        }
    };

    const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${
        isDark ? "border-white/10 bg-white/5 text-white/90 placeholder-white/30 focus:border-[#863bff]" : "border-gray-200 bg-white text-gray-800 placeholder-gray-400 focus:border-[#863bff]"
    }`;
    const btnPrimary = `w-full cursor-pointer rounded-lg border-none py-2 text-sm font-medium text-white transition-colors ${
        busy ? "opacity-60" : "hover:opacity-90"
    } bg-[#863bff]`;
    const label = `mb-1 block text-xs font-medium ${isDark ? "text-white/70" : "text-gray-600"}`;
    // 邮箱输入行：输入框与固定后缀同行、后缀在框外侧（【name】@mails.tsinghua.edu.cn）
    const emailRow = (
        <div className="flex items-center gap-2">
            <input
                className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${
                    isDark ? "border-white/10 bg-white/5 text-white/90 placeholder-white/30 focus:border-[#863bff]" : "border-gray-200 bg-white text-gray-800 placeholder-gray-400 focus:border-[#863bff]"
                }`}
                type="text"
                value={emailName}
                onChange={(e) => handleEmailName(e.target.value)}
                placeholder="name"
                autoComplete="username"
            />
            <span className={`shrink-0 select-none text-sm ${isDark ? "text-white/50" : "text-gray-500"}`}>
                {EMAIL_SUFFIX}
            </span>
        </div>
    );
    // 人机验证行（发码前必答；step1 常驻，step2 点「重新发送」时出现）
    const captchaRow = (
        <div>
            <span className={label}>
                {zh ? "人机验证" : "Human check"}
                <button
                    onClick={fetchCaptcha}
                    className="ml-2 cursor-pointer border-none bg-transparent text-[11px] text-[#863bff] hover:underline"
                >
                    {zh ? "换一题" : "New question"}
                </button>
            </span>
            <div className="flex items-center gap-2">
                <span className={`shrink-0 rounded-md px-2.5 py-2 text-sm font-semibold tracking-wider ${
                    isDark ? "bg-white/10 text-white/85" : "bg-gray-100 text-gray-700"
                }`}>
                    {captcha ? `${captcha.q} = ?` : "…"}
                </span>
                <input
                    className={`${inputCls} flex-1`}
                    inputMode="numeric"
                    maxLength={3}
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value.replace(/\D/g, ""))}
                    placeholder={zh ? "答案" : "answer"}
                />
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{background: "rgba(0,0,0,0.45)"}} onClick={closeAuthModal}>
            <div
                className={`w-[360px] max-w-[92vw] rounded-2xl border p-5 shadow-2xl ${isDark ? "border-white/10 bg-[#1e1e2a]" : "border-gray-200 bg-white"}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex gap-1 rounded-lg p-0.5" style={{background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}}>
                        {(["login", "register"] as const).map((m) => (
                            <button
                                key={m}
                                onClick={() => { setMode(m); setStep(1); setErr(""); setCode(""); setRegToken(""); setCaptcha(null); setCaptchaAnswer(""); setNeedCaptcha(false); }}
                                className={`cursor-pointer rounded-md border-none px-3 py-1 text-xs font-medium transition-colors ${
                                    mode === m ? "bg-[#863bff] text-white" : isDark ? "text-white/60 hover:text-white" : "text-gray-500 hover:text-gray-800"
                                }`}
                            >
                                {m === "login" ? (zh ? "登录" : "Sign in") : (zh ? "注册" : "Sign up")}
                            </button>
                        ))}
                    </div>
                    <button onClick={closeAuthModal} className={`cursor-pointer border-none bg-transparent text-base leading-none ${isDark ? "text-white/50 hover:text-white" : "text-gray-400 hover:text-gray-700"}`}>✕</button>
                </div>

                {mode === "login" ? (
                    <div className="space-y-3">
                        <div>
                            <span className={label}>{zh ? "清华邮箱" : "Tsinghua email"}</span>
                            {emailRow}
                        </div>
                        <div>
                            <span className={label}>{zh ? "密码" : "Password"}</span>
                            <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLogin()} />
                        </div>
                        {err && <div className="text-xs text-red-500">{err}</div>}
                        <button className={btnPrimary} disabled={busy || !emailNameOk} onClick={doLogin}>{zh ? "登录" : "Sign in"}</button>
                        <div className="flex items-center justify-between text-[11px]">
                            <button
                                onClick={() => { setMode("reset"); setStep(1); setErr(""); setCode(""); setCaptcha(null); setCaptchaAnswer(""); setNeedCaptcha(false); }}
                                className={`cursor-pointer border-none bg-transparent hover:underline ${isDark ? "text-[#c4a8ff]" : "text-[#863bff]"}`}
                            >
                                {zh ? "忘记密码？" : "Forgot password?"}
                            </button>
                            <span className={isDark ? "text-white/40" : "text-gray-400"}>
                                {zh ? "没有账号？切到「注册」" : "No account? Use Sign up"}
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {/* 步骤指示 */}
                        <div className="flex items-center gap-1.5">
                            {[1, 2, 3].map((s) => (
                                <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${step >= s ? "bg-[#863bff]" : isDark ? "bg-white/10" : "bg-gray-200"}`} />
                            ))}
                        </div>
                        <div className={`text-xs ${isDark ? "text-white/60" : "text-gray-500"}`}>
                            {step === 1 && (mode === "reset"
                                ? (zh ? "第 1 步 / 共 3 步：输入账号邮箱，获取验证码" : "Step 1/3: Enter your email for a code")
                                : (zh ? "第 1 步 / 共 3 步：输入清华学生邮箱，获取验证码" : "Step 1/3: Enter your Tsinghua email for a code"))}
                            {step === 2 && (zh ? "第 2 步 / 共 3 步：输入邮件中的 6 位验证码" : "Step 2/3: Enter the 6-digit code from your inbox")}
                            {step === 3 && (mode === "reset"
                                ? (zh ? "第 3 步 / 共 3 步：设置新密码" : "Step 3/3: Set a new password")
                                : (zh ? "第 3 步 / 共 3 步：设置密码与昵称" : "Step 3/3: Set password and nickname"))}
                        </div>
                        {step === 1 && (
                            <>
                                <div>
                                    <span className={label}>{zh ? "清华邮箱" : "Tsinghua email"}</span>
                                    {emailRow}
                                </div>
                                {/* 人机验证：点「获取验证码」且邮箱判定通过后才弹出 */}
                                {needCaptcha && captchaRow}
                                {err && <div className="text-xs text-red-500">{err}</div>}
                                <button
                                    className={btnPrimary}
                                    disabled={busy || cooldown > 0 || (needCaptcha && (!captcha || captchaAnswer === ""))}
                                    onClick={needCaptcha ? sendCode : handleRequestCode}
                                >
                                    {cooldown > 0
                                        ? (zh ? `重新发送（${cooldown}s）` : `Resend (${cooldown}s)`)
                                        : busy
                                            ? (zh ? "发送中…" : "Sending…")
                                            : needCaptcha
                                                ? (zh ? "确认发送" : "Confirm")
                                                : (zh ? "获取验证码" : "Send code")}
                                </button>
                            </>
                        )}
                        {step === 2 && (
                            <>
                                <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                                    isDark ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                }`}>
                                    ✓ {zh ? `验证码已发送至 ${email}` : `Code sent to ${email}`}
                                    <div className={isDark ? "text-white/40" : "text-gray-400"}>
                                        {zh ? "收不到？可返回上一步确认邮箱是否正确" : "Not received? Go back to check the address"}
                                    </div>
                                </div>
                                <input className={`${inputCls} text-center text-lg tracking-[0.3em]`} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
                                {/* 点过「重新发送」后出现的人机验证行（重发必须先过验证） */}
                                {needCaptcha && captchaRow}
                                {err && <div className="text-xs text-red-500">{err}</div>}
                                <button className={btnPrimary} disabled={busy || code.length !== 6} onClick={doVerify}>
                                    {zh ? "验证" : "Verify"}
                                </button>
                                <div className="flex items-center justify-between">
                                    <button
                                        onClick={() => { setStep(1); setErr(""); setCode(""); }}
                                        className={`cursor-pointer border-none bg-transparent text-xs hover:underline ${isDark ? "text-white/50" : "text-gray-500"}`}
                                    >
                                        ← {zh ? "返回修改邮箱" : "Back to email"}
                                    </button>
                                    <button
                                        onClick={sendCode}
                                        disabled={cooldown > 0 || busy || !captcha || captchaAnswer === ""}
                                        className={`cursor-pointer border-none bg-transparent text-xs ${cooldown > 0 ? (isDark ? "text-white/30" : "text-gray-400") : "text-[#863bff] hover:underline"}`}
                                    >
                                        {cooldown > 0 ? (zh ? `重新发送（${cooldown}s）` : `Resend (${cooldown}s)`) : (zh ? "重新发送" : "Resend")}
                                    </button>
                                </div>
                            </>
                        )}
                        {step === 3 && (
                            <>
                                <div>
                                    <span className={label}>{mode === "reset" ? (zh ? "新密码（至少 8 位）" : "New password (min 8 chars)") : (zh ? "密码（至少 8 位）" : "Password (min 8 chars)")}</span>
                                    <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                                </div>
                                <div>
                                    <span className={label}>{zh ? "确认密码" : "Confirm password"}</span>
                                    <input className={inputCls} type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
                                </div>
                                {mode === "register" && (
                                    <div>
                                        <span className={label}>{zh ? "昵称（选填，默认取邮箱前缀）" : "Nickname (optional, defaults to email prefix)"}</span>
                                        <input className={inputCls} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={emailName} onKeyDown={(e) => e.key === "Enter" && doRegister()} />
                                    </div>
                                )}
                                {err && <div className="text-xs text-red-500">{err}</div>}
                                <button className={btnPrimary} disabled={busy || password.length < 8 || password !== password2} onClick={doRegister}>
                                    {mode === "reset"
                                        ? (busy ? (zh ? "重置中…" : "Resetting…") : (zh ? "重置密码" : "Reset password"))
                                        : (busy ? (zh ? "创建中…" : "Creating…") : (zh ? "完成注册" : "Create account"))}
                                </button>
                            </>
                        )}
                        <div className={`text-[11px] leading-relaxed ${isDark ? "text-white/35" : "text-gray-400"}`}>
                            {mode === "reset" ? (
                                <button
                                    onClick={() => { setMode("login"); setStep(1); setErr(""); setNeedCaptcha(false); }}
                                    className={`cursor-pointer border-none bg-transparent hover:underline ${isDark ? "text-[#c4a8ff]" : "text-[#863bff]"}`}
                                >
                                    ← {zh ? "返回登录" : "Back to sign in"}
                                </button>
                            ) : (
                                <>
                                    {zh
                                        ? "仅支持清华学生邮箱；邮箱仅用于身份验证，不会公开展示。"
                                        : "Tsinghua student emails only; your email is used for verification only and never shown publicly."}
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
