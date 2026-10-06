/* The start page of the hidden games: what is going on, own coins, the chat of all games. */
const socket = io("/casino");

var myName = null;

// Used by chat.js
function chatUsername() {
  return myName;
}

function formatCoins(value) {
  return Number(value).toLocaleString("en-US");
}

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => (document.getElementById("connectionBanner").hidden = false));
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/";
});

window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => (myName = data.username));

socket.on("coins", (data) => {
});


function live(id, text, hot) {
  var element = document.getElementById(id);
  element.innerText = text;
  element.classList.toggle("hot", hot === true);
}

socket.on("summary", (data) => {
  var jackpot = data.jackpot;
  if (jackpot.phase == "drawing") live("csJackpot", "🎰 Drawing a winner right now", true);
  else if (jackpot.total > 0) live("csJackpot", "🪙 " + formatCoins(jackpot.total) + " in the pot · " + jackpot.players + (jackpot.players == 1 ? " player" : " players"), jackpot.phase == "countdown");
  else live("csJackpot", "The pot is empty - be the first");

  var battles = data.battles;
  var parts = [];
  if (battles.open > 0) parts.push(battles.open + " open");
  if (battles.running > 0) parts.push(battles.running + " running");
  live("csBattles", parts.length ? "⚔️ " + parts.join(" · ") : "No battles - create one", battles.open > 0);

  var poker = data.poker;
  live("csPoker", poker.seated == 0 ? "The table is empty - take a seat" : "🃏 " + poker.seated + " / " + poker.seats + " seats" + (poker.playing ? " · playing" : ""), poker.seated > 0 && poker.seated < poker.seats);
});

document.addEventListener("DOMContentLoaded", () => {
  setupChat();
});
