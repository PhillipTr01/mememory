//server vars
var linkForIdArr = new Array(66);
var matchArr = new Array(66);
var cardTurnedPermanently = new Array(66).fill(false);
var id1 = -1;
var id2 = -1;

var playSingleplayer = true;
var difficultyComputer = 0;
var difficultyExpert = false;
var previousMoves = new Array();
var nextMoves = [];

var isGameReady = false;
var cardsControlled = false;
var turnEnded = false;
var computerTurnIsActive = false;

//server and local
var player1Turn = true;
var player1Points = 0;
var player2Points = 0;
var openCards = 0;

function mainMethod() {
    // here runs code every one second so i don't have problems with checking cards and stopping animations

    // only run if initializeMemoryLogik is done
    if (isGameReady) {

        // check if it is the computers turn
        if (!player1Turn && !computerTurnIsActive) {
            console.log("computer is turning");

            // activate computer turn
            computerTurnIsActive = true;

            // make computers turn
            ComputerLogic();

        } // else: wait for the user to turn the cards


        // if both cards are opened 
        if (openCards == 2 && !cardsControlled) {
            console.log("cards get controlled");

            //disable the if 
            cardsControlled = true;

            // controll the cards - do they match?
            if (!checkIdsForMatch()) {
                console.log("cards didn't match");

                // the cards didn't match 
                // enable button 
                document.getElementById("playButton").disabled = false;

                // give the buttons usefull text 
                document.getElementById("playButton").innerText = "End Turn";

                // to end the turn click the button
                turnEnded = true;
            }

        }

    }

}

setInterval(mainMethod, 1000);

