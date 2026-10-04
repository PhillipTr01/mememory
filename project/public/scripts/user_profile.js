// Profile: statistics of the logged in user
var MODES = ["easy", "medium", "hard", "expert", "multiplayer"];

document.addEventListener('DOMContentLoaded', function () {
    userPromise.then((username) => {
        if (!username) return;
        document.getElementById('heroName').innerText = username;
        document.getElementById('heroAvatar').replaceWith(createAvatar(username, 'lg'));
    });
    loadStatistic();
}, false);

function loadStatistic() {
    fetch('/requests/user/statistic', { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
        .then(showStatistic)
        .catch(() => showToast('Could not load your statistics.', 'error'));
}

function percent(win, lose) {
    var games = win + lose;
    return games == 0 ? 0 : Math.round((win / games) * 100);
}

function showStatistic(statistic) {
    var totalWins = 0;
    var totalGames = 0;

    MODES.forEach((mode) => {
        var win = statistic[mode + 'Win'] || 0;
        var lose = statistic[mode + 'Lose'] || 0;
        totalWins += win;
        totalGames += win + lose;

        document.getElementById(mode + 'Win').innerText = win;
        document.getElementById(mode + 'Lose').innerText = lose;
        document.getElementById(mode + 'Bar').style.width = percent(win, lose) + '%';
        document.getElementById(mode + 'Rate').innerText =
            win + lose == 0 ? 'No games yet' : percent(win, lose) + '% win rate · ' + (win + lose) + ' games';
    });

    document.getElementById('totalGames').innerText = totalGames;
    document.getElementById('totalWins').innerText = totalWins;
    document.getElementById('totalRate').innerText = percent(totalWins, totalGames - totalWins) + '%';
}
