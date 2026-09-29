import { useState } from "react";
import { api, fmtUsd, fmtMult } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory, FairnessBox, ResultBanner } from "../../components/game.jsx";
import { BetPanel, RangeSlider, toast } from "../../components/ui.jsx";

export default function Limbo() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [amount, setAmount] = useState(10);
  const [target, setTarget] = useState(2);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const chance = (100 / target) * 0.99;

  const bet = async () => {
    setLoading(true);
    try {
      const r = await api("/games/limbo", { method: "POST", body: { stake: Math.round(amount * 100), target } });
      setResult(r);
      setHistory((h) => [r.result, ...h].slice(0, 20));
      await refresh();
      toast(
        r.result.win ? `${t("won")} ${fmtUsd(r.payout)}` : `${t("lost")} · ${fmtMult(r.result.multiplier)}`,
        r.result.win ? "success" : "error"
      );
    } catch (e) {
      toast(err(e.message), "error");
    } finally {
      setLoading(false);
    }
  };

  const win = result?.result?.win;

  return (
    <GameShell
      emoji="🎯"
      title={t("g_limbo")}
      subtitle={t("g_limbo_sub")}
      side={
        <>
          <Panel title={t("history")}>
            <div className="flex flex-wrap gap-2">
              {history.length === 0 && <span className="text-sm text-muted-foreground">{t("no_bets")}</span>}
              {history.map((h, i) => (
                <span
                  key={i}
                  className={`px-2 py-1 rounded-lg text-xs font-bold font-mono border ${
                    h.win ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border-red-500/30 text-red-300"
                  }`}
                >
                  {fmtMult(h.multiplier)}
                </span>
              ))}
            </div>
          </Panel>
          <FairnessBox />
          <BetHistory game="limbo" />
        </>
      }
    >
      <Panel>
        <div className="rounded-xl bg-secondary/40 border border-border/50 h-44 grid place-items-center mb-5 overflow-hidden relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,oklch(78%_0.18_55/0.10),transparent_65%)]" />
          <div className="relative text-center">
            <div
              className={`text-5xl sm:text-6xl font-black font-mono ${
                result ? (win ? "text-emerald-400" : "text-red-400") : "text-muted-foreground"
              }`}
            >
              {result ? fmtMult(result.result.multiplier) : fmtMult(target)}
            </div>
            <div className="text-xs text-muted-foreground mt-2">{t("limbo_result")}</div>
          </div>
        </div>

        {result && (
          <div className="mb-4">
            <ResultBanner outcome={win ? "win" : "loss"}>
              {fmtMult(result.result.multiplier)} {win ? `· ${t("won")} ${fmtUsd(result.payout)}` : `· ${t("lost")}`}
            </ResultBanner>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("limbo_target")}</span>
              <span className="font-mono font-bold">{target.toFixed(2)}x</span>
            </div>
            <RangeSlider value={Math.round(target * 100)} min={101} max={100000} step={1} onChange={(v) => setTarget(v / 100)} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
              <div className="text-xs text-muted-foreground">{t("win_chance")}</div>
              <div className="font-bold text-primary">{chance.toFixed(2)}%</div>
            </div>
            <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
              <div className="text-xs text-muted-foreground">{t("profit")}</div>
              <div className="font-bold text-emerald-400">{fmtUsd(Math.round(amount * (target - 1) * 100))}</div>
            </div>
          </div>
        </div>

        <BetPanel
          betAmount={amount}
          onBetChange={setAmount}
          onBet={bet}
          loading={loading}
          disabled={!user}
          amountLabel={t("bet_amount")}
          maxLabel={t("max")}
          buttonLabel={`${t("bet")} ${target.toFixed(2)}x`}
        />
      </Panel>
    </GameShell>
  );
}
