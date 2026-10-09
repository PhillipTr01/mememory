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
 * In full screen the coins (of the bar at the top, which is gone then) show at
 * the top in the middle, on the height of the game's title.
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
    var tallest = 0; // the highest the game was in this full screen: the zoom never grows back (no jumping)
    // The game's own parts (taken when the full screen starts - dialogs that come in later aren't zoomed)
    var own = [];
    var parts = () =>
      own.filter(function (part) {
        return part.isConnected;
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
      tallest = Math.max(tallest, natural);
      natural = tallest;
      var next = Math.max(0.5, Math.min(room.x / width, room.y / natural));
      // Phones: never bigger than on the page (what sticks out of a part grows with it)
      if (window.innerWidth < 700) next = Math.min(1, next);
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
        // (what sticks out of its part - like the line numbers next to the slot machine - counts too)
        Array.prototype.forEach.call(target.children, function (part) {
          if (!part.classList.contains("cs-fs-coins") && part.offsetParent != null) width = Math.max(width, part.scrollWidth);
        });
      },
      start: function () {
        if (!width) this.measure();
        own = Array.prototype.slice.call(target.children).filter(function (part) {
          return !part.classList.contains("cs-fs-coins");
        });
        zoom = 1;
        tallest = 0;
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

  // The coins at the top: a copy of the bar's, kept up to date - in the middle, as high as the title
  function coinsCorner(target) {
    var source = document.getElementById("navCoinsValue");
    var box = null;
    var watcher = null;
    var timer = null;
    var spot = null; // "middle" or "corner" - for this full screen
    var middleX = null;
    // In the room between the title and the buttons on the right (too narrow: the top right corner)
    function place() {
      var title = target.querySelector("h1");
      if (!box || !title) return;
      var rect = title.getBoundingClientRect();
      var right = Math.min.apply(
        null,
        Array.prototype.slice
          .call(target.querySelectorAll(".cs-head-actions, .pk-seatbar:not([hidden]), .cs-fs-btn"))
          .map(function (el) {
            return el.getBoundingClientRect().left;
          })
          .concat([window.innerWidth]),
      );
      // Middle or corner: decided once (it doesn't jump between them while the zoom settles)
      if (spot == null) spot = right - rect.right >= box.offsetWidth + 24 ? "middle" : "corner";
      box.style.visibility = "";
      if (spot == "middle") {
        // (where it is decided once too - standing up, a bar going away doesn't move it)
        if (middleX == null) middleX = (rect.right + right) / 2;
        box.style.left = middleX + "px";
        box.style.right = "auto";
        box.style.transform = "translateX(-50%)";
        box.style.top = Math.max(8, rect.top + rect.height / 2 - box.offsetHeight / 2) + "px";
      } else {
        box.style.left = "auto";
        box.style.right = "16px";
        box.style.transform = "none";
        box.style.top = "12px";
      }
    }
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
        // Hidden until it has its place (the zoom of the game settles first)
        box.style.visibility = "hidden";
        spot = null;
        middleX = null;
        target.appendChild(box);
        setTimeout(place, 350);
        timer = setInterval(place, 300);
      },
      hide: function () {
        clearInterval(timer);
        if (watcher) watcher.disconnect();
        if (box) box.remove();
        box = null;
        watcher = null;
      },
    };
  }

  // In full screen only the game is seen: what opens on the page meanwhile (dialogs like the buy-in,
  // toasts, prompts) goes into it - and back to the page afterwards
  var moved = [];
  function observeBody() {
    if (!document.body) return;
    new MutationObserver(function (changes) {
      var screen = document.fullscreenElement;
      if (!screen) return;
      changes.forEach(function (change) {
        change.addedNodes.forEach(function (node) {
          if (node.nodeType != 1 || node.tagName == "SCRIPT" || node.parentNode != document.body) return;
          screen.appendChild(node);
          moved.push(node);
        });
      });
    }).observe(document.body, { childList: true });
  }
  document.addEventListener("fullscreenchange", function () {
    if (document.fullscreenElement) {
      // (already open ones too: a dialog opened just before)
      Array.prototype.slice.call(document.body.children).forEach(function (node) {
        if (/mm-dialog-backdrop|cs-chance|cs-join|toast/.test((node.className || "") + " " + node.id)) {
          document.fullscreenElement.appendChild(node);
          moved.push(node);
        }
      });
      return;
    }
    moved.forEach(function (node) {
      if (node.isConnected) document.body.appendChild(node);
    });
    moved = [];
  });

  document.addEventListener("DOMContentLoaded", function () {
    observeBody();
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

/*
 * A game that is too high for the screen: its main part (`part`) a bit smaller as a whole - nothing
 * moves on it, nothing overlaps, the page doesn't scroll and the menu at the bottom stays free.
 * Only on big screens and not in full screen (that zooms the whole game by itself). watch: elements
 * whose showing / hiding changes the room (refit then).
 */
window.casinoFitGame = function (part, watch) {
  if (!part || !("zoom" in document.body.style)) return;
  var fit = () => {
    if (document.fullscreenElement) return;
    part.style.zoom = "";
    part.style.width = "";
    part.style.margin = "";
    if (window.innerWidth < 992) return;
    var dock = document.getElementById("csDock");
    var room = dock ? window.innerHeight - (parseFloat(getComputedStyle(dock).bottom) || 0) - dock.offsetHeight - 16 : window.innerHeight - 16;
    var card = part.closest(".mm-card") || part.parentNode;
    var over = card.getBoundingClientRect().bottom + window.scrollY - room;
    if (over <= 0) return;
    var height = part.offsetHeight;
    // (a fixed width: a zoomed part of 100% width would fill the same room again)
    part.style.width = part.offsetWidth + "px";
    part.style.margin = "0 auto";
    part.style.zoom = Math.max(0.6, (height - over) / height).toFixed(3);
    window.dispatchEvent(new Event("casinofit"));
  };
  window.addEventListener("resize", fit);
  document.addEventListener("fullscreenchange", () => requestAnimationFrame(fit));
  fit();
  setTimeout(fit, 600);
  var observer = new MutationObserver(() => requestAnimationFrame(fit));
  (watch || []).forEach((node) => node && observer.observe(node, { attributes: true, attributeFilter: ["hidden"] }));
  return fit;
};
