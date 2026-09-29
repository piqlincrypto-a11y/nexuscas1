import { useState, useEffect } from "react";
import { fmtUsd } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { useT, useErr } from "../../lib/i18n.jsx";
import { GameShell, Panel } from "../../components/game.jsx";
import { toast } from "../../components/ui.jsx";
import { useRoom, useSocket, send } from "../../lib/ws.js";

const RANKS = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUITS = { s: "♠", h: "♥", d: "♦", c: "♣" };
const rank = (r) => RANKS[r] || String(r);
const red = (s) => s === "h" || s === "d";

function Card({ card, hidden, small }) {
  const size = small ? "w-9 h-12 text-xs" : "w-14 h-20 text-xl";
  if (hidden) {
    return (
      <div className={`rounded-lg grid place-items-center border border-border bg-secondary text-muted-foreground/70 ${size}`}>
        ◆
      </div>
    );
  }
  return (
    <div
      className={`rounded-lg grid place-items-center border font-black leading-none bg-white ${
        red(card?.s) ? "text-red-600 border-red-200" : "text-neutral-900 border-neutral-300"
      } ${size}`}
    >
      <div className="text-center">
        {rank(card?.r)}
        <span className="block text-[10px]">{SUITS[card?.s]}</span>
      </div>
    </div>
  );
}

