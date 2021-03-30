var randomstring = require('randomstring');

global.rooms = {};

module.exports = function (io) {

    const lobby = io.of('/lobby');


    lobby.on('connection', socket => {

        socket.on('joinGame', gameID => {
            if (!(gameID in rooms)) {
                socket.emit('failedJoinGame', 'notExist');
            } else {
                if (rooms[gameID].player.length == 2) {
                    socket.emit('failedJoinGame', 'roomFull');
                } else {
                    // Join Game
                }
            }
        });

        socket.on('createGame', username => {
            var gameID = randomstring.generate(10);

            rooms[gameID] = {player: [username]};

            socket.emit('saveGameID', gameID);
        });
    });
}