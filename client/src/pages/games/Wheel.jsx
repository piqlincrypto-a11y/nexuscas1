import { useState } from "react";
import { api, fmtUsd, fmtMult } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory, FairnessBox, ResultBanner } from "../../components/game.jsx";
import { BetPanel, toast } from "../../components/ui.jsx";

const SECTORS = [
  { label: "1.1x", mult: 1.1, cls: "bg-emerald-600/70" },
  { label: "1.5x", mult: 1.5, cls: "bg-emerald-500/70" },
  { label: "2x", mult: 2, cls: "bg-teal-500/70" },
  { label: "3x", mult: 3, cls: "bg-sky-500/70" },
  { label: "5x", mult: 5, cls: "bg-violet-500/70" },
  { label: "10x", mult: 10, cls: "bg-fuchsia-500/70" },
  { label: "50x", mult: 50, cls: "bg-primary" },
  { label: "0x", mult: 0, cls: "bg-red-600/80" },
];

export default function Wheel() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [amount, setAmount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [offset, setOffset] = useState(0);

  const bet = async () => {
    setLoading(true);
    setSpinning(true);
    try {
      const r = await api("/games/wheel", { method: "POST", body: { stake: Math.round(amount * 100) } });
      await refresh();
      const idx = SECTORS.findIndex((s) => s.label === r.result.sector);
      const shift = 3600 + (-(idx < 0 ? 0 : idx) * (360 / SECTORS.length) - (offset % 360));
      setOffset((o) => o + (shift - (o % 360)) + (shift < 0 ? 360 : 0));
      setTimeout(() => {
        setSpinning(false);
        setResult(r);
        toast(
          r.result.win ? `${t("won")} ${fmtUsd(r.payout)} · ${fmtMult(r.result.multiplier)}` : t("lost"),
          r.result.win ? "success" : "error"
        );
      }, 1100);
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
      emoji="🎡"
      title={t("g_wheel")}
      subtitle={t("g_wheel_sub")}
      side={
        <>
          <Panel title={t("sector")}>
            <div className="space-y-1.5">
              {SECTORS.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between text-sm bg-secondary/30 rounded-lg px-3 py-2 border border-border/30"
                >
                  <span className={`w-3 h-3 rounded-sm ${s.cls}`} />
                  <span className="font-bold font-mono">{s.label}</span>
                </div>
              ))}
            </div>
          </Panel>
          <FairnessBox />
          <BetHistory game="wheel" />
        </>
      }
    >
      <Panel>
        <div className="rounded-xl bg-secondary/30 border border-border/50 p-5 mb-5">
          <div className="relative">
            <div className="absolute left-1/2 -translate-x-1/2 -top-1 z-10 text-primary text-lg">▼</div>
            <div className="overflow-hidden rounded-xl">
              <div
                className="flex transition-transform duration-[1100ms] ease-out"
                style={{ transform: `translateX(-${(offset % 360) * 2}px)` }}
              >
                {[...SECTORS, ...SECTORS, ...SECTORS].map((s, i) => (
                  <div
                    key={i}
                    className={`min-w-[90px] h-24 ${s.cls} grid place-items-center font-black text-sm text-white border-r border-black/20`}
                  >
                    {s.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="text-center text-xs text-muted-foreground mt-3">{spinning ? t("spin") + "…" : t("sector")}</div>
        </div>

        {result && (
          <div className="mb-4">
            <ResultBanner outcome={win ? "win" : "loss"}>
              {result.result.sector} · {fmtMult(result.result.multiplier)} ·{" "}
              {win ? `${t("won")} ${fmtUsd(result.payout)}` : t("lost")}
            </ResultBanner>
          </div>
        )}

        <BetPanel
          betAmount={amount}
          onBetChange={setAmount}
          onBet={bet}
          loading={loading || spinning}
          disabled={!user}
          amountLabel={t("bet_amount")}
          maxLabel={t("max")}
          buttonLabel={`${t("spin")} · ${fmtUsd(Math.round(amount * 100))}`}
        />
      </Panel>
    </GameShell>
  );
}
