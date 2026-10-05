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
function createAvatar(name, size, online) {
  var avatar = document.createElement("span");
  avatar.className = "mm-avatar" + (size ? " " + size : "");
  avatar.style.background = avatarColor(name);
  avatar.innerText = name.charAt(0);
  avatar.title = name;
  avatar.dataset.name = name;
  if (typeof drawAvatar == "function") {
    if (name in avatarCache) applyAvatar(avatar, avatarCache[name]);
    else requestAvatar(name);
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
var avatarTimer = null;

function saveAvatarCache() {
  try {
    sessionStorage.setItem("avatars", JSON.stringify(avatarCache));
  } catch (error) {
    // storage full or blocked: only this page knows the avatars
  }
}

// The letter avatar becomes the drawn one (the online dot stays)
function applyAvatar(element, config) {
  var old = element.querySelector(".mm-avatar-svg");
  if (old) old.remove();
  element.classList.toggle("has-avatar", config != null);
  if (config == null) {
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
  var names = [...avatarQueue].filter((name) => !(name in avatarCache));
  avatarQueue.clear();
  if (names.length == 0) return;
  fetch("/requests/user/avatars?names=" + encodeURIComponent(names.join(",")), { credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : null))
    .then((avatars) => {
      if (avatars == null) return;
      names.forEach((name) => setAvatarConfig(name, avatars[name] || null));
    })
    .catch(() => {});
}

// Updates the cache and every avatar of this user on the page
function setAvatarConfig(name, config) {
  avatarCache[name] = config;
  saveAvatarCache();
  document.querySelectorAll(".mm-avatar").forEach((element) => {
    if (element.dataset.name == name) applyAvatar(element, config);
  });
}

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

// Small message at the bottom of the screen instead of alert()
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