function initializeMemoryLogik() {
    /////////////////////////    
    // create memory field //  (siehe One Note Flussdiagramm)
    /////////////////////////    

    // request data
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open("GET", '/requests/memes', false);
    xmlHttp.send(null);

    var body = JSON.parse(xmlHttp.responseText);

    // create arraylist with all links from db -> linkArr
    var linkArr = [];
    for (image of body) {
        linkArr.push(image.link);
    }

    //request geht aktuell nicht daher ersatz array
    linkArr = ["https://i.redd.it/xkrxblyyv7q61.gif", "https://i.redd.it/8135h1b7d8q61.jpg", "https://i.redd.it/w4bozpjfa7q61.png", "https://i.redd.it/x177kvcvx6q61.gif", "https://i.redd.it/ltkz5zf186q61.jpg", "https://i.redd.it/7yxqnkv0m5q61.jpg", "https://i.redd.it/1hc8jji986q61.png", "https://i.redd.it/xj91z2wcn6q61.png", "https://i.redd.it/ir7mqnlsk6q61.jpg", "https://i.redd.it/zm27b5b308q61.jpg", "https://i.redd.it/9ctbm0yvq6q61.jpg", "https://i.redd.it/g1yrsjut77q61.jpg", "https://i.redd.it/o9r6onvco5q61.gif", "https://i.redd.it/qxlnw8y5v5q61.jpg", "https://i.redd.it/98kypb6a07q61.png", "https://i.redd.it/jdckwajw75q61.jpg", "https://i.redd.it/pk41i3aqo6q61.jpg", "https://i.redd.it/x8orm0tyw7q61.jpg", "https://i.redd.it/9z2fnawbq5q61.jpg", "https://i.redd.it/rx0myb0z76q61.png", "https://i.redd.it/yg27qnybu4q61.jpg", "https://i.redd.it/tw72kazc55q61.jpg", "https://i.redd.it/iz7uze0i85q61.jpg", "https://i.redd.it/ydzmeramu6q61.png", "https://i.redd.it/xc1yoy39t4q61.gif", "https://i.redd.it/lvz6uq3ku6q61.gif", "https://i.redd.it/ui4h00htv5q61.gif", "https://i.redd.it/hkc26zjd95q61.jpg", "https://i.redd.it/futezcn6s7q61.jpg", "https://i.redd.it/10dnorsfx4q61.jpg", "https://i.redd.it/vmvyl4ltj5q61.jpg", "https://i.redd.it/nuzxf8j6t4q61.jpg", "https://i.redd.it/xag4bao877q61.jpg", "https://i.redd.it/lw6thdk8c8q61.jpg", "https://i.redd.it/pl7hbi1r95q61.jpg", "https://i.redd.it/g7vvqq2nr4q61.jpg", "https://i.redd.it/11u34p4kc4q61.jpg", "https://i.redd.it/5lzn68imp5q61.jpg", "https://i.redd.it/v21kjboll4q61.gif", "https://i.redd.it/bscm23ar14q61.jpg", "https://i.redd.it/lg6txoezs4q61.jpg", "https://i.redd.it/e0xgn7sjf8q61.jpg", "https://i.redd.it/q16w6q0re8q61.png", "https://i.redd.it/zwqckjkj17q61.jpg", "https://i.redd.it/s1gq3acva4q61.jpg", "https://i.redd.it/anwuleumf5q61.jpg", "https://i.redd.it/826g88adg4q61.jpg", "https://i.redd.it/uivbvo6u33q61.jpg", "https://i.redd.it/voi2h0r7v5q61.png", "https://i.redd.it/6bo3p0uho4q61.jpg", "https://i.redd.it/ovvrovcjg5q61.jpg", "https://i.redd.it/6mqhjxdmd7q61.jpg", "https://i.redd.it/inj2b8lb86q61.jpg", "https://i.redd.it/2tvrnklc88q61.jpg", "https://i.redd.it/ecksk2gvh8q61.png", "https://i.redd.it/r47u34rj79q61.jpg", "https://i.redd.it/etulvzfx66q61.jpg", "https://i.redd.it/p0pnj88bq3q61.jpg", "https://i.redd.it/jby2abvtc8q61.jpg", "https://i.redd.it/pyldz9u7t4q61.jpg", "https://i.redd.it/fiky9i93k4q61.gif", "https://i.redd.it/ihrp6ylec8q61.jpg", "https://i.redd.it/vkncf322h5q61.png", "https://i.redd.it/96qiq20bq8q61.jpg", "https://i.redd.it/lkm79cbst7q61.gif", "https://i.redd.it/nssibcw7m8q61.png", "https://i.redd.it/2j2hgdpqq6q61.jpg", "https://i.redd.it/21309eueg8q61.jpg", "https://i.redd.it/n9ijgkmau8q61.jpg", "https://i.redd.it/dcjzuu4vl7q61.jpg", "https://i.redd.it/ppeyxopis8q61.jpg", "https://i.redd.it/2iev8451p8q61.jpg", "https://i.redd.it/ihlwpke788q61.jpg", "https://i.redd.it/5neq8szvk7q61.png", "https://i.redd.it/1riisx3ie6q61.png", "https://i.redd.it/gdmvg8x238q61.jpg", "https://i.redd.it/bbm3d8f1k3q61.jpg", "https://i.redd.it/e0dl9iv9o8q61.jpg", "https://i.redd.it/91zcyixcz3q61.jpg", "https://i.redd.it/5z0zcm6j08q61.jpg", "https://i.redd.it/k0ig9x1r93q61.jpg", "https://i.redd.it/zi3joia9b8q61.jpg", "https://i.redd.it/i4kt5zukf5q61.jpg", "https://i.redd.it/9ckjhzqn08q61.jpg", "https://i.redd.it/pplw7vwq79q61.jpg", "https://i.redd.it/e7b3v0gnn8q61.jpg", "https://i.redd.it/0pu2f8b2h6q61.gif", "https://i.redd.it/ysu9u1uve7q61.jpg", "https://i.redd.it/nri36zghw4q61.jpg", "https://i.redd.it/3ijkurwik8q61.png", "https://i.redd.it/zo2nsc01b7q61.jpg", "https://i.redd.it/okjq9y6oz7q61.jpg", "https://i.redd.it/5ifwr3jz38q61.jpg", "https://i.redd.it/m1h9u6gg58q61.jpg", "https://i.redd.it/9fqq0ycpj5q61.gif", "https://i.redd.it/8dwh6df557q61.jpg", "https://i.redd.it/pd0dvdgrn2q61.png", "https://i.redd.it/jwghjjvm27q61.jpg", "https://i.redd.it/y2djwozu17q61.jpg", "https://i.redd.it/s82tnwka57q61.jpg"];
    console.log("created linkArr: " + linkArr);

    // create arraylist with id's -> idArr
    var idArr = [];
    for (var i = 0; i < 66; i++) {
        // id's are just from 0 to 65
        idArr.push(i);
    }

    // create empty arraylist with id and link -> linkForIdArr (ist schon global geschehen)

    // create empty arraylist with id matches -> matchArr(ist schon global geschehen)

    while (idArr.length >= 2) {
        //for (var index = 0; index < 66; index++) {

        if (idArr.length == 2) {
            var rndIndex = 0;
            var rndIndex2 = 0;
        } else {
            //create random number 
            var rndIndex = Math.floor(Math.random() * idArr.length);

            // random again
            var rndIndex2 = Math.floor(Math.random() * (idArr.length - 1));
        }

        // choose random from idArr -> x
        var x = idArr[rndIndex];

        // delete x from idArr
        idArr.splice(rndIndex, 1);

        // choose random from idArr -> y
        var y = idArr[rndIndex2];

        // delete y from idArr
        idArr.splice(rndIndex2, 1);

        // add [x,y] to matchArr
        matchArr.splice(x, 1, y);

        // add [y,x] to matchArr
        matchArr.splice(y, 1, x);

        // choose random from linkArr -> src
        var src = linkArr[Math.floor(Math.random() * linkArr.length)];

        // delete src from linkArr
        linkArr.splice(y, 1);

        // add [x,src] to linkForIdArr
        linkForIdArr.splice(x, 1, src);

        // add [y,src] to linkForIdArr
        linkForIdArr.splice(y, 1, src);
    }

    console.log("created matchArr: " + matchArr);
    console.log("created linkForIdArr: " + linkForIdArr);

    // Computer difficulty
    defineComputerDifficulty();

    // highlight the current player
    highlightCurrentPlayer();

    // everything has loaded, the game is ready
    isGameReady = true;
}

