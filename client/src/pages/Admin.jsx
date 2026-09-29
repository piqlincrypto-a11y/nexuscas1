import { useEffect, useState, useCallback } from "react";
import { api, fmtUsd, dt } from "../lib/api.js";
import { useT, useErr } from "../lib/i18n.jsx";
import { Panel } from "../components/game.jsx";
import { StatCard, toast } from "../components/ui.jsx";

const TABS = [
  ["overview", "admin_overview"],
  ["players", "admin_players"],
  ["transactions", "admin_transactions"],
  ["bets", "admin_bets"],
  ["rounds", "admin_rounds"],
  ["settings", "admin_settings"],
  ["audit", "admin_audit"],
  ["referrals", "admin_referrals"],
];

const SETTING_GROUPS = [
  { title: "brand", keys: ["site_name", "site_tagline", "support_email", "promo_banner"] },
  { title: "house_edge", keys: ["house_edge_pct", "admin_commission_pct", "min_bet", "max_bet", "min_deposit", "min_withdraw"] },
  { title: "boost", keys: ["boost_enabled", "boost_bets", "registration_enabled", "deposit_enabled", "withdraw_enabled", "maintenance", "maintenance_msg"] },
  { title: "welcome_bonus", keys: ["welcome_bonus_enabled", "welcome_bonus_pct", "welcome_bonus_max"] },
  { title: "daily_bonus", keys: ["daily_bonus_enabled", "daily_bonus_max_day7"] },
  { title: "cashback", keys: ["cashback_enabled", "cashback_pct"] },
  { title: "tournament", keys: ["tournament_enabled", "tournament_pool"] },
  { title: "referral_promo", keys: ["referral_enabled", "referral_bonus", "referral_min_deposit"] },
  { title: "telegram", keys: ["tg_token", "tg_enabled", "tg_channel"] },
  { title: "webhook_secret", keys: ["webhook_secret"] },
  {
    title: "currency",
    keys: ["crypto_btc_address", "crypto_eth_address", "crypto_usdt_address", "crypto_ton_address", "rate_btc", "rate_eth", "rate_usdt", "rate_ton"],
  },
];

const BOOL_KEYS = new Set([
  "maintenance", "boost_enabled", "registration_enabled", "deposit_enabled", "withdraw_enabled",
  "welcome_bonus_enabled", "daily_bonus_enabled", "cashback_enabled", "tournament_enabled",
  "referral_enabled", "tg_enabled", "vip_enabled",
]);

