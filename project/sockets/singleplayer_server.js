const User = require('../models/User');
const Statistic = require('../models/Statistic');

module.exports = function (io) {

    const singlePlayer = io.of('/singleplayer');

    singlePlayer.on('connection', socket => {
        socket.on('initializingGame', data => {
            if (global.rooms[data.gameID] != null) {
                var idArray = [],
                    linkArray = [];

                /* Fetch Memes and initialize idArray */
                for(link of data.links) {
                    linkArray.push(link.link);
                }

                for (var i = 0; i < 66; i++) {
                    idArray.push(i);
                }

                getWinner(data.gameID, socket);

                /* Assign images and card pairs to cards */
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

                    global.rooms[data.gameID].cardPairs[x] = y;
                    global.rooms[data.gameID].cardPairs[y] = x;

                    var src = linkArray[randomSourceIndex];
                    linkArray.splice(linkArray.indexOf(src), 1);

                    global.rooms[data.gameID].cardImages[x] = src;
                    global.rooms[data.gameID].cardImages[y] = src;
                }

                /* Define computer difficulty */
                for (var i = 0; i < global.rooms[data.gameID].computer.moveMemory * 2; i++) {
                    global.rooms[data.gameID].previousMoves.push(-1);
                }

                socket.emit('createBoard');
                socket.emit('setComputername', global.rooms[data.gameID].computer.name);
                socket.emit('highlightPlayer', {
                    turn: global.rooms[data.gameID].turn,
                    computer: global.rooms[data.gameID].computer.name,
                    user: global.rooms[data.gameID].user.name
                });
                socket.emit('startGame');
            } else {
                socket.emit('noGameFound');
            }
        });

        socket.on('checkGame', gameID => {
            if (global.rooms[gameID] != null) {
                // Status: 0 - Doing nothing; 1 - Computer running; 2 - Checking Cards; 3 - finished Game;

                if (global.rooms[gameID].turn == 1 && global.rooms[gameID].status == 0) {
                    global.rooms[gameID].status = 1;
                    computerLogic(gameID, socket);
                }

                if (global.rooms[gameID].openedCards.length == 2 && global.rooms[gameID].status < 2) {
                    global.rooms[gameID].status = 2;

                    if (!checkCards(gameID, socket)) {
                        if (global.rooms[gameID].turn == 0) {
                            socket.emit('activateEndTurn');
                        } else {
                            setTimeout(() => endTurn(gameID, socket), 2000);
                        }
                    }
                }

                if (global.rooms[gameID].foundMatches.length == 66) {
                    getWinner(gameID, socket);
                }
            }
        });

        socket.on('openCard', data => {
            if (!global.rooms[data.gameID].openedCards.includes(data.id) && !global.rooms[data.gameID].foundMatches.includes(data.id)) {
                if (global.rooms[data.gameID].turn == 0 && global.rooms[data.gameID].openedCards.length < 2) {
                    global.rooms[data.gameID].openedCards.push(data.id);
                    socket.emit('turnCard', {
                        id: data.id,
                        src: global.rooms[data.gameID].cardImages[data.id]
                    });
                }
            } else {
                socket.emit('zoomImage', data.id);
            }
        });

        socket.on('endTurn', gameID => {
            endTurn(gameID, socket);
        });

        socket.on('disconnect', () => {

        });
    });
}

function endTurn(gameID, socket) {
    var id = global.rooms[gameID].openedCards[0];
    var id2 = global.rooms[gameID].openedCards[1];

    socket.emit('closeCards', {1: id, 2: id2});

    if (global.rooms[gameID].turn == 0) {
        socket.emit('disableEndTurn');
    }

    computerCheckForMatch(gameID, id);
    computerCheckForMatch(gameID, id2);

    global.rooms[gameID].previousMoves.pop();
    global.rooms[gameID].previousMoves.pop();
    global.rooms[gameID].previousMoves.unshift(id);
    global.rooms[gameID].previousMoves.unshift(id2);
    global.rooms[gameID].turn = (global.rooms[gameID].turn == 1 ? 0 : 1);
    global.rooms[gameID].openedCards = [];
    global.rooms[gameID].status = 0;

    socket.emit('highlightPlayer', {
        turn: global.rooms[gameID].turn,
        computer: global.rooms[gameID].computer.name,
        user: global.rooms[gameID].user.name
    });
}

