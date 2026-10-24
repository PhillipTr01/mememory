const fs = require("fs");
const path = require("path");

/*
 * A Telegram bot of its own (@ptfast_bot), independent of the casino: every few minutes it reads the
 * season top of csgofast (TOP_URL), keeps one pinned message with the ranking up to date (names, quests,
 * shells, the item of every place with its price and the price in euros) and writes a message when
 * something changed (places, quests, shells, prizes). The prices of csgofast come in cents (205334 -> 2,053.34).
 *
 * .env: TELEGRAM_BOT_TOKEN (needed - without it nothing runs), TELEGRAM_CHAT_ID (optional: otherwise the
 * first chat that sends /start), TELEGRAM_POLL_MINUTES (5), TELEGRAM_EUR_RATE (0.57),
 * TELEGRAM_PLACES (15), TELEGRAM_HIGHLIGHT (FlaveDrake,duck.), CSGOFAST_TOP_URL, TELEGRAM_STATE_FILE (where the chat, the pinned message and the last ranking are kept).
 *
 * Commands in the chat: /start (this chat gets the ranking), /ranking (the ranking as a new message),
 * /raw (the first entry of the answer as it comes - to see its fields).
 */
const TOP_URL = process.env.CSGOFAST_TOP_URL || "https://back-new.csgofast.com/api/motivator/seasons-top?limit=15";
const minutes = () => Math.max(1, Number(process.env.TELEGRAM_POLL_MINUTES) || 5);
const eurRate = () => (process.env.TELEGRAM_EUR_RATE ? Number(String(process.env.TELEGRAM_EUR_RATE).replace(",", ".")) : 0.57);
const stateFile = () => process.env.TELEGRAM_STATE_FILE || path.join(__dirname, "..", ".telegram_bot.json");

/* ---------- Reading the ranking (csgofast: {seasonsTop: [{user: {name}, rank, score, completedQuestsCount, prizes}]}) ---------- */

// The prices come in cents: 205334 -> 2,053.34
const cents = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : null;
};

// The list of the answer: seasonsTop - or the first list of objects in it
function listOf(body) {
  if (Array.isArray(body)) return body;
  if (body == null || typeof body !== "object") return [];
  if (Array.isArray(body.seasonsTop)) return body.seasonsTop;
  for (const value of Object.values(body)) {
    if (Array.isArray(value) && value.some((v) => v && typeof v === "object")) return value;
    if (value && typeof value === "object") {
      const found = listOf(value);
      if (found.length) return found;
    }
  }
  return [];
}

// The prizes of a place: the items ({name, price, count}) and the balance (wallet: quantity x value)
function prizesOf(entry) {
  const items = [];
  let wallet = 0;
  for (const prize of Array.isArray(entry.prizes) ? entry.prizes : []) {
    const reward = prize && prize.reward;
    if (!reward) continue;
    const quantity = Number(prize.quantity) || 1;
    if (reward.type === "item" && reward.item) {
      const base = reward.item.baseItem || {};
      items.push({ name: base.name || "Item", price: cents(reward.item.price), count: quantity });
    } else if (reward.type === "wallet") {
      wallet += quantity * (cents(reward.value) || 0);
    }
  }
  return { items: items, wallet: Math.round(wallet * 100) / 100 };
}

function entryOf(entry, i) {
  const user = entry.user || {};
  const prizes = prizesOf(entry);
  return {
    place: Number(entry.rank) || i + 1,
    name: String(user.name || entry.userId || "?"),
    quests: Number.isFinite(Number(entry.completedQuestsCount)) ? Number(entry.completedQuestsCount) : null,
    shells: Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
    items: prizes.items,
    wallet: prizes.wallet,
  };
}

function parse(body) {
  return listOf(body)
    .filter((e) => e && typeof e === "object")
    .map(entryOf)
    .sort((a, b) => a.place - b.place);
}

// What the prizes of a place are worth (the items and the balance)
const worth = (row) => (row.items || []).reduce((sum, item) => sum + (item.price || 0) * item.count, 0) + (row.wallet || 0);

