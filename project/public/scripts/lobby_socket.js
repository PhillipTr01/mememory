const lobbySocket = io('/lobby');

function createLobby() {
    lobbySocket.emit('createGame', window.username);
}

lobbySocket.on('saveGameID', data => {
    sessionStorage.setItem('gameID', data.gameID);
    window.location.href = '/play';
});