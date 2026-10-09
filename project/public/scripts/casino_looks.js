/*
 * The casino's avatar looks (frames and animations from the shop, see
 * game/shop.js): every avatar of a casino page gets what its player wears.
 * Only the casino pages load this - the MemeMory pages stay as they are.
 * Wraps createAvatar (ui.js): the looks of a name are asked for once per page.
 */
(function () {
  if (typeof createAvatar != "function") return;
  var looks = {}; // name -> {frame, effect} (only who wears something)
  var asked = new Set();
  var queue = new Set();
  var timer = null;

  function apply(avatar) {
    var name = avatar.dataset.name;
    [...avatar.classList].filter((c) => c.startsWith("look-")).forEach((c) => avatar.classList.remove(c));
    var old = avatar.querySelector(":scope > .look-fx");
    if (old) old.remove();
    var look = looks[name];
    if (!look) return;
    if (look.frame) avatar.classList.add("look-frame-" + look.frame);
    if (look.effect) {
      avatar.classList.add("look-fx-" + look.effect);
      avatar.appendChild(Object.assign(document.createElement("span"), { className: "look-fx" }));
    }
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
    looks[name] = look && (look.frame || look.effect) ? look : null;
    document.querySelectorAll('.mm-avatar[data-name="' + CSS.escape(name) + '"]').forEach(apply);
  };
})();
