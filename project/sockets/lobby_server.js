var randomstring = require('randomstring');

global.rooms = {};

module.exports = function (io) {
    const lobby = io.of('/lobby');

    lobby.on('connection', socket => {
        socket.on('playSingleplayer', data => {

            // Check if difficulty is in range
            if (data.difficulty >= 0 && data.difficulty <= 3) {

                // Assign Name & how much the computer can remember
                switch (data.difficulty) {
                    case 0:
                        var computername = "Easy Bot";
                        var moveMemory = 3;
                        break;
                    case 1:
                        var computername = "Medium Bot";
                        var moveMemory = 7;
                        break;
                    case 2:
                        var computername = "Hard Bot";
                        var moveMemory = 12;
                        break;
                    case 3:
                        var computername = "Expert Bot";
                        var moveMemory = 50;
                        break;
                }

                // Randomstring of 10 Chars
                var gameID = randomstring.generate(10);

                // Save Game to rooms
                global.rooms[gameID] = {
                    difficulty: data.difficulty,
                    username: data.username,
                    computername: computername,
                    moveMemory: moveMemory,
                }

                socket.emit('saveGameID', {gameID: gameID, url: '/singleplayer'});
            }
        });

        socket.on('playMultiplayer', username => {

            // Randomstring of 10 Chars
            var gameID = randomstring.generate(10);

            // Save Game to rooms
            global.rooms[gameID] = {
                player: [{name: username, points: 0}],
                activePlayers: [1],
                checkingCards: false,
                status: 0,
                turn: 0,
                openedCards: [],
                cardPairs: [],
                cardImages: [],
                foundMatches: [],
                cardCounter: Array(66).fill(0)
            }

            socket.emit('saveGameID', {gameID: gameID, url: '/play'});
        });
        
        socket.on('joinMultiplayer', gameID => {
            socket.emit('saveGameID', {gameID: gameID, url: '/play'});
        });
    });
}