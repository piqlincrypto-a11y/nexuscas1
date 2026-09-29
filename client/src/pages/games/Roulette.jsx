import { useState } from "react";
import { api, fmtUsd } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory, FairnessBox, ResultBanner } from "../../components/game.jsx";
import { BetPanel, toast } from "../../components/ui.jsx";

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const cellColor = (n) => (n === 0 ? "bg-emerald-600" : RED.has(n) ? "bg-red-600" : "bg-neutral-900");

const OUTSIDE = [
  { key: "red", type: "red", label: "Red", cls: "bg-red-600 text-white" },
  { key: "black", type: "black", label: "Black", cls: "bg-neutral-900 text-white border border-border" },
  { key: "odd", type: "odd", label: "Odd", cls: "bg-secondary" },
  { key: "even", type: "even", label: "Even", cls: "bg-secondary" },
  { key: "low", type: "low", label: "1-18", cls: "bg-secondary" },
  { key: "high", type: "high", label: "19-36", cls: "bg-secondary" },
  { key: "d1", type: "dozen", numbers: range(1, 12), label: "1st 12", cls: "bg-secondary" },
  { key: "d2", type: "dozen", numbers: range(13, 24), label: "2nd 12", cls: "bg-secondary" },
  { key: "d3", type: "dozen", numbers: range(25, 36), label: "3rd 12", cls: "bg-secondary" },
  { key: "c1", type: "column", numbers: range(1, 36).filter((n) => n % 3 === 1), label: "Col 1", cls: "bg-secondary" },
  { key: "c2", type: "column", numbers: range(1, 36).filter((n) => n % 3 === 2), label: "Col 2", cls: "bg-secondary" },
  { key: "c3", type: "column", numbers: range(1, 36).filter((n) => n % 3 === 0), label: "Col 3", cls: "bg-secondary" },
];

export default function Roulette() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [amount, setAmount] = useState(0); // total stake in USD (kept in sync with chips)
  const [chips, setChips] = useState([]); // {key,type,numbers,amount}
  const [chipValue, setChipValue] = useState(1);
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);

  const totalCents = chips.reduce((s, c) => s + c.amount, 0);

  const addChip = (key, type, numbers) => {
    const cents = Math.round(chipValue * 100);
    setChips((prev) => {
      const i = prev.findIndex((c) => c.key === key);
      if (i < 0) return [...prev, { key, type, numbers, amount: cents }];
      const next = [...prev];
      next[i] = { ...next[i], amount: next[i].amount + cents };
      return next;
    });
    setAmount((totalCents + cents) / 100);
    setResult(null);
  };

  const clear = () => {
    setChips([]);
    setAmount(0);
  };

  const bet = async () => {
    if (!chips.length) return;
    setLoading(true);
    setSpinning(true);
    try {
      const r = await api("/games/roulette", {
        method: "POST",
        body: { stake: totalCents, bets: chips.map(({ type, numbers, amount: a }) => ({ type, numbers, amount: a })) },
      });
      await refresh();
      setTimeout(() => {
        setSpinning(false);
        setResult(r);
        toast(
          r.result.win ? `${t("won")} ${fmtUsd(r.payout)}` : `${t("lost")} · ${t("roulette_number")} ${r.result.number}`,
          r.result.win ? "success" : "error"
        );
      }, 1400);
    } catch (e) {
      setSpinning(false);
      toast(err(e.message), "error");
    } finally {
      setLoading(false);
    }
  };

  const win = result?.result?.win;
  const cells = [0, ...range(1, 36)];
  const chipFor = (key) => chips.find((c) => c.key === key);
  const numberKey = (n) => `s${n}`;

  return (
    <GameShell
      emoji="🎡"
      title={t("g_roulette")}
      subtitle={t("g_roulette_sub")}
      side={
        <>
          <Panel title={t("roulette_chips")}>
            <div className="grid grid-cols-5 gap-2">
              {[1, 5, 10, 25, 100].map((v) => (
                <button
                  key={v}
                  onClick={() => setChipValue(v)}
                  className={`py-2 rounded-lg text-sm font-bold transition ${
                    chipValue === v ? "bg-primary text-primary-foreground" : "bg-secondary/60 border border-border hover:border-primary/40"
                  }`}
                >
                  ${v}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("bet_amount")}</span>
              <span className="font-bold font-mono">{fmtUsd(totalCents)}</span>
            </div>
            <button
              onClick={clear}
              disabled={!chips.length}
              className="mt-3 w-full py-2 rounded-lg bg-secondary/60 border border-border text-sm hover:border-primary/40 transition disabled:opacity-40"
            >
              {t("roulette_clear")}
            </button>
          </Panel>
          <FairnessBox />
          <BetHistory game="roulette" />
        </>
      }
    >
      <Panel>
        <div className="rounded-xl bg-secondary/40 border border-border/50 py-6 mb-5 text-center">
          {spinning ? (
            <div className="text-5xl font-black animate-pulse text-primary">🎡</div>
          ) : result ? (
            <div className="flex flex-col items-center gap-3">
              <div className={`w-16 h-16 rounded-full grid place-items-center text-2xl font-black text-white ${cellColor(result.result.number)}`}>
                {result.result.number}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">{t("roulette_place")}</div>
          )}
        </div>

        {result && (
          <div className="mb-5">
            <ResultBanner outcome={win ? "win" : "loss"}>
              {win ? `${t("won")} ${fmtUsd(result.payout)}` : `${t("lost")} · ${t("roulette_number")} ${result.result.number}`}
            </ResultBanner>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 justify-center mb-5">
          {cells.map((n) => {
            const key = numberKey(n);
            const chip = chipFor(key);
            return (
              <button
                key={n}
                onClick={() => addChip(key, "straight", [n])}
                className={`relative w-9 h-9 rounded-lg text-sm font-bold transition ${cellColor(n)} text-white hover:scale-105`}
                title={`${n} (35:1)`}
              >
                {n}
                {chip && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] grid place-items-center font-black">
                    {chip.amount / 100}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5">
          {OUTSIDE.map((b) => {
            const chip = chipFor(b.key);
            return (
              <button
                key={b.key}
                onClick={() => addChip(b.key, b.type, b.numbers)}
                className={`relative py-2.5 rounded-lg text-sm font-bold transition ${b.cls} hover:brightness-125`}
              >
                {b.label}
                {chip && (
                  <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] grid place-items-center font-black">
                    {chip.amount / 100}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <BetPanel
          betAmount={amount || 0}
          onBetChange={() => {}}
          onBet={bet}
          loading={loading || spinning}
          disabled={!user || !chips.length}
          amountLabel={t("bet_amount")}
          maxLabel={t("max")}
          buttonLabel={`${t("roulette_spin")} · ${fmtUsd(totalCents)}`}
        />
      </Panel>
    </GameShell>
  );
}
