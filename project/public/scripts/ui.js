/* Small UI helpers shared by lobby and multiplayer room */

// Same name -> same color, so players are easy to recognise
function avatarColor(name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 22%, 38%)`;
}

// Avatar with the first letter of the name (built with DOM nodes, no innerHTML).
// Users with an own avatar (avatar maker) get it as soon as it is loaded.
// The house in the jackpot when a player is alone (see sockets/jackpot_server.js)
var GHOST_BET = "Ghost";

function createAvatar(name, size, online) {
  var avatar = document.createElement("span");
  avatar.className = "mm-avatar" + (size ? " " + size : "");
  if (name == GHOST_BET) {
    avatar.classList.add("ghost");
    avatar.innerText = "👻";
    avatar.title = name;
    avatar.dataset.name = name;
    return avatar;
  }
  avatar.style.background = avatarColor(name);
  avatar.innerText = name.charAt(0);
  avatar.title = name;
  avatar.dataset.name = name;
  if (typeof drawAvatar == "function") {
    // Right away: the saved one, or the default avatar of the name (no flicker
    // for most users); an own avatar replaces it once it is loaded
    applyAvatar(avatar, name in avatarCache ? avatarCache[name] : null);
    // The cache is only for the first moment: every page asks once for the
    // current avatar, so changes by others show up
    if (!avatarChecked.has(name)) requestAvatar(name);
  }

  if (online !== undefined) {
    var dot = document.createElement("span");
    dot.className = "mm-status-dot" + (online ? "" : " offline");
    avatar.appendChild(dot);
  }
  return avatar;
}

/* ---------- Own avatars (avatar maker, see avatar.js) ---------- */

// name -> config or null (letter); kept for the browser tab, so pages don't flicker
var avatarCache = {};
try {
  avatarCache = JSON.parse(sessionStorage.getItem("avatars")) || {};
} catch (error) {
  avatarCache = {};
}
var avatarQueue = new Set();
var avatarChecked = new Set(); // names this page already asked the server for
var avatarTimer = null;

function saveAvatarCache() {
  try {
    sessionStorage.setItem("avatars", JSON.stringify(avatarCache));
  } catch (error) {
    // storage full or blocked: only this page knows the avatars
  }
}

// config: own avatar, null = the default avatar of the name, "letter" = letter
// (the online dot stays)
function applyAvatar(element, config) {
  var old = element.querySelector(".mm-avatar-svg");
  if (old) old.remove();
  if (config == null) config = nameAvatar(element.dataset.name);
  var letter = config == AVATAR_LETTER;
  element.classList.toggle("has-avatar", !letter);
  if (letter) {
    if (element.firstChild == null || element.firstChild.nodeType != Node.TEXT_NODE) {
      element.insertBefore(document.createTextNode(element.dataset.name.charAt(0)), element.firstChild);
    }
    return;
  }
  if (element.firstChild && element.firstChild.nodeType == Node.TEXT_NODE) element.firstChild.remove();
  element.insertBefore(drawAvatar(config), element.firstChild);
}

// Avatars are loaded together (one request for a whole player list)
function requestAvatar(name) {
  avatarQueue.add(name);
  clearTimeout(avatarTimer);
  avatarTimer = setTimeout(loadAvatars, 30);
}

function loadAvatars() {
  var names = [...avatarQueue].filter((name) => !avatarChecked.has(name));
  avatarQueue.clear();
  names.forEach((name) => avatarChecked.add(name));
  if (names.length == 0) return;
  // (the admin panel asks its own address - it has no player login)
  fetch((window.AVATAR_URL || "/requests/user/avatars") + "?names=" + encodeURIComponent(names.join(",")), { credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : null))
    .then((avatars) => {
      if (avatars == null) return;
      names.forEach((name) => setAvatarConfig(name, avatars[name] || null));
    })
    .catch(() => {});
}

// Updates the cache and every avatar of this user on the page
function setAvatarConfig(name, config) {
  // Unchanged (the usual case): nothing to redraw
  if (name in avatarCache && JSON.stringify(avatarCache[name]) == JSON.stringify(config)) return;
  avatarCache[name] = config;
  saveAvatarCache();
  document.querySelectorAll(".mm-avatar").forEach((element) => {
    if (element.dataset.name == name) applyAvatar(element, config);
  });
}

/*
 * The server was restarted / updated while the page was open (the socket
 * reconnected by itself): reload, so the page code fits the server again.
 */
document.addEventListener("DOMContentLoaded", () => {
  var meta = document.querySelector('meta[name="app-version"]');
  if (meta == null || typeof socket == "undefined") return;
  socket.on("appVersion", (current) => {
    if (current && current != meta.content) window.location.reload();
  });
});

// Small square button with only an icon; the label is the hover tooltip
function createIconButton(icon, label, extraClass, onClick) {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn" + (extraClass ? " " + extraClass : "");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(createIcon(icon));
  button.addEventListener("click", onClick);
  return button;
}

function createIcon(classes, title) {
  var icon = document.createElement("i");
  icon.className = "bi " + classes;
  if (title) icon.title = title;
  return icon;
}

/*
 * No toasts: a short message sits as a small bubble on the control it is
 * about (the button just clicked, the field just used) and goes by itself.
 * showHint(message, type, anchor) - without an anchor: what was clicked last.
 */
var lastControl = null;
document.addEventListener(
  "pointerdown",
  (event) => {
    var control = event.target.closest && event.target.closest("button, input, select, a, [role=button], [data-hint-anchor]");
    if (control) lastControl = control;
  },
  true,
);
document.addEventListener(
  "keydown",
  (event) => {
    if (event.target && event.target.closest && event.target.closest("button, input, select, a, [role=button]")) lastControl = event.target;
  },
  true,
);

function showHint(message, type, anchor) {
  anchor = anchor || lastControl;
  // The control is gone (or hidden): the main panel of the page
  if (!anchor || !anchor.isConnected || anchor.getClientRects().length == 0) anchor = document.querySelector("[data-hint-home]") || document.querySelector("main") || document.body;
  document.querySelectorAll(".mm-hint").forEach((old) => old.remove());
  var hint = document.createElement("div");
  hint.className = "mm-hint" + (type ? " " + type : "");
  hint.setAttribute("role", type == "error" ? "alert" : "status");
  hint.innerText = message;
  document.body.appendChild(hint);
  var box = anchor.getBoundingClientRect();
  var width = hint.offsetWidth;
  var left = Math.max(8, Math.min(window.innerWidth - width - 8, box.left + box.width / 2 - width / 2));
  // Over the control - under it when there is no room above
  var above = box.top - hint.offsetHeight - 10 > 8;
  var top = above ? box.top - hint.offsetHeight - 10 : Math.min(box.bottom + 10, window.innerHeight - hint.offsetHeight - 8);
  if (anchor == document.body || box.height > window.innerHeight * 0.6) top = Math.max(8, box.top + 12);
  // A side bar (data-hint-right): next to the item, not over the one above it
  if (anchor.closest("[data-hint-right]") && window.innerWidth > 991) {
    hint.style.left = box.right + 10 + "px";
    hint.style.top = Math.max(8, box.top + box.height / 2 - hint.offsetHeight / 2) + "px";
    hint.classList.add("right");
  } else {
    hint.style.left = left + "px";
    hint.style.top = top + "px";
    hint.style.setProperty("--arrow", Math.max(12, Math.min(width - 12, box.left + box.width / 2 - left)) + "px");
    hint.classList.add(above ? "above" : "below");
  }
  var remove = () => {
    window.removeEventListener("scroll", remove, true);
    hint.classList.add("out");
    setTimeout(() => hint.remove(), 150);
  };
  window.addEventListener("scroll", remove, true);
  // Short: read it, then it fades (a click anywhere takes it away right away)
  setTimeout(remove, type == "error" ? 1800 : 1200);
  setTimeout(() => document.addEventListener("pointerdown", remove, { once: true, capture: true }), 0);
}

// Small message at the bottom of the screen instead of alert() (the MemeMory pages - the casino uses showHint)
function showToast(message, type) {
  // The game pages show everything on the board / in the chat instead
  if (document.body.classList.contains("no-toasts")) return;
  var container = document.getElementById("mm-toasts");
  if (container == null) {
    container = document.createElement("div");
    container.id = "mm-toasts";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }

  var toast = document.createElement("div");
  toast.className = "mm-toast" + (type ? " " + type : "");
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/*
 * A notification of the casino (top right, like "Your case battle starts!"):
 * casinoNotice({icon, title, text, action: {label, run}, ms, key})
 * - several stack under each other; the same key replaces the one before.
 */
function noticeStack() {
  var stack = document.getElementById("mm-notices");
  if (stack == null) {
    stack = document.createElement("div");
    stack.id = "mm-notices";
    stack.className = "bt-notice-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

function casinoNotice(options) {
  var stack = noticeStack();
  if (window.casinoSound && options.sound !== false) window.casinoSound.play(options.key == "rain" ? "rain" : "notice");
  if (options.key) stack.querySelectorAll(".bt-notice").forEach((old) => old.dataset.key == options.key && old.remove());
  var notice = document.createElement("div");
  notice.className = "bt-notice";
  notice.setAttribute("role", "status");
  if (options.key) notice.dataset.key = options.key;
  var icon = document.createElement("span");
  icon.className = "bt-notice-icon";
  icon.innerText = options.icon || "🔔";
  var text = document.createElement("div");
  text.className = "bt-notice-text";
  var title = document.createElement("b");
  title.innerText = options.title;
  text.appendChild(title);
  if (options.text) {
    var line = document.createElement("span");
    line.innerText = options.text;
    text.appendChild(line);
  }
  var hide = () => {
    if (notice.classList.contains("out")) return;
    notice.classList.add("out");
    setTimeout(() => notice.remove(), 250);
  };
  notice.append(icon, text);
  if (options.action) {
    var go = document.createElement("button");
    go.type = "button";
    go.className = "mm-btn mm-btn-primary mm-btn-sm";
    go.innerText = options.action.label;
    go.addEventListener("click", () => {
      hide();
      options.action.run();
    });
    notice.appendChild(go);
  }
  var close = document.createElement("button");
  close.type = "button";
  close.className = "bt-notice-close";
  close.innerText = "×";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", hide);
  notice.appendChild(close);
  stack.appendChild(notice);
  setTimeout(hide, options.ms || 6000);
  return { hide: hide };
}

/*
 * Updates `parent` to look like `nodes` - but only where something differs:
 * equal parts stay as they are (no flicker, avatars are not drawn again),
 * a changed number is just a changed text. (Listeners of the new nodes are not
 * moved over to kept ones - for lists that are only shown.)
 */
function morphChildren(parent, nodes) {
  nodes = nodes.filter((node) => node != null);
  nodes.forEach((node, i) => {
    var old = parent.childNodes[i];
    if (old == null) parent.appendChild(node);
    else morphNode(old, node);
  });
  while (parent.childNodes.length > nodes.length) parent.lastChild.remove();
}

function morphNode(old, fresh) {
  if (old.nodeType != fresh.nodeType || old.nodeName != fresh.nodeName) return old.replaceWith(fresh);
  if (old.nodeType != 1) {
    if (old.nodeValue != fresh.nodeValue) old.nodeValue = fresh.nodeValue;
    return;
  }
  // The same player's avatar: kept as it is (its picture may still be loading in the new one)
  if (old.classList.contains("mm-avatar")) {
    if (old.dataset.name != fresh.dataset.name || old.className != fresh.className) old.replaceWith(fresh);
    return;
  }
  // (the tooltips move a title to data-tip - not a change)
  var tip = old.dataset.tip;
  for (var attr of [...old.attributes]) {
    if (attr.name == "data-tip" || attr.name == "aria-label") continue;
    if (!fresh.hasAttribute(attr.name)) old.removeAttribute(attr.name);
  }
  for (var attr2 of [...fresh.attributes]) {
    if (attr2.name == "title" && tip != null) {
      if (tip != attr2.value) old.dataset.tip = attr2.value;
      continue;
    }
    if (old.getAttribute(attr2.name) != attr2.value) old.setAttribute(attr2.name, attr2.value);
  }
  morphChildren(old, [...fresh.childNodes]);
}

function copyText(text, button) {
  var done = () => {
    showToast("Copied to clipboard!");
    if (button) {
      button.classList.add("copied");
      setTimeout(() => button.classList.remove("copied"), 1500);
    }
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => prompt("Copy this:", text));
  } else {
    prompt("Copy this:", text);
  }
}

/*
 * Styled confirm dialog instead of the browser's confirm().
 * Returns a Promise<boolean>. Escape / click outside = cancel.
 */
function confirmDialog(options) {
  return new Promise((resolve) => {
    var previousFocus = document.activeElement;

    var backdrop = document.createElement("div");
    backdrop.className = "mm-dialog-backdrop";

    var dialog = document.createElement("div");
    dialog.className = "mm-dialog" + (options.danger ? " danger" : "");
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");


    var title = document.createElement("h2");
    title.className = "mm-dialog-title";
    title.id = "mm-dialog-title";
    title.innerText = options.title;
    dialog.setAttribute("aria-labelledby", title.id);

    var text = document.createElement("p");
    text.className = "mm-dialog-text";
    text.innerText = options.text || "";

    var actions = document.createElement("div");
    actions.className = "mm-dialog-actions";

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "mm-btn";
    cancel.innerText = options.cancelLabel || "Cancel";

    var confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "mm-btn " + (options.danger ? "mm-btn-danger-solid" : "mm-btn-primary");
    if (options.confirmIcon) confirm.appendChild(createIcon(options.confirmIcon));
    confirm.appendChild(document.createTextNode(options.confirmLabel || "OK"));

    actions.append(cancel, confirm);
    dialog.append(title, text, actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    function close(result) {
      document.removeEventListener("keydown", onKey);
      backdrop.classList.add("closing");
      setTimeout(() => backdrop.remove(), 150);
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      resolve(result);
    }

    function onKey(event) {
      if (event.key == "Escape") close(false);
      // Keep the focus inside the dialog
      if (event.key == "Tab") {
        event.preventDefault();
        (document.activeElement == cancel ? confirm : cancel).focus();
      }
    }

    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    backdrop.addEventListener("click", (event) => {
      if (event.target == backdrop) close(false);
    });
    document.addEventListener("keydown", onKey);

    // The safe choice has the focus
    cancel.focus();
  });
}

/*
 * Styled hover labels instead of the browser's default ones: every element
 * with a title gets this tooltip (also elements that are added later).
 */
(function () {
  var tip = null;
  var current = null;
  var watch = null;

  function hide() {
    if (tip) tip.hidden = true;
    current = null;
    clearInterval(watch);
  }

  // The element was redrawn or something covers it now (e.g. an overlay),
  // without the mouse moving -> don't leave the label behind
  function watchCurrent() {
    clearInterval(watch);
    watch = setInterval(() => {
      if (current && (!current.isConnected || !current.matches(":hover"))) hide();
    }, 200);
  }

  function show(element) {
    if (tip == null) {
      tip = document.createElement("div");
      tip.className = "mm-tooltip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
    }
    tip.innerText = element.dataset.tip;
    tip.hidden = false;
    tip.classList.remove("below");

    // Above the element, centered; below if there is no room above
    var rect = element.getBoundingClientRect();
    var box = tip.getBoundingClientRect();
    var top = rect.top - box.height - 8;
    if (top < 4) {
      top = rect.bottom + 8;
      tip.classList.add("below");
    }
    var left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - box.width - 6));
    tip.style.top = top + "px";
    tip.style.left = left + "px";
  }

  document.addEventListener("mouseover", (event) => {
    var element = event.target.closest && event.target.closest("[title], [data-tip]");
    if (element == null || element == current) return;
    // Move the title to data-tip, so the browser doesn't show its own label
    if (element.hasAttribute("title")) {
      var title = element.getAttribute("title");
      element.removeAttribute("title");
      if (title) element.dataset.tip = title;
      if (!element.hasAttribute("aria-label") && title) element.setAttribute("aria-label", title);
    }
    if (!element.dataset.tip) return;
    current = element;
    show(element);
    watchCurrent();
  });

  document.addEventListener("mouseout", (event) => {
    if (current && !current.contains(event.relatedTarget)) hide();
  });
  // The element was redrawn (e.g. the player list) -> don't leave the label behind
  document.addEventListener("mousemove", () => {
    if (current && !current.isConnected) hide();
  });
  document.addEventListener("mousedown", hide);
  window.addEventListener("scroll", hide, true);
})();

/*
 * "Who starts?" - the same slot machine in every game (MemeMory, Singleplayer,
 * Tic Tac Toe). Needs #startOverlay, #reelTrack and #startResult on the page.
 * options: players (names), starter (index), duration (ms), myName,
 *          spin (ms, optional), avatar (name -> element, optional)
 */
function playStartReel(options) {
  var overlay = document.getElementById("startOverlay");
  var track = document.getElementById("reelTrack");
  var result = document.getElementById("startResult");
  var reel = track.parentElement;
  var itemHeight = parseFloat(getComputedStyle(reel).getPropertyValue("--item")) || 72;
  var players = options.players;
  var starter = options.starter;
  var avatar = options.avatar || ((name) => createAvatar(name));

  // Long list of names, the starter is the second to last one (under the marker)
  var rounds = Math.max(4, Math.ceil(24 / players.length));
  var names = [];
  for (var r = 0; r < rounds; r++) names.push(...players);
  names.push(...players.slice(0, starter + 1));
  names.push(players[(starter + 1) % players.length]); // one more below the marker

  track.replaceChildren();
  names.forEach((name) => {
    var item = document.createElement("div");
    item.className = "reel-item";
    item.append(avatar(name), document.createTextNode(name));
    track.appendChild(item);
  });

  var target = names.length - 2;
  var spin = options.spin || Math.max(1200, options.duration - 1300);

  result.classList.remove("show");
  result.innerText = "";
  track.style.transition = "none";
  track.style.transform = "translateY(0)";
  overlay.hidden = false;

  // Start the spin in the next frame so the transition is applied
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      track.style.transition = `transform ${spin}ms cubic-bezier(0.12, 0.75, 0.18, 1)`;
      // The marker is the second row of the reel
      track.style.transform = `translateY(${-(target - 1) * itemHeight}px)`;
    }),
  );

  setTimeout(() => {
    track.children[target].classList.add("chosen");
    var name = players[starter];
    result.innerText = name == options.myName ? "You start" : `${name} starts`;
    result.classList.add("show");
  }, spin);

  setTimeout(() => (overlay.hidden = true), options.duration + 200);
  return spin;
}

/*
 * One row of a "last rounds" list (jackpot, battles, poker, blackjack): a
 * picture, who and what happened, the coins on the right.
 * `picture`: an element (avatar) or a text (emoji); `tone`: "", "plus" or "minus".
 */
function historyItem(picture, title, sub, value, tone) {
  var item = document.createElement("li");
  item.className = "jp-history-item";
  var icon = typeof picture == "string" ? Object.assign(document.createElement("span"), { className: "jp-history-icon", innerText: picture }) : picture;
  var text = document.createElement("span");
  text.className = "jp-history-text";
  var name = document.createElement("b");
  name.innerText = title;
  var detail = document.createElement("small");
  detail.innerText = sub;
  text.append(name, detail);
  var coins = document.createElement("span");
  coins.className = "jp-history-won" + (tone ? " " + tone : "");
  coins.innerText = value;
  item.append(icon, text, coins);
  return item;
}
