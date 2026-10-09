// Profile: statistics of the logged in user, avatar maker
var myName = null;
var MODES = ["easy", "medium", "hard", "expert", "multiplayer", "tictactoe"];

document.addEventListener('DOMContentLoaded', function () {
    userPromise.then((username) => {
        if (!username) return;
        document.getElementById('heroName').innerText = username;
        var hero = createAvatar(username, 'lg');
        hero.id = 'heroAvatar';
        document.getElementById('heroAvatar').replaceWith(hero);
        myName = username;
    });
    loadStatistic();
}, false);

function loadStatistic() {
    fetch('/requests/user/statistic', { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
        .then(showStatistic)
        .catch(() => showToast('Could not load your statistics.', 'error'));
}

function percent(win, lose, draw) {
    var games = win + lose + (draw || 0);
    return games == 0 ? 0 : Math.round((win / games) * 100);
}

function showStatistic(statistic) {
    var totalWins = 0;
    var totalGames = 0;

    MODES.forEach((mode) => {
        var win = statistic[mode + 'Win'] || 0;
        var lose = statistic[mode + 'Lose'] || 0;
        // Only Tic Tac Toe has draws
        var draw = statistic[mode + 'Draw'] || 0;
        var played = win + lose + draw;
        totalWins += win;
        totalGames += played;

        document.getElementById(mode + 'Win').innerText = win;
        document.getElementById(mode + 'Lose').innerText = lose;
        var drawElement = document.getElementById(mode + 'Draw');
        if (drawElement) drawElement.innerText = draw;
        document.getElementById(mode + 'Bar').style.width = percent(win, lose, draw) + '%';
        var footer = document.getElementById(mode + 'Rate');
        if (played == 0) {
            footer.innerText = 'No games yet';
        } else {
            var rate = document.createElement('span');
            rate.innerText = percent(win, lose, draw) + '% win rate';
            var games = document.createElement('span');
            games.innerText = played + (played == 1 ? ' game' : ' games');
            footer.replaceChildren(rate, games);
        }
    });

    document.getElementById('totalGames').innerText = totalGames;
    document.getElementById('totalWins').innerText = totalWins;
    document.getElementById('totalRate').innerText = percent(totalWins, totalGames - totalWins, 0) + '%';
}