export default function Admin() {
  const t = useT();
  const err = useErr();
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [players, setPlayers] = useState(null);
  const [tx, setTx] = useState(null);
  const [bets, setBets] = useState(null);
  const [rounds, setRounds] = useState(null);
  const [audit, setAudit] = useState(null);
  const [refs, setRefs] = useState(null);
  const [settings, setSettings] = useState(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOverview = useCallback(() => api("/admin/overview").then(setOverview).catch(() => {}), []);
  const loadPlayers = useCallback(() => api(`/admin/players?q=${encodeURIComponent(q)}`).then(setPlayers).catch(() => {}), [q]);
  const loadTx = useCallback(
    () => api(`/admin/transactions${statusFilter ? `?status=${statusFilter}` : ""}`).then(setTx).catch(() => {}),
    [statusFilter]
  );
  const loadBets = useCallback(() => api(`/admin/bets?q=${encodeURIComponent(q)}`).then(setBets).catch(() => {}), [q]);
  const loadSettings = useCallback(() => api("/admin/settings").then((d) => setSettings(d.settings)).catch(() => {}), []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (tab === "players") loadPlayers();
    if (tab === "transactions") loadTx();
    if (tab === "bets") loadBets();
    if (tab === "rounds") api("/admin/rounds").then(setRounds).catch(() => {});
    if (tab === "audit") api("/admin/audit").then(setAudit).catch(() => {});
    if (tab === "referrals") api("/admin/referrals").then(setRefs).catch(() => {});
    if (tab === "settings") loadSettings();
  }, [tab, loadPlayers, loadTx, loadBets, loadSettings]);

  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
      toast(t("save"), "success");
    } catch (e) {
      toast(err(e.message), "error");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = () =>
    act(async () => {
      const body = {};
      for (const g of SETTING_GROUPS) for (const k of g.keys) body[k] = settings[k];
      const r = await api("/admin/settings", { method: "POST", body });
      toast(`${t("save")} · ${r.changed.length}`, "success");
      loadOverview();
    });

  const playerAction = (id, body) =>
    act(async () => {
      await api(`/admin/players/${id}`, { method: "POST", body });
      loadPlayers();
      loadOverview();
    });

  const txAction = (id, action) =>
    act(async () => {
      await api(`/admin/transactions/${id}`, { method: "POST", body: { action } });
      loadTx();
      loadOverview();
    });

  const o = overview;
  const tabBtn = (k, label) => (
    <button
      key={k}
      onClick={() => setTab(k)}
      className={`px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition ${
        tab === k ? "bg-primary text-primary-foreground" : "bg-secondary border border-border hover:border-primary/40"
      }`}
    >
      {t(label)}
    </button>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-3xl font-black">{t("nav_admin")}</h1>
        <a
          href="/api/admin/export"
          className="px-4 py-2 rounded-lg bg-secondary border border-border text-sm font-semibold hover:border-primary/40 transition"
        >
          {t("export")}
        </a>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-5">
        {TABS.map(([k, label]) => tabBtn(k, label))}
      </div>

      {/* ------------------------------- overview ------------------------------ */}
      {tab === "overview" && o && (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={`${t("today")} · ${t("ggr")}`} value={fmtUsd(o.today.ggr)} accent="text-primary" />
            <StatCard label={`${t("week")} · ${t("ggr")}`} value={fmtUsd(o.week.ggr)} />
            <StatCard label={`${t("all")} · ${t("commission")}`} value={fmtUsd(o.all.commission)} accent="text-emerald-400" />
            <StatCard label={t("players")} value={o.all.players} sub={`${t("today")}: +${o.newPlayers}`} />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={`${t("staked")} (${t("all")})`} value={fmtUsd(o.all.staked)} />
            <StatCard label={`${t("paid")} (${t("all")})`} value={fmtUsd(o.all.paid)} />
            <StatCard label={t("pending_tx")} value={o.all.pendingTx} sub={fmtUsd(o.all.pendingWithdrawals)} />
            <StatCard label={t("today")} value={o.today.bets} sub={`${o.today.active} ${t("players")}`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Panel title={t("admin_bets")}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs uppercase">
                      <th className="text-left py-2">{t("nav_casino")}</th>
                      <th className="text-right py-2">{t("bets")}</th>
                      <th className="text-right py-2">{t("staked")}</th>
                      <th className="text-right py-2">{t("profit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(o.games || []).map((g) => (
                      <tr key={g.game} className="border-t border-border/40">
                        <td className="py-2 capitalize">{g.game}</td>
                        <td className="py-2 text-right">{g.bets}</td>
                        <td className="py-2 text-right font-mono">{fmtUsd(g.staked)}</td>
                        <td className={`py-2 text-right font-mono ${g.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {fmtUsd(g.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title={t("top_winners")}>
              <div className="space-y-2">
                {(o.topPlayers || []).map((p) => (
                  <div key={p.username} className="flex items-center justify-between text-sm bg-secondary/30 border border-border/30 rounded-lg px-3 py-2">
                    <span className="font-semibold truncate">{p.username}</span>
                    <span className="text-muted-foreground font-mono">{fmtUsd(p.balance)}</span>
                    <span className={`font-bold font-mono ${p.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtUsd(p.profit)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title={t("history")}>
            <div className="flex items-end gap-1 h-32">
              {(o.series || []).map((d) => {
                const max = Math.max(...o.series.map((x) => x.staked), 1);
                return (
                  <div
                    key={d.d}
                    className="flex-1 bg-primary/60 rounded-t"
                    style={{ height: `${Math.max(4, (d.staked / max) * 100)}%` }}
                    title={`${d.d}: ${fmtUsd(d.staked)}`}
                  />
                );
              })}
              {!o.series?.length && <div className="text-sm text-muted-foreground">—</div>}
            </div>
          </Panel>
        </div>
      )}

      {/* ------------------------------- players ------------------------------- */}
      {tab === "players" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search")}
              className="flex-1 px-3 py-2.5 rounded-xl bg-secondary/50 border border-border focus:border-primary/60 focus:outline-none text-sm"
            />
            <button
              onClick={loadPlayers}
              className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition"
            >
              {t("search")}
            </button>
          </div>
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs uppercase">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">{t("player")}</th>
                    <th className="text-right py-2 px-2">{t("balance")}</th>
                    <th className="text-right py-2 px-2">{t("bets")}</th>
                    <th className="text-right py-2 px-2">{t("deposit")}</th>
                    <th className="text-left py-2 px-2">{t("type")}</th>
                    <th className="text-left py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {(players?.items || []).map((p) => (
                    <tr key={p.id} className="border-t border-border/40">
                      <td className="py-2 px-2 font-mono text-muted-foreground">{p.id}</td>
                      <td className="py-2 px-2">
                        <div className="font-semibold">{p.username}</div>
                        <div className="text-xs text-muted-foreground">{p.email || p.ip || ""}</div>
                      </td>
                      <td className="py-2 px-2 text-right font-mono">{fmtUsd(p.balance)}</td>
                      <td className="py-2 px-2 text-right">{p.bets}</td>
                      <td className="py-2 px-2 text-right font-mono">{fmtUsd(p.deposited)}</td>
                      <td className="py-2 px-2 capitalize">
                        {p.role} {p.status !== "active" && <span className="text-red-400">· {p.status}</span>}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex flex-wrap gap-1 justify-end">
                          <button
                            onClick={() => {
                              const v = window.prompt(`${t("adjust")} (${p.username})`, "10000");
                              if (v) playerAction(p.id, { adjust: Number(v), note: "admin" });
                            }}
                            className="px-2 py-1 rounded bg-secondary border border-border text-xs hover:border-primary/40"
                          >
                            {t("adjust")}
                          </button>
                          <button
                            onClick={() => playerAction(p.id, { ban: p.status !== "banned", reason: "manual" })}
                            className="px-2 py-1 rounded bg-secondary border border-border text-xs hover:border-primary/40"
                          >
                            {p.status === "banned" ? t("unban") : t("ban")}
                          </button>
                          <button
                            onClick={() => {
                              const v = window.prompt(`${t("boost")} (${p.username})`, "30");
                              if (v !== null) playerAction(p.id, { boostBets: Number(v) });
                            }}
                            className="px-2 py-1 rounded bg-secondary border border-border text-xs hover:border-primary/40"
                          >
                            {t("boost")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!players?.items?.length && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-muted-foreground">
                        —
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ---------------------------- transactions ----------------------------- */}
      {tab === "transactions" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {["", "pending", "completed", "rejected"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition ${
                  statusFilter === s ? "bg-primary text-primary-foreground" : "bg-secondary border border-border"
                }`}
              >
                {s ? t(s) : t("all")}
              </button>
            ))}
          </div>
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs uppercase">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">{t("player")}</th>
                    <th className="text-left py-2 px-2">{t("type")}</th>
                    <th className="text-right py-2 px-2">{t("amount")}</th>
                    <th className="text-left py-2 px-2">{t("status")}</th>
                    <th className="text-left py-2 px-2 hidden sm:table-cell">{t("history")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(tx?.items || []).map((x) => (
                    <tr key={x.id} className="border-t border-border/40">
                      <td className="py-2 px-2 font-mono text-muted-foreground">{x.id}</td>
                      <td className="py-2 px-2">{x.username || `#${x.userId}`}</td>
                      <td className="py-2 px-2 capitalize">{x.type}</td>
                      <td className={`py-2 px-2 text-right font-mono ${x.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtUsd(x.amount)}
                      </td>
                      <td className="py-2 px-2 capitalize">{t(x.status)}</td>
                      <td className="py-2 px-2 text-xs text-muted-foreground hidden sm:table-cell">{dt(x.createdAt)}</td>
                      <td className="py-2 px-2">
                        {x.status === "pending" && (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => txAction(x.id, "approve")}
                              disabled={busy}
                              className="px-2 py-1 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-xs"
                            >
                              {t("approve")}
                            </button>
                            <button
                              onClick={() => txAction(x.id, "reject")}
                              disabled={busy}
                              className="px-2 py-1 rounded bg-red-600/20 border border-red-500/40 text-red-300 text-xs"
                            >
                              {t("reject")}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!tx?.items?.length && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-muted-foreground">
                        {t("no_tx")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* --------------------------------- bets -------------------------------- */}
      {tab === "bets" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search")}
              className="flex-1 px-3 py-2.5 rounded-xl bg-secondary/50 border border-border focus:border-primary/60 focus:outline-none text-sm"
            />
            <button
              onClick={loadBets}
              className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition"
            >
              {t("search")}
            </button>
          </div>
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs uppercase">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">{t("player")}</th>
                    <th className="text-left py-2 px-2">{t("nav_casino")}</th>
                    <th className="text-right py-2 px-2">{t("bet")}</th>
                    <th className="text-right py-2 px-2">{t("payout")}</th>
                    <th className="text-right py-2 px-2">{t("commission")}</th>
                    <th className="text-left py-2 px-2 hidden sm:table-cell">{t("history")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(bets?.items || []).map((b) => (
                    <tr key={b.id} className="border-t border-border/40">
                      <td className="py-2 px-2 font-mono text-muted-foreground">{b.id}</td>
                      <td className="py-2 px-2">{b.username}</td>
                      <td className="py-2 px-2 capitalize">{b.game}{b.boosted ? " ⭐" : ""}</td>
                      <td className="py-2 px-2 text-right font-mono">{fmtUsd(b.stake)}</td>
                      <td className="py-2 px-2 text-right font-mono">{fmtUsd(b.payout)}</td>
                      <td className="py-2 px-2 text-right font-mono text-primary">{fmtUsd(b.commission)}</td>
                      <td className="py-2 px-2 text-xs text-muted-foreground hidden sm:table-cell">{dt(b.createdAt)}</td>
                    </tr>
                  ))}
                  {!bets?.items?.length && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-muted-foreground">
                        —
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-muted-foreground mt-3">
              {bets?.total} {t("bets")} · {t("page")} {bets?.page}
            </div>
          </Panel>
        </div>
      )}

      {/* -------------------------------- rounds ------------------------------- */}
      {tab === "rounds" && (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-left py-2 px-2">{t("nav_casino")}</th>
                  <th className="text-left py-2 px-2">{t("status")}</th>
                  <th className="text-right py-2 px-2">{t("mp_pot")}</th>
                  <th className="text-right py-2 px-2">{t("commission")}</th>
                  <th className="text-left py-2 px-2 hidden md:table-cell">seedHash</th>
                  <th className="text-left py-2 px-2 hidden lg:table-cell">seed</th>
                </tr>
              </thead>
              <tbody>
                {(rounds?.items || []).map((r) => (
                  <tr key={r.id} className="border-t border-border/40">
                    <td className="py-2 px-2 font-mono text-muted-foreground">{r.id}</td>
                    <td className="py-2 px-2 capitalize">{r.game}</td>
                    <td className="py-2 px-2">{r.status}</td>
                    <td className="py-2 px-2 text-right font-mono">{fmtUsd(r.pot)}</td>
                    <td className="py-2 px-2 text-right font-mono text-primary">{fmtUsd(r.adminCut)}</td>
                    <td className="py-2 px-2 text-xs font-mono text-muted-foreground hidden md:table-cell">{(r.seedHash || "").slice(0, 16)}…</td>
                    <td className="py-2 px-2 text-xs font-mono text-muted-foreground hidden lg:table-cell">{(r.seed || "").slice(0, 16)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ------------------------------- settings ------------------------------ */}
      {tab === "settings" && settings && (
        <div className="space-y-5">
          {SETTING_GROUPS.map((g) => (
            <Panel key={g.title} title={t(g.title) || g.title}>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.keys.map((k) => (
                  <div key={k} className="space-y-1">
                    <label className="text-xs text-muted-foreground font-mono">{k}</label>
                    {BOOL_KEYS.has(k) ? (
                      <select
                        value={String(settings[k] ?? "0")}
                        onChange={(e) => setSettings({ ...settings, [k]: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-sm focus:border-primary/60 focus:outline-none"
                      >
                        <option value="1">ON</option>
                        <option value="0">OFF</option>
                      </select>
                    ) : (
                      <input
                        value={settings[k] ?? ""}
                        onChange={(e) => setSettings({ ...settings, [k]: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-sm font-mono focus:border-primary/60 focus:outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          ))}
          <button
            onClick={saveSettings}
            disabled={busy}
            className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 transition disabled:opacity-40"
          >
            {t("save_settings")}
          </button>
        </div>
      )}

      {/* --------------------------------- audit ------------------------------- */}
      {tab === "audit" && (
        <Panel>
          <div className="space-y-2">
            {(audit?.items || []).map((a) => (
              <div key={a.id} className="text-sm bg-secondary/30 border border-border/30 rounded-lg px-3 py-2">
                <div className="flex justify-between gap-3">
                  <span className="font-semibold">{a.action}</span>
                  <span className="text-xs text-muted-foreground">{dt(a.createdAt)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.admin} · {a.detail} {a.ip ? `· ${a.ip}` : ""}
                </div>
              </div>
            ))}
            {!audit?.items?.length && <p className="text-sm text-muted-foreground">—</p>}
          </div>
        </Panel>
      )}

      {/* ------------------------------ referrals ------------------------------ */}
      {tab === "referrals" && (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase">
                  <th className="text-left py-2">#</th>
                  <th className="text-left py-2">{t("referral_promo")}</th>
                  <th className="text-left py-2">{t("player")}</th>
                  <th className="text-right py-2">{t("amount")}</th>
                  <th className="text-left py-2">{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {(refs?.items || []).map((r) => (
                  <tr key={r.id} className="border-t border-border/40">
                    <td className="py-2 font-mono text-muted-foreground">{r.id}</td>
                    <td className="py-2">{r.referrer}</td>
                    <td className="py-2">{r.invitee}</td>
                    <td className="py-2 text-right font-mono">{fmtUsd(r.amount)}</td>
                    <td className="py-2 capitalize">{r.status}</td>
                  </tr>
                ))}
                {!refs?.items?.length && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
