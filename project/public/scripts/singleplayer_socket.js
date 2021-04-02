const socket = io('/singleplayer');

var modal;
var game;
var backImage = "/static/images/avatar_expert_200.png";

document.addEventListener('DOMContentLoaded', function () {
    modal = document.getElementById("cardModal");
}, false);

var request = new XMLHttpRequest();
request.onreadystatechange = function () {
    if (this.readyState == 4) {
        if (this.status == 200) {
            var links = JSON.parse(request.responseText);
            socket.emit('initializingGame', {gameID: sessionStorage.getItem('gameID'), links: links});
        }
    }
}
request.open("GET", '/requests/memes');
request.send();

socket.on('createBoard', () => {
    var board = document.getElementById("memoryTable");
    // Clear table first
    board.innerHTML = "";
    // Add all 66 cards
    for (var index = 0; index < 66; index++) {
        // Add div and classes
        var div = ` <div id="card-${index}" class="col-1 card card-size" onclick="openCard(${index}); false;"> 
                        <div class="card-back card-image"> 
                            <img src="" class="card-image">
                        </div>
                        <div class="card-front card-image"> 
                            <img src="${backImage}" class="card-image">
                        </div>    
                    </div>`;
        // Add to html
        board.innerHTML += div;
    }
});

socket.on('setComputername', name => {
    document.getElementById('user2Username').innerText = name;
});

socket.on('highlightPlayer', data => {
    if (data.turn == 0) {
        // Highlight player1 -> bold and arrow
        document.getElementById("user1Username").classList.add("fw-bold");
        document.getElementById("user2Username").classList.remove("fw-bold");
        document.getElementById("user1Username").innerHTML += `<i class="bi bi-hand-index-thumb ps-2 text-info"></i>`;
        document.getElementById("user2Username").innerHTML = data.computer;
    } else {
        // Highlight player2 - bold and arrow
        document.getElementById("user1Username").classList.remove("fw-bold");
        document.getElementById("user2Username").classList.add("fw-bold");
        document.getElementById("user1Username").innerHTML = data.user;
        document.getElementById("user2Username").innerHTML += `<i class="bi bi-hand-index-thumb ps-2 text-info"></i>`;
    }
});

socket.on('turnCard', data => {
    var card = document.getElementById("card-" + data.id);
    card.childNodes[1].childNodes[1].src = data.src;
    card.classList.add("flip");
});

socket.on('closeCards', data => {
    var card = document.getElementById("card-" + data[1]);
    card.classList.remove("flip");
    setTimeout(() => {card2.childNodes[1].childNodes[1].src = ""}, 500);
    
    var card2 = document.getElementById("card-" + data[2]);
    card2.classList.remove("flip");
    setTimeout(() => {card2.childNodes[1].childNodes[1].src = ""}, 500);
});

function checkGame() {
    socket.emit('checkGame', sessionStorage.getItem('gameID'));
}

socket.on('startGame', () => {
    game = setInterval(checkGame, 100);
});

function openCard(id) {
    socket.emit('openCard', {gameID: sessionStorage.getItem('gameID'), id: id});
}

socket.on('zoomImage', id => {
    var src = document.getElementById("card-" + id).childNodes[1].childNodes[1].src;
    document.getElementById("imgModal").src = src;
    modal.style.display = "block";
});

socket.on('activateEndTurn', () => {
    document.getElementById("playButton").disabled = false;
});

socket.on('disableEndTurn', () => {
    document.getElementById("playButton").disabled = true;
});

function emitEndTurn() {
    socket.emit('endTurn', sessionStorage.getItem('gameID'));
};

socket.on('increasePoints', data => {
    if (data.turn == 0) {
        document.getElementById("user1Score").innerHTML = data.points;
    } else {
        document.getElementById("user2Score").innerHTML = data.points;
    }
});

socket.on('noGameFound', () => {
    window.location.href = '/lobby';
});

socket.on('getWinner', data => {

    if (data.winner == 0) {
        document.getElementById("user1Username").innerHTML = data.user + " ";
        document.getElementById("user2Username").innerHTML = data.computer;
        document.getElementById("user1Username").classList.add("text-success");
        document.getElementById("user1Username").innerHTML += `<i class="bi bi-trophy text-warning"></i>`;
        document.getElementById("user2Username").classList.add("text-danger");
    } else {
        document.getElementById("user1Username").innerHTML = data.user;
        document.getElementById("user2Username").innerHTML = data.computer + " ";
        document.getElementById("user2Username").classList.add("text-success");
        document.getElementById("user2Username").innerHTML += `<i class="bi bi-trophy text-warning"></i>`;
        document.getElementById("user1Username").classList.add("text-danger");
    }
    // Change End Turn Button to Leave (-> To Lobby)

    sessionStorage.clear();
    clearInterval(game);
});