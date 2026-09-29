import { useState } from "react";
import { api, fmtUsd, fmtMult } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory, FairnessBox, ResultBanner } from "../../components/game.jsx";
import { BetPanel, toast } from "../../components/ui.jsx";

const SYMBOLS = ["cherry", "lemon", "grape", "bell", "bar", "seven", "gem", "wild"];
const GLYPH = { cherry: "🍒", lemon: "🍋", grape: "🍇", bell: "🔔", bar: "BAR", seven: "7️⃣", gem: "💎", wild: "⭐" };
const PAYS = { cherry: 3, lemon: 5, grape: 8, bell: 12, bar: 25, seven: 100, gem: 50, wild: 250 };
const NOISE = [
  ["lemon", "cherry", "grape"],
  ["bell", "bar", "seven"],
  ["gem", "wild", "cherry"],
];

export default function Slots() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [amount, setAmount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [cells, setCells] = useState([
    ["cherry", "lemon", "grape"],
    ["bell", "bar", "seven"],
    ["gem", "wild", "cherry"],
  ]);
  const [result, setResult] = useState(null);

  const bet = async () => {
    setLoading(true);
    setSpinning(true);
    try {
      const r = await api("/games/slots", { method: "POST", body: { stake: Math.round(amount * 100) } });
      await refresh();
      // brief reel animation before locking in the real result
      let n = 0;
      const spinId = setInterval(() => {
        setCells(NOISE.map((row, i) => row.map((_, j) => SYMBOLS[(n + i + j * 2) % SYMBOLS.length])));
        n += 1;
      }, 70);
      setTimeout(() => {
        clearInterval(spinId);
        setSpinning(false);
        setCells(r.result.cells);
        setResult(r);
        toast(
          r.result.win ? `${t("won")} ${fmtUsd(r.payout)} · ${fmtMult(r.result.multiplier)}` : t("lost"),
          r.result.win ? "success" : "error"
        );
      }, 900);
    } catch (e) {
      setSpinning(false);
      toast(err(e.message), "error");
    } finally {
      setLoading(false);
    }
  };

  const win = result?.result?.win;

  return (
    <GameShell
      emoji="🎰"
      title={t("g_slots")}
      subtitle={t("g_slots_sub")}
      side={
        <>
          <Panel title={t("slots_paytable")}>
            <div className="space-y-1.5">
              {Object.keys(PAYS)
                .slice()
                .reverse()
                .map((s) => (
                  <div key={s} className="flex items-center justify-between text-sm bg-secondary/30 rounded-lg px-3 py-2 border border-border/30">
                    <span className="text-lg">{GLYPH[s]}</span>
                    <span className="font-bold text-primary">{PAYS[s]}x</span>
                  </div>
                ))}
            </div>
          </Panel>
          <FairnessBox />
          <BetHistory game="slots" />
        </>
      }
    >
      <Panel>
        <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-secondary/60 to-secondary/25 p-4 sm:p-6 mb-5">
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((col) => (
              <div key={col} className="space-y-3">
                {[0, 1, 2].map((row) => {
                  const sym = cells[col]?.[row];
                  const isLine = row === 1;
                  return (
                    <div
                      key={row}
                      className={`h-16 sm:h-20 rounded-xl grid place-items-center text-3xl sm:text-4xl border transition
                        ${isLine ? "border-primary/50 bg-primary/10" : "border-border/40 bg-background/40"}
                        ${spinning ? "blur-[1px] opacity-70" : ""}`}
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {sym === "bar" ? <span className="text-xl sm:text-2xl font-black text-primary">BAR</span> : GLYPH[sym]}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="text-center text-[11px] text-muted-foreground mt-3">{t("slots_line")}</div>
        </div>

        {result && (
          <div className="mb-4">
            <ResultBanner outcome={win ? "win" : "loss"}>
              {win
                ? `${GLYPH[result.result.symbol]} ${t("won")} ${fmtUsd(result.payout)} · ${fmtMult(result.result.multiplier)}`
                : t("lost")}
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
          buttonLabel={`${t("spin")} · ${fmtUsd(Math.round(amount * 100))}`}
        />
      </Panel>
    </GameShell>
  );
}
