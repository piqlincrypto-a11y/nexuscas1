import { db, getUser, now, getSetting, setSetting, audit } from "./db.js";
import { requireAuth } from "./auth.js";
import { clientIp, rateLimit } from "./util.js";
import { leaderboard } from "./promos.js";
import { broadcastAll } from "./multi.js";

let offset = 0;
let api = (method, payload) => {};
let started = false;

function token() {
  return String(getSetting("tg_token") || "").trim();
}
function enabled() {
  return getSetting("tg_enabled") === "1" && token().length > 10;
}
function makeApi(t) {
  return async (method, payload) => {
    const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    return r.json();
  };
}

const fmt = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

async function reply(chatId, text, extra = {}) {
  try {
    await api("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
  } catch {}
}

function findUserByTg(tgId) {
  return db.prepare("SELECT * FROM users WHERE tg_id = ?").get(Number(tgId));
}

async function onMessage(msg) {
  const chat = msg.chat?.id;
  const text = String(msg.text || "").trim();
  if (!chat || !text) return;
  const user = findUserByTg(msg.from?.id);
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();

  if (cmd === "/start") {
    const code = (args[0] || "").trim().toUpperCase();
    if (user) return reply(chat, `✅ Аккаунт <b>${user.username}</b> уже привязан.`);
    if (!code || !code.startsWith("NX")) return reply(chat, "Отправьте /start <код> — код из раздела «Профиль» на сайте.");
    const target = db.prepare("SELECT * FROM users WHERE referral_code = ? OR tg_link_code = ?").get(code, code);
    if (!target) return reply(chat, "❌ Код не найден. Проверьте код на сайте.");
    if (target.tg_id) return reply(chat, "❌ Этот аккаунт уже привязан к другому Telegram.");
    db.prepare("UPDATE users SET tg_id = ?, tg_username = ? WHERE id = ?").run(msg.from.id, msg.from.username || "", target.id);
    audit(target.id, "tg.link", `chat=${chat}`, "");
    return reply(chat, `✅ Привязано: <b>${target.username}</b>\nБаланс: <b>${fmt(target.balance)}</b>\nКоманды: /balance /top /help`);
  }

  if (!user) return reply(chat, "Сначала привяжите аккаунт: /start <код> (код в профиле на сайте).");

  switch (cmd) {
    case "/balance":
      return reply(chat, `💰 <b>${user.username}</b>\nБаланс: <b>${fmt(user.balance)}</b>\nОтыграно (VIP): ${fmt(user.vip_wagered)}`);
    case "/top": {
      const rows = leaderboard("week").slice(0, 10);
      const lines = rows.map((r, i) => `${i + 1}. ${r.username} — ${fmt(r.profit)}`);
      return reply(chat, `🏆 Топ недели:\n${lines.length ? lines.join("\n") : "Пока пусто"}`);
    }
    case "/help":
      return reply(
        chat,
        "🤖 <b>Nexus Casino bot</b>\n/balance — баланс\n/top — лидерборд\n/HELP — эта справка\n\nСтавки, депозиты и выводы — на сайте."
      );
    default:
      return reply(chat, "Неизвестная команда. /help — список команд.");
  }
}

async function poll() {
  if (!enabled()) return;
  try {
    const res = await api("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
    if (!res?.ok) return;
    for (const upd of res.result) {
      offset = upd.update_id + 1;
      try {
        await onMessage(upd.message);
      } catch (e) {
        console.error("tg msg", e.message);
      }
    }
  } catch {}
}

export function tgNotifyUser(userId, text) {
  if (!enabled()) return;
  const u = getUser(userId);
  if (!u?.tg_id) return;
  reply(u.tg_id, text).catch(() => {});
}
export function tgNotifyAdmin(text) {
  if (!enabled()) return;
  db.prepare("SELECT id, tg_id FROM users WHERE role='admin' AND tg_id IS NOT NULL")
    .all()
    .forEach((a) => reply(a.tg_id, text).catch(() => {}));
}

export function startBot() {
  if (started) return;
  started = true;
  const t = token();
  if (!enabled()) {
    console.log("[tg] bot disabled (no token in admin settings)");
    return;
  }
  api = makeApi(t);
  setInterval(poll, 1500);
  poll();
  console.log("[tg] bot started");
}
export function restartBot() {
  started = false;
  const t = token();
  if (t && getSetting("tg_enabled") === "1") {
    api = makeApi(t);
    started = true;
    poll();
  }
}

export function registerBotRoutes(app) {
  app.post("/api/account/telegram/code", requireAuth, (req, res) => {
    try {
      if (!rateLimit(`tg:${req.user.id}`, 10, 3600000)) throw new Error("too_many");
      const code = "NX" + Math.random().toString(36).slice(2, 8).toUpperCase();
      db.prepare("UPDATE users SET tg_link_code = ? WHERE id = ?").run(code, req.user.id);
      res.json({ code, enabled: enabled(), bot: token() ? "@" + (getSetting("tg_channel") || "nexus_bot") : null });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/account/telegram", requireAuth, (req, res) => {
    const u = getUser(req.user.id);
    res.json({ enabled: enabled(), bound: !!u.tg_id, username: u.tg_username || null });
  });
}
