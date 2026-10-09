/*
 * The accessory shop of the casino: frames and animations for the avatar
 * (game/shop.js). Paid with the coins outside a season - in a season with the
 * balance from before it. The avatar maker is on this page too (avatar_editor.js).
 */
// The connection of the jackpot: the chat, the coins at the top and the daily bonus
const socket = io((window.CASINO_NS || "") + "/jackpot");

var myName = null;
var shopData = null; // {items, owned, frame, effect, balance, season}
var RARITY = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };

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
  // (casino_looks.js puts my worn looks on it - here exactly the ones asked for)
  [...avatar.classList].filter((c) => c.startsWith("look-")).forEach((c) => avatar.classList.remove(c));
  avatar.querySelectorAll(".look-fx").forEach((fx) => fx.remove());
  avatar.dataset.preview = "1";
  if (look.frame) avatar.classList.add("look-frame-" + look.frame);
  if (look.effect) {
    avatar.classList.add("look-fx-" + look.effect);
    avatar.appendChild(el("span", "look-fx"));
  }
  // The preview keeps its looks (not the ones of the player)
  avatar.removeAttribute("data-name");
  return avatar;
}

function render() {
  if (!myName || !shopData) return;
  document.getElementById("shName").innerText = myName;
  var hero = avatarWith({ frame: shopData.frame, effect: shopData.effect }, "lg");
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
  if (typeof refreshLooks == "function") refreshLooks(myName, { frame: shopData.frame, effect: shopData.effect });
  renderGrid("shFrames", "frame");
  renderGrid("shEffects", "effect");
}

function renderGrid(id, kind) {
  var grid = document.getElementById(id);
  grid.replaceChildren(
    ...shopData.items
      .filter((item) => item.kind == kind)
      .sort((a, b) => a.price - b.price)
      .map((item) => {
        // (free for all: everything can be worn without buying it)
        var owned = shopData.free || shopData.owned.includes(item.id);
        var worn = shopData[kind] == item.id;
        var card = el("div", "sh-item " + item.rarity + (worn ? " worn" : "") + (owned ? " owned" : ""));
        var stage = el("div", "sh-stage");
        // The preview: the item alone (with the other kind I wear)
        stage.appendChild(avatarWith(kind == "frame" ? { frame: item.id, effect: shopData.effect } : { frame: shopData.frame, effect: item.id }, "lg"));
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

/* ---------- Two views: the shop and the avatar maker (shop#avatar) ---------- */

var openEditor = null;
var closeEditor = null;
var VIEWS = {
  shop: { icon: "🛍️", title: "Shop", text: "Frames and animations for your avatar - everybody in the casino sees them." },
  avatar: { icon: "🎨", title: "Avatar", text: "Your face in the casino - the frame and the animation from the shop come on top." },
};

function setView(view) {
  var main = document.querySelector(".sh-main");
  var avatar = view == "avatar";
  main.classList.toggle("view-avatar", avatar);
  document.querySelectorAll(".sh-view-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view == view);
    tab.setAttribute("aria-selected", tab.dataset.view == view ? "true" : "false");
  });
  document.getElementById("shTitleIcon").innerText = VIEWS[view].icon;
  document.getElementById("shTitle").innerText = VIEWS[view].title;
  document.getElementById("shSubtitle").innerText = VIEWS[view].text;
  if (avatar && document.getElementById("avatarEditor").hidden) openEditor();
  if (!avatar && !document.getElementById("avatarEditor").hidden) closeEditor();
  var hash = avatar ? "#avatar" : "";
  if (location.hash != hash) history.replaceState(null, "", location.pathname + location.search + hash);
}

// The editor opens / closes (the edit buttons, #avatar, Cancel, Save): the view goes with it
// (avatar_editor.js comes after this file: taken over once the page is there)
function takeOverEditor() {
  openEditor = openAvatarEditor;
  closeEditor = closeAvatarEditor;
  openAvatarEditor = () => setView("avatar");
  closeAvatarEditor = () => setView("shop");
}

document.addEventListener("DOMContentLoaded", () => {
  takeOverEditor();
  setupChat();
  userPromise.then((username) => {
    if (!username) return;
    myName = myName || username;
    load();
  });
  document.getElementById("shEditAvatar").addEventListener("click", () => setView("avatar"));
  document.querySelectorAll(".sh-view-tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
});
