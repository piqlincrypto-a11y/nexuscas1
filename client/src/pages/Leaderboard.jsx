import { useEffect, useState } from "react";
import { api, fmtUsd, timeAgo } from "../lib/api.js";
import { useT } from "../lib/i18n.jsx";
import { Panel } from "../components/game.jsx";

export default function Leaderboard() {
  const t = useT();
  const [period, setPeriod] = useState("week");
  const [data, setData] = useState(null);
  const [feed, setFeed] = useState(null);

  useEffect(() => {
    api(`/leaderboard?period=${period}`).then(setData).catch(() => setData({ rows: [], tournament: [], pool: 0 }));
    api("/feed/live").then(setFeed).catch(() => setFeed({ wins: [], top: [], mostPlayed: [] }));
  }, [period]);

  const rows = data?.rows || [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black">{t("nav_leaderboard")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("choose_game")}</p>
        </div>
        <div className="flex gap-2">
          {[
            ["week", t("week")],
            ["all", t("all_time")],
          ].map(([p, label]) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                period === p ? "bg-primary text-primary-foreground" : "bg-secondary border border-border hover:border-primary/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase">
                  <th className="text-left py-2 px-3">#</th>
                  <th className="text-left py-2 px-3">{t("player")}</th>
                  <th className="text-right py-2 px-3">{t("wagered")}</th>
                  <th className="text-right py-2 px-3">{t("bets")}</th>
                  <th className="text-right py-2 px-3">{t("profit")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">
                      —
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={r.id} className="border-t border-border/40">
                    <td className="py-2.5 px-3 font-mono text-muted-foreground">{i + 1}</td>
                    <td className="py-2.5 px-3 font-semibold">
                      {i < 3 ? ["🥇", "🥈", "🥉"][i] : ""} {r.username}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">{fmtUsd(r.wagered)}</td>
                    <td className="py-2.5 px-3 text-right text-muted-foreground">{r.bets}</td>
                    <td className={`py-2.5 px-3 text-right font-bold ${r.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {fmtUsd(r.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel title={`${t("tournament")} · ${t("prize_pool")} ${fmtUsd(data?.pool || 0)}`}>
            <div className="space-y-2">
              {(data?.tournament || []).slice(0, 10).map((r, i) => (
                <div key={r.id} className="flex items-center justify-between text-sm bg-secondary/30 border border-border/30 rounded-lg px-3 py-2">
                  <span className="text-muted-foreground font-mono">{i + 1}</span>
                  <span className="font-semibold truncate">{r.username}</span>
                  <span className="font-bold text-primary font-mono">{fmtUsd(r.profit)}</span>
                </div>
              ))}
              {!data?.tournament?.length && <p className="text-sm text-muted-foreground">—</p>}
            </div>
          </Panel>

          <Panel title={t("top_winners")}>
            <div className="space-y-2">
              {(feed?.top || []).map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="truncate">{r.username}</span>
                  <span className="font-bold text-emerald-400 font-mono">{fmtUsd(r.profit)}</span>
                </div>
              ))}
              {!feed?.top?.length && <p className="text-sm text-muted-foreground">—</p>}
            </div>
          </Panel>

          <Panel title={t("most_played")}>
            <div className="space-y-2">
              {(feed?.mostPlayed || []).map((r) => (
                <div key={r.game} className="flex items-center justify-between text-sm capitalize">
                  <span>{r.game}</span>
                  <span className="text-muted-foreground font-mono">{fmtUsd(r.staked)}</span>
                </div>
              ))}
              {!feed?.mostPlayed?.length && <p className="text-sm text-muted-foreground">—</p>}
            </div>
          </Panel>

          <Panel title={t("live_wins")}>
            <div className="space-y-2 max-h-[260px] overflow-y-auto">
              {(feed?.wins || []).slice(0, 10).map((w) => (
                <div key={w.id} className="flex items-center justify-between text-sm">
                  <div>
                    <div className="font-semibold truncate">{w.username}</div>
                    <div className="text-xs text-muted-foreground capitalize">{w.game} · {timeAgo(w.createdAt)}</div>
                  </div>
                  <span className="font-bold text-emerald-400 font-mono">+{fmtUsd(w.profit)}</span>
                </div>
              ))}
              {!feed?.wins?.length && <p className="text-sm text-muted-foreground">{t("no_wins")}</p>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
