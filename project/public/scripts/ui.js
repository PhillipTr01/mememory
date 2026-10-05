/* Small UI helpers shared by lobby and multiplayer room */

// Same name -> same color, so players are easy to recognise
function avatarColor(name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 22%, 38%)`;
}

// Avatar with the first letter of the name (built with DOM nodes, no innerHTML)
function createAvatar(name, size, online) {
  var avatar = document.createElement("span");
  avatar.className = "mm-avatar" + (size ? " " + size : "");
  avatar.style.background = avatarColor(name);
  avatar.innerText = name.charAt(0);
  avatar.title = name;

  if (online !== undefined) {
    var dot = document.createElement("span");
    dot.className = "mm-status-dot" + (online ? "" : " offline");
    avatar.appendChild(dot);
  }
  return avatar;
}

// Small square button with only an icon; the label is the hover tooltip
function createIconButton(icon, label, extraClass, onClick) {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn" + (extraClass ? " " + extraClass : "");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(createIcon(icon));
  button.addEventListener("click", onClick);
  return button;
}

function createIcon(classes, title) {
  var icon = document.createElement("i");
  icon.className = "bi " + classes;
  if (title) icon.title = title;
  return icon;
}

// Small message at the bottom of the screen instead of alert()
function showToast(message, type) {
  // The game pages show everything on the board / in the chat instead
  if (document.body.classList.contains("no-toasts")) return;
  var container = document.getElementById("mm-toasts");
  if (container == null) {
    container = document.createElement("div");
    container.id = "mm-toasts";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }

  var toast = document.createElement("div");
  toast.className = "mm-toast" + (type ? " " + type : "");
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function copyText(text, button) {
  var done = () => {
    showToast("Copied to clipboard!");
    if (button) {
      button.classList.add("copied");
      setTimeout(() => button.classList.remove("copied"), 1500);
    }
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => prompt("Copy this:", text));
  } else {
    prompt("Copy this:", text);
  }
}

/*
 * Styled confirm dialog instead of the browser's confirm().
 * Returns a Promise<boolean>. Escape / click outside = cancel.
 */
function confirmDialog(options) {
  return new Promise((resolve) => {
    var previousFocus = document.activeElement;

    var backdrop = document.createElement("div");
    backdrop.className = "mm-dialog-backdrop";

    var dialog = document.createElement("div");
    dialog.className = "mm-dialog" + (options.danger ? " danger" : "");
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");


    var title = document.createElement("h2");
    title.className = "mm-dialog-title";
    title.id = "mm-dialog-title";
    title.innerText = options.title;
    dialog.setAttribute("aria-labelledby", title.id);

    var text = document.createElement("p");
    text.className = "mm-dialog-text";
    text.innerText = options.text || "";

    var actions = document.createElement("div");
    actions.className = "mm-dialog-actions";

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "mm-btn";
    cancel.innerText = options.cancelLabel || "Cancel";

    var confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "mm-btn " + (options.danger ? "mm-btn-danger-solid" : "mm-btn-primary");
    if (options.confirmIcon) confirm.appendChild(createIcon(options.confirmIcon));
    confirm.appendChild(document.createTextNode(options.confirmLabel || "OK"));

    actions.append(cancel, confirm);
    dialog.append(title, text, actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    function close(result) {
      document.removeEventListener("keydown", onKey);
      backdrop.classList.add("closing");
      setTimeout(() => backdrop.remove(), 150);
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      resolve(result);
    }

    function onKey(event) {
      if (event.key == "Escape") close(false);
      // Keep the focus inside the dialog
      if (event.key == "Tab") {
        event.preventDefault();
        (document.activeElement == cancel ? confirm : cancel).focus();
      }
    }

    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    backdrop.addEventListener("click", (event) => {
      if (event.target == backdrop) close(false);
    });
    document.addEventListener("keydown", onKey);

    // The safe choice has the focus
    cancel.focus();
  });
}

/*
 * Styled hover labels instead of the browser's default ones: every element
 * with a title gets this tooltip (also elements that are added later).
 */
(function () {
  var tip = null;
  var current = null;

  function hide() {
    if (tip) tip.hidden = true;
    current = null;
  }

  function show(element) {
    if (tip == null) {
      tip = document.createElement("div");
      tip.className = "mm-tooltip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
    }
    tip.innerText = element.dataset.tip;
    tip.hidden = false;
    tip.classList.remove("below");

    // Above the element, centered; below if there is no room above
    var rect = element.getBoundingClientRect();
    var box = tip.getBoundingClientRect();
    var top = rect.top - box.height - 8;
    if (top < 4) {
      top = rect.bottom + 8;
      tip.classList.add("below");
    }
    var left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - box.width - 6));
    tip.style.top = top + "px";
    tip.style.left = left + "px";
  }

  document.addEventListener("mouseover", (event) => {
    var element = event.target.closest && event.target.closest("[title], [data-tip]");
    if (element == null || element == current) return;
    // Move the title to data-tip, so the browser doesn't show its own label
    if (element.hasAttribute("title")) {
      var title = element.getAttribute("title");
      element.removeAttribute("title");
      if (title) element.dataset.tip = title;
      if (!element.hasAttribute("aria-label") && title) element.setAttribute("aria-label", title);
    }
    if (!element.dataset.tip) return;
    current = element;
    show(element);
  });

  document.addEventListener("mouseout", (event) => {
    if (current && !current.contains(event.relatedTarget)) hide();
  });
  // The element was redrawn (e.g. the player list) -> don't leave the label behind
  document.addEventListener("mousemove", () => {
    if (current && !current.isConnected) hide();
  });
  document.addEventListener("mousedown", hide);
  window.addEventListener("scroll", hide, true);
})();
