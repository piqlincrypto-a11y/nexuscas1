import { useState, useEffect } from "react";
import { fmtUsd, timeAgo } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel, BetHistory } from "../../components/game.jsx";
import { BetPanel, toast } from "../../components/ui.jsx";
import { useRoom, useSocket, send } from "../../lib/ws.js";

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const cellColor = (n) => (n === 0 ? "bg-emerald-600" : RED.has(n) ? "bg-red-600" : "bg-neutral-900");

const BET_TYPES = [
  { type: "red", label: "Red", cls: "bg-red-600 text-white" },
  { type: "black", label: "Black", cls: "bg-neutral-900 text-white border border-border" },
  { type: "even", label: "Even", cls: "bg-secondary" },
  { type: "odd", label: "Odd", cls: "bg-secondary" },
  { type: "low", label: "1-18", cls: "bg-secondary" },
  { type: "high", label: "19-36", cls: "bg-secondary" },
];

export default function MpRoulette() {
  const { refresh, user } = useAuth();
  const t = useT();
  const err = useErr();
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);
  const [amount, setAmount] = useState(10);
  const [betType, setBetType] = useState("red");
  const [loading, setLoading] = useState(false);

  useSocket((m) => {
    if (m.t === "mp:list" && m.game === "mproulette") setRooms(m.rooms);
    if (m.t === "mp:joined" && m.game === "mproulette") setRoomId(m.roomId);
    if (m.t === "mp:beted") toast(`${t("mp_your_bet")}: ${m.bet.type} ${fmtUsd(m.bet.amount)}`, "success");
    if (m.t === "err") toast(err(m.error), "error");
  });

  useRoom(roomId ? `mp:mproulette:${roomId}` : null, (m) => {
    if (m.t === "mp:state" && m.game === "mproulette") setRoom(m.room);
  });

  useEffect(() => {
    send({ t: "mp:list", game: "mproulette" });
  }, []);

  const create = () => send({ t: "mp:create", game: "mproulette", opts: { max: 5 } });
  const quick = () => send({ t: "mp:quick", game: "mproulette" });
  const joinRoom = (id) => send({ t: "mp:join", game: "mproulette", roomId: id });
  const leave = () => {
    send({ t: "mp:leave", game: "mproulette", roomId });
    setRoomId(null);
    setRoom(null);
  };

  const place = async () => {
    setLoading(true);
    try {
      send({ t: "mp:bet", game: "mproulette", roomId, amount: Math.round(amount * 100), type: betType });
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const me = room?.players?.find((p) => p.userId === user?.id);
  const secs = room ? Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000)) : 0;
  const totalPool = (room?.players || []).reduce((s, p) => s + (p.bet?.amount || 0), 0);

  return (
    <GameShell
      emoji="🎡"
      title={t("g_mproulette")}
      subtitle={t("g_mproulette_sub")}
      side={
        <>
          <Panel title={t("mp_title")}>
            <div className="space-y-2">
              {rooms.length === 0 && <p className="text-sm text-muted-foreground">{t("mp_no_rooms")}</p>}
              {rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => joinRoom(r.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-secondary/40 border border-border/50 hover:border-primary/40 transition text-sm"
                >
                  <span className="font-mono font-bold">#{r.id}</span>
                  <span className="text-muted-foreground">
                    {r.players}/{r.max}
                  </span>
                  <span className="text-xs text-primary font-semibold">{r.phase}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                onClick={create}
                className="py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition"
              >
                {t("create_room")}
              </button>
              <button
                onClick={quick}
                className="py-2 rounded-lg bg-secondary border border-border text-sm font-semibold hover:border-primary/40 transition"
              >
                {t("quick_join")}
              </button>
            </div>
          </Panel>
          <BetHistory game="mproulette" />
        </>
      }
    >
      <Panel>
        {!roomId || !room ? (
          <div className="py-16 text-center text-muted-foreground text-sm">{t("mp_no_rooms")}</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono font-bold">
                {t("room")} #{room.id}
              </div>
              <div className="text-sm text-muted-foreground">
                {room.phase === "settled" ? t("mp_settled") : `${t("mp_betting")} · ${secs}s`}
              </div>
              <button onClick={leave} className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-secondary transition">
                {t("leave")}
              </button>
            </div>

            {room.result && (
              <div className="flex flex-col items-center gap-2 mb-5 py-6 rounded-xl bg-secondary/40 border border-border/50">
                <div className={`w-16 h-16 rounded-full grid place-items-center text-2xl font-black text-white ${cellColor(room.result.number)}`}>
                  {room.result.number}
                </div>
                <div className="text-sm text-muted-foreground">{t("mp_pool")}: {fmtUsd(totalPool)}</div>
                <div className="flex gap-1">
                  {(room.history || []).slice(0, 12).map((h, i) => (
                    <span key={i} className={`w-6 h-6 rounded text-[10px] grid place-items-center font-bold text-white ${cellColor(h.number)}`}>
                      {h.number}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 mb-5">
              {room.players.map((p) => (
                <div
                  key={p.userId}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm ${
                    p.userId === user?.id ? "bg-primary/10 border-primary/30" : "bg-secondary/30 border-border/40"
                  }`}
                >
                  <span className="font-semibold truncate">{p.username}</span>
                  <span className="text-muted-foreground capitalize">{p.bet ? `${p.bet.type} ${fmtUsd(p.bet.amount)}` : "—"}</span>
                  <span className={`font-bold ${p.payout > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {room.phase === "settled" ? (p.payout > 0 ? `+${fmtUsd(p.payout)}` : fmtUsd(0)) : t("waiting")}
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
              {BET_TYPES.map((b) => (
                <button
                  key={b.type}
                  onClick={() => setBetType(b.type)}
                  className={`py-2.5 rounded-lg text-xs sm:text-sm font-bold transition ${b.cls} ${
                    betType === b.type ? "ring-2 ring-primary scale-[1.03]" : "hover:brightness-125"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {me?.bet && (
              <div className="mb-4 text-center text-sm text-muted-foreground">
                {t("mp_your_bet")}: <span className="text-primary font-bold capitalize">{me.bet.type} {fmtUsd(me.bet.amount)}</span>
              </div>
            )}

            <BetPanel
              betAmount={amount}
              onBetChange={setAmount}
              onBet={place}
              loading={loading}
              disabled={!user || room.phase !== "betting"}
              amountLabel={t("bet_amount")}
              maxLabel={t("max")}
              buttonLabel={room.phase === "betting" ? `${t("bet")} · ${betType}` : t("mp_settled")}
            />
          </>
        )}
      </Panel>
    </GameShell>
  );
}
