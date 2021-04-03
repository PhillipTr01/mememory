const socket = io('/singleplayer');

var modal;
var game;
var backImage = "/static/images/avatar_expert_200.png";

document.addEventListener('DOMContentLoaded', function () {

    // Fill board with cards
    var board = document.getElementById("memoryTable");
    board.innerHTML = "";
    for (var index = 0; index < 66; index++) {
        var div = ` <div id="card-${index}" class="col-1 card card-size" onclick="openCard(${index}); false;"> 
                        <div class="card-back card-image"> 
                            <img src="" class="card-image">
                        </div>
                        <div class="card-front card-image"> 
                            <img src="${backImage}" class="card-image">
                        </div>    
                    </div>`;
        board.innerHTML += div;
    }

    modal = document.getElementById("cardModal");
}, false);


// Get all Memes from database
var request = new XMLHttpRequest();
request.onreadystatechange = function () {
    if (this.readyState == 4) {
        if (this.status == 200) {
            var links = JSON.parse(request.responseText);
            // Initialize Game
            socket.emit('initializingGame', {gameID: sessionStorage.getItem('gameID'), links: links});
        }
    }
}
request.open("GET", '/requests/memes');
request.send();

// Set computername on the scoreboard
socket.on('setComputername', name => {
    document.getElementById('user2Username').innerText = name;
});

// Show which player's turn it is
socket.on('highlightPlayer', data => {
    if (data.turn == 0) {
        // Highlight player1
        document.getElementById("user1Username").classList.add("fw-bold");
        document.getElementById("user2Username").classList.remove("fw-bold");
        document.getElementById("user1Username").innerHTML += `<i class="bi bi-hand-index-thumb ps-2 text-info"></i>`;
        document.getElementById("user2Username").innerHTML = data.computer;
    } else {
        // Highlight computer
        document.getElementById("user1Username").classList.remove("fw-bold");
        document.getElementById("user2Username").classList.add("fw-bold");
        document.getElementById("user1Username").innerHTML = data.user;
        document.getElementById("user2Username").innerHTML += `<i class="bi bi-hand-index-thumb ps-2 text-info"></i>`;
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
    var src = document.getElementById("card-" + id).childNodes[1].childNodes[1].src;
    document.getElementById("imgModal").src = src;
    modal.style.display = "block";
});

// Increase Points if a match was found
socket.on('increasePoints', data => {
    if (data.turn == 0) {
        document.getElementById("user1Score").innerHTML = data.points;
    } else {
        document.getElementById("user2Score").innerHTML = data.points;
    }
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
    setTimeout(() => {card2.childNodes[1].childNodes[1].src = ""}, 500);
    
    var card2 = document.getElementById("card-" + data[2]);
    card2.classList.remove("flip");
    setTimeout(() => {card2.childNodes[1].childNodes[1].src = ""}, 500);

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

function emitEndTurn() {
    socket.emit('endTurn');
};

function surrender() {
    socket.emit('surrender');
}

socket.on('getWinner', data => {
    var playButton = document.getElementById('playButton');
    var user1 = document.getElementById("user1Username");
    var user2 = document.getElementById("user2Username");

    // Visual change for winner
    if (data.winner == 0) {
        user1.innerHTML = data.user + " ";
        user2.innerHTML = data.computer;
        user1.classList.add("text-success");
        user1.innerHTML += `<i class="bi bi-trophy text-warning"></i>`;
        user2.classList.add("text-danger");
    } else {
        user1.innerHTML = data.user;
        user2.innerHTML = data.computer + " ";
        user2.classList.add("text-success");
        user2.innerHTML += `<i class="bi bi-trophy text-warning"></i>`;
        user1.classList.add("text-danger");
    }

    user1.classList.remove("fw-bold");
    user2.classList.remove("fw-bold");

    // Remove all highlights
    for(var i = 0; i < 66; i++) {
        understateCard(i);
    }

    // Change EndTurn-Button to Back to Lobby
    playButton.onclick = () => {
        window.location.href = '/lobby';
    };
    playButton.disabled = false;
    playButton.innerHTML = 'Back to Lobby';

    // Reset storage
    sessionStorage.clear();
});