/* ---------- The messages ---------- */

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const int = (n) => (n == null ? "–" : Number(n).toLocaleString("de-DE", { maximumFractionDigits: 0 }));
const money = (n) => (n == null ? "–" : Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const euro = (n) => (n == null ? "–" : money(n * eurRate()) + " €");
const MEDALS = ["🥇", "🥈", "🥉"];
const time = (at) => new Date(at).toLocaleString("de-DE", { timeZone: process.env.TELEGRAM_TZ || "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// The players to highlight (TELEGRAM_HIGHLIGHT, comma separated)
const highlighted = () => new Set(String(process.env.TELEGRAM_HIGHLIGHT || "FlaveDrake,duck.").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean));
const places = () => Math.max(1, Number(process.env.TELEGRAM_PLACES) || 15);
// (the wear in short - one message has room for at most 4096 characters)
const WEAR = { "Factory New": "FN", "Minimal Wear": "MW", "Field-Tested": "FT", "Well-Worn": "WW", "Battle-Scarred": "BS" };
const shortName = (name) => String(name).replace(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)/, (all, wear) => "(" + WEAR[wear] + ")");

function rankingText(rows, at = Date.now(), compact = false) {
  const marked = highlighted();
  const lines = [`🏆 <b>Season-Ranking</b>`, `<i>Stand: ${esc(time(at))}</i>`, ""];
  if (!rows.length) lines.push("Keine Einträge.");
  for (const row of rows.slice(0, places())) {
    const mark = MEDALS[row.place - 1] || `<b>${row.place}.</b>`;
    const star = marked.has(row.name.toLowerCase());
    lines.push(star ? `${mark} ⭐️ <u><b>${esc(row.name)}</b></u> ⭐️` : `${mark} <b>${esc(row.name)}</b>`);
    lines.push(`🎯 ${int(row.quests)} Quests · 🐚 ${int(row.shells)} Shells`);
    for (const item of row.items || []) {
      lines.push(`🔪 ${item.count > 1 ? item.count + "× " : ""}${esc(compact ? shortName(item.name) : item.name)}`);
      lines.push(`💰 ${money(item.price)} Coins → <b>${euro(item.price)}</b>`);
    }
    if (row.wallet > 0 && !compact) lines.push(`💵 ${money(row.wallet)} Coins Guthaben → ${euro(row.wallet)}`);
    lines.push("");
  }
  const text = lines.join("\n").trim();
  // (too long for one message: the short form)
  return text.length > 4096 && !compact ? rankingText(rows, at, true) : text.slice(0, 4096);
}

// A name in a message (the highlighted ones with a star)
const who = (name) => (highlighted().has(name.toLowerCase()) ? `⭐️ <u><b>${esc(name)}</b></u>` : `<b>${esc(name)}</b>`);

// What changed since the last look: lines - empty: nothing
function changes(before, now) {
  if (!before) return [];
  const old = new Map(before.map((r) => [r.name, r]));
  const lines = [];
  for (const row of now) {
    const was = old.get(row.name);
    if (!was) {
      lines.push(`🆕 ${who(row.name)} ist neu auf Platz ${row.place}.`);
      continue;
    }
    const parts = [];
    if (was.place !== row.place) parts.push(row.place < was.place ? `⬆️ Platz ${was.place} → ${row.place}` : `⬇️ Platz ${was.place} → ${row.place}`);
    if (was.quests !== row.quests && row.quests != null) parts.push(`🎯 ${int(was.quests)} → ${int(row.quests)} Quests`);
    if (was.shells !== row.shells && row.shells != null) parts.push(`🐚 ${int(was.shells)} → ${int(row.shells)} Shells`);
    if (parts.length) lines.push(`${who(row.name)}: ${parts.join(", ")}`);
  }
  const names = new Set(now.map((r) => r.name));
  for (const row of before) if (!names.has(row.name)) lines.push(`👋 ${who(row.name)} ist raus (war Platz ${row.place}).`);
  // The prizes of the places: other items, other prices
  const oldPlaces = new Map(before.map((r) => [r.place, r]));
  for (const row of now) {
    const was = oldPlaces.get(row.place);
    if (!was) continue;
    const key = (r) => JSON.stringify([(r.items || []).map((i) => [i.name, i.price, i.count]), r.wallet || 0]);
    if (key(was) !== key(row)) lines.push(`🎁 Platz ${row.place}: jetzt ${money(worth(row))} Coins → ${euro(worth(row))} (vorher ${money(worth(was))} Coins)`);
  }
  return lines;
}

/* ---------- Telegram ---------- */

function api(method, body) {
  return fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw Object.assign(new Error(data.description || `Telegram ${method}: ${res.status}`), { code: data.error_code });
    return data.result;
  });
}

