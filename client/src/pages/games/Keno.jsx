import { useState } from "react";
import { api, fmtUsd, fmtMult } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory, FairnessBox, ResultBanner } from "../../components/game.jsx";
import { BetPanel, toast } from "../../components/ui.jsx";

export default function Keno() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [amount, setAmount] = useState(10);
  const [picks, setPicks] = useState([1, 5, 10, 15, 20]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const toggle = (n) => {
    setResult(null);
    setPicks((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length >= 10 ? p : [...p, n]));
  };

  const bet = async () => {
    setLoading(true);
    try {
      const r = await api("/games/keno", { method: "POST", body: { stake: Math.round(amount * 100), picks } });
      setResult(r);
      await refresh();
      toast(
        r.result.hitCount > 0 ? `${r.result.hitCount} ${t("hits")} · ${fmtUsd(r.payout)}` : t("lost"),
        r.result.hitCount > 0 && r.payout > 0 ? "success" : "error"
      );
    } catch (e) {
      toast(err(e.message), "error");
    } finally {
      setLoading(false);
    }
  };

  const drawn = new Set(result?.result?.drawn || []);
  const hits = new Set(result?.result?.hits || []);
  const win = result && result.payout > result.stake;

  return (
    <GameShell
      emoji="🎱"
      title={t("g_keno")}
      subtitle={t("g_keno_sub")}
      side={
        <>
          <Panel title={t("picks")}>
            <div className="text-sm text-muted-foreground">
              {picks.length}/10 · <span className="text-primary font-bold">{picks.sort((a, b) => a - b).join(", ")}</span>
            </div>
            <button
              onClick={() => setPicks([])}
              className="mt-3 w-full py-2 rounded-lg bg-secondary/60 border border-border text-sm hover:border-primary/40 transition"
            >
              {t("roulette_clear")}
            </button>
          </Panel>
          <FairnessBox />
          <BetHistory game="keno" />
        </>
      }
    >
      <Panel>
        <div className="grid grid-cols-8 sm:grid-cols-10 gap-2 mb-5">
          {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => {
            const picked = picks.includes(n);
            const isHit = hits.has(n);
            const isDrawn = drawn.has(n);
            return (
              <button
                key={n}
                onClick={() => toggle(n)}
                className={`aspect-square rounded-lg text-sm font-bold transition border
                  ${isHit ? "bg-emerald-500 border-emerald-300 text-white" : isDrawn ? "bg-secondary border-border text-muted-foreground" : picked ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border/50 hover:border-primary/40"}`}
              >
                {n}
              </button>
            );
          })}
        </div>

        {result && (
          <div className="mb-4">
            <ResultBanner outcome={win ? "win" : "loss"}>
              {t("drawn")}: {result.result.drawn.length} · {t("hits")}: {result.result.hitCount} ·{" "}
              {fmtMult(result.result.multiplier)} · {win ? `${t("won")} ${fmtUsd(result.payout)}` : t("lost")}
            </ResultBanner>
          </div>
        )}

        <BetPanel
          betAmount={amount}
          onBetChange={setAmount}
          onBet={bet}
          loading={loading}
          disabled={!user || picks.length === 0}
          amountLabel={t("bet_amount")}
          maxLabel={t("max")}
          buttonLabel={`${t("bet")} · ${picks.length} ${t("picks")}`}
        />
      </Panel>
    </GameShell>
  );
}
