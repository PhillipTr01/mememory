/*
 * The max bet by balance (game/limits.js): what more a player may bet this round. `rule` ({floor, share} - null: no
 * cap) comes with the balance, `already`: the player's coins in this round (a pot, a table, open battles). The cap
 * counts for the round together, from the balance before it (what is left + what is in).
 */
function casinoCapLeft(rule, balance, already) {
  if (!rule) return Infinity;
  already = already || 0;
  var cap = Math.max(rule.floor, Math.floor(((balance + already) * rule.share) / 100));
  return Math.max(0, cap - already);
}

/*
 * The coins of a season: the admin can give a season its own coin icon
 * (game/seasons.js) - the page gets it as window.CASINO_COIN. Every 🪙 of the
 * page (text, titles, the coin in front of the pot) shows it instead, also in
 * everything the page adds later. Without one: nothing happens.
 */
(function () {
  var coin = window.CASINO_COIN;
  var NORMAL = "🪙";
  if (!coin || coin == NORMAL) return;
  var ATTRIBUTES = ["title", "placeholder", "aria-label"];

  // The coins drawn by the styles
  var style = document.createElement("style");
  style.textContent = '.jp-total::before, .jp-record-amount::before { content: ' + JSON.stringify(coin) + '; }';
  document.head.appendChild(style);

  // (the money outside the season stays the 🪙: [data-coin="real"])
  function real(node) {
    var element = node.nodeType == Node.ELEMENT_NODE ? node : node.parentElement;
    return element != null && element.closest('[data-coin="real"]') != null;
  }

  function swapText(node) {
    if (node.nodeValue && node.nodeValue.includes(NORMAL) && !real(node)) node.nodeValue = node.nodeValue.split(NORMAL).join(coin);
  }

  function swapElement(element) {
    if (real(element)) return;
    ATTRIBUTES.forEach((name) => {
      var value = element.getAttribute(name);
      if (value && value.includes(NORMAL)) element.setAttribute(name, value.split(NORMAL).join(coin));
    });
  }

  function swapTree(root) {
    if (root.nodeType == Node.TEXT_NODE) return swapText(root);
    if (root.nodeType != Node.ELEMENT_NODE) return;
    swapElement(root);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (var node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType == Node.TEXT_NODE) swapText(node);
      else swapElement(node);
    }
  }

  function start() {
    swapTree(document.body);
    new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type == "characterData") swapText(mutation.target);
        else if (mutation.type == "attributes") swapElement(mutation.target);
        else mutation.addedNodes.forEach(swapTree);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
