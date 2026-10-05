/*
 * Tic Tac Toe XL: tic tac toe with pieces of different sizes.
 * A piece can be placed on an empty cell or on top of a smaller piece (own or
 * the opponent's). Only the top pieces count, three in a row wins.
 * Pure game logic without sockets, so it is easy to test.
 */

const SIZES = [1, 2, 3, 4];
// Pieces per player: size -> count.
// Solved by brute force: with 3x size 1 the starting player always wins,
// with 2x size 1 perfect play ends in a draw, so neither side is favoured.
const PIECES = { 1: 2, 2: 2, 3: 2, 4: 1 };
const CELLS = 9;
const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function newGame(starter = 0) {
  return {
    board: Array.from({ length: CELLS }, () => []), // stacks of {owner, size}, top is last
    reserves: [{ ...PIECES }, { ...PIECES }],
    turn: starter,
    winner: null,
    draw: false,
    line: null,
    lastMove: null,
    passed: null, // player who had no move and was skipped
  };
}

function isOver(game) {
  return game.winner != null || game.draw;
}

function top(game, cell) {
  const stack = game.board[cell];
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

function canPlace(game, player, size, cell) {
  if (isOver(game)) return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return false;
  if (!SIZES.includes(size) || !(game.reserves[player][size] > 0)) return false;
  const piece = top(game, cell);
  return piece == null || piece.size < size;
}

function hasMove(game, player) {
  return SIZES.some((size) => {
    for (let cell = 0; cell < CELLS; cell++) {
      if (canPlace(game, player, size, cell)) return true;
    }
    return false;
  });
}

function findLine(game, player) {
  return (
    LINES.find((line) =>
      line.every((cell) => {
        const piece = top(game, cell);
        return piece != null && piece.owner === player;
      }),
    ) || null
  );
}

/*
 * Places a piece for the player. Returns {ok: true} or {error}.
 * A player without a legal move is skipped; nobody can move -> draw.
 */
function place(game, player, size, cell) {
  if (isOver(game)) return { error: "The game is over." };
  if (game.turn !== player) return { error: "It's not your turn." };
  if (!canPlace(game, player, size, cell)) return { error: "You can't place this piece there." };

  game.board[cell].push({ owner: player, size: size });
  game.reserves[player][size]--;
  game.lastMove = cell;
  game.passed = null;

  // Only the mover's piece became visible, so only the mover can complete a line
  const line = findLine(game, player);
  if (line != null) {
    game.winner = player;
    game.line = line;
    return { ok: true };
  }

  const next = 1 - player;
  if (hasMove(game, next)) {
    game.turn = next;
  } else if (hasMove(game, player)) {
    game.passed = next;
  } else {
    game.draw = true;
  }
  return { ok: true };
}

module.exports = { SIZES, PIECES, CELLS, LINES, newGame, top, canPlace, hasMove, findLine, place, isOver };
