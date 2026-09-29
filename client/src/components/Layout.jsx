import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth.jsx";
import { api, fmtUsd } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";
import { Toaster } from "./ui.jsx";
import { useSocket } from "../lib/ws.js";

export function BalancePill({ balanceCents }) {
  return (
    <Link
      to="/dashboard"
      className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm font-semibold hover:bg-primary/20 transition"
    >
      <span className="font-bold">{fmtUsd(balanceCents)}</span>
    </Link>
  );
}

function LiveBalance() {
  const { user } = useAuth();
  const [cents, setCents] = useState(user?.balance ?? 0);

  useSocket((m) => {
    if (m.t === "balance") setCents(m.balance);
  });

  useEffect(() => {
    if (!user) return;
    setCents(user.balance);
    let alive = true;
    const tick = async () => {
      try {
        const me = await api("/auth/session");
        if (alive && me.user) setCents(me.user.balance);
      } catch {
        /* transient */
      }
    };
    const id = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user]);

  if (!user) return null;
  return <BalancePill balanceCents={cents} />;
}

function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
      {["ru", "en"].map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2 py-1.5 uppercase transition ${
            lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  const navCls = ({ isActive }) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition ${
      isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
    }`;

  const NAV = [
    { to: "/casino", label: t("nav_casino") },
    { to: "/promotions", label: t("nav_promotions") },
    { to: "/leaderboard", label: t("nav_leaderboard") },
    { to: "/mproulette", label: t("g_mproulette") },
    { to: "/poker", label: t("g_poker") },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Toaster />
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 font-black text-xl tracking-tight">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-primary text-primary-foreground text-lg">⚡</span>
              <span>{t("brand")}</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={navCls}>
                  {n.label}
                </NavLink>
              ))}
              {user?.role === "admin" && (
                <NavLink to="/admin" className={navCls}>
                  {t("nav_admin")}
                </NavLink>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <LangSwitch />
            <LiveBalance />
            {user ? (
              <>
                <Link
                  to="/dashboard"
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-sm hover:bg-secondary/70 transition"
                >
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary grid place-items-center text-xs font-bold">
                    {user.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="max-w-[100px] truncate">{user.username}</span>
                </Link>
                <button
                  onClick={logout}
                  className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition"
                >
                  {t("sign_out")}
                </button>
              </>
            ) : (
              <Link
                to="/auth"
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition"
              >
                {t("sign_in")}
              </Link>
            )}
            <button
              className="md:hidden p-2 rounded-lg hover:bg-secondary transition"
              onClick={() => setOpen((v) => !v)}
              aria-label="Menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>

        {open && (
          <nav className="md:hidden border-t border-border/50 px-4 py-2 flex flex-col gap-1 bg-background">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={navCls}>
                {n.label}
              </NavLink>
            ))}
            {user && (
              <NavLink to="/dashboard" className={navCls}>
                {t("nav_dashboard")}
              </NavLink>
            )}
            {user?.role === "admin" && (
              <NavLink to="/admin" className={navCls}>
                {t("nav_admin")}
              </NavLink>
            )}
          </nav>
        )}
      </header>

      <main className="flex-1 pt-16">{children}</main>

      <footer className="border-t border-border/50 mt-16">
        <div className="max-w-7xl mx-auto px-4 py-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <div className="flex items-center gap-2 font-black text-lg mb-3">
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-primary text-primary-foreground">⚡</span>
              {t("brand")}
            </div>
            <p className="text-muted-foreground leading-relaxed">{t("hero_sub")}</p>
          </div>
          <div>
            <div className="font-semibold mb-3">{t("casino_games")}</div>
            <ul className="space-y-2 text-muted-foreground">
              {[
                ["/casino/crash", "g_crash"],
                ["/casino/dice", "g_dice"],
                ["/casino/mines", "g_mines"],
                ["/casino/limbo", "g_limbo"],
                ["/casino/roulette", "g_roulette"],
                ["/casino/slots", "g_slots"],
                ["/casino/plinko", "g_plinko"],
                ["/casino/keno", "g_keno"],
              ].map(([to, key]) => (
                <li key={to}>
                  <Link className="hover:text-foreground" to={to}>
                    {t(key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-3">{t("provably_fair")}</div>
            <ul className="space-y-2 text-muted-foreground">
              <li>{t("pf_l1")}</li>
              <li>18+. {t("age_notice").split(".")[0]}.</li>
              <li>{t("demo_off")}</li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-3">{t("nav_promotions")}</div>
            <ul className="space-y-2 text-muted-foreground">
              <li>
                <Link className="hover:text-foreground" to="/promotions">
                  {t("nav_promotions")}
                </Link>
              </li>
              <li>
                <Link className="hover:text-foreground" to="/leaderboard">
                  {t("nav_leaderboard")}
                </Link>
              </li>
              <li>
                <Link className="hover:text-foreground" to="/dashboard">
                  {t("nav_wallet")}
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/50 py-5 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {t("brand")}. 18+.
        </div>
      </footer>
    </div>
  );
}
