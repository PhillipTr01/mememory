/*
 * The accessory shop of the casino: frames, animations and backgrounds for the avatar
 * (game/shop.js). Paid with the coins outside a season - in a season with the
 * balance from before it. The avatar maker is on this page too (avatar_editor.js).
 */
// The connection of the jackpot: the chat, the coins at the top and the daily bonus
const socket = io((window.CASINO_NS || "") + "/jackpot");

var myName = null;
var shopData = null; // {items, owned, won, frame, effect, background, balance, season}
var RARITY = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", mystic: "Mystic", exclusive: "Exclusive", unique: "Unique" };
var KIND_ORDER = ["frame", "effect", "background"];
var KIND_NAMES = { frame: "Frame", effect: "Animation", background: "Background" };
// Try on: items put on only for a look (nothing bought, nothing saved, nobody else sees it) - {kind: id}
var tryOn = {};

// Used by chat.js
function chatUsername() {
  return myName;
}

function formatCoins(value) {
  return Number(value).toLocaleString("en-US");
}

function el(tag, className, text) {
  var element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.innerText = text;
  return element;
}

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => (document.getElementById("connectionBanner").hidden = false));
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
});
socket.on("casinoClosed", () => window.location.reload());
socket.on("joined", (data) => (myName = data.username));
// Coins changed (a win somewhere, a purchase): the balance of the shop again
socket.on("coins", () => shopData && load());
window.addEventListener("pagehide", () => socket.disconnect());

async function load() {
  try {
    var res = await fetch("shop/data", { cache: "no-store" });
    if (!res.ok) return;
    shopData = await res.json();
  } catch (error) {
    return;
  }
  render();
}

// An avatar of me wearing `look` (not from the looks of the page: the preview of an item)
function avatarWith(look, size) {
  var avatar = createAvatar(myName, size);
  // (data-preview: it keeps these looks - the name stays, so the own avatar still comes when it is loaded)
  avatar.dataset.preview = "1";
  return wearLooks(avatar, look);
}

// What I wear now - with one item in its place (the preview of an item)
function wornWith(item) {
  var look = { frame: shopData.frame, effect: shopData.effect, background: shopData.background };
  if (item) look[item.kind] = item.id;
  return look;
}

// What I would look like: what I wear - with what I try on
function lookNow() {
  return Object.assign(wornWith(null), tryOn);
}

// The preview of an item: on me as I would look now (with what I try on)
function previewWith(item) {
  var look = lookNow();
  look[item.kind] = item.id;
  return look;
}

// Try an item on (again: off) - or a whole set
function toggleTry(item) {
  if (tryOn[item.kind] == item.id) delete tryOn[item.kind];
  else tryOn[item.kind] = item.id;
  render();
}

function tryButton(item) {
  var on = tryOn[item.kind] == item.id;
  var button = el("button", "sh-try" + (on ? " on" : ""), on ? "✓ Trying" : "👁 Try on");
  button.type = "button";
  button.title = on ? "Take it off again" : "See it on you - with what else you try on";
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.addEventListener("click", () => toggleTry(item));
  return button;
}

// The fitting room: always in sight while trying on - me with all of it on a stage, what it is (a chip each, a click
// takes it off), what the rest would cost
var KIND_ICONS = { frame: "🖼️", effect: "✨", background: "🌄" };

function renderFitting() {
  var box = document.getElementById("shFitting");
  var tried = Object.values(tryOn)
    .map((id) => shopData.items.find((item) => item.id == id))
    .filter(Boolean)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  if (!tried.length) {
    if (box) box.remove();
    return;
  }
  if (!box) {
    box = el("aside", "sh-fitting");
    box.dataset.looksHover = "";
    box.id = "shFitting";
    box.setAttribute("aria-label", "Trying on");
    document.body.appendChild(box);
  }
  var stop = () => {
    tryOn = {};
    render();
  };
  // The head: what this is - and close (stop trying)
  var close = el("button", "sh-fitting-close", "✕");
  close.type = "button";
  close.title = "Stop trying";
  close.setAttribute("aria-label", "Stop trying");
  close.addEventListener("click", stop);
  var head = el("div", "sh-fitting-head");
  head.append(el("span", "sh-fitting-title", "Fitting room"), close);
  // The stage: me with all of it
  var stage = el("div", "sh-fitting-stage");
  stage.appendChild(avatarWith(lookNow(), "lg"));
  // The chips
  var chips = el("div", "sh-fitting-chips");
  tried.forEach((item) => {
    var chip = el("button", "sh-fitting-chip");
    chip.type = "button";
    chip.title = "Take " + item.name + " off";
    chip.append(el("span", "sh-fitting-icon", KIND_ICONS[item.kind]), el("span", "sh-fitting-name", item.name), el("span", "sh-fitting-x", "✕"));
    chip.addEventListener("click", () => toggleTry(item));
    chips.appendChild(chip);
  });
  // What the rest would cost (or: a reward only)
  var missing = tried.filter((item) => !isOwned(item));
  var cost = missing.filter((item) => !item.exclusive).reduce((sum, item) => sum + item.price, 0);
  var parts = [];
  if (!missing.length) parts.push("✓ All of it is yours");
  if (cost) parts.push("🪙 " + formatCoins(cost) + " to buy");
  if (missing.some((item) => item.exclusive)) parts.push("🔒 Rewards only");
  var foot = el("div", "sh-fitting-foot", parts.join(" · "));
  foot.dataset.coin = "real";
  box.replaceChildren(head, stage, chips, foot);
}

