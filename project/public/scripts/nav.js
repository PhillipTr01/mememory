/* Shared header: profile menu (top right), username and logout */

// Resolves with the username of the logged in user (or null)
var userPromise = fetch("/requests/user/username", { credentials: "same-origin" })
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => (data ? data.username : null))
  .catch(() => null);

function startLobbyPage() {
  window.location.href = "/lobby";
}

function logoutUser() {
  fetch("/requests/authentication/logout", { credentials: "same-origin" })
    .catch(() => {})
    .then(() => (window.location.href = "/"));
}

document.addEventListener("DOMContentLoaded", () => {
  var menu = document.getElementById("profileMenu");
  if (menu == null) return;

  var trigger = document.getElementById("profileTrigger");
  var dropdown = document.getElementById("profileDropdown");

  userPromise.then((username) => {
    if (!username) return;
    document.getElementById("username").innerText = username;
    document.getElementById("profileName").innerText = username;
    document.getElementById("profileAvatar").replaceWith(createAvatar(username, "sm"));
    document.getElementById("profileAvatarLarge").replaceWith(createAvatar(username));
  });

  buildMenu(dropdown);

  // Highlight the current page
  menu.querySelectorAll("a.profile-item").forEach((link) => {
    var href = link.getAttribute("href");
    if (href.includes("#")) return;
    var path = href.startsWith("/") ? href : null;
    if (path ? path == window.location.pathname : window.location.pathname.endsWith("/" + href)) link.classList.add("active");
  });

  function setOpen(open) {
    dropdown.hidden = !open;
    trigger.setAttribute("aria-expanded", open);
  }

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(dropdown.hidden);
  });
  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key == "Escape") setOpen(false);
  });

  document.getElementById("logoutButton").addEventListener("click", logoutUser);
});

/*
 * The items of the profile menu: MemeMory has its games, scoreboard and
 * profile - the casino (body.jackpot-theme) only what it needs (the avatar,
 * the accessory shop). Every item with a colored icon tile.
 */
var MENU_MEMEMORY = [
  { href: "/lobby", icon: "🎮", tone: "blue", label: "Play" },
  { href: "/home", icon: "🏆", tone: "gold", label: "Scoreboard" },
  { href: "/user", icon: "📊", tone: "green", label: "Profile" },
  { href: "/user#avatar", icon: "🎨", tone: "pink", label: "Avatar" },
  { href: "/settings", icon: "⚙️", tone: "gray", label: "Settings" },
];
var MENU_CASINO = [
  { href: "shop#avatar", icon: "🎨", tone: "pink", label: "Avatar" },
  { href: "shop", icon: "🛍️", tone: "gold", label: "Shop", sub: "Frames & animations" },
  { href: "/settings", icon: "⚙️", tone: "gray", label: "Settings" },
];

function buildMenu(dropdown) {
  var casino = document.body.classList.contains("jackpot-theme");
  var head = dropdown.querySelector(".profile-head");
  var items = (casino ? MENU_CASINO : MENU_MEMEMORY).map((item) => {
    var link = document.createElement("a");
    link.className = "profile-item";
    link.href = item.href;
    var tile = document.createElement("span");
    tile.className = "profile-icon " + item.tone;
    tile.setAttribute("aria-hidden", "true");
    tile.innerText = item.icon;
    var text = document.createElement("span");
    text.className = "profile-item-text";
    text.innerText = item.label;
    if (item.sub) {
      var sub = document.createElement("small");
      sub.innerText = item.sub;
      text.appendChild(sub);
    }
    link.append(tile, text);
    // The avatar on the same page: the editor opens (no reload)
    if (item.href.endsWith("#avatar")) {
      link.addEventListener("click", (event) => {
        var path = item.href.split("#")[0];
        var here = path.startsWith("/") ? location.pathname == path : location.pathname.endsWith("/" + path);
        if (here && typeof openAvatarEditor == "function") {
          event.preventDefault();
          dropdown.hidden = true;
          openAvatarEditor();
        }
      });
    }
    return link;
  });
  var divider = document.createElement("div");
  divider.className = "profile-divider";
  var logout = document.createElement("button");
  logout.type = "button";
  logout.className = "profile-item danger";
  logout.id = "logoutButton";
  var tile = document.createElement("span");
  tile.className = "profile-icon red";
  tile.setAttribute("aria-hidden", "true");
  tile.innerText = "🚪";
  var text = document.createElement("span");
  text.className = "profile-item-text";
  text.innerText = "Logout";
  logout.append(tile, text);
  dropdown.replaceChildren(...(head ? [head] : []), ...items, divider, logout);
}
