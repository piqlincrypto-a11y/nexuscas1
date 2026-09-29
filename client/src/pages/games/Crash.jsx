import { useEffect, useRef, useState } from "react";
import { fmtUsd, fmtMult } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory, FairnessBox } from "../../components/game.jsx";
import { BetPanel, toast } from "../../components/ui.jsx";
import { useRoom, send } from "../../lib/ws.js";

const LAMBDA = 11000;

export default function Crash() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [state, setState] = useState(null);
  const [amount, setAmount] = useState(10);
  const [joined, setJoined] = useState(false);
  const [auto, setAuto] = useState(2);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [payout, setPayout] = useState(null);
  const cashedRef = useRef(false);

  useRoom("crash", (m) => {
    if (m.t !== "crash") return;
    setState(m.state);
    if (m.state.phase === "betting") {
      setJoined(false);
      setPayout(null);
      cashedRef.current = false;
    }
    if (m.state.phase === "result") setJoined(false);
  });

  // local clock for the live multiplier
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 80);
    return () => clearInterval(id);
  }, []);

  const liveMult = (() => {
    if (!state) return 1;
    if (state.phase === "running") return Math.exp(Math.max(0, Date.now() - state.startTs) / LAMBDA);
    if (state.phase === "result") return state.crashAt || 1;
    return 1;
  })();

  // auto cashout
  useEffect(() => {
    if (!joined || cashedRef.current) return;
    if (state?.phase === "running" && auto > 1 && liveMult >= auto) cashOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMult, joined, state?.phase]);

  const joinRound = async () => {
    setLoading(true);
    try {
      send({ t: "crash:join", stake: Math.round(amount * 100) });
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const cashOut = () => {
    if (cashedRef.current) return;
    cashedRef.current = true;
    send({ t: "crash:cashout" });
    setTimeout(() => refresh(), 300);
  };

  // server replies over the socket
  useRoom("crash", (m) => {
    if (m.t === "crash:joined") {
      setJoined(true);
      toast(`${t("crash_you_in")} · ${fmtUsd(m.stake)}`, "success");
    }
    if (m.t === "crash:cashout") {
      setPayout(m);
      toast(`${t("cashout")} ${fmtMult(m.mult)} · +${fmtUsd(m.profit)}`, "success");
      refresh();
    }
    if (m.t === "err") {
      toast(err(m.error), "error");
      cashedRef.current = false;
      // a failed join during the betting window means we are not in the round
      if (state?.phase === "betting") setJoined(false);
    }
  });

  if (!state) {
    return (
      <GameShell emoji="🚀" title={t("g_crash")} subtitle={t("g_crash_sub")}>
        <Panel>
          <div className="h-40 rounded-xl bg-secondary/40 animate-pulse" />
        </Panel>
      </GameShell>
    );
  }

  const secs = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  const crashed = state.phase === "result";
  const running = state.phase === "running";
  const color = crashed ? "text-red-400" : running ? "text-primary" : "text-muted-foreground";

  return (
    <GameShell
      emoji="🚀"
      title={t("g_crash")}
      subtitle={t("g_crash_sub")}
      side={
        <>
          <Panel title={t("history")}>
            <div className="flex flex-wrap gap-2">
              {(state.history || []).map((h, i) => (
                <span
                  key={i}
                  className={`px-2 py-1 rounded-lg text-xs font-bold font-mono border ${
                    h >= 2 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border-red-500/30 text-red-300"
                  }`}
                >
                  {fmtMult(h)}
                </span>
              ))}
              {!state.history?.length && <span className="text-sm text-muted-foreground">—</span>}
            </div>
          </Panel>
          <FairnessBox />
          <BetHistory game="crash" />
        </>
      }
    >
      <Panel>
        <div className="relative h-56 rounded-xl border border-border/50 bg-secondary/30 overflow-hidden mb-5">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,oklch(78%_0.18_55/0.12),transparent_70%)]" />
          <div className="absolute top-3 left-4 text-xs text-muted-foreground font-mono">
            #{state.round} · {t("crash_seed")}: {state.seedHash?.slice(0, 16)}…
          </div>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className={`text-5xl sm:text-7xl font-black font-mono ${color}`}>{fmtMult(liveMult)}</div>
              <div className="text-sm text-muted-foreground mt-2">
                {state.phase === "betting"
                  ? `${t("crash_next")} ${secs}s`
                  : crashed
                  ? `${t("crash_crashed")} ${fmtMult(state.crashAt)}`
                  : t("crash_running")}
              </div>
            </div>
          </div>
          {crashed && <div className="absolute inset-0 bg-red-500/10 pointer-events-none" />}
        </div>

        {payout && (
          <div className="mb-4 rounded-xl p-4 text-center font-bold text-lg border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
            {t("cashout")} {fmtMult(payout.mult)} · +{fmtUsd(payout.profit)}
          </div>
        )}

        <div className="mb-5 rounded-xl bg-secondary/40 border border-border/50 p-4">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-muted-foreground">{t("crash_players_in")}</span>
            <span className="font-bold">{state.players?.length || 0}</span>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {state.players?.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
            {state.players?.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-background/40 rounded-lg px-3 py-2">
                <span className="font-semibold truncate">{p.username}</span>
                <span className="text-muted-foreground font-mono">{fmtUsd(p.stake)}</span>
                <span className={`font-bold font-mono ${p.cashedAt ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {p.cashedAt ? `${fmtMult(p.cashedAt)} → ${fmtUsd(p.payout)}` : running ? "…" : t("lost")}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div className="rounded-xl bg-secondary/40 border border-border/50 p-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t("crash_auto_cashout")}</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1.01"
                step="0.1"
                value={auto}
                onChange={(e) => setAuto(Number(e.target.value) || 0)}
                className="w-20 px-2 py-1.5 rounded-lg bg-secondary/60 border border-border font-mono text-sm text-right focus:border-primary/50 focus:outline-none"
              />
              <span className="font-bold text-primary">x</span>
            </div>
          </div>
          <div className="rounded-xl bg-secondary/40 border border-border/50 p-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t("round")}</span>
            <span className="font-mono font-bold">#{state.round}</span>
          </div>
        </div>

        {joined && running ? (
          <button
            onClick={cashOut}
            className="w-full py-4 rounded-xl font-black text-lg bg-emerald-500 text-white hover:bg-emerald-400 transition"
          >
            {t("cash_out")} {fmtMult(liveMult)} → {fmtUsd(Math.floor((amount * 100 * liveMult) / 100))}
          </button>
        ) : joined ? (
          <div className="w-full py-4 rounded-xl font-bold text-center bg-primary/10 border border-primary/30 text-primary">
            {t("crash_you_in")}
          </div>
        ) : (
          <BetPanel
            betAmount={amount}
            onBetChange={setAmount}
            onBet={joinRound}
            loading={loading}
            disabled={!user || state.phase !== "betting"}
            amountLabel={t("bet_amount")}
            maxLabel={t("max")}
            buttonLabel={state.phase === "betting" ? `${t("crash_place")} · ${secs}s` : t("crash_wait")}
            buttonColor={
              state.phase === "betting"
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-secondary text-muted-foreground cursor-not-allowed"
            }
          />
        )}
      </Panel>
    </GameShell>
  );
}
