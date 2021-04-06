const User = require('../models/User');
const Statistic = require('../models/Statistic');

module.exports = function (io) {

    const singlePlayer = io.of('/singleplayer');

    singlePlayer.on('connection', socket => {
        socket.on('initializingGame', data => {
            // Check if game exists
            if (global.rooms[data.gameID] != null) {
                socket.gameID = data.gameID;
                socket.difficulty = global.rooms[data.gameID].difficulty;
                socket.user = {name: global.rooms[data.gameID].username, points: 0};
                socket.computer = {name: global.rooms[data.gameID].computername, moveMemory: global.rooms[data.gameID].moveMemory, points: 0};
                socket.status = 0;
                socket.turn = 0;
                socket.finished = 0;
                socket.openedCards = [];
                socket.cardPairs = [];
                socket.cardImages = [];
                socket.foundMatches = [];
                socket.previousMoves = [];
                
                var idArray = [],
                    linkArray = [];

                // Fetch Memes and initialize idArray
                for(link of data.links) {
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

                    socket.cardPairs[x] = y;
                    socket.cardPairs[y] = x;

                    var src = linkArray[randomSourceIndex];
                    linkArray.splice(linkArray.indexOf(src), 1);

                    socket.cardImages[x] = src;
                    socket.cardImages[y] = src;
                }

                // Define length of previous moves. It shows how many cards the computer can remember.
                for (var i = 0; i < socket.computer.moveMemory * 2; i++) {
                    socket.previousMoves.push(-1);
                }

                socket.emit('setComputername', socket.computer.name);
                socket.emit('highlightPlayer', {turn: socket.turn, computer: socket.computer.name, user: socket.user.name});
                checkGame(socket);
            } else {
                socket.emit('noGameFound');
            }
        });

        socket.on('openCard', id => {
            if (socket.gameID != null && !socket.openedCards.includes(id) && !socket.foundMatches.includes(id)) {
                if (socket.turn == 0 && socket.openedCards.length < 2) {
                    socket.openedCards.push(id);
                    socket.emit('turnCard', {id: id, src: socket.cardImages[id]});
                }
            } else {
                socket.emit('zoomImage', id);
            }
        });

        // endTurn
        socket.on('endTurn', () => {
            endTurn(socket);
        });

        // surrender
        socket.on('surrender', () => {
            for(var i = 0; i < 66; i++) {
                socket.emit('turnCard', {id: i, src: socket.cardImages[i]});
            }
            
            surrendGame(socket);
        });

        // disconnect
        socket.on('disconnect', () => { 
            surrendGame(socket);
        });
    });
}

function checkGame(socket) {
    socket.interval = setInterval(() => {
        if (socket.gameID != null) {
            // Status: 0 - Doing nothing; 1 - Computer running; 2 - Checking Cards;
            // Turn: 0 - Turn of player; 1 - Turn of computer;
    
            if (socket.turn == 1 && socket.status == 0) {
                // Change status so that socket doesn't call the computerLogic twice (or more).
                socket.status = 1;
                computerLogic(socket);
            }
    
            // If both cards are open check if those are a match.
            if (socket.openedCards.length == 2 && socket.status < 2) {
                socket.status = 2;
    
                if (!checkCards(socket)) {
                    // If it's the player's turn activate endTurn-Button, so that he can manually end his turn. 
                    if (socket.turn == 0) {
                        socket.emit('activateEndTurn');
                    } else {
                        // Computer automatically ends his turn after 2 seconds.
                        setTimeout(() => endTurn(socket), 2000);
                    }
                }
            }
    
            // Check for winner
            if (socket.foundMatches.length == 66) {
                getWinner(socket);
            }
        }
    }, 100);
}


function computerLogic(socket) {
    var id = -1;
    var id2 = -1;

    // Check if there is a match in previousMoves
    for (var i = 0; i < socket.previousMoves.length; i++) {
        var pre = socket.previousMoves;
        var pairs = socket.cardPairs;
        var foundMatches = socket.foundMatches;
        if (pre.includes(pairs[pre[i]]) && !foundMatches.includes(pairs[pre[i]]) && !foundMatches.includes(pre[i])) {
            id = pre[i];
            id2 = pairs[pre[i]];
        }
    }

    if(id == -1 && id2 == -1) {
        // Get random card -> if pair is in previousMoves open it -> if not get another random card.
        id = getRandomCard(socket);
        id2 = socket.cardPairs[id];

        if (!socket.previousMoves.includes(id2)) {
            do {
                id2 = getRandomCard(socket);
            } while (id == id2);
        }
    }

    // Push cards to openedCards, so that they get checked in checkGame-method
    socket.openedCards.push(id);
    setTimeout(() => socket.emit('turnCard', {id: id, src: socket.cardImages[id]}), 1250);
    setTimeout(() => socket.emit('turnCard', {id: id2, src: socket.cardImages[id2]}), 1750);
    setTimeout(() => socket.openedCards.push(id2), 2250);
}

