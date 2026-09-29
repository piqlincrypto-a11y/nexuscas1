import { useEffect, useState } from "react";
import { api, fmtUsd, fmtMult } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory, FairnessBox, ResultBanner } from "../../components/game.jsx";
import { BetPanel, toast } from "../../components/ui.jsx";

const GEM = "💎";
const BOMB = "💣";

export default function Mines() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [amount, setAmount] = useState(10);
  const [mines, setMines] = useState(3);
  const [game, setGame] = useState(null); // {mines, stake, picks, multiplier?, potential?}
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    if (!user) return;
    api("/games/mines", { method: "POST", body: { action: "state" } })
      .then((d) => d.ok && setGame({ mines: d.mines, stake: d.stake, picks: d.picks }))
      .catch(() => {});
  }, [user]);

  const start = async () => {
    setLoading(true);
    try {
      const r = await api("/games/mines", {
        method: "POST",
        body: { action: "start", stake: Math.round(amount * 100), mines },
      });
      setGame({ mines: r.mines, stake: r.stake, picks: r.picks });
      setFlash(null);
      await refresh();
    } catch (e) {
      toast(err(e.message), "error");
    } finally {
      setLoading(false);
    }
  };

  const pick = async (cell) => {
    if (!game || loading) return;
    setLoading(true);
    try {
      const r = await api("/games/mines", { method: "POST", body: { action: "pick", cell } });
      if (r.boom) {
        setFlash({ boom: true, cell, picks: r.picks, stake: game?.stake });
        setGame(null);
        toast(t("boom"), "error");
      } else {
        setGame({ ...game, picks: r.picks, multiplier: r.multiplier, potential: r.potential });
        setFlash(null);
      }
      await refresh();
    } catch (e) {
      toast(err(e.message), "error");
    } finally {
      setLoading(false);
    }
  };

  const cashout = async () => {
    if (!game || !game.picks?.length) return;
    setLoading(true);
    try {
      const r = await api("/games/mines", { method: "POST", body: { action: "cashout" } });
      setFlash({ win: true, payout: r.payout, multiplier: r.multiplier, picks: r.picks });
      setGame(null);
      await refresh();
      toast(`${t("won")} ${fmtUsd(r.payout)}`, "success");
    } catch (e) {
      toast(err(e.message), "error");
    } finally {
      setLoading(false);
    }
  };

  const gemSet = new Set();
  const bombSet = new Set();
  if (flash?.boom) {
    for (const c of flash.picks || []) if (c !== flash.cell) gemSet.add(c);
    bombSet.add(flash.cell);
  } else if (flash?.win) {
    for (const c of flash.picks || []) gemSet.add(c);
  } else {
    for (const c of game?.picks || []) gemSet.add(c);
  }
  const nextMult = game?.multiplier;
  const potential = game?.potential;

  return (
    <GameShell
      emoji="💣"
      title={t("g_mines")}
      subtitle={t("g_mines_sub")}
      side={
        <>
          <Panel title={t("mines_count")}>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setMines(n)}
                  disabled={!!game}
                  className={`py-2 rounded-lg text-sm font-bold transition disabled:opacity-40 ${
                    mines === n ? "bg-primary text-primary-foreground" : "bg-secondary/60 border border-border hover:border-primary/40"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">{t("mines_grid")}</p>
          </Panel>
          <FairnessBox />
          <BetHistory game="mines" />
        </>
      }
    >
      <Panel>
        <div className="grid grid-cols-5 gap-2 sm:gap-3 mb-5">
          {Array.from({ length: 25 }).map((_, i) => {
            const isGem = gemSet.has(i);
            const isBomb = bombSet.has(i);
            const open = isGem || isBomb;
            return (
              <button
                key={i}
                onClick={() => pick(i)}
                disabled={!game || open || loading}
                className={`aspect-square rounded-xl border text-xl sm:text-2xl grid place-items-center transition
                  ${open ? (isBomb ? "bg-red-500/25 border-red-500/60" : "bg-emerald-500/15 border-emerald-500/40") : "bg-secondary/40 border-border/50 hover:border-primary/40 hover:bg-secondary/70"}
                  ${!game || loading ? "cursor-default" : ""}`}
              >
                {open ? (isBomb ? BOMB : GEM) : ""}
              </button>
            );
          })}
        </div>

        {flash && (
          <div className="mb-4">
            <ResultBanner outcome={flash.win ? "win" : "loss"}>
              {flash.win
                ? `${t("won")} ${fmtUsd(flash.payout)} · ${fmtMult(flash.multiplier)}`
                : `${t("boom")} ${t("lost")} ${fmtUsd(game?.stake || flash.stake || 0)}`}
            </ResultBanner>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 text-center mb-4">
          <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
            <div className="text-xs text-muted-foreground">{t("payout")}</div>
            <div className="font-bold text-primary">{nextMult ? fmtMult(nextMult) : "—"}</div>
          </div>
          <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
            <div className="text-xs text-muted-foreground">{t("potential")}</div>
            <div className="font-bold text-emerald-400">{potential ? fmtUsd(potential) : "—"}</div>
          </div>
          <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
            <div className="text-xs text-muted-foreground">{t("gems")}</div>
            <div className="font-bold">{gemSet.size}</div>
          </div>
        </div>

        {game ? (
          <button
            onClick={cashout}
            disabled={!game.picks?.length || loading}
            className="w-full py-3.5 rounded-xl font-bold bg-emerald-500 text-white hover:bg-emerald-400 transition disabled:opacity-40"
          >
            {t("mines_cashout")} {potential ? fmtUsd(potential) : ""}
          </button>
        ) : (
          <BetPanel
            betAmount={amount}
            onBetChange={setAmount}
            onBet={start}
            loading={loading}
            disabled={!user}
            amountLabel={t("bet_amount")}
            maxLabel={t("max")}
            buttonLabel={`${t("start")} · ${mines} ${t("mines")}`}
          />
        )}
      </Panel>
    </GameShell>
  );
}
