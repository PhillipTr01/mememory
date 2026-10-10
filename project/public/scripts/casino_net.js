/*
 * The own result in a game (routes/secret_route.js, stats/net): every element with data-game-net="<game>"
 * shows what the player won or lost there today and in total (in the world they play in). The game page
 * calls refreshGameNet() when coins changed hands (a round is over).
 */
(function () {
  var timer = null;

  function signed(value) {
    return (value > 0 ? "+" : value < 0 ? "−" : "±") + "🪙 " + Math.abs(value).toLocaleString("en-US");
  }

  function part(label, value) {
    var box = document.createElement("span");
    box.className = "cs-net-part";
    var name = document.createElement("span");
    name.className = "cs-net-label";
    name.innerText = label;
    var amount = document.createElement("b");
    amount.className = "cs-net-value" + (value > 0 ? " plus" : value < 0 ? " minus" : "");
    amount.innerText = signed(value);
    box.append(name, amount);
    return box;
  }

  function load(element) {
    fetch("stats/net?game=" + encodeURIComponent(element.dataset.gameNet), { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        element.hidden = !data || data.test;
        if (!data || data.test) return;
        element.replaceChildren(part("Today", data.today), part("Total", data.total));
        element.title = "What you won or lost here - " + data.rounds.toLocaleString("en-US") + (data.rounds == 1 ? " round" : " rounds") + " in total";
      })
      .catch(() => {});
  }

  // (a moment later: the server has written the round's coins by then - several calls at once: one load)
  window.refreshGameNet = function () {
    clearTimeout(timer);
    timer = setTimeout(() => document.querySelectorAll("[data-game-net]").forEach(load), 600);
  };

  document.addEventListener("DOMContentLoaded", () => document.querySelectorAll("[data-game-net]").forEach(load));
  document.addEventListener("visibilitychange", () => document.visibilityState == "visible" && window.refreshGameNet());
})();
