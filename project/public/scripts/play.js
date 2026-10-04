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

    document.getElementById("imgModal").src = image.src;
    document.getElementById("cardModal").style.display = "block";
    return true;
}

document.addEventListener("keydown", (event) => {
    if (event.key == "Escape") closeCardModal();
});
