module.exports = function (io) {

    const multiPlayer = io.of('/multiplayer');

    multiPlayer.on('connection', socket => {
        
    });
}