function computerLogic(gameID, socket) {
    var id = -1;
    var id2 = -1;

    if (global.rooms[gameID].moveQueue.length) {
        id = global.rooms[gameID].moveQueue.pop();
        id2 = global.rooms[gameID].moveQueue.pop();
    } else {

        for (var i = 0; i < global.rooms[gameID].previousMoves.length; i++) {
            var pre = global.rooms[gameID].previousMoves;
            var pairs = global.rooms[gameID].cardPairs;
            var foundMatches = global.rooms[gameID].foundMatches;
            if (pre.includes(pairs[pre[i]]) && !foundMatches.includes(pairs[pre[i]]) && !foundMatches.includes(pre[i])) {
                id = pre[i];
                id2 = pairs[pre[i]];
            }
        }

        if(id == -1 && id2 == -1) {
            id = getRandomCard(gameID);
            id2 = global.rooms[gameID].cardPairs[id];
    
            if (!global.rooms[gameID].previousMoves.includes(id2)) {
                do {
                    id2 = getRandomCard(gameID);
                } while (id == id2);
            }
        }
    }

    global.rooms[gameID].openedCards.push(id);
    setTimeout(() => socket.emit('turnCard', {
        id: id,
        src: global.rooms[gameID].cardImages[id]
    }), 500);
    setTimeout(() => socket.emit('turnCard', {
        id: id2,
        src: global.rooms[gameID].cardImages[id2]
    }), 1000);
    setTimeout(() => global.rooms[gameID].openedCards.push(id2), 2000);
}

function computerCheckForMatch(gameID, id) {
    var match = global.rooms[gameID].cardPairs;
    if (global.rooms[gameID].previousMoves.includes(match)) {
        global.rooms[gameID].moveQueue.push(id);
        global.rooms[gameID].moveQueue.push(match);
    }
}

function checkCards(gameID, socket) {
    var cardsMatch = global.rooms[gameID].cardPairs[global.rooms[gameID].openedCards[0]] == global.rooms[gameID].openedCards[1];

    if (cardsMatch) {
        global.rooms[gameID].foundMatches.push(global.rooms[gameID].openedCards[0]);
        global.rooms[gameID].foundMatches.push(global.rooms[gameID].openedCards[1]);

        if (global.rooms[gameID].turn == 0) {
            global.rooms[gameID].user.points++;
            socket.emit('increasePoints', {
                turn: global.rooms[gameID].turn,
                points: global.rooms[gameID].user.points
            });
        } else {
            global.rooms[gameID].computer.points++;
            socket.emit('increasePoints', {
                turn: global.rooms[gameID].turn,
                points: global.rooms[gameID].computer.points
            });
        }

        global.rooms[gameID].openedCards = [];
        global.rooms[gameID].status = 0;
    }

    return cardsMatch;
}

function getRandomCard(gameID) {
    do {
        id = Math.floor(Math.random() * 66);
    } while (global.rooms[gameID].foundMatches.includes(id));

    return id;
}

async function getWinner(gameID, socket) {

    var user = await User.findOne({username: global.rooms[gameID].user.name});
    var statistic = await Statistic.findOne({_id: user.statistics});
    var winner;
    var body;

    if (global.rooms[gameID].user.points > global.rooms[gameID].computer.points) {
        winner = 0;

        switch (global.rooms[gameID].difficulty) {
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

        switch (global.rooms[gameID].difficulty) {
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
    socket.emit('getWinner', {winner: winner, computer: global.rooms[gameID].computer.name, user: global.rooms[gameID].user.name});
    delete global.rooms[gameID];
}