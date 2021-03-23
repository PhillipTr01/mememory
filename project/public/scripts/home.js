//after creation 
document.addEventListener('DOMContentLoaded', function () {
    //setting correct username
    setUsername();
    setScoreboardData();
}, false);

function startLobbyPage() {
    window.location.href = "/beta";
    return;
    //TODO add Lobby Page
}

function startProfilePage() {
    window.location.href = "/user";
    return;
}

function startSettingsPage() {
    return;
    //TODO add Settings Page
}

function logoutUser() {
    return;
    //TODO logout function
}

function setUsername() {
    var request = new XMLHttpRequest();

    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                document.getElementById('username').innerText = JSON.parse(this.responseText).username;
            }
        }
    }

    request.open('GET', '/requests/user/username');
    request.send();
}

function setScoreboardData() {
    var request = new XMLHttpRequest();

    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                var response = JSON.parse(this.responseText);
                var easyArr = response.easy;
                var middleArr = response.middle;
                var hardArr = response.hard;
                var expertArr = response.expert;
                var multiplayerArr = response.multiplayer;
                createScoreboard("easyTable", easyArr);
                createScoreboard("middleTable", middleArr);
                createScoreboard("hardTable", hardArr);
                createScoreboard("expertTable", expertArr);
                createScoreboard("multiplayerTable", multiplayerArr);
            }
        }
    }

    request.open('GET', '/requests/scoreboard');
    request.send();
}

function createScoreboard(tableID, array) {
    var tableBody = document.getElementById(tableID);
    for (var i = 0; i < array.length; i++) {
        tableBody.innerHTML += `<tr>
                                    <td>` + (i + 1) + `.</td>
                                    <td>` + array[i].username + `</td>
                                    <td>` + array[i].win + `</td>
                                    <td>` + array[i].lose + `</td>
                                    <td class="d-none d-md-block">` + divide(array[i].win, array[i].lose) + `</td>
                                </tr>`
    }
}

function divide(x, y) {
    y = (y == 0 ? 1 : y);
    var z = x / y;
    n = Math.pow(10, 2);
    return (Math.round(z * n) / n);
}