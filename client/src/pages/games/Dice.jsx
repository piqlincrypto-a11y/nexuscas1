import { useState } from "react";
import { api, fmtUsd } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory, FairnessBox, ResultBanner } from "../../components/game.jsx";
import { BetPanel, RangeSlider, toast } from "../../components/ui.jsx";

export default function Dice() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [amount, setAmount] = useState(10);
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState("over");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const winChance = direction === "over" ? 100 - target : target;
  const payout = ((100 / winChance) * 0.99).toFixed(4);

  const bet = async () => {
    setLoading(true);
    try {
      const r = await api("/games/dice", {
        method: "POST",
        body: { stake: Math.round(amount * 100), target, dir: direction },
      });
      setResult(r);
      await refresh();
      toast(
        r.result.win
          ? `${t("g_dice")} ${Number(r.result.roll).toFixed(2)} — ${t("won")} ${fmtUsd(r.payout)}`
          : `${t("g_dice")} ${Number(r.result.roll).toFixed(2)} — ${t("lost")}`,
        r.result.win ? "success" : "error"
      );
    } catch (e) {
      toast(err(e.message), "error");
    } finally {
      setLoading(false);
    }
  };

  const roll = result ? Number(result.result.roll) : null;
  const win = result?.result?.win;

  return (
    <GameShell
      emoji="🎲"
      title={t("g_dice")}
      subtitle={t("g_dice_sub")}
      side={
        <>
          <FairnessBox />
          <BetHistory game="dice" />
        </>
      }
    >
      <Panel className="overflow-hidden">
        <div className="relative h-28 rounded-xl bg-secondary/40 border border-border/50 overflow-hidden mb-6">
          <div className="absolute inset-0 flex">
            {Array.from({ length: 100 }).map((_, i) => {
              const active = direction === "over" ? i > target : i < target;
              return (
                <div
                  key={i}
                  className={`flex-1 ${active ? "bg-primary/15" : "bg-transparent"}`}
                  style={{ borderRight: i % 10 === 0 ? "1px solid rgba(255,255,255,0.06)" : "none" }}
                />
              );
            })}
          </div>
          <div className="absolute top-0 bottom-0 w-0.5 bg-primary" style={{ left: `${target}%` }} />
          {roll !== null && (
            <div
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full grid place-items-center font-black text-sm border-2 ${
                win ? "bg-emerald-500 border-emerald-300 text-white" : "bg-red-500 border-red-300 text-white"
              }`}
              style={{ left: `${Math.min(99, Math.max(1, roll))}%` }}
            >
              {Math.floor(roll)}
            </div>
          )}
          <div className="absolute bottom-1 left-2 text-[10px] text-muted-foreground font-mono">0</div>
          <div className="absolute bottom-1 right-2 text-[10px] text-muted-foreground font-mono">100</div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div className="space-y-2">
            <div className="flex gap-2">
              {["under", "over"].map((d) => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold uppercase transition ${
                    direction === d
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/60 border border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("target")}</span>
              <span className="font-mono font-bold">{target}</span>
            </div>
            <RangeSlider value={target} min={2} max={98} onChange={setTarget} />
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
              <div className="text-xs text-muted-foreground">{t("win_chance")}</div>
              <div className="font-bold text-primary">{winChance}%</div>
            </div>
            <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
              <div className="text-xs text-muted-foreground">{t("payout")}</div>
              <div className="font-bold text-primary">{payout}x</div>
            </div>
            <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
              <div className="text-xs text-muted-foreground">{t("profit")}</div>
              <div className="font-bold text-emerald-400">{fmtUsd(Math.round(amount * (payout - 1) * 100))}</div>
            </div>
          </div>
        </div>

        {result && (
          <div className="mb-4">
            <ResultBanner outcome={win ? "win" : "loss"}>
              {Number(result.result.roll).toFixed(2)} ·{" "}
              {win ? `${t("won")} ${fmtUsd(result.payout)}` : t("lost")}
            </ResultBanner>
          </div>
        )}

        <BetPanel
          betAmount={amount}
          onBetChange={setAmount}
          onBet={bet}
          loading={loading}
          disabled={!user}
          amountLabel={t("bet_amount")}
          maxLabel={t("max")}
          buttonLabel={`${t("bet")} ${direction} ${target} (${winChance}%)`}
        />
      </Panel>
    </GameShell>
  );
}
