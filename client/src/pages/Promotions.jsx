import { useEffect, useState } from "react";
import { api, fmtUsd } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { useT, useErr } from "../lib/i18n.jsx";
import { Panel } from "../components/game.jsx";
import { toast } from "../components/ui.jsx";

export default function Promotions() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = () => api("/promotions").then(setData).catch(() => setData(null));

  useEffect(() => {
    load();
  }, []);

  const act = async (which) => {
    setBusy(which);
    try {
      const r = await api(`/promotions/${which}`, { method: "POST", body: {} });
      toast(`${t("claimed")} ${fmtUsd(r.amount || 0)}`, "success");
      await Promise.all([load(), refresh()]);
    } catch (e) {
      toast(err(e.message), "error");
    } finally {
      setBusy(null);
    }
  };

  if (!data || !user) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="h-40 rounded-2xl bg-card/50 border border-border/50 animate-pulse" />
      </div>
    );
  }

  const s = data.settings;
  const u = data.user;
  const vip = u.vip;

  const cards = [];

  if (s.dailyEnabled)
    cards.push({
      key: "daily",
      icon: "🎁",
      title: t("daily_bonus"),
      body: `${t("day")} ${u.streakDay}/7 · ≤ ${fmtUsd(s.dailyMaxDay7)}`,
      action: u.canDaily ? t("claim") : t("claimed"),
      enabled: u.canDaily,
    });

  if (s.cashbackEnabled)
    cards.push({
      key: "cashback",
      icon: "↩️",
      title: `${t("cashback")} ${s.cashbackPct}%`,
      body: `${t("eligible")}: ${fmtUsd(u.cashbackEligible)}`,
      action: !u.cashbackClaimed && u.cashbackEligible > 0 ? t("claim") : t("claimed"),
      enabled: !u.cashbackClaimed && u.cashbackEligible > 0,
    });

  if (s.welcomeEnabled)
    cards.push({
      key: "welcome",
      icon: "🎉",
      title: t("welcome_bonus"),
      body: `${s.welcomeBonusPct}% ≤ ${fmtUsd(s.welcomeBonusMax)}`,
      action: null,
      enabled: false,
    });

  if (s.referralEnabled)
    cards.push({
      key: "referral",
      icon: "👥",
      title: t("referral_promo"),
      body: `${fmtUsd(s.referralBonus)} · ${u.referrals} · ${fmtUsd(u.referralEarned)}`,
      action: null,
      enabled: false,
      link: u.referralCode ? `${location.origin}/auth?ref=${u.referralCode}` : null,
    });

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black">{t("nav_promotions")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("streak")}: {u.streakDay} · {t("vip")}: {vip?.name}</p>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm">
          {t("prize_pool")}: <span className="font-bold text-primary">{fmtUsd(s.tournamentPool)}</span>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
        {cards.map((c) => (
          <div key={c.key} className="rounded-2xl border border-border/50 bg-card/50 p-6 flex flex-col">
            <div className="text-3xl mb-3">{c.icon}</div>
            <h3 className="font-bold text-lg">{c.title}</h3>
            <p className="text-sm text-muted-foreground mt-1 flex-1">{c.body}</p>
            {c.link && (
              <div className="mt-3 flex gap-2">
                <input
                  readOnly
                  value={c.link}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-secondary/50 border border-border text-xs font-mono"
                />
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(c.link);
                    toast(t("copied"), "success");
                  }}
                  className="px-3 rounded-lg bg-secondary border border-border text-xs font-semibold hover:border-primary/40 transition"
                >
                  {t("copy")}
                </button>
              </div>
            )}
            {c.action && (
              <button
                onClick={() => act(c.key === "daily" ? "daily" : "cashback")}
                disabled={!c.enabled || busy === c.key}
                className="mt-4 w-full py-2.5 rounded-xl font-semibold bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-40"
              >
                {busy === c.key ? t("processing") : c.action}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title={`${t("tournament")} · ${t("week")}`}>
          <div className="text-sm text-muted-foreground mb-3">{data.tournament.week}</div>
          <div className="space-y-2">
            {data.tournament.standings.map((r, i) => (
              <div key={r.id} className="flex items-center justify-between text-sm bg-secondary/30 border border-border/30 rounded-lg px-3 py-2">
                <span className="text-muted-foreground font-mono w-6">{i + 1}</span>
                <span className="flex-1 truncate font-semibold">{r.username}</span>
                <span className="font-mono text-muted-foreground">{fmtUsd(r.wagered)}</span>
                <span className="font-bold text-primary font-mono ml-3">{fmtUsd(r.profit)}</span>
              </div>
            ))}
            {!data.tournament.standings.length && <p className="text-sm text-muted-foreground">—</p>}
          </div>
        </Panel>

        <Panel title={t("vip")}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-lg text-primary">{vip?.name}</span>
              <span className="text-sm text-muted-foreground">
                {t("cashback")}: {vip?.cashback}% · {fmtUsd(vip?.from)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{
                  width: `${Math.min(
                    100,
                    vip?.next ? ((user.vipWagered ?? 0) / (vip.next.from || 1)) * 100 : 100
                  )}%`,
                }}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {vip?.next
                ? `${vip.next.name}: ${fmtUsd(vip.next.from)}`
                : t("all_time")}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="rounded-xl bg-secondary/40 border border-border/50 p-3 text-center">
                <div className="text-xs text-muted-foreground">{t("wagered")}</div>
                <div className="font-bold font-mono">{fmtUsd(u.vipWagered ?? 0)}</div>
              </div>
              <div className="rounded-xl bg-secondary/40 border border-border/50 p-3 text-center">
                <div className="text-xs text-muted-foreground">{t("boost_left")}</div>
                <div className="font-bold font-mono">{user.boostBetsLeft ?? 0}</div>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
