import { useState } from "react";
import { api, fmtUsd, fmtMult } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory, FairnessBox, ResultBanner } from "../../components/game.jsx";
import { BetPanel, toast } from "../../components/ui.jsx";

const RANK = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUITS = ["♠", "♥", "♦", "♣"];
const rankLabel = (n) => RANK[n] || String(n);
const isRed = (n) => [2, 4, 6, 8, 10, 12, 14].includes(n); // cosmetic only

export default function Hilo() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [amount, setAmount] = useState(10);
  const [current, setCurrent] = useState(9);
  const [suit, setSuit] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [streak, setStreak] = useState(0);

  const probHi = (14 - current) / 13;
  const probLo = (current - 2) / 13;

  const bet = async (guess) => {
    setLoading(true);
    try {
      const r = await api("/games/hilo", {
        method: "POST",
        body: { stake: Math.round(amount * 100), guess, current },
      });
      setResult(r);
      setCurrent(r.result.card);
      setSuit(Math.floor(Math.random() * 4));
      setStreak((s) => (r.result.win ? s + 1 : 0));
      await refresh();
      toast(
        r.result.win ? `${t("won")} ${fmtUsd(r.payout)} · ${fmtMult(r.result.multiplier)}` : t("lost"),
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
      emoji="🃏"
      title={t("g_hilo")}
      subtitle={t("g_hilo_sub")}
      side={
        <>
          <Panel title={t("g_hilo")}>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("win_chance")} {t("higher")}</span>
                <span className="font-bold text-primary">{(probHi * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("win_chance")} {t("lower")}</span>
                <span className="font-bold text-primary">{(probLo * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("streak")}</span>
                <span className="font-bold">{streak}</span>
              </div>
            </div>
          </Panel>
          <FairnessBox />
          <BetHistory game="hilo" />
        </>
      }
    >
      <Panel>
        <div className="flex items-center justify-center gap-4 mb-5">
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-2">{result ? t("card") : t("next_card")}</div>
            <div
              className={`w-24 h-32 rounded-xl grid place-items-center text-4xl font-black border-2 bg-white ${
                result ? (win ? "border-emerald-400" : "border-red-400") : "border-border"
              } ${result && isRed(result.result.card) ? "text-red-600" : "text-neutral-900"}`}
            >
              {rankLabel(result ? result.result.card : current)}
              <span className="text-lg">{SUITS[result ? (result.result.card % 4) : suit]}</span>
            </div>
          </div>
          <div className="text-3xl text-muted-foreground">→</div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-2">{t("guess")}</div>
            <div className="w-24 h-32 rounded-xl grid place-items-center text-4xl font-black border-2 border-dashed border-border/60 bg-secondary/30 text-muted-foreground">
              ?
            </div>
          </div>
        </div>

        {result && (
          <div className="mb-4">
            <ResultBanner outcome={win ? "win" : "loss"}>
              {result.result.prev} → {result.result.card} ·{" "}
              {win ? `${t("won")} ${fmtUsd(result.payout)} · ${fmtMult(result.result.multiplier)}` : t("lost")}
            </ResultBanner>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => bet("hi")}
            disabled={loading || !user || probHi <= 0}
            className="py-3.5 rounded-xl font-bold bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 transition disabled:opacity-40"
          >
            {t("higher")} {(probHi * 100).toFixed(0)}%
          </button>
          <button
            onClick={() => bet("lo")}
            disabled={loading || !user || probLo <= 0}
            className="py-3.5 rounded-xl font-bold bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 transition disabled:opacity-40"
          >
            {t("lower")} {(probLo * 100).toFixed(0)}%
          </button>
        </div>

        <BetPanel
          betAmount={amount}
          onBetChange={setAmount}
          onBet={() => bet("hi")}
          loading={loading}
          disabled={!user}
          amountLabel={t("bet_amount")}
          maxLabel={t("max")}
          buttonLabel={`${t("bet")} · ${fmtUsd(Math.round(amount * 100))}`}
        />
      </Panel>
    </GameShell>
  );
}
