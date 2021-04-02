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

socket.on('saveGameID', data => {
    sessionStorage.setItem('gameID', data.gameID);
    sessionStorage.setItem('type', data.type);
    window.location.href = data.url;
});