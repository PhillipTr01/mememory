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
                    socket.username = global.rooms[data.gameID].player1.name;

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
            if (global.rooms[data.gameID] != null) {
                socket.gameID = data.gameID;
                socket.username = data.username;
                socket.join(socket.gameID);
                global.rooms[socket.gameID].player2.name = data.username;
    
                multiPlayer.to(socket.gameID).emit('visualInitializing', {player1: global.rooms[socket.gameID].player1.name, player2: global.rooms[socket.gameID].player2.name});
                multiPlayer.to(socket.gameID).emit('highlightPlayer', {turn: global.rooms[socket.gameID].turn, player1: global.rooms[socket.gameID].player1.name, player2: global.rooms[socket.gameID].player2.name});
                checkGame(multiPlayer, socket);
            } else {
                socket.emit('noGameFound');
            }
        });

        socket.on('openCard', id => {
            if (global.rooms[socket.gameID] != null && global.rooms[socket.gameID].player2.name != '' && !global.rooms[socket.gameID].openedCards.includes(id) && !global.rooms[socket.gameID].foundMatches.includes(id)) {
                if (global.rooms[socket.gameID].openedCards.length < 2) {
                    if ((global.rooms[socket.gameID].player1.name == socket.username && global.rooms[socket.gameID].turn == 0) || 
                        (global.rooms[socket.gameID].player2.name == socket.username && global.rooms[socket.gameID].turn == 1)) {
                        global.rooms[socket.gameID].openedCards.push(id);
                        multiPlayer.to(socket.gameID).emit('turnCard', {id: id, src: global.rooms[socket.gameID].cardImages[id]});

                        if (global.rooms[socket.gameID].openedCards.length == 2) {
                            checkGame(multiPlayer, socket);
                        }
                    }
                }
            } else {
                socket.emit('zoomImage', id);
            }
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
            surrendGame(multiPlayer, socket);
        });
    });
}

function checkGame(io, socket) {
    if (socket.gameID != null) {
        // Status: 0 - Doing nothing; 1 - Checking Cards;
        // Turn: 0 - Turn of player; 1 - Turn of computer;

        // If both cards are open check if those are a match.
        if (global.rooms[socket.gameID].openedCards.length == 2 && global.rooms[socket.gameID].status < 1) {
            global.rooms[socket.gameID].status = 1;

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
        if (global.rooms[socket.gameID].turn == 0) {
            global.rooms[socket.gameID].player1.points++;
            io.to(socket.gameID).emit('increasePoints', {turn: global.rooms[socket.gameID].turn, points: global.rooms[socket.gameID].player1.points});
        } else {
            global.rooms[socket.gameID].player2.points++;
            io.to(socket.gameID).emit('increasePoints', {turn: global.rooms[socket.gameID].turn, points: global.rooms[socket.gameID].player2.points});
        }

        // Reset turn
        global.rooms[socket.gameID].openedCards = [];
        global.rooms[socket.gameID].status = 0;
    }

    return cardsMatch;
}

function endTurn(io, socket) {
    var id = global.rooms[socket.gameID].openedCards[0];
    var id2 = global.rooms[socket.gameID].openedCards[1];

    // Close both cards
    io.to(socket.gameID).emit('closeCards', {1: id, 2: id2});

    // If it's the player's turn disable the endTurn-Button so that the user can't end his turn twice
    socket.emit('disableEndTurn');

    // Switch turns
    global.rooms[socket.gameID].turn = (global.rooms[socket.gameID].turn == 1 ? 0 : 1);
    // Reset turn
    global.rooms[socket.gameID].openedCards = [];
    global.rooms[socket.gameID].status = 0;

    // Change highlight of player
    io.to(socket.gameID).emit('highlightPlayer', {turn: global.rooms[socket.gameID].turn, player1: global.rooms[socket.gameID].player1.name, player2: global.rooms[socket.gameID].player2.name});
}

function surrendGame(io, socket) {
    // Does this game exist? Is it finished?
    if(global.rooms[socket.gameID] != null && !global.rooms[socket.gameID].finished) {
        if(global.rooms[socket.gameID].player1.name == socket.username) {
            global.rooms[socket.gameID].player2.points = 50;
        } else {
            global.rooms[socket.gameID].player1.points = 50;
        }
        getWinner(io, socket);
    }
}

async function getWinner(io, socket) {
    if (global.rooms[socket.gameID].player2.name != '') {
        var player1 = await User.findOne({username: global.rooms[socket.gameID].player1.name});
        var statistic1 = await Statistic.findOne({_id: player1.statistics});
        var player2 = await User.findOne({username: global.rooms[socket.gameID].player2.name});
        var statistic2 = await Statistic.findOne({_id: player2.statistics});
        var winner;
    
        for(var i = 0; i < 66; i++) {
            io.to(socket.gameID).emit('turnCard', {id: i, src: global.rooms[socket.gameID].cardImages[i]});
        }
    
        // Change gameState to finish
        socket.finished = 1;
    
        // Change Statistic in Database
        if (global.rooms[socket.gameID].player1.points > global.rooms[socket.gameID].player2.points) {
            winner = 0;
    
            await Statistic.updateOne({_id: player1.statistics}, {multiplayerWin: (statistic1.multiplayerWin + 1)}, {runValidators: true});
            await Statistic.updateOne({_id: player2.statistics}, {multiplayerLose: (statistic2.multiplayerLose + 1)}, {runValidators: true});
    
        } else {
            winner = 1;
    
            await Statistic.updateOne({_id: player1.statistics}, {multiplayerLose: (statistic1.multiplayerLose + 1)}, {runValidators: true});
            await Statistic.updateOne({_id: player2.statistics}, {multiplayerWin: (statistic2.multiplayerWin + 1)}, {runValidators: true});
        }
        
        io.to(socket.gameID).emit('getWinner', {winner: winner, player1: global.rooms[socket.gameID].player1.name, player2: global.rooms[socket.gameID].player2.name});
    
        // Delete game
        delete global.rooms[socket.gameID];
    }
}