let state = { chatId: null, pinnedId: null, rows: null, at: null, offset: 0 };
function loadState() {
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(stateFile(), "utf8")) };
  } catch (error) {
    // the first start
  }
  if (process.env.TELEGRAM_CHAT_ID) state.chatId = process.env.TELEGRAM_CHAT_ID;
}
function saveState() {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch (error) {
    console.error("[telegram] Could not save:", error.message);
  }
}

async function fetchTop() {
  const res = await fetch(TOP_URL, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (ptfast_bot)" } });
  if (!res.ok) throw new Error(`csgofast: ${res.status}`);
  return res.json();
}

// The pinned message: edited - or sent anew and pinned (the first time, or when it is gone)
async function showPinned(text) {
  if (state.pinnedId) {
    try {
      await api("editMessageText", { chat_id: state.chatId, message_id: state.pinnedId, text: text, parse_mode: "HTML", disable_web_page_preview: true });
      return;
    } catch (error) {
      if (/not modified/i.test(error.message)) return;
      if (!/not found|can't be edited|message to edit/i.test(error.message)) throw error;
    }
  }
  const sent = await api("sendMessage", { chat_id: state.chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: true });
  state.pinnedId = sent.message_id;
  saveState();
  await api("pinChatMessage", { chat_id: state.chatId, message_id: sent.message_id, disable_notification: true }).catch((error) => console.error("[telegram] Could not pin:", error.message));
}

let busy = false;
async function check() {
  if (busy || !state.chatId) return;
  busy = true;
  try {
    const rows = parse(await fetchTop());
    const now = Date.now();
    const lines = changes(state.rows, rows);
    await showPinned(rankingText(rows, now));
    if (lines.length) await api("sendMessage", { chat_id: state.chatId, text: `🔔 <b>Änderungen</b>\n\n${lines.slice(0, 40).join("\n")}`, parse_mode: "HTML", disable_web_page_preview: true });
    state.rows = rows;
    state.at = now;
    saveState();
  } catch (error) {
    console.error("[telegram] Check failed:", error.message);
  } finally {
    busy = false;
  }
}

// The commands of the chat (long polling, one request at a time)
async function listen() {
  for (;;) {
    try {
      const updates = await api("getUpdates", { offset: state.offset, timeout: 50, allowed_updates: ["message"] });
      for (const update of updates) {
        state.offset = update.update_id + 1;
        const message = update.message;
        if (!message || typeof message.text !== "string") continue;
        const chatId = String(message.chat.id);
        const command = message.text.trim().split(/[\s@]/)[0].toLowerCase();
        // (another chat than the set one: only /start, and only while no chat is set)
        if (state.chatId && chatId !== String(state.chatId)) continue;
        if (command === "/start") {
          state.chatId = chatId;
          state.pinnedId = null;
          saveState();
          await api("sendMessage", { chat_id: chatId, text: `👋 Hier kommt das Ranking hin. Es wird alle ${minutes()} Minuten aktualisiert.` });
          await check();
        } else if (command === "/ranking") {
          const rows = state.rows || parse(await fetchTop());
          await api("sendMessage", { chat_id: chatId, text: rankingText(rows, state.at || Date.now()), parse_mode: "HTML", disable_web_page_preview: true });
        } else if (command === "/raw") {
          const body = await fetchTop();
          const first = listOf(body)[0];
          await api("sendMessage", { chat_id: chatId, text: "<pre>" + esc(JSON.stringify(first === undefined ? body : first, null, 1).slice(0, 3500)) + "</pre>", parse_mode: "HTML" });
        }
      }
      saveState();
    } catch (error) {
      console.error("[telegram] Updates failed:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
}

let started = false;
function start() {
  if (started || !process.env.TELEGRAM_BOT_TOKEN) return false;
  started = true;
  loadState();
  listen();
  check();
  setInterval(check, minutes() * 60 * 1000).unref();
  console.log(`[telegram] Bot läuft, alle ${minutes()} Minuten${state.chatId ? "" : " - schick ihm /start"}.`);
  return true;
}

module.exports = { start, parse, rankingText, changes, listOf };
