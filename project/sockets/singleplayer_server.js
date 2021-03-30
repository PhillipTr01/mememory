module.exports = function (io) {

    const singlePlayer = io.of('/singleplayer');

    singlePlayer.on('connection', socket => {
        
    });
}