import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtUsd, fmtMult, timeAgo } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { useT } from "../lib/i18n.jsx";
import { GAMES, SUB_KEYS } from "../lib/games.js";

const FEATURES = [
  { title: "pf_short", desc: "pf_desc" },
  { title: "g_mproulette", desc: "g_mproulette_sub" },
  { title: "g_poker", desc: "g_poker_sub" },
  { title: "welcome_bonus", desc: "hero_sub" },
];

export default function Home() {
  const { user } = useAuth();
  const t = useT();
  const [wins, setWins] = useState([]);
  const [cfg, setCfg] = useState(null);

  useEffect(() => {
    const load = () => {
      api("/feed/live")
        .then((d) => setWins(d.wins))
        .catch(() => {});
    };
    api("/games").then(setCfg).catch(() => {});
    load();
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(78%_0.18_55/0.12),transparent_60%)]" />
        <div className="relative max-w-7xl mx-auto px-4 py-24 sm:py-32 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            {t("hero_badge")}
          </div>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05]">
            {t("hero_1")}
            <br />
            <span className="text-primary">{t("hero_2")}</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">{t("hero_sub")}</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/casino"
              className="px-8 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:opacity-90 transition glow"
            >
              {user ? t("play_now") : t("get_started")}
            </Link>
            <Link
              to="/leaderboard"
              className="px-8 py-4 rounded-xl border border-border bg-secondary/50 font-semibold text-lg hover:bg-secondary transition"
            >
              {t("view_leaderboard")}
            </Link>
          </div>

          <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {[
              { label: t("total_games"), value: String(GAMES.length) },
              { label: t("rtp"), value: `${cfg ? cfg.rtp : "—"}%` },
              { label: t("min_bet"), value: cfg ? fmtUsd(cfg.minBet) : "—" },
              { label: t("live_wins"), value: String(wins.length) },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-border/50 bg-card/50 p-4">
                <div className="text-xl sm:text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-3xl font-black">{t("casino_games")}</h2>
            <p className="text-muted-foreground mt-1">{t("choose_game")}</p>
          </div>
          <Link to="/casino" className="text-primary text-sm font-semibold hover:underline hidden sm:block">
            {t("view_all")}
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {GAMES.map((g) => (
            <Link
              key={g.key}
              to={g.href}
              className={`group relative rounded-2xl border ${g.border} bg-gradient-to-br ${g.color} p-6 hover:scale-[1.02] transition-transform duration-200`}
            >
              {g.badge && (
                <span className={`absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${g.badgeColor}`}>
                  {g.badge}
                </span>
              )}
              <div className="text-5xl mb-4">{g.emoji}</div>
              <h3 className="text-xl font-bold">{t(g.key)}</h3>
              <p className="text-sm text-muted-foreground mt-1">{t(SUB_KEYS[g.key])}</p>
              <div className="mt-4 text-sm font-semibold text-primary opacity-0 group-hover:opacity-100 transition">
                {t("play_now")} →
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-black text-center">{t("why_title")}</h2>
        <p className="text-muted-foreground text-center mt-2">{t("why_sub")}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-10">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border/50 bg-card/50 p-6">
              <div className="text-3xl mb-3">✦</div>
              <h3 className="font-bold">{t(f.title)}</h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{t(f.desc)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="grid lg:grid-cols-2 gap-8">
          <div className="rounded-2xl border border-border/50 bg-card/50 p-6">
            <h3 className="font-bold text-lg mb-4">🔥 {t("live_wins")}</h3>
            <div className="space-y-3">
              {wins.length === 0 && <p className="text-sm text-muted-foreground">{t("no_wins")}</p>}
              {wins.slice(0, 12).map((w) => (
                <div key={w.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-secondary grid place-items-center text-sm">🎮</span>
                    <div>
                      <div className="text-sm font-semibold">{w.username}</div>
                      <div className="text-xs text-muted-foreground capitalize">{w.game}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-emerald-400">+{fmtUsd(w.profit)}</div>
                    <div className="text-xs text-muted-foreground">{timeAgo(w.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card/50 p-6">
            <h3 className="font-bold text-lg mb-4">⚡ {t("pf_short")}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">{t("pf_desc")}</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {["pf_l1", "pf_l2", "pf_l3", "pf_l4"].map((k) => (
                <li key={k} className="flex gap-2">
                  <span className="text-primary">✓</span>
                  {t(k)}
                </li>
              ))}
            </ul>
            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              {[["g_dice", "RTP"], ["g_limbo", "RTP"], ["g_crash", "RTP"]].map(([g, r]) => (
                <div key={g} className="rounded-xl bg-secondary/50 border border-border/50 p-3">
                  <div className="text-xs text-muted-foreground">{t(g)}</div>
                  <div className="text-sm font-bold text-primary">
                    {cfg ? `${cfg.rtp}%` : r}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-3xl sm:text-5xl font-black">{t("cta_title")}</h2>
        <p className="text-muted-foreground mt-4 text-lg">{t("cta_sub")}</p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/casino"
            className="px-8 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:opacity-90 transition"
          >
            {t("play_now")}
          </Link>
          <Link
            to="/promotions"
            className="px-8 py-4 rounded-xl border border-border bg-secondary/50 font-semibold text-lg hover:bg-secondary transition"
          >
            {t("view_promotions")}
          </Link>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">{t("demo_off")}</p>
      </section>
    </div>
  );
}
