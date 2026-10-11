/*
 * Moderators on the casino pages (game/moderators.js): a 🛡️ Mod button in the bar at the top opens their
 * panel - a money rain for everybody online (a total, split evenly - they get theirs too, never alone), an announcement in
 * the chat, who is muted, what they did. In the chat (with the chat right) every message of somebody else
 * gets a delete and a mute button. Other players see none of it.
 */
(function () {
  if (typeof socket == "undefined") return;
  var state = null; // {mod, rainLeft, mutes, muteMax, log}

  function el(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.innerText = text;
    return element;
  }
  var format = (value) => Number(value || 0).toLocaleString("en-US");
  var me = () => (typeof chatUsername == "function" ? chatUsername() : null);

  async function call(path, body) {
    var res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
    var data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "That didn't work.");
    return data;
  }

  async function load() {
    try {
      state = await call("mod");
    } catch (error) {
      state = null;
    }
    render();
  }

  /* ---------- The button in the bar ---------- */

  function render() {
    var on = !!(state && state.mod);
    var button = document.getElementById("navMod");
    if (on && !button) {
      button = el("button", "nav-mod", "🛡️ Mod");
      button.id = "navMod";
      button.type = "button";
      button.title = "Moderator";
      button.addEventListener("click", openPanel);
      var anchor = document.getElementById("navBonus") || document.getElementById("navCoins");
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(button, anchor);
    }
    if (button) button.hidden = !on;
    // The chat: the tools on every message (or off again)
    window.chatModTools = on && state.mod.perms.chat ? tools : null;
    document.querySelectorAll("#chat-content [data-msg-id]").forEach((message) => {
      message.querySelectorAll(".msg-mod").forEach((node) => node.remove());
      if (window.chatModTools) tools(message);
    });
    var panel = document.querySelector(".cs-mod-backdrop");
    if (panel && !on) panel.remove();
  }

  /* ---------- In the chat: delete, mute ---------- */

  function tools(message) {
    var name = message.dataset.msgName;
    if (!name || name == me() || message.querySelector(".msg-mod")) return;
    var bar = el("div", "msg-mod");
    var remove = el("button", "msg-mod-btn", "🗑");
    remove.type = "button";
    remove.title = "Delete the message";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!(await confirmDialog({ title: "Delete this message?", text: "From " + name + " - it is gone for everybody.", confirmLabel: "Delete", danger: true }))) return;
      try {
        await call("mod/chat/delete", { id: Number(message.dataset.msgId) });
      } catch (error) {
        showHint(error.message, "error", remove);
      }
    });
    var mute = el("button", "msg-mod-btn", "🔇");
    mute.type = "button";
    mute.title = "Mute " + name;
    mute.addEventListener("click", (event) => {
      event.stopPropagation();
      muteDialog(name);
    });
    bar.append(remove, mute);
    message.appendChild(bar);
  }

  function muteDialog(name) {
    var options = [
      [10, "10 min"],
      [60, "1 hour"],
      [360, "6 hours"],
      [1440, "1 day"],
    ].filter(([minutes]) => minutes <= ((state && state.muteMax) || 1440));
    var { backdrop, dialog, close } = popup("cs-mod-mute");
    dialog.append(el("h2", "mm-dialog-title", "🔇 Mute " + name), el("p", "mm-dialog-text", name + " can't write in the casino chat for this long."));
    var list = el("div", "cs-mod-choices");
    options.forEach(([minutes, text]) => {
      var b = el("button", "mm-btn", text);
      b.type = "button";
      b.addEventListener("click", async () => {
        try {
          var result = await call("mod/chat/mute", { username: name, minutes: minutes });
          state.mutes = result.mutes;
          close();
          casinoNotice && casinoNotice({ icon: "🔇", title: name + " is muted", text: "for " + text, ms: 4000, key: "mod-mute" });
        } catch (error) {
          showHint(error.message, "error", b);
        }
      });
      list.appendChild(b);
    });
    var cancel = el("button", "cs-mod-cancel", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", close);
    dialog.append(list, cancel);
    document.body.appendChild(backdrop);
  }

  /* ---------- The panel ---------- */

  function popup(className) {
    var backdrop = el("div", "mm-dialog-backdrop cs-mod-backdrop");
    var dialog = el("div", "mm-dialog cs-mod " + (className || ""));
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    var onKey = (event) => event.key == "Escape" && close();
    var close = () => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
    };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (event) => event.target == backdrop && close());
    backdrop.appendChild(dialog);
    return { backdrop, dialog, close };
  }

  function section(title, icon) {
    var box = el("section", "cs-mod-section");
    box.appendChild(el("h3", "cs-mod-title", icon + " " + title));
    return box;
  }

  async function openPanel() {
    await load();
    if (!state || !state.mod) return;
    document.querySelectorAll(".cs-mod-backdrop").forEach((n) => n.remove());
    var { backdrop, dialog, close } = popup("cs-mod-panel");
    var x = el("button", "cs-gift-close", "✕");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);
    var perms = state.mod.perms;
    dialog.append(x, el("h2", "mm-dialog-title", "🛡️ Moderator"));
    if (!perms.rain && !perms.chat && !perms.announce) dialog.appendChild(el("p", "mm-dialog-text", "The admin hasn't given you any rights yet."));
    if (perms.rain) dialog.appendChild(rainSection());
    if (perms.announce) dialog.appendChild(announceSection());
    if (perms.chat) dialog.appendChild(chatSection());
    dialog.appendChild(logSection());
    document.body.appendChild(backdrop);
  }

  // 💸 A money rain for everybody online: the total, split evenly (never with only moderators online)
  function rainSection() {
    var box = section("Money rain", "💸");
    var mod = state.mod;
    var limits = "For everybody online · at most 🪙 " + format(mod.rainMax) + " per rain" + (state.rainLeft != null ? " · 🪙 " + format(state.rainLeft) + " left this week (of " + format(mod.rainWeekly) + ")" : "");
    box.appendChild(el("p", "cs-mod-note", limits));
    var amount = Object.assign(el("input", "mm-input"), { type: "number", min: 1, step: 1000, placeholder: "Coins in total" });
    amount.setAttribute("aria-label", "Coins in total");
    var note = Object.assign(el("input", "mm-input"), { type: "text", maxLength: 80, placeholder: "What for (optional)" });
    var preview = el("p", "cs-mod-preview", "");
    var send = el("button", "cs-gift-send", "💸 Let it rain");
    send.type = "button";
    var row = el("div", "cs-mod-row");
    row.append(amount, note);
    box.append(row, preview, send);
    var timer = null;
    var body = () => ({ amount: Math.floor(Number(amount.value) || 0), note: note.value });
    var last = null; // the last preview
    var check = () => {
      clearTimeout(timer);
      var b = body();
      var over = b.amount > mod.rainMax || (state.rainLeft != null && b.amount > state.rainLeft);
      send.disabled = b.amount < 1 || over;
      if (b.amount < 1) return (preview.innerText = "");
      if (over) return (preview.innerText = b.amount > mod.rainMax ? "More than 🪙 " + format(mod.rainMax) + " per rain." : "More than you have left this week.");
      timer = setTimeout(async () => {
        try {
          last = await call("mod/rain/preview", b);
          preview.innerText = last.others > 0 ? "→ " + last.players + " players online get 🪙 " + format(last.each) + " each - 🪙 " + format(last.total) + " in total" : "No player is online but moderators - a money rain needs at least one other player.";
          send.disabled = !(last.others > 0) || last.each < 1;
        } catch (error) {
          preview.innerText = error.message;
        }
      }, 250);
    };
    amount.addEventListener("input", check);
    send.addEventListener("click", async () => {
      var b = body();
      if (!(await confirmDialog({ title: "Let it rain?", text: "🪙 " + format(b.amount) + " in total, split evenly between everybody online" + (last ? " (" + last.players + " players)" : "") + ".", confirmLabel: "Let it rain" }))) return;
      send.disabled = true;
      try {
        var result = await call("mod/rain", b);
        casinoNotice({ icon: "💸", title: "Money rain sent", text: result.players + " players · 🪙 " + format(result.each) + " each", ms: 6000, key: "mod-rain" });
        openPanel();
      } catch (error) {
        preview.innerText = error.message;
        send.disabled = false;
      }
    });
    check();
    return box;
  }

  // 📣 An announcement in the casino chat
  function announceSection() {
    var box = section("Announcement", "📣");
    var text = Object.assign(el("input", "mm-input"), { type: "text", maxLength: 200, placeholder: "For everybody in the casino chat" });
    var send = el("button", "mm-btn mm-btn-primary", "📣 Announce");
    send.type = "button";
    send.disabled = true;
    text.addEventListener("input", () => (send.disabled = text.value.trim().length < 2));
    send.addEventListener("click", async () => {
      send.disabled = true;
      try {
        await call("mod/announce", { text: text.value });
        text.value = "";
        casinoNotice({ icon: "📣", title: "Announced", text: "It's in the chat for everybody", ms: 4000, key: "mod-announce" });
      } catch (error) {
        showHint(error.message, "error", send);
        send.disabled = false;
      }
    });
    var row = el("div", "cs-mod-row");
    row.append(text, send);
    box.appendChild(row);
    return box;
  }

  // 💬 The chat: who is muted (unmute) - delete and mute on the messages themselves
  function chatSection() {
    var box = section("Chat", "💬");
    box.appendChild(el("p", "cs-mod-note", "Hover a message in the chat: 🗑 deletes it, 🔇 mutes its writer."));
    var list = el("div", "cs-mod-mutes");
    var fill = () => {
      list.replaceChildren(
        ...(state.mutes.length
          ? state.mutes.map((m) => {
              var row = el("div", "cs-mod-mute-row");
              var left = Math.max(1, Math.ceil((m.until - Date.now()) / 60000));
              row.append(createAvatar(m.username, "sm"), el("b", "", m.username), el("span", "cs-mod-note", "muted " + (left >= 60 ? Math.round(left / 60) + " h" : left + " min") + " more"));
              var un = el("button", "mm-btn mm-btn-sm", "🔊 Unmute");
              un.type = "button";
              un.addEventListener("click", async () => {
                try {
                  state.mutes = (await call("mod/chat/unmute", { username: m.username })).mutes;
                  fill();
                } catch (error) {
                  showHint(error.message, "error", un);
                }
              });
              row.appendChild(un);
              return row;
            })
          : [el("p", "cs-mod-note", "Nobody is muted.")]),
      );
    };
    fill();
    box.appendChild(list);
    return box;
  }

  var ICONS = { rain: "💸", delete: "🗑️", mute: "🔇", unmute: "🔊", announce: "📣" };
  function logSection() {
    var box = section("What you did", "🗒️");
    box.classList.add("cs-mod-log");
    if (!state.log.length) box.appendChild(el("p", "cs-mod-note", "Nothing yet."));
    state.log.slice(0, 8).forEach((entry) => {
      var row = el("div", "cs-mod-log-row");
      row.append(el("span", "", ICONS[entry.action] || "•"), el("span", "cs-mod-log-text", entry.detail), el("span", "cs-mod-note", new Date(entry.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })));
      box.appendChild(row);
    });
    return box;
  }

  // The admin changed the rights: everything anew
  socket.on("modChanged", load);
  load();
})();