export default function Poker() {
  const { user } = useAuth();
  const t = useT();
  const err = useErr();
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);
  const [buyIn, setBuyIn] = useState(200);
  const [raiseAmt, setRaiseAmt] = useState(0);

  useSocket((m) => {
    if (m.t === "mp:list" && m.game === "poker") setRooms(m.rooms);
    if (m.t === "mp:joined" && m.game === "poker") setRoomId(m.roomId);
    if (m.t === "err") toast(err(m.error), "error");
  });

  useRoom(roomId ? `mp:poker:${roomId}` : null, (m) => {
    if (m.t === "mp:state" && m.game === "poker") setRoom(m.room);
  });

  useEffect(() => {
    send({ t: "mp:list", game: "poker" });
  }, []);

  const create = () => send({ t: "mp:create", game: "poker", opts: { buyIn: Math.round(buyIn * 100) } });
  const quick = () => send({ t: "mp:quick", game: "poker" });
  const joinRoom = (id) => send({ t: "poker:sit", roomId: id });
  const leave = () => {
    send({ t: "mp:leave", game: "poker", roomId });
    setRoomId(null);
    setRoom(null);
  };
  const act = (action, amount) => send({ t: "poker:action", roomId, action, amount });

  const me = room?.players?.find((p) => p.userId === user?.id);
  const toCall = room && me ? Math.max(0, room.currentBet - (me.roundCommitted || 0)) : 0;
  const myTurn = room?.toAct === user?.id;
  const canCheck = toCall === 0;

  return (
    <GameShell
      emoji="🃏"
      title={t("g_poker")}
      subtitle={t("g_poker_sub")}
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
                  <span className="font-mono text-xs text-primary">{fmtUsd(r.buyIn)}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("mp_buyin")}</span>
                <input
                  type="number"
                  min={1}
                  value={buyIn}
                  onChange={(e) => setBuyIn(Number(e.target.value) || 0)}
                  className="w-24 px-2 py-1.5 rounded-lg bg-secondary/60 border border-border font-mono text-sm text-right focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
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
            </div>
          </Panel>

          {room?.history?.length > 0 && (
            <Panel title={t("history")}>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {room.history.slice(0, 10).map((h, i) => (
                  <div key={i} className="text-xs bg-secondary/30 border border-border/30 rounded-lg px-3 py-2">
                    <div className="flex justify-between font-semibold">
                      <span>
                        {t("mp_hand")} #{h.handNo}
                      </span>
                      <span className="text-primary">{fmtUsd(h.finalPot ?? h.pot ?? 0)}</span>
                    </div>
                    <div className="text-muted-foreground mt-1">
                      {(h.winners || []).join(", ") || "—"} {h.rake ? `· rake ${fmtUsd(h.rake)}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      }
    >
      <Panel>
        {!roomId || !room ? (
          <div className="py-16 text-center text-muted-foreground text-sm">{t("mp_no_rooms")}</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4 text-sm">
              <span className="font-mono font-bold">
                {t("room")} #{room.id}
              </span>
              <span className="text-muted-foreground capitalize">
                {t("mp_hand")} #{room.handNo} · {room.phase}
              </span>
              <button onClick={leave} className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-secondary transition">
                {t("leave")}
              </button>
            </div>

            {/* board */}
            <div className="rounded-xl bg-secondary/30 border border-border/50 p-4 mb-5 text-center">
              <div className="text-xs text-muted-foreground mb-2">
                {t("mp_pot")}: <span className="text-primary font-bold font-mono">{fmtUsd(room.pot)}</span>
                {room.deadline > Date.now() && room.phase !== "waiting" && (
                  <span className="ml-3">· {Math.ceil((room.deadline - Date.now()) / 1000)}s</span>
                )}
              </div>
              <div className="flex justify-center gap-2 min-h-[68px] items-center">
                {room.board?.length === 0 && <span className="text-sm text-muted-foreground">{room.phase}</span>}
                {room.board?.map((c, i) => (
                  <Card key={i} card={c} />
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-2">
                {t("crash_seed")}: {room.seedHash?.slice(0, 18)}… {room.revealed ? "✓" : ""}
              </div>
            </div>

            {/* seats */}
            <div className="grid sm:grid-cols-2 gap-3 mb-5">
              {room.players.map((p) => {
                const active = room.toAct === p.userId;
                return (
                  <div
                    key={p.userId}
                    className={`rounded-xl border p-3 transition ${
                      active ? "border-primary bg-primary/10" : "border-border/40 bg-secondary/30"
                    } ${p.folded ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="font-semibold truncate">
                        {p.username}
                        {p.userId === user?.id ? " (you)" : ""}
                      </span>
                      <span className="text-muted-foreground font-mono">{fmtUsd(p.stack ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1.5">
                        {(p.cards || []).map((c, i) => (
                          <Card key={i} card={c} hidden={!c} small />
                        ))}
                        {!p.cards && (
                          <>
                            <div className="w-9 h-12 rounded-lg bg-secondary border border-border grid place-items-center text-xs">
                              ?
                            </div>
                            <div className="w-9 h-12 rounded-lg bg-secondary border border-border grid place-items-center text-xs">
                              ?
                            </div>
                          </>
                        )}
                      </div>
                      <div className="text-right text-xs">
                        <div className="text-muted-foreground">
                          {t("mp_pot")} {fmtUsd(p.committed || 0)}
                        </div>
                        <div className="font-semibold capitalize">
                          {p.lastAction || (p.inHand ? t("waiting") : t("mp_spectate"))}
                          {p.allin ? ` · ${t("mp_allin")}` : ""}
                          {p.payout > 0 ? ` · +${fmtUsd(p.payout)}` : ""}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* my cards */}
            {me && (
              <div className="flex items-center justify-center gap-3 mb-5">
                <span className="text-xs text-muted-foreground">{t("mp_your_cards")}</span>
                {(me.cards || []).map((c, i) => (
                  <Card key={i} card={c} />
                ))}
                {!me.cards && (
                  <>
                    <Card hidden />
                    <Card hidden />
                  </>
                )}
              </div>
            )}

            {/* actions */}
            {!me ? (
              <button
                onClick={() => joinRoom(roomId)}
                className="w-full py-3.5 rounded-xl font-bold bg-primary text-primary-foreground hover:opacity-90 transition"
              >
                {t("mp_sit")} · {fmtUsd(room.buyIn)}
              </button>
            ) : room.phase === "waiting" ? (
              <div className="text-center text-sm text-muted-foreground py-4">{t("waiting")}…</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  onClick={() => act("fold")}
                  disabled={!myTurn}
                  className="py-3 rounded-xl font-bold bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 transition disabled:opacity-40"
                >
                  {t("mp_fold")}
                </button>
                <button
                  onClick={() => act(canCheck ? "check" : "call")}
                  disabled={!myTurn}
                  className="py-3 rounded-xl font-bold bg-secondary border border-border hover:border-primary/40 transition disabled:opacity-40"
                >
                  {canCheck ? t("mp_check") : `${t("mp_call")} ${fmtUsd(toCall)}`}
                </button>
                <div className="col-span-2 flex gap-2">
                  <input
                    type="number"
                    min={0}
                    value={raiseAmt}
                    onChange={(e) => setRaiseAmt(Number(e.target.value) || 0)}
                    placeholder={t("mp_raise")}
                    className="flex-1 min-w-0 px-3 py-3 rounded-xl bg-secondary/60 border border-border font-mono text-sm focus:border-primary/50 focus:outline-none"
                  />
                  <button
                    onClick={() => act("raise", Math.round(raiseAmt * 100))}
                    disabled={!myTurn || raiseAmt <= 0}
                    className="px-4 py-3 rounded-xl font-bold bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-40"
                  >
                    {t("mp_raise")}
                  </button>
                </div>
                {myTurn && <div className="col-span-2 text-center text-xs text-primary font-semibold">{t("mp_turn")}</div>}
              </div>
            )}
          </>
        )}
      </Panel>
    </GameShell>
  );
}
