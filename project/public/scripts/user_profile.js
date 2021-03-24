//after creation 
document.addEventListener('DOMContentLoaded', function () {
    setUsername();
    setStatisticData();
}, false);

function startLobbyPage() {
    window.location.href = "/beta";
    //window.location.href = "/lobby";
    return;
    //TODO add Lobby Page
}

function startScoreboardPage() {
    window.location.href = "/home";
    return;
}

function startSettingsPage() {
    return;
    //TODO add Settings Page
}

function logoutUser() {
    var request = new XMLHttpRequest();

    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                window.location.href = "/";
            }
        }
    }

    request.open('GET', '/requests/authentication/logout');
    request.send();
    return;
}

function setUsername() {
    var request = new XMLHttpRequest();

    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                var username = JSON.parse(this.responseText).username;
                document.getElementById('username').innerText = username;
                document.getElementById('usernameHomePage').innerText = username;
            }
        }
    }

    request.open('GET', '/requests/user/username');
    request.send();
}

function setStatisticData() {
    var request = new XMLHttpRequest();

    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                var response = JSON.parse(this.responseText);
                document.getElementById('easyWin').innerText = response.easyWin;
                document.getElementById('easyLose').innerText = response.easyLose;
                document.getElementById('middleWin').innerText = response.middleWin;
                document.getElementById('middleLose').innerText = response.middleLose;
                document.getElementById('hardWin').innerText = response.hardWin;
                document.getElementById('hardLose').innerText = response.hardLose;
                document.getElementById('expertWin').innerText = response.expertWin;
                document.getElementById('expertLose').innerText = response.expertLose;
                document.getElementById('multiplayerWin').innerText = response.multiplayerWin;
                document.getElementById('multiplayerLose').innerText = response.multiplayerLose;
            }
        }
    }

    request.open('GET', '/requests/user/statistic');
    request.send();
}