function render() {
  if (!myName || !shopData) return;
  // (what is gone from the shop: not tried on any more)
  for (var kind in tryOn) if (!shopData.items.some((item) => item.id == tryOn[kind])) delete tryOn[kind];
  document.getElementById("shName").innerText = myName;
  var hero = avatarWith(lookNow(), "lg");
  hero.id = "shHeroAvatar";
  document.getElementById("shHeroAvatar").replaceWith(hero);
  // The shop takes the 🪙 (the money outside seasons) - also in a season: the 🪙 stays a 🪙 here
  var balance = document.getElementById("shBalance");
  balance.dataset.coin = "real";
  balance.innerText = "🪙 " + formatCoins(shopData.balance);
  document.getElementById("shBalanceLabel").innerText = "Your coins";
  var note = document.getElementById("shBalanceNote");
  note.hidden = !shopData.free;
  note.innerText = "🧪 Everything is free right now - wear what you like.";
  if (typeof refreshLooks == "function") refreshLooks(myName, wornWith(null));
  renderGrid("shFrames", "frame");
  renderGrid("shEffects", "effect");
  renderGrid("shBackgrounds", "background");
  // The avatar maker open: its looks again (the whole tab only where the looks are - a color picker stays open)
  if (typeof renderAvatarEditor == "function" && !document.getElementById("avatarEditor").hidden) {
    if (editTab in LOOK_TABS || editTab == "bg") renderAvatarEditor();
    else document.getElementById("avatarPreview").replaceWith(previewAvatar(editing));
  }
  renderMystic();
  renderSeason();
  renderFitting();
}

// The exclusive items: worn like the rest when given - otherwise locked, with how to get them
function renderSeason() {
  var list = shopData.items.filter((item) => item.exclusive);
  document.getElementById("shSeasonSection").hidden = list.length == 0;
  document.querySelector('#shSections [data-section="shSeasonSection"]').hidden = list.length == 0;
  var won = shopData.won || [];
  // The singles first (the laurels - frames, then animations), then every set together (as the server sends them:
  // frame, animation, background) under a heading of its own
  var singles = list.filter((item) => !item.set).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  var sets = groupSets(list.filter((item) => item.set));
  document.getElementById("shSeason").replaceChildren(...singles.map(card), ...sets.flatMap((group) => [setHead(group), ...group.items.map(card)]));

  function card(item) {
    var owned = isOwned(item);
    var worn = shopData[item.kind] == item.id;
    var card = el("div", "sh-item exclusive" + (item.set ? " in-set" : "") + (item.unique ? " unique" : "") + (worn ? " worn" : "") + (owned ? " owned" : " locked"));
    card.dataset.looksHover = ""; // (its avatar live only while the mouse is over it - casino_looks.js)
    var stage = el("div", "sh-stage");
    stage.append(avatarWith(previewWith(item), "lg"), tryButton(item));
    var kindLabel = el("span", "sh-rarity", (item.unique ? "💎 Unique " : "✨ ") + KIND_NAMES[item.kind]);
    kindLabel.title = kindLabel.innerText;
    var nameLabel = el("span", "sh-item-name", item.name);
    nameLabel.title = item.name;
    card.append(stage, kindLabel, nameLabel);
    // Where it came from (given) - or how to get it
    var mine = won.filter((entry) => entry.id == item.id);
    if (mine.length) {
      var last = mine[mine.length - 1];
      card.appendChild(el("span", "sh-season-origin", (last.icon ? last.icon + " " : "") + (last.source || last.season || "A reward") + (last.rank ? " · #" + last.rank : "") + (mine.length > 1 ? " (" + mine.length + "×)" : "")));
    } else card.appendChild(el("span", "sh-season-origin how", owned ? "Free for all" : "Only as a reward"));
    var button;
    if (worn) {
      button = el("button", "mm-btn mm-btn-sm sh-btn", "Take off");
      button.addEventListener("click", () => wear(item.kind, null, button));
    } else if (owned) {
      button = el("button", "mm-btn mm-btn-sm sh-btn", "Wear");
      button.addEventListener("click", () => wear(item.kind, item.id, button));
    } else {
      button = el("button", "mm-btn mm-btn-sm sh-btn", "🔒 Not for sale");
      button.disabled = true;
    }
    button.type = "button";
    if (worn) card.appendChild(el("span", "sh-worn-tag", "Wearing"));
    card.appendChild(button);
    return card;
  }
}

