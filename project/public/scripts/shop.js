/*
 * The accessory shop of the casino: frames, animations and backgrounds for the avatar
 * (game/shop.js). Paid with the coins outside a season - in a season with the
 * balance from before it. The avatar maker is on this page too (avatar_editor.js).
 */
// The connection of the jackpot: the chat, the coins at the top and the daily bonus
const socket = io((window.CASINO_NS || "") + "/jackpot");

var myName = null;
var shopData = null; // {items, owned, won, frame, effect, background, balance, season}
var RARITY = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", exclusive: "Exclusive" };
var KIND_ORDER = ["frame", "effect", "background"];
var KIND_NAMES = { frame: "Frame", effect: "Animation", background: "Background" };

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

function render() {
  if (!myName || !shopData) return;
  document.getElementById("shName").innerText = myName;
  var hero = avatarWith(wornWith(null), "lg");
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
  if (typeof renderAvatarEditor == "function" && !document.getElementById("avatarEditor").hidden && editTab in LOOK_TABS) renderAvatarEditor();
  renderSeason();
}

// The exclusive items: worn like the rest when given - otherwise locked, with how to get them
function renderSeason() {
  var list = shopData.items.filter((item) => item.exclusive);
  document.getElementById("shSeasonSection").hidden = list.length == 0;
  document.querySelector('#shSections [data-section="shSeasonSection"]').hidden = list.length == 0;
  var won = shopData.won || [];
  document.getElementById("shSeason").replaceChildren(
    // (frames, then animations - each by price, as the server sends them)
    ...list
      .slice()
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
      .map((item) => {
        var owned = isOwned(item);
        var worn = shopData[item.kind] == item.id;
        var card = el("div", "sh-item exclusive" + (worn ? " worn" : "") + (owned ? " owned" : " locked"));
        var stage = el("div", "sh-stage");
        stage.appendChild(avatarWith(wornWith(item), "lg"));
        card.append(stage, el("span", "sh-rarity", "Exclusive " + KIND_NAMES[item.kind].toLowerCase()), el("span", "sh-item-name", item.name));
        // Where it came from (given) - or how to get it
        var mine = won.filter((entry) => entry.id == item.id);
        if (mine.length) {
          var last = mine[mine.length - 1];
          card.appendChild(el("span", "sh-season-origin", (last.icon ? last.icon + " " : "") + (last.source || last.season || "A reward") + (last.rank ? " · #" + last.rank : "") + (mine.length > 1 ? " (" + mine.length + "×)" : "")));
        }
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
      }),
  );
}

function isOwned(item) {
  return shopData.free || shopData.owned.includes(item.id);
}

function renderGrid(id, kind) {
  var grid = document.getElementById(id);
  grid.replaceChildren(
    ...shopData.items
      // (by rarity, then by price - the order of the server)
      .filter((item) => item.kind == kind && !item.exclusive)
      .map((item) => {
        // (free for all: everything can be worn without buying it)
        var owned = shopData.free || shopData.owned.includes(item.id);
        var worn = shopData[kind] == item.id;
        var card = el("div", "sh-item " + item.rarity + (worn ? " worn" : "") + (owned ? " owned" : ""));
        var stage = el("div", "sh-stage");
        // The preview: the item alone (with the other kind I wear)
        stage.appendChild(avatarWith(wornWith(item), "lg"));
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
      }),
  );
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

// The preview of the editor wears what I wear
function decorateAvatarPreview(avatar) {
  if (shopData && typeof wearLooks == "function") wearLooks(avatar, wornWith(null));
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
    var worn = (shopData[kind] || null) == id;
    var button = el("button", "avatar-option tile look" + (worn ? " selected" : ""));
    button.type = "button";
    button.setAttribute("aria-pressed", worn);
    button.title = label;
    var face = createAvatarPreview(editing);
    var look = wornWith(null);
    look[kind] = id;
    wearLooks(face, look);
    button.append(face, el("span", "avatar-option-label", label));
    button.addEventListener("click", () => worn || wear(kind, id, button));
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