function getRandomCard(socket) {
    do {
        // Get random card which wasn't opened (in computer memory) yet and haven't been found already
        var id = Math.floor(Math.random() * 66);
    } while (socket.foundMatches.includes(id) || socket.previousMoves.includes(id));

    return id;
}

function checkCards(socket) {
    var id = socket.openedCards[0];
    var id2 = socket.openedCards[1];

    // Check if cards match
    var cardsMatch = socket.cardPairs[id] == id2;

    if (cardsMatch) {

        // Push to foundMatches -> So it can't be opened again
        socket.foundMatches.push(id);
        socket.foundMatches.push(id2);

        // understateCard - remove Zoom and Border on cards
        setTimeout(() => socket.emit('understateCard', id), 500);
        setTimeout(() => socket.emit('understateCard', id2), 500);

        // Increase Points
        if (socket.turn == 0) {
            socket.user.points++;
            socket.emit('increasePoints', {turn: socket.turn, points: socket.user.points});
        } else {
            socket.computer.points++;
            socket.emit('increasePoints', {turn: socket.turn, points: socket.computer.points});
        }

        // Reset turn
        socket.openedCards = [];
        socket.status = 0;
    }

    // Push last 2 cards to previousMoves
    socket.previousMoves.pop();
    socket.previousMoves.pop();
    socket.previousMoves.unshift(id);
    socket.previousMoves.unshift(id2);

    return cardsMatch;
}

function endTurn(socket) {
    var id = socket.openedCards[0];
    var id2 = socket.openedCards[1];

    // Close both cards
    if (!socket.finished) {
        socket.emit('closeCards', {1: id, 2: id2});
    }
    
    // If it's the player's turn disable the endTurn-Button so that the user can't end his turn twice
    if (socket.turn == 0) {
        socket.emit('disableEndTurn');
    }

    // Switch turns
    socket.turn = (socket.turn == 1 ? 0 : 1);
    // Reset turn
    socket.openedCards = [];
    socket.status = 0;

    // Change highlight of player
    socket.emit('highlightPlayer', {turn: socket.turn, computer: socket.computer.name, user: socket.user.name});
}

function surrendGame(socket) {
    // Does this game exist? Is it finished?
    if(socket.gameID != null && !socket.finished) {
        // Set points above possible range. => No need to implement surrend function, if you declare computer as winner.
        socket.computer.points = 50;
        getWinner(socket);
    }
}

async function getWinner(socket) {
    var user = await User.findOne({username: socket.user.name});
    var statistic = await Statistic.findOne({_id: user.statistics});
    var winner;
    var body;

    // Change gameState to finish
    socket.finished = 1;

    // Change Statistic in Database
    if (socket.user.points > socket.computer.points) {
        winner = 0;

        switch (socket.difficulty) {
            case 0:
                body = {easyWin: (statistic.easyWin + 1)};
                break;
            case 1:
                body = {mediumWin: (statistic.mediumWin + 1)};
                break;
            case 2:
                body = {hardWin: (statistic.hardWin + 1)};
                break;
            case 3:
                body = {expertWin: (statistic.expertWin + 1)};
                break;
        }
    } else {
        winner = 1;

        switch (socket.difficulty) {
            case 0:
                body = {easyLose: (statistic.easyLose + 1)};
                break;
            case 1:
                body = {mediumLose: (statistic.mediumLose + 1)};
                break;
            case 2:
                body = {hardLose: (statistic.hardLose + 1)};
                break;
            case 3:
                body = {expertLose: (statistic.expertLose + 1)};
                break;
        }
    }

    await Statistic.updateOne({_id: user.statistics}, body, {runValidators: true});
    socket.emit('getWinner', {winner: winner, computer: socket.computer.name, user: socket.user.name});

    // Delete game
    delete global.rooms[socket.gameID];
    delete socket.gameID;
    clearInterval(socket.interval);
}