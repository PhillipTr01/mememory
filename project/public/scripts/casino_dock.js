/*
 * The games of the casino: a bar in the middle at the bottom of every casino
 * page. It can be closed (only the handle stays) - the page remembers it.
 */
(function () {
  var KEY = "casinoDockClosed";

  function setOpen(dock, toggle, open) {
    dock.classList.toggle("closed", !open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.title = open ? "Hide the games" : "Show the games";
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
