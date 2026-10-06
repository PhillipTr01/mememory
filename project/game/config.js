/* Multiplayer settings. The maximum can be changed with MULTIPLAYER_MAX_PLAYERS. */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = clamp(parseInt(process.env.MULTIPLAYER_MAX_PLAYERS, 10) || 8, MIN_PLAYERS, 16);

// Plain object on purpose: the tests shorten the timings.
module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  // Size of a new room, the host can change it in the waiting room.
  DEFAULT_MAX_PLAYERS: Math.min(4, MAX_PLAYERS),
  MAX_CHAT_LENGTH: 300,
  CHAT_HISTORY: 50,
  CHAT_COOLDOWN: 500, // ms between two chat messages of one player

  // A disconnected player keeps the seat this long (reload, bad connection, ...)
  REJOIN_GRACE_WAITING: 20 * 1000,
  REJOIN_GRACE_PLAYING: 60 * 1000,
  // Rooms without anybody in them are deleted after this time
  EMPTY_ROOM_GRACE: 15 * 1000,
  // Length of the "who starts" animation, the game begins afterwards
  START_ANIMATION: 4000,
  // How often disconnected players and empty rooms are checked
  TICK: 1000,

  // Game modes the host can choose in the waiting room
  MODES: ["classic", "speed", "powerups"],
  // Speed round: default time per turn (ms), the choices for the host (seconds)
  // and the pause after two wrong cards before the turn passes
  SPEED_TURN_TIME: 10 * 1000,
  SPEED_TURN_OPTIONS: [3, 5, 10, 15],
  SPEED_MISS_DELAY: 950,
  // The clock starts after the card animations (the flip takes 0.6s on the client)
  SPEED_ANIMATION_GRACE: 700,
  // Singleplayer: who starts (0 = player, 1 = bot, null = random)
  SINGLEPLAYER_STARTER: null,
  // Singleplayer: two wrong cards stay open this long, then the turn passes
  SINGLEPLAYER_MISS_DELAY: 1850,

  // Power-up mode: "who starts" plus the start power-ups
  POWERUPS_START_ANIMATION: 7000,

  // Speed round: shorter "who starts" animation
  SPEED_START_ANIMATION: 2600,

  // Coins (hidden jackpot): start amount, free coins once a day when (almost) broke
  START_COINS: 100,
  DAILY_BONUS: 50,
  BONUS_BELOW: 10,
  BONUS_EVERY: 24 * 60 * 60 * 1000,
  // Coins for a win (only real wins: no surrender / left opponent)
  COIN_REWARDS: { easy: 5, medium: 10, hard: 20, expert: 40, multiplayer: 15, tictactoe: 5 },

  // Jackpot: the draw starts this long after the second player joined the pot
  JACKPOT_COUNTDOWN: 30 * 1000,
  JACKPOT_SPIN: 8000, // the draw animation (wheel, roulette, bowling, ...)
  JACKPOT_PAUSE: 5000, // result is shown, then a new round starts
  JACKPOT_MAX_BETS: 5, // separate bets per player and round (any amount)
  JACKPOT_HISTORY: 10,
  // Secret word on the jackpot page (typed anywhere, not in a field): +1000 coins
  // every time. Only the server knows it, it can be changed with JACKPOT_SECRET.
  JACKPOT_SECRET: (process.env.JACKPOT_SECRET || "moneyrain").toLowerCase(),
  JACKPOT_SECRET_COINS: 1000,
  JACKPOT_SECRET_COOLDOWN: 1000, // ms between two uses (no flooding)

  // Case battles (hidden, opened from the jackpot page)
  BATTLE_START: 3000, // countdown when the battle is full
  BATTLE_ROUND: 4500, // one case for everybody: spin + a short look at the items
  BATTLE_MAX_ROUNDS: 10, // cases per battle
  BATTLE_MAX_OPEN: 3, // waiting battles per creator
  BATTLE_KEEP: 60 * 1000, // a finished battle stays in the list this long
  BATTLE_EXPIRE: 15 * 60 * 1000, // nobody joined: cancelled, coins back
  BATTLE_HISTORY: 10,
};
