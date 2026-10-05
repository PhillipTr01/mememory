// Scoreboard: top players for every mode
var scoreboard = null;
var currentMode = "easy";

var MODE_COLORS = {
    easy: "#34d399",
    medium: "#48b0f7",
    hard: "#f59e0b",
    expert: "#ef4444",
    multiplayer: "#a78bfa",
    tictactoe: "#3f9d6b",
};

document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".mode-tab").forEach((tab) => {
        tab.addEventListener("click", () => showMode(tab.dataset.mode));
    });
    loadScoreboard();
}, false);

function loadScoreboard() {
    fetch("/requests/scoreboard", { credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
        .then((data) => {
            scoreboard = data;
            showMode(currentMode);
        })
        .catch(() => showToast("Could not load the scoreboard.", "error"));
}

function showMode(mode) {
    currentMode = mode;

    document.querySelectorAll(".mode-tab").forEach((tab) => {
        var active = tab.dataset.mode == mode;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", active);
    });

    // The color of the list follows the selected mode (same colors as the lobby).
    // Set directly on the element, so no other style rule can override it.
    var board = document.querySelector(".scoreboard");
    board.className = board.className.replace(/\bmode-\w+/g, "").trim() + " mode-" + mode;
    board.style.setProperty("--mode", MODE_COLORS[mode]);

    if (scoreboard == null) return;
    userPromise.then((username) => renderList(scoreboard[mode] || [], username));
}

function renderList(players, username) {
    var list = document.getElementById("scoreList");
    list.replaceChildren();
    document.getElementById("scoreEmpty").hidden = players.length > 0;

    var medals = ["🥇", "🥈", "🥉"];

    players.forEach((player, index) => {
        var row = document.createElement("li");
        row.className = "score-row" + (player.username == username ? " me" : "");
        row.style.animationDelay = index * 30 + "ms";

        var rank = document.createElement("span");
        rank.className = "score-rank" + (index < 3 ? " medal" : "");
        rank.innerText = index < 3 ? medals[index] : index + 1;

        var info = document.createElement("div");
        info.className = "overflow-hidden";
        var name = document.createElement("div");
        name.className = "score-name";
        var nameText = document.createElement("span");
        nameText.className = "score-name-text";
        nameText.innerText = player.username;
        name.appendChild(nameText);
        // Same "You" tag as in the game
        if (player.username == username) {
            var you = document.createElement("span");
            you.className = "you-tag";
            you.innerText = "You";
            name.appendChild(you);
        }

        var draw = player.draw || 0;
        var games = player.win + player.lose + draw;
        var percent = games == 0 ? 0 : Math.round((player.win / games) * 100);
        var rate = document.createElement("div");
        rate.className = "score-rate";
        var bar = document.createElement("span");
        bar.className = "bar";
        var fill = document.createElement("span");
        fill.className = "fill d-block";
        fill.style.width = percent + "%";
        bar.appendChild(fill);
        rate.append(bar, document.createTextNode(percent + "% win rate"));
        info.append(name, rate);

        var stats = document.createElement("div");
        stats.className = "score-stats";
        stats.append(stat("win", player.win, "Wins"), stat("lose", player.lose, "Losses"));
        // Tic Tac Toe: draws count as games, too
        if (currentMode == "tictactoe") stats.append(stat("draw", draw, "Draws"));

        row.append(rank, createAvatar(player.username), info, stats);
        list.appendChild(row);
    });
}

function stat(type, value, label) {
    var element = document.createElement("div");
    element.className = type;
    var number = document.createElement("div");
    number.className = "value";
    number.innerText = value;
    var text = document.createElement("div");
    text.className = "label";
    text.innerText = label;
    element.append(number, text);
    return element;
}
