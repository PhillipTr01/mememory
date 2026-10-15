/*
 * The little "i" next to the title of a game: how it works, the limits - a board of tiles (a picture, a line).
 * The content comes from the server (info/<game>, game/info.js), with the limits set now:
 * {title, sub, sections: [{heading, tiles: [{icon, title, text, v}]}]} - v: the picture (see picture()).
 */
(function () {
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.innerText = text;
    return node;
  }

  // A playing card: "A♠", "10♥" - "?" its back
  function playingCard(text) {
    if (text == "?") return make("span", "ci-pcard back", "");
    var suit = text.slice(-1);
    var card = make("span", "ci-pcard" + (suit == "♥" || suit == "♦" ? " red" : ""));
    card.append(make("b", "", text.slice(0, -1)), make("i", "", suit));
    return card;
  }

  // Bầu Cua's animals: its own drawings when the page has them
  function animal(id, className) {
    var box = make("span", className);
    if (typeof window.baucuaIcon == "function") box.appendChild(window.baucuaIcon(id));
    else box.innerText = { tiger: "🐯", gourd: "🍐", rooster: "🐓", fish: "🐟", crab: "🦀", shrimp: "🦐" }[id] || id;
    return box;
  }

  // The picture of a tile
  function picture(v) {
    var box = make("div", "ci-pic");
    if (v.cards) v.cards.forEach((c) => box.appendChild(playingCard(c)));
    else if (v.coins) v.coins.forEach((c, i) => {
      if (i) box.appendChild(make("span", "ci-arrow", "→"));
      box.appendChild(make("span", "ci-coin", "🪙 " + c));
    });
    else if (v.emoji) {
      box.classList.add("emoji");
      if (v.emoji.length == 1) box.classList.add("one");
      v.emoji.forEach((e) => box.appendChild(make("span", "", e)));
    } else if (v.tags) v.tags.forEach((t) => box.appendChild(make("span", "ci-tag " + (t[1] || ""), t[0])));
    else if (v.split) {
      box.classList.add("split");
      var bar = make("div", "ci-split");
      v.split.forEach((part) => {
        var piece = make("span", "ci-part " + (part[2] || ""), part[0] + " " + part[1] + "%");
        piece.style.flexGrow = part[1];
        bar.appendChild(piece);
      });
      box.appendChild(bar);
    } else if (v.steps) v.steps.forEach((step, i) => {
      if (i) box.appendChild(make("span", "ci-arrow", "→"));
      box.appendChild(make("span", "ci-step", step));
    });
    else if (v.dice) v.dice.forEach((id) => box.appendChild(animal(id, "ci-die")));
    else if (v.animals) v.animals.forEach((id) => box.appendChild(animal(id, "ci-animal")));
    else if (v.grid) {
      box.classList.add("grid");
      v.grid.forEach((row) => {
        var line = make("div", "ci-row");
        row.forEach((cell) => line.appendChild(make("span", "ci-cell" + (cell == "·" ? " empty" : ""), cell == "·" ? "" : cell)));
        box.appendChild(line);
      });
    } else if (v.big) box.appendChild(make("span", "ci-big", v.big));
    return box;
  }

  function show(about) {
    var backdrop = make("div", "mm-dialog-backdrop");
    var dialog = make("div", "mm-dialog cs-info ci-board");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.appendChild(make("h2", "ci-title", about.title));
    if (about.sub) dialog.appendChild(make("div", "ci-sub", about.sub));
    about.sections.forEach(function (section) {
      dialog.appendChild(make("h3", "ci-heading", section.heading));
      var grid = make("div", "ci-grid");
      (section.tiles || (section.items || []).map((text) => ({ icon: "•", title: "", text: text }))).forEach(function (t) {
        var tile = make("div", "ci-tile");
        if (t.title) tile.appendChild(make("div", "ci-tile-title", t.icon + " " + t.title));
        if (t.v) tile.appendChild(picture(t.v));
        tile.appendChild(make("div", "ci-text", t.text));
        grid.appendChild(tile);
      });
      dialog.appendChild(grid);
    });
    var close = make("button", "mm-btn ci-close", "Got it");
    close.type = "button";
    dialog.appendChild(close);
    backdrop.appendChild(dialog);
    (document.fullscreenElement || document.body).appendChild(backdrop);
    var done = function () {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
    };
    var onKey = function (event) {
      if (event.key == "Escape") done();
    };
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", done);
    backdrop.addEventListener("click", function (event) {
      if (event.target == backdrop) done();
    });
    // (the focus on the button - the board stays at its top)
    close.focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }

  // (a page with its own content: casinoInfo({title, sub, sections: [{heading, tiles}]}))
  window.casinoInfo = show;

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-info]").forEach(function (title) {
      var button = make("button", "cs-info-btn", "i");
      button.type = "button";
      button.title = "How it works";
      button.setAttribute("aria-label", "How it works");
      button.addEventListener("click", function () {
        fetch("info/" + title.dataset.info)
          .then(function (response) {
            if (!response.ok) throw new Error();
            return response.json();
          })
          .then(show)
          .catch(function () {});
      });
      // Right behind the name of the game, before the tags
      var name = Array.prototype.find.call(title.childNodes, function (node) {
        return node.nodeType == 3 && node.textContent.trim() != "";
      });
      if (name) {
        name.textContent = name.textContent.replace(/\s+$/, "");
        title.insertBefore(button, name.nextSibling);
      } else title.appendChild(button);
    });
  });
})();
