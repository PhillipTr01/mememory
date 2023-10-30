const socket = io('/multiplayer');

var modal;
var game;
var backImage = "/static/images/logo_small.png";

document.addEventListener('DOMContentLoaded', function () {

    // Fill board with cards
    var board = document.getElementById("memoryTable");
    board.innerHTML = "";
    for (var index = 0; index < 66; index++) {
        var div = ` <div class="card-size">
                        <div id="card-${index}" class="col-1 card pos-abs w-100 h-100" onclick="openCard(${index}); false;"> 
                            <div class="card-back card-image"> 
                                <img src="" class="card-image">
                            </div>
                            <div class="card-front card-image"> 
                                <img src="${backImage}" class="card-image">
                            </div>    
                        </div>
                    </div>`;
        board.innerHTML += div;
    }

    modal = document.getElementById("cardModal");
}, false);

if (sessionStorage.getItem("role") == "creator") {
    // Get all Memes from database
    document.getElementById('playButton').hidden = true;
    document.getElementById('startButton').hidden = false;
    document.getElementById('startButton').disabled = true;

    var request = new XMLHttpRequest();
    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {

                var links = JSON.parse(request.responseText);
                // Initialize Game
                socket.emit('initializingGame', {
                    gameID: sessionStorage.getItem('gameID'),
                    links: links
                });
            }
        }
    }
    request.open("GET", '/requests/memes');
    request.send();
} else {
    socket.emit('joinGame', {
        gameID: sessionStorage.getItem('gameID'),
        username: sessionStorage.getItem('username')
    });
}

socket.on('enableStartGame', () => {
    if (document.getElementById('startButton').disabled) {
        document.getElementById('startButton').disabled = false;
    }
});

socket.on('disableStartGame', () => {
    document.getElementById('startButton').disabled = true;
});

// Set usernames on the scoreboard
socket.on('visualInitializing', data => {
    for (var i = 1; i <= 4; i++) {
        document.getElementById(`user${i}Username`).innerText = "";
        document.getElementById(`user${i}Score`).innerText = "";
    }

    for (var i = 1; i <= data.player.length; i++) {
        document.getElementById(`user${i}Username`).innerText = data.player[i - 1].name;
        document.getElementById(`user${i}Score`).innerText = "0";
    }
    // document.getElementById('surrenderButton').disabled = false;
});

// Set usernames on the scoreboard
socket.on('watchGame', () => {
    var playButton = document.getElementById('playButton');
    var surrenderButton = document.getElementById('surrenderButton');

    surrenderButton.disabled = true;
    surrenderButton.innerHTML = 'SPECTATING GAME';
    surrenderButton.classList.remove('btn-outline-danger');
    surrenderButton.classList.add('btn-outline-secondary');

    playButton.onclick = () => {
        window.location.href = '/lobby';
    };
    playButton.disabled = false;
    playButton.innerHTML = 'Back to Lobby';
});

// Show which player's turn it is
socket.on('highlightPlayer', data => {
    for (var i = 1; i <= data.player.length; i++) {
        if (data.turn == i) {
            document.getElementById(`user${i}Username`).classList.add("fw-bold");
            document.getElementById(`user${i}Username`).innerHTML = `${data.player[i - 1].name} <i class="bi bi-hand-index-thumb ps-2 text-info"></i>`;
        } else {
            document.getElementById(`user${i}Username`).classList.remove("fw-bold");
            document.getElementById(`user${i}Username`).innerHTML = data.player[i - 1].name;
        }
    }
});

socket.on('noGameFound', () => {
    window.location.href = '/lobby';
});

function openCard(id) {
    socket.emit('openCard', id);
}

socket.on('turnCard', data => {
    var card = document.getElementById("card-" + data.id);
    card.childNodes[1].childNodes[1].src = data.src;
    card.classList.add("flip");

    // Highlighting a card - It gets bigger and gets a border
    document.getElementById("card-" + data.id).classList.add("border");
    document.getElementById("card-" + data.id).classList.add("border-3");
    document.getElementById("card-" + data.id).classList.add("zoom-card-on-turn");
});

// If the card is already open, you can zoom in to read the meme
socket.on('zoomImage', id => {
    if (document.getElementById("card-" + id).classList.contains('flip')) {
        var src = document.getElementById("card-" + id).childNodes[1].childNodes[1].src;
        document.getElementById("imgModal").src = src;
        modal.style.display = "block";
    }
});

// Increase Points if a match was found
socket.on('increasePoints', data => {
    document.getElementById(`user${data.turn}Score`).innerHTML = data.points;
});

// Remove the zoom and the border of a card (if highlighted) 
socket.on('understateCard', id => {
    understateCard(id);
});

function understateCard(id) {
    document.getElementById("card-" + id).classList.remove("zoom-card-on-turn");
    document.getElementById("card-" + id).classList.remove("border");
    document.getElementById("card-" + id).classList.remove("border-3");
}

// Close opened cards
socket.on('closeCards', data => {
    var card = document.getElementById("card-" + data[1]);
    card.classList.remove("flip");
    setTimeout(() => {
        card.childNodes[1].childNodes[1].src = ""
    }, 500);

    var card2 = document.getElementById("card-" + data[2]);
    card2.classList.remove("flip");
    setTimeout(() => {
        card2.childNodes[1].childNodes[1].src = ""
    }, 500);

    understateCard(data[1]);
    understateCard(data[2]);
});

// Activate endTurn-Button
socket.on('activateEndTurn', () => {
    document.getElementById("playButton").disabled = false;
});

// Disable endTurn-Button
socket.on('disableEndTurn', () => {
    document.getElementById("playButton").disabled = true;
});

function startGame() {
    document.getElementById('startButton').hidden = true;
    document.getElementById('playButton').hidden = false;

    socket.emit('startGame', {
        username: sessionStorage.getItem('username')
    });
}

function emitEndTurn() {
    socket.emit('endTurn');
};

function surrender() {
    socket.emit('surrender');
}

socket.on('playerSurrendered', data => {
    var userElement = document.getElementById(`user${data.playerIndex}Username`);
    var scoreElement = document.getElementById(`user${data.playerIndex}Score`);
    
    userElement.innerHTML = data.playerName;
    userElement.classList.add("text-secondary");
    scoreElement.classList.add("text-secondary");
    userElement.classList.remove("fw-bold");
});

socket.on('getWinner', data => {
    var playButton = document.getElementById('playButton');

    for (var i = 1; i < data.player.length + 1; i++) {
        var userElement = document.getElementById(`user${i}Username`);
        var scoreElement = document.getElementById(`user${i}Score`);

        if (data.winners.includes(data.player[i - 1].name)) {
            userElement.innerHTML = `${data.player[i - 1].name}  <i class="bi bi-trophy text-warning"></i>`;
            userElement.classList.add("fw-bold");
        } else {
            userElement.innerHTML = data.player[i - 1].name;
            userElement.classList.add("text-secondary");
            scoreElement.classList.add("text-secondary");
            userElement.classList.remove("fw-bold");
        }
    }

    // Remove all highlights
    for (var i = 0; i < 66; i++) {
        understateCard(i);
    }

    // Change EndTurn-Button to Back to Lobby
    playButton.onclick = () => {
        window.location.href = '/lobby';
    };
    playButton.disabled = false;
    playButton.innerHTML = 'Back to Lobby';
    document.getElementById('surrenderButton').disabled = true;

    // Reset storage
    sessionStorage.clear();
});