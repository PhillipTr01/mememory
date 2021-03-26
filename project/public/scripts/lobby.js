//after creation 
document.addEventListener('DOMContentLoaded', function () {

    //setting correct username
    setUsername();
}, false);

//Keep dropdown open if clicked on other groups
document.getElementById("keep-open-dropdown").addEventListener("click", function (e) {
    e.stopPropagation();
}, false);

function startLobbyPage() {
    //stay on site
    //window.location.href = "/lobby";
    return;
}

function startScoreboardPage() {
    window.location.href = "/home";
    return;
}

function startProfilePage() {
    window.location.href = "/user";
    return;
}

function startSettingsPage() {
    return;
    //TODO add Settings Page
}

function startComputerMatch() {
    return;
    //TODO add computer match
}

function joinLobby(id) {
    console.log("joining lobby: " + id);
    return;
    //TODO add join lobby
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
                document.getElementById('username').innerText = JSON.parse(this.responseText).username;
            }
        }
    }

    request.open('GET', '/requests/user/username');
    request.send();
}

const lobbySocket = io('/lobby');
var createLobbyButton = document.getElementById('createLobbyButton');
var cancelLobbyButton = document.getElementById('cancelLobbyButton');

lobbySocket.on('message', message => {
    console.log(message);
});

lobbySocket.on('showLobby', lobbyData => {
    var tableBody = document.getElementById("lobbyTable");

    var username = lobbyData.username;
    var win = lobbyData.multiplayerWin;
    var lose = lobbyData.multiplayerLose;
    var id = lobbyData.id;

    tableBody.innerHTML +=
        `<tr class="border-dark border-bottom" id='lobby-${username}'>
        <td class="text-start">${username}</td>
        <td>${win}</td>
        <td>${lose}</td>
        <td class="text-end">
            <button class="btn btn-outline-light px-3" onclick="joinLobby('${id}')">
                Join
            </button>
        </td>
    </tr>`;

    document.getElementById('cancelLobbyButton').onclick = function() {cancelLobby(lobbyData.id)};
});

lobbySocket.on('removeLobby', username => {
    var lobby = document.getElementById("lobby-" + username);
    lobby.remove();
});

function cancelLobby(id) {
    lobbySocket.emit('deleteLobby', id);

    cancelLobbyButton.classList.add("d-none");
    createLobbyButton.classList.remove("d-none");
}

function createLobby() {

    var username = document.getElementById('username').innerText;
    var multiplayerWin = -1;
    var multiplayerLose = -1;

    
    var statisticRequest = new XMLHttpRequest();
    statisticRequest.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                multiplayerWin = JSON.parse(this.responseText).multiplayerWin;
                multiplayerLose = JSON.parse(this.responseText).multiplayerLose;

                var lobbyData = {
                    username: username,
                    multiplayerWin: multiplayerWin,
                    multiplayerLose: multiplayerLose,
                    id: null
                }

                lobbySocket.emit('createLobby', lobbyData);
            }
        }
    }
    statisticRequest.open('GET', '/requests/user/statistic', true);
    statisticRequest.send();

    createLobbyButton.classList.add("d-none");
    cancelLobbyButton.classList.remove("d-none");
};

