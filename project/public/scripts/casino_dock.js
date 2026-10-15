/*
 * The games of the casino: a bar in the middle at the bottom of every casino
 * page. It can be closed (only the handle stays) - the page remembers it.
 */
(function () {
  var KEY = "casinoDockClosed";

  function setOpen(dock, toggle, open) {
    dock.classList.toggle("closed", !open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.title = open ? "Hide the menu" : "Show the menu";
  }

  // The dungeon (an RPG): its tab (off - or a season world: hidden by the page, see secret_route.js hideOff)
  function addDungeon(dock) {
    if (dock.querySelector('.cs-tab[href="rpg"]')) return;
    var tab = document.createElement("a");
    tab.href = "rpg";
    tab.className = "cs-tab";
    tab.innerHTML =
      '<svg class="cs-dock-icon" viewBox="0 0 48 48" aria-hidden="true">' +
      // (a shield, a sword across it)
      '<path d="M24 6 L39 11 V23 C39 33 32 39 24 43 C16 39 9 33 9 23 V11 Z" fill="#7c3aed" />' +
      '<path d="M24 10 L35 14 V23 C35 31 30 35.5 24 38.5 Z" fill="#a78bfa" />' +
      '<path d="M12 38 L36 8" stroke="#e5e7eb" stroke-width="3.4" stroke-linecap="round" />' +
      '<path d="M15 29 L21 35" stroke="#d4a017" stroke-width="3.4" stroke-linecap="round" />' +
      '<circle cx="12" cy="38" r="2.6" fill="#d4a017" /></svg><span class="cs-dock-name">Dungeon</span>';
    if (/\/rpg$/.test(location.pathname)) {
      tab.classList.add("active");
      tab.setAttribute("aria-current", "page");
    }
    var sep = dock.querySelector(".cs-dock-sep");
    if (sep) sep.before(tab);
    else dock.querySelector(".cs-dock-bar").appendChild(tab);
  }

  document.addEventListener("DOMContentLoaded", () => {
    var dock = document.getElementById("csDock");
    var toggle = document.getElementById("csDockToggle");
    if (!dock || !toggle) return;
    var closed = false;
    try {
      closed = localStorage.getItem(KEY) == "1";
    } catch (error) {
      // no storage: open
    }
    setOpen(dock, toggle, !closed);
    addDungeon(dock);
    // No animation when the page opens
    requestAnimationFrame(() => dock.classList.add("ready"));
    toggle.addEventListener("click", () => {
      var open = dock.classList.contains("closed");
      setOpen(dock, toggle, open);
      try {
        localStorage.setItem(KEY, open ? "0" : "1");
      } catch (error) {
        // not remembered
      }
    });
  });
})();
