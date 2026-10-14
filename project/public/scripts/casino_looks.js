/*
 * The casino's avatar looks (frames, animations and backgrounds from the shop, see
 * game/shop.js): every avatar of a casino page gets what its player wears.
 * Only the casino pages load this - the MemeMory pages stay as they are.
 * Wraps createAvatar (ui.js): the looks of a name are asked for once per page.
 */
(function () {
  if (typeof createAvatar != "function") return;
  var looks = {}; // name -> {frame, effect, background} (only who wears something)
  var asked = new Set();
  var queue = new Set();
  var timer = null;

  // Performance: avatars this small (px) or smaller - the chat, the lists, the shop items - show the animated looks pre-rendered
  // (looks.css: look-lite - many of them cost the page next to nothing); the bigger ones draw them live (smooth)
  var LITE = 60;

  // Live or pre-rendered: marked data-looks-live (a few that stand out - the podium, the last winner) always; in a place
  // marked data-looks-hover (the shop's cards) only while the mouse is over it - elsewhere when it is bigger than LITE
  function liveHere(avatar, width) {
    if (avatar.closest("[data-looks-live]")) return true;
    var hover = avatar.closest("[data-looks-hover]");
    if (hover) return hover.matches(":hover");
    return width > LITE;
  }

  // The shop: its looks stand still until the mouse is over one (look-still - a still image of each pre-rendered
  // layer, looks.css; every other animation held at STILL ms in)
  var STILL = 1200;
  function still(avatar, on) {
    if (avatar.classList.contains("look-still") == on) return;
    avatar.classList.toggle("look-still", on);
    avatar.getAnimations({ subtree: true }).forEach((animation) => {
      if (on) {
        animation.pause();
        animation.currentTime = STILL;
      } else animation.play();
    });
  }

  // Shows an avatar live or pre-rendered (in the shop: still)
  function show(avatar, live) {
    avatar.classList.toggle("look-lite", !live);
    still(avatar, !live && !!avatar.closest("[data-looks-hover]"));
  }

  function hoverLive(container, live) {
    container.querySelectorAll(".mm-avatar[class*='look-']").forEach((avatar) => {
      if (avatar.closest("[data-looks-hover]") == container) show(avatar, live);
    });
  }
  document.addEventListener("mouseover", (event) => {
    var container = event.target.closest && event.target.closest("[data-looks-hover]");
    if (container && !(event.relatedTarget && container.contains(event.relatedTarget))) hoverLive(container, true);
  });
  document.addEventListener("mouseout", (event) => {
    var container = event.target.closest && event.target.closest("[data-looks-hover]");
    if (container && !(event.relatedTarget && container.contains(event.relatedTarget))) hoverLive(container, false);
  });

  // Performance: the animations of an avatar run only while it is on the screen (look-idle: paused) - a page full of
  // avatars (the shop, a long chat, the leaderboard) animates only the ones you see
  var watcher =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) =>
            entries.forEach((entry) => {
              // (gone from the page: not watched any more)
              if (!entry.target.isConnected) return watcher.unobserve(entry.target);
              entry.target.classList.toggle("look-idle", !entry.isIntersecting);
              // (on the screen: its size known - small ones show the pre-rendered animations, bigger ones live)
              if (entry.isIntersecting) show(entry.target, liveHere(entry.target, entry.boundingClientRect.width));
            }),
          { rootMargin: "120px" },
        )
      : null;

  // Puts looks ({frame, effect, background} - null: none) on an avatar (the ones it had come off)
  function wear(avatar, look) {
    [...avatar.classList].filter((c) => c.startsWith("look-")).forEach((c) => avatar.classList.remove(c));
    avatar.querySelectorAll(":scope > .look-fx, :scope > .look-bg").forEach((layer) => layer.remove());
    if (watcher) watcher.unobserve(avatar);
    if (!look || !(look.frame || look.effect || look.background)) return avatar;
    if (watcher) {
      // (paused until the watcher sees it on the screen - right away for the ones there; small until it knows)
      avatar.classList.add("look-idle", "look-lite");
      watcher.observe(avatar);
    }
    if (look.frame) {
      avatar.classList.add("look-frame-" + look.frame);
    }
    if (look.background) {
      avatar.classList.add("look-bg-" + look.background);
      avatar.appendChild(Object.assign(document.createElement("span"), { className: "look-bg" }));
    }
    if (look.effect) {
      avatar.classList.add("look-fx-" + look.effect);
      avatar.appendChild(Object.assign(document.createElement("span"), { className: "look-fx" }));
    }
    return avatar;
  }
  window.wearLooks = wear;

  function apply(avatar) {
    // (a preview - the shop, a reward - keeps the looks it shows)
    if (avatar.dataset.preview) return;
    wear(avatar, looks[avatar.dataset.name]);
  }

  function load() {
    timer = null;
    var names = [...queue];
    queue.clear();
    if (!names.length) return;
    fetch("looks?names=" + encodeURIComponent(names.join(",")), { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        names.forEach((name) => (looks[name] = data[name] || null));
        document.querySelectorAll(".mm-avatar[data-name]").forEach((avatar) => names.includes(avatar.dataset.name) && apply(avatar));
      })
      .catch(() => {});
  }

  function want(name) {
    if (!name || name == GHOST_BET || asked.has(name)) return;
    asked.add(name);
    queue.add(name);
    if (!timer) timer = setTimeout(load, 60);
  }

  var original = createAvatar;
  window.createAvatar = createAvatar = function (name, size, online) {
    var avatar = original(name, size, online);
    if (name in looks) apply(avatar);
    else want(name);
    return avatar;
  };

  // The own looks changed (the shop): every avatar of the player again
  window.refreshLooks = function (name, look) {
    looks[name] = look && (look.frame || look.effect || look.background) ? look : null;
    document.querySelectorAll('.mm-avatar[data-name="' + CSS.escape(name) + '"]').forEach(apply);
  };
})();
