var username1;
var username2 = "Opponent";
var modal;

// after creation 
document.addEventListener('DOMContentLoaded', function () {
    // setting correct username
    setUsername();

    // setting memory cards
    createMemoryField();

    // getting the modal
    modal = document.getElementById("cardModal");

}, false);

function startLobbyPage() {
    // stay on site
    // window.location.href = "/lobby";
    return;
}

function startScoreboardPage() {
    window.location.href = "/home";
    return;
}

function startProfilePage() {
    window.location.href = "/user";
    return;
}

function startSettingsPage() {
    return;
    // TODO add Settings Page
}

function logoutUser() {
    var request = new XMLHttpRequest();

    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                window.location.href = "/";
            }
        }
    }

    request.open('GET', '/requests/authentication/logout');
    request.send();
    return;
}

function setUsername() {
    var request = new XMLHttpRequest();

    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                username1 = JSON.parse(this.responseText).username;
                document.getElementById('username').innerText = username1;
                document.getElementById('user1Username').innerText = username1;
                document.getElementById('user2Username').innerText = "Opponent";
            }
        }
    }

    request.open('GET', '/requests/user/username');
    request.send();
}

// local vars
var cardTurned = new Array(66).fill(false);
var cardAlreadyRevealed = new Array(66).fill(false);
var backImage = "static/images/avatar_expert_200.png";

//server and local
var player1TurnClient = true;
var player1PointsClient = 0;
var player2PointsClient = 0;
var openCardsClient = 0;

function createMemoryField() {
    // create arrays on server
    initializeMemoryLogik();

    // initialize the cards
    var table = document.getElementById("memoryTable");

    // clear table first
    table.innerHTML = "";

    // add all 66 cards
    for (var index = 0; index < 66; index++) {

        // add div and classes
        var div = ` <div id="card-${index}" class="col-1 card card-size" onclick="clickCard(${index}); false;"> 
                        <div class="card-back card-image"> 
                            <img src="" class="card-image">
                        </div>
                        <div class="card-front card-image"> 
                            <img src="${backImage}" class="card-image">
                        </div>    
                    </div>`;

        // add to html
        table.innerHTML += div;
    }
}

function clickCard(id) {
    console.log("clicked index: " + id);

    // check if the card is already revealed
    if (!cardTurned[id]) {

        // turning the card around | only if it is the turn of the player
        // and turn only max 2 cards
        if (player1TurnClient && getOpenCardsServer() < 2) {

            turnCard(id);

        } // else: it is not your turn you shall not click

    } else {
        // if the card is already revealed it will zoom bigger on click
        // get the src from the card
        var src = document.getElementById("card-" + id).childNodes[1].childNodes[1].src;

        // add it to the modal 
        document.getElementById("imgModal").src = src;

        // show the modal
        modal.style.display = "block";
    }

}

function turnCardPlayer2(id, src) {
    console.log("turning card: " + id);

    // get card by id
    var card = document.getElementById("card-" + id);

    // add source to image
    card.childNodes[1].childNodes[1].src = src;

    // turn card
    card.classList.add("flip");

    // card is turned
    cardTurned[id] = true;

    // add to already revealed without Modaing?
    cardAlreadyRevealed[id] = true;

}

function turnCard(id) {
    console.log("turning card: " + id);

    // get card by id
    var card = document.getElementById("card-" + id);

    // get image Link from Socket
    src = socketGetSourceForId(id)

    // add source to image
    card.childNodes[1].childNodes[1].src = src;

    // turn card
    card.classList.add("flip");

    // card is turned
    cardTurned[id] = true;

    if (!cardAlreadyRevealed[id]) {
        // if the card wasn't already revealed -> zoom in for about 5 seconds 

        // add it to the modal 
        document.getElementById("imgModal").src = src;

        // show the modal
        modal.style.display = "block";

        // delete after 2 seconds again
        setTimeout(() => closeCardModal(), 2000);

        // change array
        cardAlreadyRevealed[id] = true;
    }

}


// if they disable this function, they won't lose the image shown - not optimal
function turnCardBack(id) {
    console.log("turning card back: " + id);

    // get card by id
    var card = document.getElementById("card-" + id);

    // flip card back
    card.classList.remove("flip");

    // delete source
    card.childNodes[1].childNodes[1].src = "";

    // card is turned back
    cardTurned[id] = false;
}

function increasePlayer1ScoreClient() {
    console.log("point player one");

    player1PointsClient++;
    document.getElementById("user1Score").innerHTML = player1PointsClient;
}

function increasePlayer2ScoreClient() {
    console.log("point player two");

    player2PointsClient++;
    document.getElementById("user2Score").innerHTML = player2PointsClient;
}

function player1WonClient() {
    console.log("player one won");

    document.getElementById("user1Username").classList.add("text-success");
    document.getElementById("user1Username").innerHTML += `<i class="bi bi-trophy text-warning"></i>`;
    document.getElementById("user2Username").classList.add("text-danger");
    // TODO some more stuff like a pop up
    // tell him the point is added 
    // add back to lobby button - maybe change surrender
}

function player2WonClient() {
    console.log("player two won");

    document.getElementById("user2Username").classList.add("text-success");
    document.getElementById("user2Username").innerHTML += `<i class="bi bi-trophy text-warning"></i>`;
    document.getElementById("user1Username").classList.add("text-danger");
    // TODO some more stuff like a pop up
}

function highlightPlayer1() {
    console.log("player one on turn");
    // highlight player1 - bold and arrow
    document.getElementById("user1Username").classList.add("fw-bold");
    document.getElementById("user2Username").classList.remove("fw-bold");

    document.getElementById("user1Username").innerHTML += `<i class="bi bi-hand-index-thumb ps-2 text-info"></i>`;
    document.getElementById("user2Username").innerHTML = username2;

    player1TurnClient = true;
}

function highlightPlayer2() {
    console.log("player two on turn");
    // highlight player2 - bold and arrow
    document.getElementById("user1Username").classList.remove("fw-bold");
    document.getElementById("user2Username").classList.add("fw-bold");

    document.getElementById("user1Username").innerHTML = username1;
    document.getElementById("user2Username").innerHTML += `<i class="bi bi-hand-index-thumb ps-2 text-info"></i>`;

    player1TurnClient = false;
}

function closeCardModal() {
    modal.style.display = "none";
}