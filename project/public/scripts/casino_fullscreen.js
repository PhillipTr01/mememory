/*
 * Full screen for a game: a button with data-fullscreen="<selector of the
 * part to show>" (Esc or the button again to leave). The button shows which
 * way it goes (class "on" while full screen).
 */
(function () {
  var ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="cs-fs-open" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><path class="cs-fs-close" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>';

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-fullscreen]").forEach(function (button) {
      var target = document.querySelector(button.dataset.fullscreen);
      if (!target) return;
      if (!button.innerHTML.trim()) button.innerHTML = ICON;
      button.title = "Full screen";
      button.setAttribute("aria-label", "Full screen");
      button.addEventListener("click", function () {
        if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
        else if (target.requestFullscreen) target.requestFullscreen().catch(function () {});
      });
      document.addEventListener("fullscreenchange", function () {
        var on = document.fullscreenElement == target;
        button.classList.toggle("on", on);
        button.title = on ? "Leave full screen" : "Full screen";
        target.classList.toggle("cs-fullscreen", on);
      });
    });
  });
})();
