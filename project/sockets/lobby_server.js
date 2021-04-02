var randomstring = require('randomstring');
const memeScraper = require("../meme_scraper");

global.rooms = {};

module.exports = function(io) {
    const lobby = io.of('/lobby');

    lobby.on('connection', socket => {
        
        socket.on('playSingleplayer', async data => {
            if(data.difficulty >= 0 && data.difficulty <= 3) {
                switch(data.difficulty) {
                    case 0:
                        var computername = "Easy Bot";
                        var moveMemory = 2;
                        break;
                    case 1:
                        var computername = "Medium Bot";
                        var moveMemory = 4;
                        break;
                    case 2:
                        var computername = "Hard Bot";
                        var moveMemory = 8;
                        break;
                    case 3:
                        var computername = "Expert Bot";
                        var moveMemory = 50;
                        break;
                }

                var gameID = randomstring.generate(10);
                global.rooms[gameID] = {
                    type: "singlePlayer",
                    difficulty: data.difficulty,
                    user: {name: data.username, points: 0, opened: 0},
                    computer: {name: computername, moveMemory: moveMemory, points: 0},
                    status: 0,
                    turn: 0, // TODO: Multiplayer -> Entweder Turn 0 oder 1
                    openedCards: [],
                    cardPairs: [],
                    cardImages: [],
                    foundMatches: [],
                    previousMoves: [],
                    moveQueue: []
                }

                socket.emit('saveGameID', {gameID: gameID, type: "singlePlayer", url: '/singleplayer'});
            }
        })
    });
}