// Server function //
function socketGetSourceForId(id) {

    // check again if it is the players turn
    if (!player1Turn) {
        return;
    }

    // check if this card is already revealed
    if (cardTurnedPermanently[id]) {
        return;
    }

    if (openCards == 0) {
        // if there is no open card this was card nr 1 from the users move
        id1 = id;

        // one open card
        openCards++;

    } else if (openCards == 1) {
        // if there is an open card this was card nr 2 from the users move
        id2 = id;

        // check if it was the same card again
        if (id1 == id2) {
            return;
        }

        //two open cards
        openCards++;

    } else if (openCards == 2) {
        //already two open cards
        return;
    }

    return src = linkForIdArr[id];
}

// Server function //
function checkIdsForMatch() {
    console.log("check match: " + id1 + "  " + id2);

    // two checks for safety - one also possible
    var cardsMatch = matchArr[id1] == id2 || matchArr[id2] == id1;

    if (cardsMatch) {
        console.log("cards did match");

        // they match, now they stay permanent 
        cardTurnedPermanently[id1] = true;
        cardTurnedPermanently[id2] = true;

        // and the player gets a point
        if (player1Turn) {
            increasePlayer1ScoreServer();
        } else {
            increasePlayer2ScoreServer();
        }

        // is everything revealed 
        if (checker(cardTurnedPermanently)) {
            // end the game
            calculateWinner();
        }

        // moves reset
        id1 = -1;
        id2 = -1;
        openCards = 0;
        cardsControlled = false;
        computerTurnIsActive = false;
        console.log("reset ");

    } else {
        console.log("match was  " + id1 + "  " + matchArr[id1]);
        console.log("match was  " + id2 + "  " + matchArr[id2]);
    }

    // return the result - was it a match - true or false
    return cardsMatch;
}

// check if everything is true in an array
let checker = arr => arr.every(Boolean);

// change player, turn cards back, reset vars
function endTurn() {
    // turn cards back around
    turnCardBack(id1);
    turnCardBack(id2);

    // Player turn changes
    player1Turn = !player1Turn;

    // save the cards to previousMoves, so the computer remembers
    addToPreviousMoves();

    // moves reset
    id1 = -1;
    id2 = -1;
    openCards = 0;
    cardsControlled = false;
    computerTurnIsActive = false;
    console.log("reset ");

    // disable button again 
    document.getElementById("playButton").disabled = true;
    document.getElementById("playButton").innerText = "button";

    //Highlight the current player
    highlightCurrentPlayer();
}

function addToPreviousMoves() {
    // save the last moves to previousMoves array
    // remove last card except you have difficulty expert
    if (!difficultyExpert) {
        previousMoves.pop();
    }

    // add new as first
    previousMoves.unshift(id1);

    // remove last card except you have difficulty expert
    if (!difficultyExpert) {
        previousMoves.pop();
    }

    // add new as first
    previousMoves.unshift(id2);
    console.log("previousMoves: " + previousMoves);

    // check if the computer knows which card this card belongs to
    computerCheckID(id1);
    computerCheckID(id2);
}