// The heading of a set: its name, what it is - and (all of it mine) wear all of it at once
function setHead(group) {
  var head = el("div", "sh-set-head " + group.rarity);
  head.append(el("span", "sh-set-name", (group.unique ? "💎 " : group.exclusive ? "✨ " : "🔮 ") + group.name + " set"), el("span", "sh-set-note", "Frame, animation and background - made to be worn together"));
  var wearing = group.items.every((item) => shopData[item.kind] == item.id);
  // For sale (mystic): all of it at once - only what is still missing
  var missing = group.items.filter((item) => !isOwned(item));
  if (!group.exclusive && missing.length) {
    var price = missing.reduce((sum, item) => sum + item.price, 0);
    var buyAll = el("button", "mm-btn mm-btn-sm mm-btn-primary sh-set-buy", (missing.length < group.items.length ? "Buy the rest" : "Buy the set") + " · 🪙 " + formatCoins(price));
    buyAll.type = "button";
    buyAll.dataset.coin = "real";
    buyAll.disabled = shopData.balance < price;
    buyAll.title = buyAll.disabled ? (shopData.season ? "Not enough coins from before the season" : "Not enough coins") : "Buy " + group.name + " - and wear all of it";
    buyAll.addEventListener("click", async () => {
      if (await post("shop/buy-set", { set: group.id }, buyAll)) showHint("The " + group.name + " set is yours - you wear it now.", "success", document.getElementById("shHeroAvatar"));
    });
    head.appendChild(buyAll);
  } else if (group.items.every(isOwned) && !wearing) {
    var button = el("button", "mm-btn mm-btn-sm sh-set-wear", "Wear the set");
    button.type = "button";
    button.addEventListener("click", async () => {
      for (var item of group.items) if (shopData[item.kind] != item.id && !(await post("shop/wear", { kind: item.kind, id: item.id }, button))) return;
    });
    head.appendChild(button);
  } else if (wearing) head.appendChild(el("span", "sh-set-worn", "Wearing the set"));
  // Try the whole set on (again: off)
  var trying = group.items.every((item) => tryOn[item.kind] == item.id);
  var tryAll = el("button", "sh-try sh-set-try" + (trying ? " on" : ""), trying ? "✓ Trying the set" : "👁 Try the set");
  tryAll.type = "button";
  tryAll.setAttribute("aria-pressed", trying ? "true" : "false");
  tryAll.addEventListener("click", () => {
    group.items.forEach((item) => (trying ? tryOn[item.kind] == item.id && delete tryOn[item.kind] : (tryOn[item.kind] = item.id)));
    render();
  });
  head.appendChild(tryAll);
  return head;
}

function isOwned(item) {
  return shopData.free || shopData.owned.includes(item.id);
}

function renderGrid(id, kind) {
  var grid = document.getElementById(id);
  // (by rarity, then by price - the order of the server; the mystic sets in a section of their own)
  grid.replaceChildren(...shopData.items.filter((item) => item.kind == kind && !item.exclusive && item.rarity != "mystic").map(shopCard));
}

