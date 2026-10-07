/*
 * Full screen for a game: a button with data-fullscreen="<selector of the
 * part to show>" (Esc or the button again to leave). The button shows which
 * way it goes (class "on" while full screen).
 *
 * data-fullscreen-zoom: the game keeps its layout and is zoomed as a whole
 * (cards, seats, chips, the bar - not only the table) as big as the screen
 * allows - looked at again and again, so what comes later (the action bar)
 * fits too.
 *
 * In full screen the coins (of the bar at the top, which is gone then) show in
 * the top right corner.
 */
(function () {
  var ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="cs-fs-open" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><path class="cs-fs-close" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>';

  // The whole game zoomed: every part at the width it has outside of full screen (`width`), zoomed to
  // fill the screen's width - but never higher than the screen
  function zoomer(target) {
    var width = null;
    var timer = null;
    var zoom = 1;
    var parts = () =>
      Array.prototype.slice.call(target.children).filter(function (part) {
        return !part.classList.contains("cs-fs-coins");
      });
    function fit() {
      var style = getComputedStyle(target);
      var room = {
        x: target.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        y: target.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      };
      // How high the parts are on the screen (from the top of the first to the bottom of the last) - at zoom 1
      var shown = parts().filter(function (part) {
        return part.offsetParent != null;
      });
      if (!shown.length) return;
      var natural = (shown[shown.length - 1].getBoundingClientRect().bottom - shown[0].getBoundingClientRect().top) / zoom;
      var next = Math.max(0.5, Math.min(room.x / width, room.y / natural));
      if (Math.abs(next - zoom) < 0.01) return;
      zoom = next;
      parts().forEach(function (part) {
        part.style.zoom = zoom;
      });
    }
    return {
      // Before full screen: the width of the game as it is
      measure: function () {
        var style = getComputedStyle(target);
        width = target.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      },
      start: function () {
        if (!width) this.measure();
        zoom = 1;
        parts().forEach(function (part) {
          part.style.width = "100%";
          part.style.maxWidth = width + "px";
          part.style.marginLeft = "auto";
          part.style.marginRight = "auto";
        });
        fit();
        clearInterval(timer);
        timer = setInterval(fit, 300);
      },
      stop: function () {
        clearInterval(timer);
        timer = null;
        width = null;
        parts().forEach(function (part) {
          part.style.zoom = "";
          part.style.width = "";
          part.style.maxWidth = "";
          part.style.marginLeft = "";
          part.style.marginRight = "";
        });
      },
    };
  }

  // The coins in the corner: a copy of the bar's, kept up to date
  function coinsCorner(target) {
    var source = document.getElementById("navCoinsValue");
    var box = null;
    var watcher = null;
    return {
      show: function () {
        if (!source || box) return;
        box = document.createElement("div");
        box.className = "cs-fs-coins";
        var value = document.createElement("span");
        box.append("🪙 ", value);
        var copy = function () {
          value.textContent = source.textContent;
        };
        copy();
        watcher = new MutationObserver(copy);
        watcher.observe(source, { childList: true, characterData: true, subtree: true });
        target.appendChild(box);
        target.classList.add("cs-fs-with-coins");
      },
      hide: function () {
        if (watcher) watcher.disconnect();
        if (box) box.remove();
        box = null;
        watcher = null;
        target.classList.remove("cs-fs-with-coins");
      },
    };
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-fullscreen]").forEach(function (button) {
      var target = document.querySelector(button.dataset.fullscreen);
      if (!target) return;
      var zoom = button.hasAttribute("data-fullscreen-zoom") ? zoomer(target) : null;
      var corner = coinsCorner(target);
      if (!button.innerHTML.trim()) button.innerHTML = ICON;
      button.title = "Full screen";
      button.setAttribute("aria-label", "Full screen");
      button.addEventListener("click", function () {
        if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
        else if (target.requestFullscreen) {
          if (zoom) zoom.measure();
          target.requestFullscreen().catch(function () {});
        }
      });
      document.addEventListener("fullscreenchange", function () {
        var on = document.fullscreenElement == target;
        button.classList.toggle("on", on);
        button.title = on ? "Leave full screen" : "Full screen";
        target.classList.toggle("cs-fullscreen", on);
        if (on) corner.show();
        else corner.hide();
        if (zoom) {
          if (on) zoom.start();
          else zoom.stop();
        }
      });
    });
  });
})();
