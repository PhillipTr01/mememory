const User = require('../models/User');
const Statistic = require('../models/Statistic');

module.exports = function (io) {

    const multiPlayer = io.of('/multiplayer');

    multiPlayer.on('connection', socket => {
        socket.on('initializingGame', data => {
            // Check if game exists
            if (global.rooms[data.gameID] != null) {
                socket.gameID = data.gameID;
                socket.join(socket.gameID);
                socket.username = global.rooms[data.gameID].player[0].name;

                var idArray = [],
                    linkArray = [];

                // Fetch Memes and initialize idArray
                for (link of data.links) {
                    linkArray.push(link.link);
                }

                for (var i = 0; i < 66; i++) {
                    idArray.push(i);
                }

                // Assign images and card pairs to cards
                while (idArray.length >= 2) {
                    var randomIndex = Math.floor(Math.random() * idArray.length);
                    do {
                        var randomIndex2 = Math.floor(Math.random() * idArray.length);
                    } while (randomIndex == randomIndex2);
                    var randomSourceIndex = Math.floor(Math.random() * linkArray.length);

                    var x = idArray[randomIndex];
                    var y = idArray[randomIndex2];

                    idArray.splice(idArray.indexOf(x), 1);
                    idArray.splice(idArray.indexOf(y), 1);

                    global.rooms[socket.gameID].cardPairs[x] = y;
                    global.rooms[socket.gameID].cardPairs[y] = x;

                    var src = linkArray[randomSourceIndex];
                    linkArray.splice(linkArray.indexOf(src), 1);

                    global.rooms[socket.gameID].cardImages[x] = src;
                    global.rooms[socket.gameID].cardImages[y] = src;
                }
            } else {
                socket.emit('noGameFound');
            }
        });

        socket.on('joinGame', data => {
            if (global.rooms[data.gameID] == null || global.rooms[data.gameID].player.some(obj => obj.name === data.username)) {
                socket.emit('noGameFound');
                return;
            }

            if (global.rooms[data.gameID].player.length < 5 && global.rooms[data.gameID].status == 0) {
                multiPlayer.to(data.gameID).emit('enableStartGame');
                socket.gameID = data.gameID;
                socket.username = data.username;
                socket.join(data.gameID);
                global.rooms[data.gameID].player.push({
                    name: data.username,
                    points: 0
                });
                global.rooms[data.gameID].activePlayers.push(global.rooms[data.gameID].player.length)
            } else {
                socket.join(data.gameID);
                socket.emit('watchGame');
            }

            multiPlayer.to(data.gameID).emit('visualInitializing', {
                player: global.rooms[data.gameID].player
            });

            multiPlayer.to(data.gameID).emit('highlightPlayer', {
                turn: global.rooms[data.gameID].turn,
                player: global.rooms[data.gameID].player
            })
        });


        socket.on('startGame', data => {
            if (global.rooms[socket.gameID] != null && global.rooms[socket.gameID].player[0].name == data.username && global.rooms[socket.gameID].status == 0) {
                global.rooms[socket.gameID].turn = Math.floor(Math.random() * global.rooms[socket.gameID].player.length) + 1;

                global.rooms[socket.gameID].status = 1;
                multiPlayer.to(socket.gameID).emit('highlightPlayer', {
                    turn: global.rooms[socket.gameID].turn,
                    player: global.rooms[socket.gameID].player
                })
            }
        });

        socket.on('openCard', id => {
            if (global.rooms[socket.gameID] != null && global.rooms[socket.gameID].status == 1 && !global.rooms[socket.gameID].openedCards.includes(id) && !global.rooms[socket.gameID].foundMatches.includes(id)) {
                if (global.rooms[socket.gameID].openedCards.length < 2) {
                    var turn = global.rooms[socket.gameID].turn;
                    if ((global.rooms[socket.gameID].player[turn - 1].name == socket.username)) {
                        global.rooms[socket.gameID].openedCards.push(id);
                        multiPlayer.to(socket.gameID).emit('turnCard', {
                            id: id,
                            src: global.rooms[socket.gameID].cardImages[id]
                        });

                        checkGame(multiPlayer, socket);
                    }
                }
            } else {
                socket.emit('zoomImage', id);
            }
        });

        socket.on('sendChatMessage', data => {
            socket.broadcast.to(socket.gameID).emit('receiveChatMessage', {
                name: socket.username,
                message: data.message
            })
        });

        // endTurn
        socket.on('endTurn', () => {
            endTurn(multiPlayer, socket);
        });

        // surrender
        socket.on('surrender', () => {
            surrendGame(multiPlayer, socket);
        });

        // disconnect
        socket.on('disconnect', () => {
            leaveGame(multiPlayer, socket);
        });
    });
}

function checkGame(io, socket) {
    if (socket.gameID != null) {
        // checkingCards: 0 - Doing nothing; 1 - Checking Cards;

        // If both cards are open check if those are a match.
        if (global.rooms[socket.gameID].openedCards.length == 2 && !global.rooms[socket.gameID].checkingCards) {
            global.rooms[socket.gameID].checkingCards = true;

            if (!checkCards(io, socket)) {
                socket.emit('activateEndTurn');
            }
        }

        // Check for winner
        if (global.rooms[socket.gameID].foundMatches.length == 66) {
            getWinner(io, socket);
        }
    }
}

