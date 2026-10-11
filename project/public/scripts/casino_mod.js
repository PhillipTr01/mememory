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
      button = el("button", "nav-mod", "🛡️");
      // (phones: only the shield)
      button.appendChild(el("span", "nav-mod-text", " Mod"));
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

  // (drawn here - fixed markup, no text of a message in it: the same in every browser, white on the button)
  var ICON_BIN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>';
  var ICON_MUTE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>';

  function tools(message) {
    var name = message.dataset.msgName;
    if (!name || name == me() || message.querySelector(".msg-mod")) return;
    var bar = el("div", "msg-mod");
    var remove = el("button", "msg-mod-btn");
    remove.innerHTML = ICON_BIN;
    remove.type = "button";
    remove.title = "Delete the message";
    remove.setAttribute("aria-label", "Delete the message");
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!(await confirmDialog({ title: "Delete this message?", text: "From " + name + " - it is gone for everybody.", confirmLabel: "Delete", danger: true }))) return;
      try {
        await call("mod/chat/delete", { id: Number(message.dataset.msgId) });
      } catch (error) {
        showHint(error.message, "error", remove);
      }
    });
    var mute = el("button", "msg-mod-btn");
    mute.innerHTML = ICON_MUTE;
    mute.type = "button";
    mute.title = "Mute " + name;
    mute.setAttribute("aria-label", "Mute " + name);
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
    if (!perms.rain && !perms.chat && !perms.announce && !perms.give) dialog.appendChild(el("p", "mm-dialog-text", "The admin hasn't given you any rights yet."));
    if (perms.rain) dialog.appendChild(rainSection());
    if (perms.give) dialog.appendChild(giveSection());
    if (perms.announce) dialog.appendChild(announceSection());
    if (perms.chat) dialog.appendChild(chatSection());
    document.body.appendChild(backdrop);
  }

  // 💸 A money rain for everybody online: every one gets the amount (never with only moderators online)
  function rainSection() {
    var box = section("Money rain", "💸");
    var mod = state.mod;
    // In a season: none
    if (state.inSeason) {
      box.appendChild(el("p", "cs-mod-note", "No money rains in a season - switch to the normal casino for one."));
      return box;
    }
    var limits = "Every player online gets it · at most 🪙 " + format(mod.rainMax) + " per player · " + state.rainWait.hours + " h between two money rains (of all moderators)" + (state.rainLeft != null ? " · 🪙 " + format(state.rainLeft) + " left this week (of " + format(mod.rainWeekly) + ")" : "");
    box.appendChild(el("p", "cs-mod-note", limits));
    var amount = Object.assign(el("input", "mm-input"), { type: "number", min: 1, step: 1000, placeholder: "Coins per player" });
    amount.setAttribute("aria-label", "Coins per player");
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
    // The wait after the last rain: a countdown, nothing can be sent before
    var waitLine = el("p", "cs-mod-wait", "");
    box.insertBefore(waitLine, row);
    // (the later one: their own wait or the one for all moderators)
    var own = mod.nextRain && mod.nextRain > Date.now() ? mod.nextRain : null;
    var nextAt = Math.max(own || 0, state.rainWait.nextAt || 0) || null;
    var ownLater = own && own >= (state.rainWait.nextAt || 0);
    var waiting = () => nextAt && Date.now() < nextAt;
    var showWait = () => {
      if (!waiting()) return (waitLine.hidden = true);
      var min = Math.ceil((nextAt - Date.now()) / 60000);
      waitLine.hidden = false;
      waitLine.innerText = "⏳ The next money rain in " + (min >= 60 ? Math.floor(min / 60) + " h " + (min % 60) + " min" : min + " min") + (ownLater ? " (" + mod.rainCooldown + " h after your last one)" : state.rainWait.lastBy ? " - the last one was by " + state.rainWait.lastBy : "");
    };
    showWait();
    if (waiting()) {
      var waitTimer = setInterval(() => {
        showWait();
        if (!waiting() || !waitLine.isConnected) {
          clearInterval(waitTimer);
          if (waitLine.isConnected) check();
        }
      }, 30000);
    }
    var check = () => {
      clearTimeout(timer);
      var b = body();
      if (waiting()) {
        send.disabled = true;
        return (preview.innerText = "");
      }
      var over = b.amount > mod.rainMax || (state.rainLeft != null && b.amount > state.rainLeft);
      send.disabled = b.amount < 1 || over;
      if (b.amount < 1) return (preview.innerText = "");
      if (over) return (preview.innerText = b.amount > mod.rainMax ? "More than 🪙 " + format(mod.rainMax) + " per player." : "More than you have left this week.");
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
      if (!(await confirmDialog({ title: "Let it rain?", text: "🪙 " + format(b.amount) + " for every player online" + (last ? " - " + last.players + " players, 🪙 " + format(last.total) + " in total" : "") + ".", confirmLabel: "Let it rain" }))) return;
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

  // 🎁 Coins for one player - from the casino (the normal 🪙), not from the own balance
  function giveSection() {
    var box = section("Give coins", "🎁");
    var mod = state.mod;
    box.appendChild(el("p", "cs-mod-note", "From the casino, not your own coins (🪙 only) · at most 🪙 " + format(mod.giveMax) + " per gift" + (state.giveLeft != null ? " · 🪙 " + format(state.giveLeft) + " left this week (of " + format(mod.giveWeekly) + ")" : "") + " · not to yourself or other moderators"));
    // Who: typed - the players online to pick from
    var to = Object.assign(el("input", "mm-input"), { type: "text", maxLength: 40, placeholder: "Player", autocomplete: "off" });
    to.setAttribute("aria-label", "Player");
    var list = el("datalist");
    list.id = "csModGiveNames";
    to.setAttribute("list", list.id);
    var me = typeof myName != "undefined" ? myName : null;
    (window.casinoOnlineNames || []).filter((name) => name != me && !(window.casinoModNames && window.casinoModNames.has(name))).forEach((name) => list.appendChild(Object.assign(document.createElement("option"), { value: name })));
    var amount = Object.assign(el("input", "mm-input"), { type: "number", min: 1, step: 1000, placeholder: "Coins" });
    amount.setAttribute("aria-label", "Coins");
    var note = Object.assign(el("input", "mm-input"), { type: "text", maxLength: 80, placeholder: "What for (optional)" });
    var hint = el("p", "cs-mod-preview", "");
    var send = el("button", "cs-gift-send", "🎁 Give");
    send.type = "button";
    var row = el("div", "cs-mod-row");
    row.append(to, amount);
    box.append(row, list, note, hint, send);
    var check = () => {
      var value = Math.floor(Number(amount.value) || 0);
      var over = value > mod.giveMax ? "More than 🪙 " + format(mod.giveMax) + " per gift." : state.giveLeft != null && value > state.giveLeft ? "More than you have left this week." : "";
      hint.innerText = over;
      send.disabled = !to.value.trim() || value < 1 || !!over;
    };
    to.addEventListener("input", check);
    amount.addEventListener("input", check);
    send.addEventListener("click", async () => {
      var who = to.value.trim();
      var value = Math.floor(Number(amount.value) || 0);
      if (!(await confirmDialog({ title: "Give coins?", text: "🪙 " + format(value) + " for " + who + " - from the casino." + (note.value.trim() ? " “" + note.value.trim() + "”" : ""), confirmLabel: "Give" }))) return;
      send.disabled = true;
      try {
        var result = await call("mod/give", { to: who, amount: value, note: note.value });
        casinoNotice({ icon: "🎁", title: "Coins given", text: result.to + " got 🪙 " + format(result.amount) + (result.left != null ? " · 🪙 " + format(result.left) + " left this week" : ""), ms: 6000, key: "mod-give" });
        openPanel();
      } catch (error) {
        hint.innerText = error.message;
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
    // How long it stays in the chat
    var keep = el("select", "mm-input cs-mod-keep");
    keep.setAttribute("aria-label", "Stays for");
    [
      [1, "1 min"],
      [15, "15 min"],
      [60, "1 hour"],
      [360, "6 hours"],
      [1440, "1 day"],
    ].forEach(([value, label]) => keep.appendChild(Object.assign(el("option", null, "Stays " + label), { value: value })));
    keep.value = "1";
    text.addEventListener("input", () => (send.disabled = text.value.trim().length < 2));
    send.addEventListener("click", async () => {
      send.disabled = true;
      try {
        await call("mod/announce", { text: text.value, minutes: Number(keep.value) });
        text.value = "";
        casinoNotice({ icon: "📣", title: "Announced", text: "In the chat for everybody - " + keep.options[keep.selectedIndex].text.toLowerCase(), ms: 4000, key: "mod-announce" });
      } catch (error) {
        showHint(error.message, "error", send);
        send.disabled = false;
      }
    });
    var row = el("div", "cs-mod-row");
    row.append(text, keep, send);
    box.appendChild(row);
    return box;
  }

  // 💬 The chat: who is muted (unmute) - delete and mute on the messages themselves
  function chatSection() {
    var box = section("Chat", "💬");
    box.appendChild(el("p", "cs-mod-note", "Hover a message in the chat: the bin deletes it, the crossed-out bubble mutes its writer."));
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

  // The admin changed the rights: everything anew
  socket.on("modChanged", load);
  load();
})();
