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

  // Highlight the current page
  menu.querySelectorAll("a.profile-item").forEach((link) => {
    if (link.getAttribute("href") == window.location.pathname) link.classList.add("active");
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
