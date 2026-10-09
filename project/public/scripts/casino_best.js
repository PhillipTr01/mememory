/*
 * The best wins of a game (the side of its page, see game/best_wins.js): the biggest single wins of today
 * and of all time - a switch between them. The game's socket brings them ("bestWins"). The card says which
 * game it is (data-game): how the note of a win is shown.
 */
(function () {
  var card = document.getElementById("csBest");
  if (!card || typeof socket == "undefined") return;
  var game = card.dataset.game;
  var data = { today: [], all: [] };
  var span = "today";
  try {
    span = localStorage.getItem("casinoBestSpan") == "all" ? "all" : "today";
  } catch (error) {
    // the default
  }

  function make(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.innerText = text;
    return element;
  }
  var formatCoins = (value) => Number(value).toLocaleString("en-US");
  var COLORS = { red: "🔥 Red", blue: "💧 Blue", green: "🍀 Green" };
  var BJ = { blackjack: "Blackjack!", win: "Win", double: "Double", pairs: "Perfect Pairs", plus3: "21+3" };

  // What the win came from (a short line under the name)
  function note(entry) {
    var text = entry.note || "";
    if (game == "roulette") return COLORS[text] || text;
    if (game == "baucua" && typeof baucuaIcon == "function") {
      var dice = make("span", "cs-best-dice");
      text.split(" ").filter(Boolean).forEach((id) => dice.appendChild(baucuaIcon(id)));
      return dice;
    }
    if (game == "blackjack") return BJ[text] || text.charAt(0).toUpperCase() + text.slice(1);
    if (game == "slots") {
      // "3x cherry": the symbol as its icon
      var line = /^(\d)x (\w+)$/.exec(text);
      // (the machine may not be there yet - then the name for now)
      var ready = typeof setup != "undefined" && setup && typeof symbolOf == "function";
      if (line && ready && symbolOf(line[2])) return line[1] + "× " + symbolOf(line[2]).icon;
      return text.replace(/^bonus /, "🎁 ").replace(/^coin game /, "🪙 ");
    }
    if (game == "battles") return text.replace(/^(\w)/, (c) => c.toUpperCase());
    return text;
  }

  function when(at) {
    var date = new Date(at);
    if (isNaN(date)) return "";
    if (span == "today") return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return date.toLocaleDateString([], { day: "numeric", month: "short" });
  }

  function render() {
    card.querySelectorAll("[data-best-span]").forEach((button) => {
      var on = button.dataset.bestSpan == span;
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var list = data[span] || [];
    var me = typeof chatUsername == "function" ? chatUsername() : null;
    card.querySelector(".cs-best-list").replaceChildren(
      ...list.map((entry, i) => {
        var row = make("li", "jp-history-item cs-best-row" + (i < 3 ? " top top-" + (i + 1) : "") + (entry.name == me ? " mine" : ""));
        row.appendChild(make("span", "cs-best-rank", i < 3 ? ["🥇", "🥈", "🥉"][i] : String(i + 1)));
        var who = make("div", "jp-history-text cs-best-who");
        var name = make("b", "cs-best-name");
        if (typeof createAvatar == "function") name.appendChild(createAvatar(entry.name, "sm"));
        name.appendChild(make("span", "", entry.name));
        var detail = note(entry);
        var small = make("small", "cs-best-note");
        if (detail instanceof Node) small.appendChild(detail);
        else small.innerText = detail || "";
        who.append(name, small);
        var amount = make("span", "cs-best-amount");
        amount.append(make("span", "jp-history-won", "🪙 " + formatCoins(entry.win)), make("small", "cs-best-when", when(entry.at)));
        row.append(who, amount);
        return row;
      }),
    );
    var empty = card.querySelector(".cs-best-empty");
    empty.hidden = list.length > 0;
    empty.innerText = span == "today" ? "No wins yet today - be the first!" : "No wins yet - be the first!";
  }

  card.querySelectorAll("[data-best-span]").forEach((button) =>
    button.addEventListener("click", () => {
      span = button.dataset.bestSpan;
      try {
        localStorage.setItem("casinoBestSpan", span);
      } catch (error) {
        // not remembered
      }
      render();
    }),
  );
  // (the slots: the symbols come with the machine - then the notes again with their icons)
  socket.on("slotsSetup", () => setTimeout(render));
  socket.on("bestWins", (lists) => {
    data = lists || { today: [], all: [] };
    render();
  });
  render();
})();
