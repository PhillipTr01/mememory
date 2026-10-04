/* Small UI helpers shared by lobby and multiplayer room */

// Same name -> same color, so players are easy to recognise
function avatarColor(name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
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

function createIcon(classes, title) {
  var icon = document.createElement("i");
  icon.className = "bi " + classes;
  if (title) icon.title = title;
  return icon;
}

// Small message at the bottom of the screen instead of alert()
function showToast(message, type) {
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
