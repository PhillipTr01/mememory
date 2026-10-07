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
  CASINO_CHAT_HISTORY: 50, // the casino chat keeps this many messages (older ones go)
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
  MISS_DELAY: 1600, // a wrong pair: the cards stay open this long, then the turn ends by itself
  STEAL_WINDOW: 2600, // power-up Steal: after the first card of a turn, this long to steal the second guess
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

  // The games of the casino on / off (admin panel): an "off" game has no tab and no page
  GAME_JACKPOT: true,
  GAME_BATTLES: true,
  GAME_POKER: true,
  GAME_BLACKJACK: true,
  GAME_SLOTS: true,

  // Coins (hidden jackpot): start amount, free coins for everybody once a day
  START_COINS: 25000,
  // Every account gets START_COINS once for this id: a new id resets everybody's coins
  COIN_RESET: "reset-100k",
  DAILY_BONUS: 2500,
  SEASON_CLOSE_WAIT: 60 * 1000, // before a season starts: when every game is quiet, this long until the start
  SEASON_CLOSE_MAX: 5 * 60 * 1000, // ... and at most this long waiting for the games to get quiet
  SEASON_DAILY_BONUS: 1000, // the daily bonus of a new season (each season can have its own)
  // The daily bonus comes back at midnight in this time zone
  BONUS_TZ: process.env.BONUS_TZ || "Europe/Berlin",
  // Coins for a win (only real wins: no surrender / left opponent)
  COIN_REWARDS: { easy: 5, medium: 10, hard: 20, expert: 40, multiplayer: 15, tictactoe: 5 },

  // Jackpot: the draw starts this long after the second player joined the pot
  JACKPOT_COUNTDOWN: 30 * 1000,
  JACKPOT_SPIN: 12000, // the draw animation (wheel, roulette, bowling, ...): about 11 s
  JACKPOT_PAUSE: 5000, // result is shown, then a new round starts
  JACKPOT_MAX_BETS: 5, // separate bets per player and round
  JACKPOT_MAX_COINS: 100000, // all bets of a player in one round together
  // A new bet gets into the pot only after a random 3-5 s (no sniping:
  // nobody can answer a bet in the last second). Too late for the draw: the next pot.
  JACKPOT_BET_DELAY: [3000, 5000],
  // The animation of a round, one for everybody, chosen at random per round
  JACKPOT_DRAWS: ["wheel", "roulette", "bowling", "race", "claw", "royale", "coinrain", "revolver", "slots", "launch", "scratch", "ghosthunt"],
  JACKPOT_HISTORY: 10,
  // After a restart: at least this long until a countdown or a turn ends (time to come back)
  RESTORE_GRACE: 10 * 1000,
  // Alone in the pot this long after the first bet: a ghost (the house) of 85-115% of the first player's coins joins
  JACKPOT_GHOST_AFTER: 10 * 1000,
  JACKPOT_GHOST_SHARE: [0.85, 1.15],

  // The secret address of the jackpot (and its case battles and poker):
  // not linked anywhere. Can be changed with JACKPOT_PATH.
  JACKPOT_PATH: "/" + (process.env.JACKPOT_PATH || "🤫🎰💸"),

  // Payouts: a player takes coins off the balance, the admin pays them out
  WITHDRAW_MIN: 5000,
  WITHDRAW_STEP: 1000, // only whole thousands
  WITHDRAW_MAX_OPEN: 5, // open payouts per player

  // Admin panel: a secret address and a password (ADMIN_PASSWORD or the
  // hash below; without both there is no admin panel)
  // Only emojis without an invisible variation selector: the address bar shows them as they are
  ADMIN_PATH: "/" + (process.env.ADMIN_PATH || "🦆🔧"),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "",
  // Or only a salted scrypt hash of the password (make one with
  // `npm run admin-password`). ADMIN_PASSWORD wins if both are set.
  ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH || "",
  ADMIN_SESSION: 12 * 60 * 60, // seconds an admin login lasts

  // The ways a secret address can arrive: emojis like 🛠️ have an invisible
  // second character (U+FE0F) that is sometimes missing when typed or copied
  addresses(path) {
    return [...new Set([path, path.replace(/\uFE0F/g, "")])].map((p) => encodeURI(p));
  },

  // Case battles (hidden, opened from the jackpot page)
  BATTLE_START: 3000, // countdown when the battle is full
  BATTLE_ROUND: 4500, // one case for everybody: spin + a short look at the items
  BATTLE_MAX_OPEN: 3, // waiting battles per creator
  BATTLE_CASES_OFF: [], // ids of cases the admin turned off (not in the shop, no new battles with them)
  BATTLE_MAX_CASES: 50, // cases (rounds) per battle
  BATTLE_MODE_REVEAL: 5800, // random mode: the pages show which mode it was, then the winner is paid
  BATTLE_KEEP: 60 * 1000, // a finished battle stays in the list this long
  BATTLE_EXPIRE: 15 * 60 * 1000, // nobody joined: cancelled, coins back
  BATTLE_HISTORY: 10,

  // Poker (hidden, opened from the jackpot page): one table, texas hold'em
  POKER_SEATS: 5,
  POKER_SMALL_BLIND: 50, // the blinds of the first level
  POKER_BIG_BLIND: 100,
  // The blinds go up: level n = the first blinds times POKER_BLIND_STEPS[n], a new level every POKER_LEVEL_HANDS hands
  POKER_BLIND_STEPS: [1, 2, 4, 10, 20, 40, 100],
  POKER_LEVEL_HANDS: 15,
  // This long after they started at the first level, the blinds start there again (with the next hand)
  POKER_BLIND_RESET: 10 * 60 * 1000,
  // Nobody at the table this long: back to the first level
  POKER_LEVEL_RESET: 5 * 60 * 1000,
  POKER_MIN_BUYIN: 1000, // (10 big blinds of the first level)
  POKER_MAX_BUYIN: 10000,
  POKER_TURN: 20 * 1000, // time to act, then check (or fold)
  POKER_START: 3000, // pause before a hand starts
  POKER_STREET: 1200, // all-in: pause between the cards of the board
  POKER_SHOWDOWN: 6000, // the result is shown this long
  POKER_DECIDE: 5000, // after the hand: time to show or muck the cards (then mucked)
  POKER_AFTER_DECIDE: 2500, // the decisions are shown at least this long before the next hand
  POKER_AWAY: 30 * 1000, // in a hand: a player without an open page leaves the table
  // Poker / blackjack: gone from the page (another page, tab closed) and not in a
  // round: off the seat after this short wait (a reload keeps the seat)
  CASINO_LEAVE: 3000,
  POKER_HISTORY: 10,

  // Blackjack (hidden): one table against the dealer, a player can take several seats
  BJ_SEATS: 5, // seats per table
  BJ_MY_SEATS: 3, // seats one player can have at a time (per table)
  // Bets per seat (a double or a split adds the same again), per table
  BJ_CASUAL_MIN: 100,
  BJ_CASUAL_MAX: 1000,
  BJ_CLASSIC_MIN: 500,
  BJ_CLASSIC_MAX: 2500,
  BJ_HIGH_MIN: 1000,
  BJ_HIGH_MAX: 5000,
  BJ_SIDE_SHARE: 0.5, // a side bet (Perfect Pairs, 21+3) is at most this share of the table's max bet (each)
  // Slots (hidden, see game/slots.js): the bet is for a whole spin (all 9 lines)
  SLOTS_MIN_BET: 10,
  SLOTS_MAX_BET: 1000,
  SLOTS_SPIN: 2000, // the reels turn this long on the page
  SLOTS_SWEAT: 1800, // two 🎁 in sight: the last reel turns this much longer (the sweat)
  SLOTS_BONUS_TIME: 6000, // the bonus wheels (free spins, multiplier) on the page
  SLOTS_FREE_SPIN: 3000, // one free spin of the bonus game on the page
  SLOTS_RESUME_TIME: 1500, // back on the page: "the bonus goes on" before the next free spin
  SLOTS_HOLD: 24 * 60 * 60 * 1000, // a bonus game waits this long for the player to come back, then it is paid
  SLOTS_BONUS_END: 4000, // the bonus win is counted up and shown
  SLOTS_RETRIGGER_TIME: 900, // more free spins (three 🎁 in a free spin) are shown
  SLOTS_COIN_INTRO: 3000, // the coin game: the coins lock in before the first respin
  SLOTS_RESPIN: 2800, // one respin of the coin game on the page
  SLOTS_ULTRA_TIME: 4500, // all 15 spots full: the ULTRA show
  SLOTS_BIG_WIN: 15, // a win of this many times the bet gets the big show
  SLOTS_COUNT_TIME: 800, // after the reels (and the big-win show) the win is paid this soon - while it is counted up
  SLOTS_BIG_TIME: 3000, // the big-win show on top
  SLOTS_MIN_GAP: 600, // at least this long between two spins of a player
  SLOTS_FEED: 12, // last wins in the list
  SLOTS_TEST_BONUS: "off", // admin panel, for testing: every spin starts a bonus game ("free" spins or the "coins" game)

  // The tables of the lobby (in this order, limits from the keys above); a page without a table opens "classic"
  BJ_TABLES: [
    { id: "casual", name: "Casual Corner", icon: "🍀", minKey: "BJ_CASUAL_MIN", maxKey: "BJ_CASUAL_MAX", about: "Small stakes, no stress - learn the ropes." },
    { id: "classic", name: "Classic Table", icon: "🃏", minKey: "BJ_CLASSIC_MIN", maxKey: "BJ_CLASSIC_MAX", about: "The usual table: medium stakes for every round." },
    { id: "highroller", name: "High Roller", icon: "💎", minKey: "BJ_HIGH_MIN", maxKey: "BJ_HIGH_MAX", about: "Big chips only. Win big, lose big." },
  ],
  BJ_DEFAULT_TABLE: "classic",
  BJ_BETTING: 10000, // after the first bet: time for the others to bet
  BJ_SIT: 20000, // a seat without a bet: the player stands up after this
  BJ_TURN: 15000, // time for a decision, then the hand stands
  BJ_STEP: 700, // dealer cards, one after the other
  BJ_PEEK: 3800, // the dealer has a blackjack: the deal is seen, the dealer checks the card ...
  BJ_REVEAL: 1500, // ... turns it - and then the result
  BJ_RESULT: 5000, // the result is shown this long
  BJ_HISTORY: 10,
};
