const {
    v4: uuidv4
} = require('uuid');

var ids = {};


try {
    module.exports = function (io) {
        io.of('/lobby').on('connection', function (socket) {

            socket.on('createLobby', lobbyData => {
                lobbyData.id = uuidv4();
                ids[lobbyData.id] = lobbyData.username;

                io.of('/lobby').emit('showLobby', lobbyData);
            });

            socket.on('deleteLobby', id => {
                var username = ids[id];

                console.log(ids);
                delete ids[id];
                io.of('/lobby').emit('removeLobby', username);
            });
        });
    };
} catch (error) {
    console.log(error);
}