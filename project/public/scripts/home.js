//after creation 
document.addEventListener('DOMContentLoaded', function () {
    //setting correct username
    var username = parseJWT(getToken()).username;
    document.getElementById('username').innerText = username;
    document.getElementById('usernameHomePage').innerText = username;
    //getStatisticData();
}, false);

function startLobbyPage() {
    return;
    //TODO add Lobby Page
}

function startProfilePage() {
    return;
    //TODO add Lobby Page
}

function startScoreBoardPage() {
    return;
    //TODO add Scoreboard Page
}

function logoutUser() {
    window.location.href = "/";
    return;
    //TODO logout function
}

function startSettingsPage() {
    return;
    //TODO Settings Page
}

function getStatisticData() {
    var usernameStatistics = parseJWT(getToken()).statistics;
    console.log(usernameStatistics)
    var request = new XMLHttpRequest();

    request.onreadystatechange = function () {
        if (this.readyState == 4) {

            if (this.status == 200) {
                console.log(JSON.parse(this.responseText))
            }
        }
    }

    request.open('GET', 'requests/statistic/' + usernameStatistics);
    request.send();
}