// Shared by the singleplayer and multiplayer page

function closeCardModal() {
    document.getElementById("cardModal").style.display = "none";
}

/*
 * Opens the meme of a face-up card in big. Works without the server, so it
 * also works after the game is over (surrender, end of game) and for spectators.
 * Returns false if the card is face down.
 */
function zoomCard(id) {
    var card = document.getElementById("card-" + id);
    if (card == null || !card.classList.contains("flip")) return false;

    var image = card.querySelector(".card-back img");
    if (image == null || !image.getAttribute("src")) return false;
    // Nothing to show for an image that couldn't be loaded
    if (card.querySelector(".card-back.broken")) return true;

    document.getElementById("imgModal").src = image.src;
    document.getElementById("cardModal").style.display = "block";
    return true;
}

document.addEventListener("keydown", (event) => {
    if (event.key == "Escape") closeCardModal();
});

// Shows the meme on a card. If the image can't be loaded (e.g. deleted on
// Reddit) a placeholder is shown instead of the browser's broken image icon.
function setCardImage(card, src) {
    var back = card.querySelector(".card-back");
    var image = back.querySelector("img");
    back.classList.remove("broken");
    image.onerror = () => back.classList.add("broken");
    image.src = src;
}

// Removes the image after the card is turned around - but only if the card is
// still face down then (it may have been opened again in the meantime).
function clearCardImage(card, delay) {
    var clear = () => {
        if (card.classList.contains("flip")) return;
        var back = card.querySelector(".card-back");
        back.classList.remove("broken");
        back.querySelector("img").removeAttribute("src");
    };
    if (delay) setTimeout(clear, delay);
    else clear();
}

// Small "Surrender" button shown next to the own name in the player list
function createSurrenderButton() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "player-surrender";
    button.title = "Surrender";
    var icon = document.createElement("i");
    icon.className = "bi bi-flag-fill";
    button.append(icon, document.createTextNode("Surrender"));
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        surrender();
    });
    return button;
}

// Small tag for players who surrendered / left the game (like the "You" tag)
function createSurrenderedTag() {
    var tag = document.createElement("span");
    tag.className = "player-tag surrendered";
    tag.title = "Surrendered";
    var icon = document.createElement("i");
    icon.className = "bi bi-flag-fill";
    tag.append(icon, document.createTextNode("Surrendered"));
    return tag;
}
