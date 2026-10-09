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

  function swapText(node) {
    if (node.nodeValue && node.nodeValue.includes(NORMAL)) node.nodeValue = node.nodeValue.split(NORMAL).join(coin);
  }

  function swapElement(element) {
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
