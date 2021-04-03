const socket = io('/lobby');

function playSingleplayer(difficulty) {
    var request = new XMLHttpRequest();
    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                var username = JSON.parse(this.responseText).username;
                socket.emit('playSingleplayer', {username: username, difficulty: difficulty});
            }
        }
    }
    request.open('GET', '/requests/user/username');
    request.send();
}

function playMultiplayer() {
    var request = new XMLHttpRequest();
    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                var username = JSON.parse(this.responseText).username;
                sessionStorage.setItem('player', 'player1');
                socket.emit('playMultiplayer', username);
            }
        }
    }
    request.open('GET', '/requests/user/username');
    request.send();
}

function joinMultiplayer() {
    var gameID = document.getElementById('joinLobbyTag').value;

    var request = new XMLHttpRequest();
    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                var username = JSON.parse(this.responseText).username;
                sessionStorage.setItem('username', username);
                sessionStorage.setItem('player', 'player2');
                socket.emit('joinMultiplayer', gameID);
            }
        }
    }
    request.open('GET', '/requests/user/username');
    request.send();
}

socket.on('saveGameID', data => {
    
    sessionStorage.setItem('gameID', data.gameID);
    window.location.href = data.url;
});