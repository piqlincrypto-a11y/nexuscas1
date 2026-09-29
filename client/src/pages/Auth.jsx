import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.jsx";
import { useLang, useErr } from "../lib/i18n.jsx";
import { toast } from "../components/ui.jsx";

export default function Auth() {
  const { login, register } = useAuth();
  const { t, lang } = useLang();
  const err = useErr();
  const nav = useNavigate();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ref, setRef] = useState(new URLSearchParams(location.search).get("ref") || "");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        await login(username, password);
        toast(t("welcome_back"), "success");
      } else {
        await register({ username, email, password, referral: ref, lang });
        toast(t("auth_reg_sub"), "success");
      }
      nav("/dashboard");
    } catch (error) {
      toast(err(error.message), "error");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border focus:border-primary/60 focus:outline-none text-sm";

  return (
    <div className="min-h-[70vh] grid place-items-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-5xl">⚡</span>
          <h1 className="text-3xl font-black mt-4">{mode === "login" ? t("welcome_back") : t("create_account")}</h1>
          <p className="text-muted-foreground mt-2">{mode === "login" ? t("auth_login_sub") : t("auth_reg_sub")}</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-border/50 bg-card/50 p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">{t("username")}</label>
            <input
              required
              minLength={3}
              maxLength={20}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputCls}
              placeholder="lucky_player"
              autoComplete="username"
            />
          </div>

          {mode === "register" && (
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">
                {t("email")} <span className="text-xs">({t("optional")})</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">{t("password")}</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              placeholder="••••••••"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {mode === "register" && (
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">{t("referral_code")}</label>
              <input value={ref} onChange={(e) => setRef(e.target.value)} className={inputCls} placeholder="NXADMIN1" />
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition disabled:opacity-40"
          >
            {busy ? t("please_wait") : mode === "login" ? t("sign_in") : t("create_account")}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" ? t("no_account") : t("have_account")}
            <button
              type="button"
              className="text-primary font-semibold hover:underline"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? t("create_one") : t("sign_in")}
            </button>
          </p>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-6">{t("age_notice")}</p>
      </div>
    </div>
  );
}
