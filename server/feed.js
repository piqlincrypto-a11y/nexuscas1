import { now } from "./db.js";
import { broadcastAll } from "./multi.js";

const MAX = 40;
const wins = [];

export function onWin(bet) {
  const item = {
    id: bet.betId,
    game: bet.game,
    stake: bet.stake,
    payout: bet.payout,
    profit: bet.profit,
    username: bet.username,
    userId: bet.userId,
    result: bet.result,
    createdAt: now(),
  };
  wins.unshift(item);
  if (wins.length > MAX) wins.pop();
  broadcastAll({ t: "feed:win", win: item });
}

export function feedWins() {
  return wins.slice(0, 24);
}
