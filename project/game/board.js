const Meme = require("../models/Meme");

const CARD_COUNT = 66;
const PAIR_COUNT = CARD_COUNT / 2;

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/*
 * Creates a new board. The memes are loaded from the database on the server,
 * so a client can't inject its own (possibly malicious) image links.
 *
 * Returns { cardPairs, cardImages } where cardPairs[x] is the partner of
 * card x and cardImages[x] is the image link of card x.
 * Throws if there are not enough memes to fill the board.
 */
async function createBoard() {
  const memes = await Meme.aggregate([
    { $group: { _id: "$link" } },
    { $sample: { size: PAIR_COUNT } },
  ]);

  if (memes.length < PAIR_COUNT) {
    throw new Error(
      `Not enough memes available (${memes.length}/${PAIR_COUNT}). Please try again later.`,
    );
  }

  const links = memes.map((meme) => meme._id);
  const ids = shuffle([...Array(CARD_COUNT).keys()]);
  const cardPairs = [];
  const cardImages = [];

  // Assign images and card pairs to cards
  for (let i = 0; i < CARD_COUNT; i += 2) {
    const x = ids[i];
    const y = ids[i + 1];
    cardPairs[x] = y;
    cardPairs[y] = x;
    cardImages[x] = links[i / 2];
    cardImages[y] = links[i / 2];
  }

  return { cardPairs, cardImages };
}

// Card ids come from the client, so check them before using them.
function isValidCardId(id) {
  return Number.isInteger(id) && id >= 0 && id < CARD_COUNT;
}

module.exports = { CARD_COUNT, createBoard, isValidCardId };