function checkCards(io, socket) {
    var id = global.rooms[socket.gameID].openedCards[0];
    var id2 = global.rooms[socket.gameID].openedCards[1];
    var turn = global.rooms[socket.gameID].turn;

    // Check if cards match
    var cardsMatch = global.rooms[socket.gameID].cardPairs[id] == id2;

    if (cardsMatch) {

        // Push to foundMatches -> So it can't be opened again
        global.rooms[socket.gameID].foundMatches.push(id);
        global.rooms[socket.gameID].foundMatches.push(id2);

        // understateCard - remove Zoom and Border on cards
        setTimeout(() => io.to(socket.gameID).emit('understateCard', id), 500);
        setTimeout(() => io.to(socket.gameID).emit('understateCard', id2), 500);

        // Increase Points
        global.rooms[socket.gameID].player[turn - 1].points++;
        io.to(socket.gameID).emit('increasePoints', {
            turn: turn,
            points: global.rooms[socket.gameID].player[turn - 1].points
        });

        // Reset turn
        global.rooms[socket.gameID].openedCards = [];
        global.rooms[socket.gameID].checkingCards = false;
    }

    return cardsMatch;
}

function endTurn(io, socket) {
    var id = global.rooms[socket.gameID].openedCards[0];
    var id2 = global.rooms[socket.gameID].openedCards[1];
    var turn = global.rooms[socket.gameID].turn;
    var activePlayers = global.rooms[socket.gameID].activePlayers;

    // Close both cards
    io.to(socket.gameID).emit('closeCards', {
        1: id,
        2: id2
    });

    // If it's the player's turn disable the endTurn-Button so that the user can't end his turn twice
    socket.emit('disableEndTurn'); 

    // Switch turns
    global.rooms[socket.gameID].turn = activePlayers[(activePlayers.indexOf(turn) + 1) % activePlayers.length];

    // Reset turn
    global.rooms[socket.gameID].openedCards = [];
    global.rooms[socket.gameID].checkingCards = false;

    // Change highlight of player
    io.to(socket.gameID).emit('highlightPlayer', {
        turn: global.rooms[socket.gameID].turn,
        player: global.rooms[socket.gameID].player
    });
}

function surrendGame(io, socket) {
    // Does this game exist? Is it finished?
    // if (global.rooms[socket.gameID] != null && global.rooms[socket.gameID].status < 2) {
    //     if (global.rooms[socket.gameID].player1.name == socket.username) {
    //         global.rooms[socket.gameID].player2.points = 50;
    //     } else {
    //         global.rooms[socket.gameID].player1.points = 50;
    //     }
    //     getWinner(io, socket);
    // }
}

async function leaveGame(io, socket) {
    if (global.rooms[socket.gameID] == null || !global.rooms[socket.gameID].player.some(obj => obj.name === socket.username)) {
        return
    }

    var playerIndex = global.rooms[socket.gameID].player.findIndex(obj => obj.name === socket.username)
    var activePlayers = global.rooms[socket.gameID].activePlayers;
    
    if (global.rooms[socket.gameID].status == 0) { 
        global.rooms[socket.gameID].player.splice(playerIndex, 1);
        activePlayers.splice(playerIndex, 1);

        if (activePlayers.length == 1) {
            io.to(socket.gameID).emit('disableStartGame');
        } else if (activePlayers.length == 0) {
            // Delete game
            delete global.rooms[socket.gameID];
            return;
        }

        for (var i = playerIndex; i < activePlayers.length; i++) {
            activePlayers[i] = activePlayers[i] - 1;
        }

        io.to(socket.gameID).emit('visualInitializing', {
            player: global.rooms[socket.gameID].player,
            activePlayers: activePlayers
        });
    } else if (global.rooms[socket.gameID].status == 1) {
        activePlayers.splice(playerIndex, 1);

        if (global.rooms[socket.gameID].turn == (playerIndex + 1)) {  
            endTurn(io, socket);
        }

        if (global.rooms[socket.gameID].activePlayers.length == 1) {
            getWinner(io, socket);
        }

        io.to(socket.gameID).emit("playerSurrendered", {
            playerName: socket.username,
            playerIndex: playerIndex + 1
        })
    }
}

async function getWinner(io, socket) {
    if (global.rooms[socket.gameID].status == 1) {
        global.rooms[socket.gameID].status = 2;
        // check if not one of the leavers get the win
        var highestPoints = -1;
        var winners = [];

        for (var i = 1; i <= global.rooms[socket.gameID].player.length; i++) {
            player = global.rooms[socket.gameID].player[i - 1];

            if (global.rooms[socket.gameID].activePlayers.includes(i))
                if (player.points > highestPoints) {
                    highestPoints = player.points;
                    winners = [player.name];
                } else if (player.points === highestPoints) {
                    winners.push(player.name);
                }
        }

        for (var i = 0; i < 66; i++) {
            io.to(socket.gameID).emit('turnCard', {
                id: i,
                src: global.rooms[socket.gameID].cardImages[i]
            });
        }

        for (var i = 1; i <= global.rooms[socket.gameID].player.length; i++) {
            var playerName = global.rooms[socket.gameID].player[i - 1].name;
            var playerObject = await User.findOne({
                username: playerName
            });
            var playerStatistic = await Statistic.findOne({
                _id: playerObject.statistics
            })

            if (winners.includes(playerName)) {
                await Statistic.updateOne({
                    _id: playerObject.statistics
                }, {
                    multiplayerWin: (playerStatistic.multiplayerWin + 1)
                }, {
                    runValidators: true
                });
            } else {
                await Statistic.updateOne({
                    _id: playerObject.statistics
                }, {
                    multiplayerLose: (playerStatistic.multiplayerLose + 1)
                }, {
                    runValidators: true
                });
            }
        }

        io.to(socket.gameID).emit('getWinner', {
            winners: winners,
            player: global.rooms[socket.gameID].player
        });

        // Delete game
        delete global.rooms[socket.gameID];
    }
}