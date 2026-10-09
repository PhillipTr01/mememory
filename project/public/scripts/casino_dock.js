/*
 * The games of the casino: a bar in the middle at the bottom of every casino
 * page. It can be closed (only the handle stays) - the page remembers it.
 */
(function () {
  var KEY = "casinoDockClosed";

  // now: right away (the page opens - no animation to wait for)
  function setOpen(dock, toggle, open, now) {
    dock.classList.toggle("closed", !open);
    // (closed: less room below the page - the chat can take it)
    document.body.classList.toggle("cs-dock-closed", !open);
    // (after the menu moved: the chat as high as there is room now)
    if (window.casinoGrowChat) {
      if (now) window.casinoGrowChat();
      else setTimeout(window.casinoGrowChat, 260);
    }
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.title = open ? "Hide the menu" : "Show the menu";
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
    setOpen(dock, toggle, !closed, true);
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
