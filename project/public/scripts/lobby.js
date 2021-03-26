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

function createLobby() {
    document.getElementById('createLobbyButton').innerText = "Cancel Lobby";
    displayNewLobby("Flaver", 3, 44, "beispiel Lobby Id String");

    return;
    //TODO add lobby creation
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

function displayNewLobby(username, win, lose, id) {
    var tableBody = document.getElementById("lobbyTable");
    tableBody.innerHTML +=
        `<tr class="border-dark border-bottom">
        <td class="text-start">${username}</td>
        <td>${win}</td>
        <td>${lose}</td>
        <td class="text-end">
            <button class="btn btn-outline-light px-3" onclick="joinLobby('${id}')">
                Join
            </button>
        </td>
    </tr>`;

}