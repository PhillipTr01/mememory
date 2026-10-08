const config = require("./config");
const coins = require("./coins");
const slots = require("./slots");

/*
 * How every game works, for the little "i" next to the title. Made from the
 * config every time, so the limits are the ones the admin set.
 * {title, sections: [{heading, items: [text]}]}
 */
const n = (value) => Number(value).toLocaleString("en-US");
const seconds = (ms) => `${Math.round(ms / 1000)} s`;
const minutes = (ms) => `${Math.round(ms / 60000)} min`;

const GAMES = {
  jackpot: () => ({
    title: "Jackpot",
    sections: [
      {
        heading: "How it works",
        items: [
          "Everybody puts coins into one pot. One player wins the whole pot.",
          "Your chance is your share of the pot: 1,000 of 4,000 coins = 25%.",
          `The countdown (${seconds(config.JACKPOT_COUNTDOWN)}) starts with the second player. Bets during the countdown still count.`,
          `Alone in the pot for ${seconds(config.JACKPOT_GHOST_AFTER)}: the 👻 ghost (the house) joins with 85-115% of your coins. If it wins, the house keeps the pot.`,
          `A bet lands in the pot after ${seconds(config.JACKPOT_BET_DELAY[0])}-${seconds(config.JACKPOT_BET_DELAY[1])} (nobody can answer a bet in the last second). Too late for the draw: it goes into the next pot.`,
          "The winner is drawn with a random animation (wheel, roulette, race, ...). The pot is paid when the draw is over.",
        ],
      },
      {
        heading: "Limits",
        items: [`Up to ${n(config.JACKPOT_MAX_BETS)} bets per round.`, `At most 🪙 ${n(config.JACKPOT_MAX_COINS)} per player and round.`],
      },
    ],
  }),

  battles: () => ({
    title: "Case Battles",
    sections: [
      {
        heading: "How it works",
        items: [
          "Pick cases (the same one more than once, too), the players (2 to 4) and a mode. Everybody pays the same price: the cost of all the cases.",
          "Every round all players open the same case. The items are worth coins.",
          "The winner gets all the items of everybody, paid in coins when the battle is over.",
          "👑 Classic mode: the most worth wins.",
          "🤡 Crazy mode: the lowest worth wins.",
          "🎰 Jackpot mode: one player gets everything - a roulette draws the winner, your chance is the share of the pot your items are worth.",
          "🏅 Best of mode (at least 2 cases): the best item of a case wins the round - the most rounds win (equal rounds: the bigger worth).",
          "❓ Random mode: one of the other modes (best of only with 2+ cases), picked at random at the very end.",
          "A tie: everybody tied for the win splits the pot.",
          "The creator can fill free seats with bots - their items go to the winner, too.",
          "When it's over the creator can start the same battle again with one click.",
          `Nobody joins within ${minutes(config.BATTLE_EXPIRE)}: the battle is cancelled and you get your coins back.`,
        ],
      },
      {
        heading: "Cases",
        items: [
          "Click a case to see every item and its chance.",
          "Low risk: items close to the price. High risk: mostly cheap items, but a small chance of up to 50x.",
          "Every case pays back a little less than it costs on average: low risk about 93%, balanced about 91%, high risk about 88% (the price of the big jackpots).",
          "Provably fair: the seed is fixed (and its hash shown) before the battle and revealed after it.",
        ],
      },
      {
        heading: "Limits",
        items: [`Up to ${n(config.BATTLE_MAX_CASES)} cases per battle.`, `Up to ${n(config.BATTLE_MAX_OPEN)} open battles per player.`],
      },
    ],
  }),

  poker: () => {
    const level = (step) => `${n(config.POKER_SMALL_BLIND * step)}/${n(config.POKER_BIG_BLIND * step)}`;
    return {
      title: "Poker",
      sections: [
        {
          heading: "How it works",
          items: [
            `Texas Hold'em, up to ${config.POKER_SEATS} players at the table, played with chips.`,
            "Everybody gets 2 cards, then 5 cards come on the board (flop, turn, river). The best 5 of your 7 cards win the pot.",
            "Bet with the slider or the mouse wheel (in big blinds), or with your own preset buttons.",
            `${seconds(config.POKER_TURN)} per decision - then you check, or fold if you can't check.`,
            `After every hand you decide within ${seconds(config.POKER_DECIDE)}: show your cards or muck them (hide them) - no decision means muck. The winner of a showdown always shows.`,
          ],
        },
        {
          heading: "Blinds",
          items: [
            `They go up every ${n(config.POKER_LEVEL_HANDS)} hands: ${config.POKER_BLIND_STEPS.map(level).join(" → ")}.`,
            `When the table is empty for ${minutes(config.POKER_LEVEL_RESET)}, the blinds start again at ${level(1)}.`,
          ],
        },
        {
          heading: "Buy-in",
          items: [`🪙 ${n(config.POKER_MIN_BUYIN)} to ${n(config.POKER_MAX_BUYIN)} coins become chips.`, "Your chips become coins again when you stand up."],
        },
      ],
    };
  },

  blackjack: () => ({
    title: "Blackjack",
    sections: [
      {
        heading: "How it works",
        items: [
          "Beat the dealer: get closer to 21 than the dealer without going over.",
          "Cards 2-10 count their number, J, Q and K count 10, an ace 1 or 11.",
          "Hit (one more card), stand, double (on the first two cards: double bet, one card) or split (two cards of the same value, up to 4 hands).",
          "The dealer draws up to 16 and stands on every 17.",
          "Win: 2x your bet back. Blackjack (ace + 10 with the first two cards): 3:2. Same total: you get your bet back.",
          "Every round is dealt from a new shoe of 6 decks - counting cards doesn't help.",
          `You can take up to ${config.BJ_MY_SEATS} seats at a table. ${seconds(config.BJ_TURN)} per decision, then the hand stands.`,
        ],
      },
      {
        heading: "Side bets",
        items: [
          "Up to half the table's max bet on each (a main bet first), before the cards are dealt. They are decided by the first cards and paid at the end of the round.",
          "Perfect Pairs - your first two cards are a pair: mixed (red and black) 6:1, coloured (same colour) 12:1, perfect (same suit) 25:1.",
          "21+3 - your two cards and the dealer's up card as a poker hand: flush 5:1, straight 10:1, three of a kind 30:1, straight flush 40:1, suited trips 100:1.",
        ],
      },
      {
        heading: "The 3 rooms",
        items: config.BJ_TABLES.map((table) => `${table.icon} ${table.name}: 🪙 ${n(config[table.minKey])} to ${n(config[table.maxKey])} per seat. ${table.about}`),
      },
    ],
  }),

  slots: () => {
    const spins = slots.BONUS_SPINS.map((f) => f.spins).join(", ");
    const starts = slots.BONUS_MULTIPLIERS.map((f) => "×" + f.multiplier).join(", ");
    return {
      title: "Slots",
      sections: [
        {
          heading: "How it works",
          items: [
            `5 reels, 3 rows, ${slots.LINE_COUNT} lines - all lines play every spin. The bet is for the whole spin.`,
            "3, 4 or 5 of the same symbol on a line, from the left reel, win. The paytable shows what each pays.",
            "👑 is wild: it stands for every symbol.",
            `🎁 on reels 1, 3 and 5 at the same time start the bonus game: two wheels decide your free spins (${spins}) and the start multiplier (${starts}).`,
            `The free spins play by themselves. Every win is paid times the multiplier - and it grows by ${slots.BONUS_STEP} after every free spin.`,
            `Three 🎁 again during the free spins: ${slots.RETRIGGER} free spins more (up to ${slots.MAX_FREE_SPINS} in one bonus).`,
            `${slots.COIN_TRIGGER} or more 🪙 anywhere start the coin game: the coins stay, the empty spots get ${slots.COIN_RESPINS} respins - every new coin brings them back to ${slots.COIN_RESPINS}.`,
            `Every 🪙 pays its value or a prize: ${slots.COIN_VALUES.filter((v) => v.prize).map((v) => v.prize.toUpperCase() + " " + v.x + "×").join(", ")} the bet. All 15 spots full: ULTRA, ${slots.ULTRA}× the bet on top (the coin game pays at most ${slots.COIN_MAX_WIN}×).`,
            `The free spins pay at most ${slots.MAX_WIN}× the bet (then the bonus ends). On average the machine pays back about 95-96% of the bets.`,
            "The line wins of a spin that starts a bonus count as well - first the lines, then the bonus.",
            "Your coins come when the spin is over on the screen.",
          ],
        },
        {
          heading: "Limits",
          items: [`🪙 ${n(config.SLOTS_MIN_BET)} to ${n(config.SLOTS_MAX_BET)} per spin.`],
        },
      ],
    };
  },

  leaderboard: () => ({
    title: "Leaderboard",
    sections: [
      {
        heading: "How it works",
        items: [
          "All players by their coins.",
          "Without a season it is live - always up to date. The arrows show who went up or down since midnight.",
          `🪙 ${n(coins.dailyBonus())} free coins every day for everybody (🎁 in the top bar).`,
        ],
      },
      {
        heading: "Ranking",
        items: [
          "The most coins first.",
          "In a season every player shows 💔 the second chances used and 🎲 the bets made. The same coins: fewer second chances first - the same second chances: more bets first. Where this made the difference, it is marked.",
          "Only players with the same coins, second chances and bets share a place - and its prize (two players 1st - the next one is 3rd).",
          "Without a season: the same coins, the same place.",
        ],
      },
      {
        heading: "Seasons",
        items: [
          "A season runs from a start to an end. Hit Start to play in it - you get the start budget (and the daily coins you missed since it began). Only players who started are on the leaderboard.",
          "Everybody starts with the same coins - the most coins at the end wins (the prizes, if the season has any). The winners stay on the winner page.",
          "In a season the leaderboard is updated as often as the season says - the arrows show the change since the update before.",
          "Your balance from before the season is kept (🏦 next to your coins) - when the season is over you get it back, with your season coins on top.",
          "Lost everything? A season can have second chances: start again with the budget - the first right away, every further one from the next day on.",
          "Before a season starts and before it ends, the casino closes for a moment: running games finish, no new bets, then a short countdown.",
          "Click the season next to the title to see it: how long it runs, the coins, the prizes.",
        ],
      },
    ],
  }),
};

function get(game) {
  return Object.hasOwn(GAMES, game) ? GAMES[game]() : null;
}

module.exports = { get, GAMES };