// Server function //
function calculateWinner() {
    console.log("calculating winner");

    if (player1Points > player2Points) {
        // show player1 won
        player1WonServer();

        // add his point
        // TODO addPointToDbPlayer1() - (controlling with gameID? Disabling afterwards)
    } else {
        // show player2 won
        player2WonServer();

        // add his point
        // TODO addPointToDbPlayer2() - (controlling with gameID? Disabling afterwards)
    }

}

function getOpenCardsServer() {
    return openCards;
}

function increasePlayer1ScoreServer() {
    player1Points++;
    increasePlayer1ScoreClient();
}

function increasePlayer2ScoreServer() {
    player2Points++;
    increasePlayer2ScoreClient();
}

function player1WonServer() {
    player1WonClient();
}

function player2WonServer() {
    player2WonClient();
}



//////////////////////////////
// Computer logic functions //
//////////////////////////////

// button - mainly for ending turns
function makeNextMove() {

    if (turnEnded) {
        // reset var
        turnEnded = false;

        // end the turn
        endTurn();
    }

}

function defineComputerDifficulty() {
    // how much moves the computer can remember
    var movesComputerRemembers = 4;

    // define the difficulte by last char in URL
    var difficultyComputer = window.location.href.slice(-1);
    if (difficultyComputer == 4) {
        difficultyExpert = true;
    } else if (difficultyComputer == 3) {
        movesComputerRemembers = 15;
    } else if (difficultyComputer == 2) {
        movesComputerRemembers = 9;
    } else {
        movesComputerRemembers = 4;
    }

    if (!difficultyExpert) {
        // if you don't play against slave doge, 
        // make an array with the moves the computer can remember
        for (var i = 0; i < movesComputerRemembers * 2; i++) {
            previousMoves.push(-1);
        }
    }

}


function ComputerLogic() {

    // if nextMoves is filled, just work through
    if (nextMoves.length) {
        // get the first id
        id1 = nextMoves.pop();
        console.log("computer knows: " + id1);

        // send the id and the src to the frontend and turn the card
        turnCardPlayer2(id1, linkForIdArr[id1]);

        // increas openCards
        openCards++;

        // get the second id
        id2 = nextMoves.pop();
        console.log("computer knows: " + id2);

        // send the id and the src to the frontend and turn the card
        // turnCardPlayer2(id2, linkForIdArr[id2]);
        // added 2000ms wait
        setTimeout(() => turnCardPlayer2(id2, linkForIdArr[id2]), 500);

        // increas openCards
        // added 2000ms because if it shorter than the above one 
        // openCards triggers the checkIdsForMatch function before the card is turned -> bugs
        setTimeout(() => openCards++, 2000);

    } else {
        // the computer has no matching cards
        // get a random card
        id1 = getRandomCard();
        console.log("computer guesses: " + id1);

        // send the id and the src to the frontend and turn the card
        turnCardPlayer2(id1, linkForIdArr[id1]);

        // increas openCards
        openCards++;

        // get the matching card for id
        id2 = matchArr[id1];

        // check if the computer knows where the match is lying
        if (!previousMoves.includes(id2)) {
            // if it doesn't match 
            // get a second random card
            id2 = getRandomCard();
            console.log("computer guesses: " + id2);
        }

        // send the id and the src to the frontend and turn the card
        // turnCardPlayer2(id2, linkForIdArr[id2]);
        // added 2000ms wait
        setTimeout(() => turnCardPlayer2(id2, linkForIdArr[id2]), 500);

        // increas openCards
        // added 2000ms because if it shorter than the above one 
        // openCards triggers the checkIdsForMatch function before the card is turned -> bugs
        setTimeout(() => openCards++, 2000);

    }

}

function computerCheckID(id) {
    // get the matching card for id
    var idMatch = matchArr[id];

    if (previousMoves.includes(idMatch)) {
        // if it matches push it to next move, to turn around later again
        nextMoves.push(id);
        nextMoves.push(idMatch);
    }
}

function getRandomCard() {

    do {
        // generate a random id from all 66
        var id = Math.floor(Math.random() * linkForIdArr.length);
    } while (cardTurnedPermanently[id] || previousMoves.includes(id));

    // if it is not already turned around and if it is not saved in previous moves -> give back
    return id;
}

function wait(ms) {
    // wait function, no other code will be executed   return;
    var count = ms * 100;
    var ele = []
    for (let index = 0; index < count; index++) {
        ele[index] = Math.random();
    }
}

function highlightCurrentPlayer() {
    if (player1Turn) {
        highlightPlayer1();
    } else {
        highlightPlayer2();
    }
}