// A card of the shop: the item on me, its rarity and name - buy it, wear it or take it off
function shopCard(item) {
  // (free for all: everything can be worn without buying it)
  var owned = shopData.free || shopData.owned.includes(item.id);
  var kind = item.kind;
  var worn = shopData[kind] == item.id;
  var card = el("div", "sh-item " + item.rarity + (worn ? " worn" : "") + (owned ? " owned" : ""));
  card.dataset.looksHover = ""; // (its avatar live only while the mouse is over it - casino_looks.js)
  var stage = el("div", "sh-stage");
  // The preview: the item on me (with what I wear and what I try on)
  stage.append(avatarWith(previewWith(item), "lg"), tryButton(item));
  card.append(stage, el("span", "sh-rarity", RARITY[item.rarity] || item.rarity), el("span", "sh-item-name", item.name));
  var button;
  if (worn) {
    button = el("button", "mm-btn mm-btn-sm sh-btn", "Take off");
    button.addEventListener("click", () => wear(kind, null, button));
  } else if (owned) {
    button = el("button", "mm-btn mm-btn-sm sh-btn", "Wear");
    button.addEventListener("click", () => wear(kind, item.id, button));
  } else {
    button = el("button", "mm-btn mm-btn-sm mm-btn-primary sh-btn", "🪙 " + formatCoins(item.price));
    button.dataset.coin = "real";
    button.disabled = shopData.balance < item.price;
    button.title = button.disabled ? (shopData.season ? "Not enough coins from before the season" : "Not enough coins") : "Buy " + item.name;
    button.addEventListener("click", () => buy(item, button));
  }
  button.type = "button";
  if (worn) card.appendChild(el("span", "sh-worn-tag", "Wearing"));
  card.appendChild(button);
  return card;
}

// Mystic: sold only as sets - each under its heading (buy all of it at once: only what is still missing)
function renderMystic() {
  var list = shopData.items.filter((item) => item.rarity == "mystic" && !item.exclusive);
  document.getElementById("shSecMystic").hidden = list.length == 0;
  document.querySelector('#shSections [data-section="shSecMystic"]').hidden = list.length == 0;
  var singles = list.filter((item) => !item.set);
  var sets = groupSets(list.filter((item) => item.set));
  document.getElementById("shMystic").replaceChildren(...singles.map(shopCard), ...sets.flatMap((group) => [setHead(group), ...group.items.map(shopCard)]));
}

// Items of sets -> [{id, name, rarity, unique, items}] (in the order of the server: frame, animation, background)
function groupSets(list) {
  var sets = [];
  list.forEach((item) => {
    var group = sets.find((entry) => entry.id == item.set);
    if (!group) sets.push((group = { id: item.set, name: item.setName || item.set, rarity: item.rarity, unique: item.unique, exclusive: item.exclusive, items: [] }));
    group.items.push(item);
  });
  return sets;
}

async function post(path, body, button) {
  button.disabled = true;
  try {
    var res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || "That didn't work.");
    shopData = data;
    render();
    return true;
  } catch (error) {
    showHint(error.message, "error", button);
    button.disabled = false;
    return false;
  }
}

async function buy(item, button) {
  if (await post("shop/buy", { id: item.id }, button)) showHint(item.name + " is yours - you wear it now.", "success", document.getElementById("shHeroAvatar"));
}

function wear(kind, id, button) {
  post("shop/wear", { kind: kind, id: id }, button);
}

/* ---------- The avatar maker: what I have from the shop, to wear (casino only) ---------- */

// Tabs of their own (avatar_editor.js): frames and animations - the backgrounds in the Background tab
var LOOK_TABS = { frame: { label: "Frames" }, effect: { label: "Animations" } };

// What is picked in the avatar maker - only shown until "Save avatar" ({kind: id | null}; a kind not in it: as worn)
var pickedLooks = {};

function editorLooks() {
  return Object.assign(wornWith(null), pickedLooks);
}

function pickLook(kind, id) {
  if ((shopData[kind] || null) == id) delete pickedLooks[kind];
  else pickedLooks[kind] = id;
}

function lookChanges() {
  return Object.keys(pickedLooks).length > 0;
}

function resetLooks() {
  pickedLooks = {};
}

// A color of the background picked: the casino background comes off (else the color wouldn't show)
function pickedColor(part) {
  if (part == "bg" && shopData) pickLook("background", null);
}

