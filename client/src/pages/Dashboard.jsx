import { useEffect, useState } from "react";
import { api, fmtUsd, dt, fmtMult, timeAgo } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { useT, useErr } from "../lib/i18n.jsx";
import { Panel } from "../components/game.jsx";
import { StatCard, toast, useConfirm } from "../components/ui.jsx";

const STATUS_CLS = {
  pending: "text-amber-400",
  completed: "text-emerald-400",
  rejected: "text-red-400",
};

export default function Dashboard() {
  const { user, refresh } = useAuth();
  const t = useT();
  const err = useErr();
  const [confirm, dialog] = useConfirm();
  const [wallet, setWallet] = useState(null);
  const [bets, setBets] = useState(null);
  const [tab, setTab] = useState("deposit");
  const [coin, setCoin] = useState("btc");
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [tg, setTg] = useState(null);
  const [tgCode, setTgCode] = useState(null);
  const [limits, setLimits] = useState({ bet: 0, loss: 0, session: 0 });

  const load = () => {
    api("/wallet").then(setWallet).catch(() => {});
    api("/me/bets").then(setBets).catch(() => setBets({ items: [], stats: {} }));
    api("/account/telegram").then(setTg).catch(() => {});
  };

  useEffect(() => {
    load();
    setLimits({
      bet: user?.dailyBetLimit || 0,
      loss: user?.dailyLossLimit || 0,
      session: user?.sessionLimitMin || 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const crypto = wallet?.cryptos?.find((c) => c.id === coin) || wallet?.cryptos?.[0];

  const submit = async () => {
    setBusy(true);
    try {
      if (tab === "deposit") {
        const r = await api("/wallet/deposit", { method: "POST", body: { crypto: coin, amount: Number(amount) } });
        toast(`${t("request_sent")} ${fmtUsd(r.usd)}`, "success");
      } else {
        const r = await api("/wallet/withdraw", {
          method: "POST",
          body: { crypto: coin, amount: Math.round(Number(amount) * 100), address },
        });
        toast(`${t("request_sent")} ${fmtUsd(r.usd)}`, "success");
      }
      setAmount("");
      setAddress("");
      await Promise.all([load(), refresh()]);
    } catch (e) {
      toast(err(e.message), "error");
    } finally {
      setBusy(false);
    }
  };

  const tgBind = async () => {
    try {
      const r = await api("/account/telegram/code", { method: "POST", body: {} });
      setTgCode(r);
    } catch (e) {
      toast(err(e.message), "error");
    }
  };

  const saveLimits = async () => {
    try {
      await api("/account/limits", { method: "POST", body: limits });
      await refresh();
      toast(t("saved") || t("save"), "success");
    } catch (e) {
      toast(err(e.message), "error");
    }
  };

  const exclude = async () => {
    const ok = await confirm(t("self_exclude") + " 7d?");
    if (!ok) return;
    try {
      await api("/account/self-exclude", { method: "POST", body: { days: 7 } });
      toast(t("self_exclude"), "success");
    } catch (e) {
      toast(err(e.message), "error");
    }
  };

  const referralLink = user?.referralCode ? `${location.origin}/auth?ref=${user.referralCode}` : "";
  const stats = bets?.stats || {};

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-black">{t("nav_dashboard")}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {user?.username} · {t("demo_off")}
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label={t("balance")} value={fmtUsd(user?.balance)} accent="text-primary" />
        <StatCard label={t("wagered")} value={fmtUsd(user?.vipWagered)} />
        <StatCard label={t("bets_placed")} value={bets?.total ?? "—"} />
        <StatCard label={t("boost_left")} value={user?.boostBetsLeft ?? 0} sub={`${t("vip")}: ${t("all")}`} />
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-6">
          {/* wallet */}
          <Panel>
            <div className="flex gap-2 mb-4">
              {[
                ["deposit", t("deposit")],
                ["withdraw", t("withdraw")],
              ].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                    tab === k ? "bg-primary text-primary-foreground" : "bg-secondary border border-border hover:border-primary/40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {wallet && !wallet.depositEnabled && tab === "deposit" && (
              <p className="text-sm text-amber-400 mb-3">{t("err_disabled")}</p>
            )}
            {wallet && !wallet.withdrawEnabled && tab === "withdraw" && (
              <p className="text-sm text-amber-400 mb-3">{t("err_disabled")}</p>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">{t("currency")}</label>
                <select
                  value={coin}
                  onChange={(e) => setCoin(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-secondary/50 border border-border focus:border-primary/60 focus:outline-none text-sm"
                >
                  {(wallet?.cryptos || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.symbol} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">
                  {tab === "deposit" ? `${t("amount")} (${crypto?.symbol || ""})` : `${t("amount")} (USD)`}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-secondary/50 border border-border focus:border-primary/60 focus:outline-none text-sm font-mono"
                  placeholder={tab === "deposit" ? "0.01" : "100"}
                />
              </div>
            </div>

            {crypto && (
              <div className="mt-3 text-xs text-muted-foreground space-y-1">
                <div>
                  {t("min_deposit")}: {fmtUsd(wallet?.minDeposit)} · {t("min_withdraw")}: {fmtUsd(wallet?.minWithdraw)}
                </div>
                {crypto.address && (
                  <div className="font-mono break-all bg-secondary/40 rounded-lg p-2 border border-border/40">
                    {t("address")}: {crypto.address}
                  </div>
                )}
                {amount > 0 && crypto.rate && (
                  <div>
                    ≈{" "}
                    {fmtUsd(
                      tab === "deposit"
                        ? Math.round(Number(amount) * crypto.rate * 100)
                        : Math.round(Number(amount) * 100)
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === "withdraw" && (
              <div className="mt-3 space-y-1.5">
                <label className="text-sm text-muted-foreground">{t("address")}</label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-secondary/50 border border-border focus:border-primary/60 focus:outline-none text-sm font-mono"
                  placeholder={`${crypto?.symbol || ""} address`}
                />
              </div>
            )}

            <button
              onClick={submit}
              disabled={busy || !amount || (tab === "withdraw" && address.length < 10)}
              className="mt-4 w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition disabled:opacity-40"
            >
              {busy ? t("processing") : tab === "deposit" ? t("deposit") : t("withdraw")}
            </button>
          </Panel>

          {/* transactions */}
          <Panel title={t("history_tx")}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs uppercase">
                    <th className="text-left py-2 px-3">{t("type")}</th>
                    <th className="text-right py-2 px-3">{t("amount")}</th>
                    <th className="text-left py-2 px-3">{t("currency")}</th>
                    <th className="text-left py-2 px-3">{t("status")}</th>
                    <th className="text-left py-2 px-3 hidden sm:table-cell">{t("history")}</th>
                  </tr>
                </thead>
                <tbody>
                  {!wallet?.history?.length && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-muted-foreground">
                        {t("no_tx")}
                      </td>
                    </tr>
                  )}
                  {(wallet?.history || []).map((h) => (
                    <tr key={h.id} className="border-t border-border/40">
                      <td className="py-2.5 px-3 capitalize">{h.type}</td>
                      <td className={`py-2.5 px-3 text-right font-mono ${h.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {h.amount >= 0 ? "+" : ""}
                        {fmtUsd(h.amount)}
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground uppercase">{h.crypto || "usd"}</td>
                      <td className={`py-2.5 px-3 capitalize ${STATUS_CLS[h.status] || ""}`}>{t(h.status)}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{dt(h.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* my bets */}
          <Panel title={t("your_bets")}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs uppercase">
                    <th className="text-left py-2 px-3">{t("nav_casino")}</th>
                    <th className="text-right py-2 px-3">{t("bet")}</th>
                    <th className="text-right py-2 px-3">{t("payout")}</th>
                    <th className="text-right py-2 px-3">{t("profit")}</th>
                    <th className="text-left py-2 px-3 hidden sm:table-cell">{t("history")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(bets?.items || []).map((b) => (
                    <tr key={b.id} className="border-t border-border/40">
                      <td className="py-2.5 px-3 capitalize">{b.game}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{fmtUsd(b.stake)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{fmtUsd(b.payout)}</td>
                      <td className={`py-2.5 px-3 text-right font-bold ${b.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtUsd(b.profit)}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{timeAgo(b.createdAt)}</td>
                    </tr>
                  ))}
                  {!bets?.items?.length && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-muted-foreground">
                        {t("no_bets")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4 text-center">
              <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
                <div className="text-xs text-muted-foreground">{t("staked")}</div>
                <div className="font-bold font-mono">{fmtUsd(stats.staked)}</div>
              </div>
              <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
                <div className="text-xs text-muted-foreground">{t("payout")}</div>
                <div className="font-bold font-mono">{fmtUsd(stats.paid)}</div>
              </div>
              <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
                <div className="text-xs text-muted-foreground">{t("profit")}</div>
                <div className={`font-bold font-mono ${stats.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {fmtUsd(stats.profit)}
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* side */}
        <div className="space-y-6">
          <Panel title={t("telegram")}>
            {user?.tgBound ? (
              <div className="text-sm text-emerald-400">{t("tg_bound")}</div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">{t("tg_how")}</p>
                {!tgCode ? (
                  <button
                    onClick={tgBind}
                    className="w-full py-2.5 rounded-xl bg-secondary border border-border font-semibold hover:border-primary/40 transition text-sm"
                  >
                    {t("tg_bind")}
                  </button>
                ) : (
                  <div className="text-center">
                    <div className="font-mono text-2xl font-black text-primary py-3">{tgCode.code}</div>
                    <div className="text-xs text-muted-foreground">
                      {tgCode.bot || t("tg_not_bound")} · {t("tg_how")}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title={t("referral_link")}>
            {referralLink ? (
              <div className="flex gap-2">
                <input
                  readOnly
                  value={referralLink}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-secondary/50 border border-border text-xs font-mono"
                />
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(referralLink);
                    toast(t("copied"), "success");
                  }}
                  className="px-3 rounded-lg bg-secondary border border-border text-xs font-semibold hover:border-primary/40 transition"
                >
                  {t("copy")}
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </Panel>

          <Panel title={t("responsible")}>
            <div className="space-y-3 text-sm">
              {[
                ["bet", t("daily_bet_limit")],
                ["loss", t("daily_loss_limit")],
                ["session", t("session_limit")],
              ].map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{label}</span>
                  <input
                    type="number"
                    min="0"
                    value={limits[k]}
                    onChange={(e) => setLimits({ ...limits, [k]: Number(e.target.value) || 0 })}
                    className="w-28 px-2 py-1.5 rounded-lg bg-secondary/50 border border-border font-mono text-sm text-right focus:border-primary/50 focus:outline-none"
                  />
                </div>
              ))}
              <button
                onClick={saveLimits}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition text-sm"
              >
                {t("save")}
              </button>
              <button
                onClick={exclude}
                className="w-full py-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 font-semibold hover:bg-red-500/25 transition text-sm"
              >
                {t("self_exclude")}
              </button>
            </div>
          </Panel>

          <Panel title={t("my_stats")}>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("vip")}</span>
                <span className="font-bold text-primary">{fmtUsd(user?.vipWagered)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("bets_placed")}</span>
                <span className="font-bold">{user?.betsCount ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("deposit")}</span>
                <span className="font-bold">{fmtUsd(wallet?.totals?.deposit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("withdraw")}</span>
                <span className="font-bold">{fmtUsd(wallet?.totals?.withdraw)}</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
      {dialog}
    </div>
  );
}
