import { useState, useEffect } from "react";
import { api, fmtUsd, fmtMult, timeAgo } from "../lib/api.js";
import { useT, useLang } from "../lib/i18n.jsx";
import { SignInPrompt, toast } from "./ui.jsx";

export function GameShell({ emoji, title, subtitle, children, side }) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-4xl">{emoji}</span>
        <div>
          <h1 className="text-2xl sm:text-3xl font-black">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="space-y-6">{children}</div>
        <div className="space-y-6 lg:sticky lg:top-24">{side}</div>
      </div>
    </div>
  );
}

export function Panel({ title, children, className = "" }) {
  return (
    <div className={`rounded-2xl border border-border/50 bg-card/50 p-5 ${className}`}>
      {title && <div className="text-sm font-semibold mb-4">{title}</div>}
      {children}
    </div>
  );
}

const OUTCOME_CLS = {
  win: "text-emerald-400",
  loss: "text-red-400",
};

export function BetHistory({ game }) {
  const t = useT();
  const [bets, setBets] = useState(null);

  const load = () => {
    api("/me/bets")
      .then((d) => setBets(game ? d.items.filter((b) => b.game === game) : d.items))
      .catch(() => setBets([]));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  const line = (b) => {
    const r = b.result || {};
    if (b.game === "limbo") return `${fmtMult(r.multiplier)} · ${r.win ? "≥" : "<"} ${r.target}x`;
    if (b.game === "dice") return `${Number(r.roll).toFixed(2)} · ${r.dir} ${r.target}`;
    if (b.game === "mines") return r.boom ? "💣" : `${fmtMult(r.multiplier)} · ${r.picks?.length || 0} picks`;
    if (b.game === "roulette" || b.game === "mproulette") return `${t("roulette_number")} ${r.number ?? "-"}`;
    if (b.game === "crash") return `${fmtMult(r.mult)} · ${r.cashed ? "cashed" : "crashed"}`;
    if (b.game === "slots") return r.symbol ? `${r.symbol} · ${fmtMult(r.multiplier)}` : "—";
    if (b.game === "plinko") return `${t("slot")} ${r.slot} · ${fmtMult(r.multiplier)}`;
    if (b.game === "wheel") return `${r.sector} · ${fmtMult(r.multiplier)}`;
    if (b.game === "keno") return `${r.hitCount}/${r.hits?.length || 0} · ${fmtMult(r.multiplier)}`;
    if (b.game === "hilo") return `${r.guess} ${r.prev}→${r.card}`;
    if (b.game === "poker") return `#${b.roundId ?? b.id}`;
    return "";
  };

  if (bets === null) {
    return (
      <Panel title={t("bet_history")}>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-secondary/50 animate-pulse" />
          ))}
        </div>
      </Panel>
    );
  }

  if (bets.length === 0) {
    return (
      <Panel title={t("bet_history")}>
        <p className="text-sm text-muted-foreground">{t("no_bets")}</p>
      </Panel>
    );
  }

  return (
    <Panel title={t("bet_history")}>
      <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
        {bets.map((b) => {
          const win = b.profit > 0;
          return (
            <div
              key={b.id}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/30 border border-border/30 text-sm"
            >
              <div>
                <div className="font-semibold capitalize">{b.game}</div>
                <div className="text-xs text-muted-foreground">
                  {line(b)} · {timeAgo(b.createdAt)}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-bold ${win ? OUTCOME_CLS.win : b.profit === 0 ? "" : OUTCOME_CLS.loss}`}>
                  {win ? "+" : ""}
                  {fmtUsd(b.profit)}
                </div>
                <div className="text-xs text-muted-foreground">{fmtUsd(b.stake)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function FairnessBox() {
  const t = useT();
  const [info, setInfo] = useState(null);
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api("/games/pf").then(setInfo).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api("/games/pf/client-seed", { method: "POST", body: { clientSeed: seed } });
      setSeed("");
      await load();
      toast(t("set"), "success");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const r = await api("/games/pf/rotate", { method: "POST", body: {} });
      toast(`${t("revealed_seed")}: ${r.revealed?.slice(0, 16)}…`, "success");
      await load();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!info) return null;

  return (
    <Panel title={t("provably_fair")}>
      <div className="space-y-3 text-xs">
        <div>
          <div className="text-muted-foreground mb-1">{t("server_seed_hash")}</div>
          <div className="font-mono break-all bg-secondary/40 rounded-lg p-2 border border-border/40">
            {info.serverSeedHash}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">{t("your_client_seed", { n: info.nonce })}</div>
          <div className="flex gap-2">
            <input
              value={seed || info.clientSeed}
              onChange={(e) => setSeed(e.target.value)}
              className="flex-1 min-w-0 font-mono bg-secondary/40 rounded-lg p-2 border border-border/40 focus:border-primary/50 focus:outline-none"
            />
            <button
              onClick={save}
              disabled={busy}
              className="px-3 rounded-lg bg-secondary border border-border hover:border-primary/40 transition font-semibold disabled:opacity-40"
            >
              {t("set")}
            </button>
          </div>
        </div>
        <button
          onClick={rotate}
          disabled={busy}
          className="w-full px-3 py-2 rounded-lg bg-secondary/60 border border-border hover:border-primary/40 transition font-semibold disabled:opacity-40"
        >
          {t("rotate")}
        </button>
        <p className="text-muted-foreground leading-relaxed">{t("pf_desc")}</p>
      </div>
    </Panel>
  );
}

/** Shared "you must be signed in" guard for game pages. */
export function GameGate({ user, children }) {
  const t = useT();
  if (!user) return <SignInPrompt icon="🎰" title={t("sign_in_play")} description={t("sign_in_play_desc")} />;
  return children;
}

export function ResultBanner({ outcome, children }) {
  if (!children) return null;
  const cls =
    outcome === "win"
      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
      : outcome === "loss"
      ? "bg-red-500/10 border-red-500/30 text-red-300"
      : "bg-secondary/40 border-border/50";
  return <div className={`rounded-xl p-4 text-center font-bold text-lg border ${cls}`}>{children}</div>;
}

export { useLang };