// Saved: what was picked is worn (one after the other - the last answer is the shop as it is now)
async function saveLooks() {
  for (var [kind, id] of Object.entries(pickedLooks)) {
    var res = await fetch("shop/wear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: kind, id: id }) });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || "That didn't work.");
    shopData = data;
  }
  pickedLooks = {};
  render();
}

// The preview of the editor wears what I wear - with what is picked
function decorateAvatarPreview(avatar) {
  if (shopData && typeof wearLooks == "function") wearLooks(avatar, editorLooks());
}

// Background: the casino backgrounds I have first (my color under them)
function renderPartExtras(part, options) {
  if (part != "bg" || !shopData) return;
  renderLookOptions("background", optionGroup(options, "Casino backgrounds"));
}

// What I have of a kind (free for all: everything that is on) - "None" first; a click wears it right away
function renderLookOptions(kind, options) {
  if (!shopData) return;
  var mine = shopData.items.filter((item) => item.kind == kind && isOwned(item));
  if (mine.length == 0) {
    var empty = el("div", "avatar-options-empty");
    var go = el("button", "mm-btn mm-btn-sm", "🛍️ To the shop");
    go.type = "button";
    go.addEventListener("click", () => setView("shop"));
    empty.append(el("span", "", "No " + KIND_NAMES[kind].toLowerCase() + "s yet - get them in the shop (or as a reward)."), go);
    options.appendChild(empty);
    return;
  }
  var option = (id, label) => {
    var on = (editorLooks()[kind] || null) == id;
    var button = el("button", "avatar-option tile look" + (on ? " selected" : ""));
    button.type = "button";
    button.setAttribute("aria-pressed", on);
    button.title = label;
    var face = createAvatarPreview(editing);
    var look = editorLooks();
    look[kind] = id;
    wearLooks(face, look);
    button.append(face, el("span", "avatar-option-label", label));
    // Only the preview - "Save avatar" puts it on
    button.addEventListener("click", () => {
      pickLook(kind, id);
      renderAvatarEditor();
    });
    return button;
  };
  options.append(option(null, kind == "background" ? "My color" : "None"), ...mine.map((item) => option(item.id, item.name)));
}

/* ---------- Two views: the shop and the avatar maker (shop#avatar) ---------- */

var openEditor = null;
var closeEditor = null;
var VIEWS = {
  shop: { icon: "🛍️", title: "Shop", text: "Frames, animations and backgrounds for your avatar - everybody in the casino sees them." },
  avatar: { icon: "🎨", title: "Avatar", text: "Your face in the casino." },
};

function setView(view) {
  var main = document.querySelector(".sh-main");
  var avatar = view == "avatar";
  main.classList.toggle("view-avatar", avatar);
  document.getElementById("shTitleIcon").innerText = VIEWS[view].icon;
  document.getElementById("shTitle").innerText = VIEWS[view].title;
  document.getElementById("shSubtitle").innerText = VIEWS[view].text;
  // (what was picked and not saved is forgotten)
  pickedLooks = {};
  if (!avatar && !document.getElementById("avatarEditor").hidden) closeEditor();
  // (the avatar view: always the saved avatar first)
  else if (avatar) openEditor();
  var hash = avatar ? "#avatar" : "";
  if (location.hash != hash) history.replaceState(null, "", location.pathname + location.search + hash);
}

// The editor opens / closes (the edit buttons, #avatar, Cancel, Save): the view goes with it
// (avatar_editor.js comes after this file: taken over once the page is there)
function takeOverEditor() {
  openEditor = openAvatarEditor;
  closeEditor = closeAvatarEditor;
  openAvatarEditor = () => setView("avatar");
  // (saved: the avatar view stays - the editor shows the saved avatar again)
  closeAvatarEditor = () => openEditor();
  // The shop again (the profile menu's Shop, back in the browser): the shop view
  window.addEventListener("hashchange", () => location.hash != "#avatar" && setView("shop"));
}

// The row of the sections: a click flips to one; the one in view is marked
function setupSections() {
  var buttons = [...document.querySelectorAll("#shSections [data-section]")];
  var row = document.getElementById("shSections");
  var mark = (id) =>
    buttons.forEach((button) => {
      var on = button.dataset.section == id;
      if (on && !button.classList.contains("active")) row.scrollTo({ left: button.offsetLeft - (row.clientWidth - button.offsetWidth) / 2, behavior: "smooth" });
      button.classList.toggle("active", on);
    });
  buttons.forEach((button) =>
    button.addEventListener("click", () => {
      document.getElementById(button.dataset.section).scrollIntoView({ behavior: "smooth", block: "start" });
      mark(button.dataset.section);
    }),
  );
  // (the section whose top passed the upper third of the screen last)
  var pick = () => {
    var current = buttons[0].dataset.section;
    buttons.forEach((button) => {
      var section = document.getElementById(button.dataset.section);
      if (!section.hidden && section.getBoundingClientRect().top < window.innerHeight / 3) current = button.dataset.section;
    });
    mark(current);
  };
  var queued = false;
  window.addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      pick();
    });
  }, { passive: true });
  pick();
}

document.addEventListener("DOMContentLoaded", () => {
  takeOverEditor();
  setupSections();
  setupChat();
  userPromise.then((username) => {
    if (!username) return;
    myName = myName || username;
    load();
  });

});
