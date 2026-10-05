/*
 * Room chat, shared by MemeMory and Tic Tac Toe XL.
 * Needs a global `socket` and a `chatUsername()` function from the page script.
 */

var lastMessage = null; // for grouping messages of the same person

function setupChat() {
  var form = document.getElementById("chat-form");
  var input = document.getElementById("chat-input");
  var send = document.getElementById("send-message-btn");
  var counter = document.getElementById("chat-counter");
  var chat = document.getElementById("chat-content");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendChatMessage();
  });

  input.addEventListener("input", () => {
    var length = input.value.length;
    send.disabled = input.value.trim() == "";
    counter.hidden = length < 250;
    counter.innerText = 300 - length;
    counter.classList.toggle("limit", length >= 290);
  });

  // Quick emojis are added to the message
  document.querySelectorAll(".chat-quick button").forEach((button) => {
    button.addEventListener("click", () => {
      var emoji = button.dataset.emoji;
      var start = input.selectionStart != null ? input.selectionStart : input.value.length;
      input.value = (input.value.slice(0, start) + emoji + input.value.slice(input.selectionEnd || start)).slice(0, 300);
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
  });

  chat.addEventListener("scroll", () => {
    if (isChatAtBottom()) document.getElementById("newMessages").hidden = true;
  });

  document.getElementById("newMessages").addEventListener("click", () => {
    chat.scrollTop = chat.scrollHeight;
  });
}

function sendChatMessage() {
  var input = document.getElementById("chat-input");
  var message = input.value.trim();

  if (message == "") return;
  if (!socket.connected) {
    showChatError("Not connected - message not sent.");
    return;
  }

  // The message is shown when the server sends it back to everybody
  socket.emit("sendChatMessage", { message: message });
  input.value = "";
  input.dispatchEvent(new Event("input"));
  input.focus();
}

socket.on("chatHistory", (messages) => {
  document.getElementById("chat-content").replaceChildren();
  lastMessage = null;
  messages.forEach((message) => addChatMessage(message, false));
  scrollChatDown();
});

socket.on("chatMessage", (message) => {
  hideChatError();
  addChatMessage(message, true);
});

socket.on("chatError", (message) => {
  showChatError(message);
});

var chatErrorTimeout = null;

function showChatError(message) {
  var element = document.getElementById("chat-error");
  if (element == null) return;
  element.innerText = message;
  element.hidden = false;
  clearTimeout(chatErrorTimeout);
  chatErrorTimeout = setTimeout(hideChatError, 3000);
}

function hideChatError() {
  var element = document.getElementById("chat-error");
  if (element != null) element.hidden = true;
}

function isChatAtBottom() {
  var chat = document.getElementById("chat-content");
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
}

function scrollChatDown() {
  var chat = document.getElementById("chat-content");
  chat.scrollTop = chat.scrollHeight;
  document.getElementById("newMessages").hidden = true;
}

// Returns the link if the whole message is a link to an image (https only)
function getImageUrl(text) {
  if (!/^https:\/\/\S+\.(jpe?g|png|gif|webp)(\?\S*)?$/i.test(text)) return null;
  try {
    var url = new URL(text);
    return url.protocol == "https:" ? url.href : null;
  } catch (error) {
    return null;
  }
}

// Only 1-3 emojis (no text) -> shown big. Longer emoji rows stay in a normal bubble.
function isJumboEmoji(text) {
  try {
    var compact = text.replace(/\s+/g, "");
    if (!/^(\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u.test(compact)) return false;
    if (!/\p{Extended_Pictographic}/u.test(compact)) return false;

    var count = window.Intl && Intl.Segmenter
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(compact)].length
      : (compact.match(/\p{Extended_Pictographic}/gu) || []).length;
    return count <= 3;
  } catch (error) {
    return false;
  }
}

var SYSTEM_ICONS = {
  join: "bi-person-plus",
  timer: "bi-stopwatch",
  leave: "bi-box-arrow-left",
  watch: "bi-eye",
  host: "bi-star-fill",
  start: "bi-flag-fill",
  trophy: "bi-trophy-fill",
  disconnect: "bi-wifi-off",
  reconnect: "bi-wifi",
  info: "bi-info-circle",
};

// Builds the message with DOM elements - no innerHTML, so nothing in a message can run as code
function addChatMessage(message, live) {
  var chat = document.getElementById("chat-content");
  if (chat == null) return;
  document.getElementById("chat-empty").hidden = true;

  var atBottom = isChatAtBottom();
  var element;

  if (message.type == "system") {
    element = document.createElement("div");
    element.className = "sys-msg " + (message.icon || "info");
    element.append(createIcon(SYSTEM_ICONS[message.icon] || SYSTEM_ICONS.info), document.createTextNode(message.text));
    lastMessage = null;
  } else {
    var own = message.name == chatUsername();
    // Messages of the same person within 2 minutes are grouped
    var grouped = lastMessage != null && lastMessage.name == message.name && message.time - lastMessage.time < 120000;

    element = document.createElement("div");
    element.className = "msg" + (own ? " own" : "") + (grouped ? " grouped" : "");

    var avatarSlot = document.createElement("div");
    avatarSlot.className = "avatar-slot";
    avatarSlot.appendChild(createAvatar(message.name, "sm"));

    var body = document.createElement("div");
    body.className = "msg-body";

    var meta = document.createElement("div");
    meta.className = "msg-meta";
    var name = document.createElement("span");
    name.className = "msg-name";
    name.style.color = own ? "var(--mm-accent)" : avatarColor(message.name);
    name.innerText = own ? "You" : message.name;
    if (message.spectator) name.appendChild(createIcon("bi-eye ms-1", "Spectator"));
    var time = document.createElement("span");
    time.className = "msg-time";
    time.innerText = new Date(message.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    meta.append(name, time);

    var bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.title = time.innerText;

    var imageUrl = getImageUrl(message.text);
    if (imageUrl) {
      bubble.classList.add("has-image");
      var image = document.createElement("img");
      image.className = "chat-image";
      image.src = imageUrl;
      image.alt = "Image from " + message.name;
      image.referrerPolicy = "no-referrer";
      image.addEventListener("click", () =>
        typeof openImageModal == "function" ? openImageModal(imageUrl) : window.open(imageUrl, "_blank", "noopener"),
      );
      // Show the link as text if the image can't be loaded
      image.addEventListener("error", () => {
        bubble.classList.remove("has-image");
        image.replaceWith(document.createTextNode(message.text));
      });
      image.addEventListener("load", () => {
        if (atBottom) scrollChatDown();
      });
      bubble.appendChild(image);
    } else {
      if (isJumboEmoji(message.text)) bubble.classList.add("jumbo");
      bubble.appendChild(document.createTextNode(message.text));
    }

    body.append(meta, bubble);
    element.append(avatarSlot, body);
    lastMessage = message;
  }

  chat.appendChild(element);

  // Only scroll down if the user didn't scroll up to read older messages
  if (!live || atBottom || message.name == chatUsername()) {
    scrollChatDown();
  } else {
    document.getElementById("newMessages").hidden = false;
  }
}

