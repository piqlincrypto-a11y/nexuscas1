import { useState } from "react";
import { api, fmtUsd, fmtMult } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory, FairnessBox, ResultBanner } from "../../components/game.jsx";
import { BetPanel, toast } from "../../components/ui.jsx";

const ROWS = 12;
const RISKS = ["low", "medium", "high"];

export default function Plinko() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [amount, setAmount] = useState(10);
  const [risk, setRisk] = useState("medium");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [dropping, setDropping] = useState(false);

  const bet = async () => {
    setLoading(true);
    setDropping(true);
    try {
      const r = await api("/games/plinko", { method: "POST", body: { stake: Math.round(amount * 100), risk } });
      await refresh();
      setTimeout(() => {
        setDropping(false);
        setResult(r);
        toast(
          r.result.multiplier >= 1 ? `${t("won")} ${fmtUsd(r.payout)} · ${fmtMult(r.result.multiplier)}` : t("lost"),
          r.result.multiplier >= 1 ? "success" : "error"
        );
      }, 800);
    } catch (e) {
      setDropping(false);
      toast(err(e.message), "error");
    } finally {
      setLoading(false);
    }
  };

  const win = result && result.result.multiplier >= 1;
  const path = result?.result?.path || [];
  // build the peg triangle; the ball column follows the path bits
  const rows = Array.from({ length: ROWS }, (_, r) => r + 1);
  const ballCol = path.length ? path.reduce((a, b) => a + b, 0) : null;

  return (
    <GameShell
      emoji="🔻"
      title={t("g_plinko")}
      subtitle={t("g_plinko_sub")}
      side={
        <>
          <Panel title={t("risk")}>
            <div className="grid grid-cols-3 gap-2">
              {RISKS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRisk(r)}
                  className={`py-2 rounded-lg text-sm font-bold capitalize transition ${
                    risk === r ? "bg-primary text-primary-foreground" : "bg-secondary/60 border border-border hover:border-primary/40"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </Panel>
          <FairnessBox />
          <BetHistory game="plinko" />
        </>
      }
    >
      <Panel>
        <div className="rounded-xl bg-secondary/30 border border-border/50 p-4 mb-5 overflow-hidden">
          <div className="flex flex-col items-center gap-1">
            {rows.map((r, idx) => (
              <div key={r} className="flex items-center gap-3" style={{ marginLeft: `${(ROWS - r) * 8}px` }}>
                {Array.from({ length: r }).map((_, i) => {
                  const isBall = dropping && idx === Math.min(ROWS - 1, Math.floor((Date.now() / 60) % ROWS)) && i === Math.floor(r / 2);
                  return (
                    <span
                      key={i}
                      className={`w-2 h-2 rounded-full ${isBall ? "bg-primary shadow-lg" : "bg-muted-foreground/40"}`}
                    />
                  );
                })}
              </div>
            ))}
            <div className="flex gap-1.5 mt-3">
              {Array.from({ length: ROWS + 1 }).map((_, i) => {
                const table = { low: 0, medium: 1, high: 2 }[risk];
                const mults = [
                  [16, 8, 4, 2, 1.2, 1, 0.8, 1, 1.2, 2, 4, 8, 16],
                  [30, 12, 6, 3, 1.5, 1, 0.6, 1, 1.5, 3, 6, 12, 30],
                  [120, 40, 16, 6, 2.4, 1, 0.3, 1, 2.4, 6, 16, 40, 120],
                ][table];
                const active = result && ballCol === i;
                return (
                  <span
                    key={i}
                    className={`px-1 py-0.5 rounded text-[9px] font-mono font-bold border ${
                      active
                        ? mults[i] >= 1
                          ? "bg-emerald-500/30 border-emerald-400 text-emerald-200"
                          : "bg-red-500/30 border-red-400 text-red-200"
                        : "bg-background/50 border-border/40 text-muted-foreground"
                    }`}
                  >
                    {mults[i]}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {result && (
          <div className="mb-4">
            <ResultBanner outcome={win ? "win" : "loss"}>
              {t("slot")} {result.result.slot}/{ROWS} · {fmtMult(result.result.multiplier)} ·{" "}
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
          buttonLabel={`${t("bet")} · ${risk}`}
        />
      </Panel>
    </GameShell>
  );
}
