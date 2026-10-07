/*
 * The little "i" next to the title of a game: how it works, the limits.
 * The text comes from the server (info/<game>), with the limits set now.
 */
(function () {
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.innerText = text;
    return node;
  }

  function show(about) {
    var backdrop = make("div", "mm-dialog-backdrop");
    var dialog = make("div", "mm-dialog cs-info");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.appendChild(make("h2", "mm-dialog-title", about.title));
    about.sections.forEach(function (section) {
      dialog.appendChild(make("h3", "cs-info-heading", section.heading));
      var list = make("ul", "cs-info-list");
      section.items.forEach(function (item) {
        list.appendChild(make("li", "", item));
      });
      dialog.appendChild(list);
    });
    var close = make("button", "mm-btn w-100", "Got it");
    close.type = "button";
    dialog.appendChild(close);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
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
    close.focus();
  }

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
      title.appendChild(button);
    });
  });
})();
