const config = require("./config");
const coins = require("./coins");
const slots = require("./slots");

// What the slot machine pays back on average (worked out from its reels and paytable once - it doesn't change)
let slotsRtpText = null;
function slotsRtp() {
  if (slotsRtpText == null) slotsRtpText = (slots.rtp().rtp * 100).toFixed(1);
  return slotsRtpText;
}
const roulette = require("./roulette");
const limits = require("./limits");
const baucua = require("./baucua");

/*
 * How every game works, for the little "i" next to the title. Made from the
 * config every time, so the limits are the ones the admin set.
 * {title, sections: [{heading, items: [text]}]}
 */
const n = (value) => Number(value).toLocaleString("en-US");
const seconds = (ms) => `${Math.round(ms / 1000)} s`;
const minutes = (ms) => `${Math.round(ms / 60000)} min`;

// The cases as they are now (the admin can change them): the biggest item, what they pay back - by risk
function caseFacts() {
  const off = config.BATTLE_CASES_OFF || [];
  const list = require("./cases").list().filter((box) => !box.off && !off.includes(box.id));
  const of = (risk) => list.filter((box) => box.risk === risk);
  const range = (boxes) => {
    const low = Math.round(Math.min(...boxes.map((box) => box.rtp)) * 100);
    const high = Math.round(Math.max(...boxes.map((box) => box.rtp)) * 100);
    return low === high ? `about ${low}%` : `about ${low}-${high}%`;
  };
  const top = (boxes) => {
    const most = Math.max(...boxes.map((box) => box.top));
    return most < 10 ? String(Math.round(most * 10) / 10) : String(Math.round(most));
  };
  const risks = [["low", "low risk"], ["balanced", "balanced"], ["high", "high risk"]].filter(([risk]) => of(risk).length);
  if (!risks.length) return [];
  return [
    `Low risk: items close to the price (up to ${of("low").length ? top(of("low")) : 2}x). High risk: mostly cheap items, but a small chance of up to ${of("high").length ? top(of("high")) : 50}x.`,
    `Every case pays back a little less than it costs on average: ${risks.map(([risk, name]) => name + " " + range(of(risk))).join(", ")} (the price of the big jackpots).`,
  ];
}

const GAMES = {
  jackpot: (L) => ({
    title: "Jackpot",
    sections: [
      {
        heading: "How it works",
        items: [
          `Everybody puts coins into one pot. One player wins the pot - the house keeps ${config.JACKPOT_RAKE}% of it, but never more than half of the other players' coins: you never win back less than you put in.`,
          "Your chance is your share of the pot: 1,000 of 4,000 coins = 25%.",
          `The countdown (${seconds(config.JACKPOT_COUNTDOWN)}) starts with the second player. Bets during the countdown still count.`,
          `Alone in the pot for ${seconds(config.JACKPOT_GHOST_AFTER)}: the 👻 ghost (the house) joins with ${config.JACKPOT_GHOST_MIN}-${config.JACKPOT_GHOST_TOP}% of your coins (at most 🪙 ${n(config.JACKPOT_GHOST_MAX)}) - once: more coins of yours later make your chance bigger. If it wins, the house keeps the pot.`,
          `A bet lands in the pot after ${seconds(config.JACKPOT_BET_DELAY[0])}-${seconds(config.JACKPOT_BET_DELAY[1])} (nobody can answer a bet in the last second). Too late for the draw: it goes into the next pot.`,
          "The winner is drawn with a random animation (wheel, roulette, race, ...). The pot is paid when the draw is over.",
          "Where you stand in a draw says nothing: the spots are shuffled at the start (and swapped now and then while waiting). More players than spots: the spots roll and stop on who is in - the winner always among them, the bigger bets more often.",
        ],
      },
      {
        heading: "Limits",
        items: [`Up to ${n(L.JACKPOT_MAX_BETS)} bets per round.`, `At most 🪙 ${n(L.JACKPOT_MAX_COINS)} per player and round.`],
      },
    ],
  }),

  battles: (L) => ({
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
          "🏅 Best of mode: the best item of a case wins the round - the most rounds win (equal rounds: the bigger worth).",
          "🥄 Worst of mode: the worst item of a case wins the round - the most rounds win (equal rounds: the smaller worth).",
          "❓ Random mode: one of the other modes, picked at random at the very end - while it runs you see the chance and the rounds won (🏅 best, 🥄 worst).",
          "👥 2v2 (Format: 2v2 - always 4 players): Team A (seats 1-2) against Team B (seats 3-4) - pick your team with the Join button of its seat. Every mode counts the two of a team together (their worth, their items of a round added up; jackpot: the team of the drawn player). The winning team splits the pot.",
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
          ...caseFacts(),
          "Provably fair: the seed is fixed (and its hash shown) before the battle and revealed after it.",
        ],
      },
      {
        heading: "Limits",
        items: [`Up to ${n(L.BATTLE_MAX_CASES)} cases per battle, 🪙 ${n(L.BATTLE_MAX_COST)} at most per player.`, `Up to ${n(L.BATTLE_MAX_OPEN)} battles of your own at a time.`],
      },
    ],
  }),

  poker: (L) => {
    const level = (step) => `${n(config.POKER_SMALL_BLIND * step)}/${n(config.POKER_BIG_BLIND * step)}`;
    return {
      title: "Poker",
      sections: [
        {
          heading: "How it works",
          items: [
            `Texas Hold'em, up to ${config.POKER_SEATS} players at the table, played with chips.`,
            "Everybody gets 2 cards, then 5 cards come on the board (flop, turn, river). The best 5 of your 7 cards win the pot.",
            `The house keeps ${config.POKER_RAKE}% of every pot that sees the flop (rake) - a hand that ends before the flop has none.`,
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
          items: [`🪙 ${n(L.POKER_MIN_BUYIN)} to ${n(L.POKER_MAX_BUYIN)} coins become chips.`, "Your chips become coins again when you stand up."],
        },
      ],
    };
  },

  blackjack: (L) => ({
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
          `You can take up to ${L.BJ_MY_SEATS} seats at a table. ${seconds(config.BJ_TURN)} per decision, then the hand stands.`,
          "After the round the bar under the table shows what it brought you: Win / Lose - all your seats and side bets together.",
        ],
      },
      {
        heading: "Side bets",
        items: [
          `From a fifth of the table's min bet up to half its max bet on each (a main bet first), before the cards are dealt. They are decided by the first cards and paid at the end of the round.`,
          "Perfect Pairs - your first two cards are a pair: mixed (red and black) 6:1, coloured (same colour) 12:1, perfect (same suit) 25:1.",
          "21+3 - your two cards and the dealer's up card as a poker hand: flush 5:1, straight 10:1, three of a kind 30:1, straight flush 40:1, suited trips 100:1.",
        ],
      },
      {
        heading: "The 3 rooms",
        items: config.BJ_TABLES.map((table) => `${table.icon} ${table.name}: 🪙 ${n(L[table.minKey])} to ${n(L[table.maxKey])} per seat, side bets 🪙 ${n(Math.max(1, Math.min(Math.ceil(L[table.minKey] * config.BJ_SIDE_MIN_SHARE), Math.floor(L[table.maxKey] * config.BJ_SIDE_SHARE))))} to ${n(Math.floor(L[table.maxKey] * config.BJ_SIDE_SHARE))}. ${table.about}`),
      },
    ],
  }),

  slots: (L) => {
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
            `The free spins turn their own reels: fewer 🍌, more 🎁 - three 🎁 again: ${slots.RETRIGGER} free spins more (up to ${slots.MAX_FREE_SPINS} in one bonus).`,
            `${slots.COIN_TRIGGER} or more 🪙 anywhere start the coin game: the coins stay, the empty spots get ${slots.COIN_RESPINS} respins - every new coin brings them back to ${slots.COIN_RESPINS}.`,
            `Every 🪙 pays its value or a prize: ${slots.COIN_VALUES.filter((v) => v.prize).map((v) => v.prize.toUpperCase() + " " + v.x + "×").join(", ")} the bet. A 🧰 treasure chest: pick one of three closed chests - MINI, MAJOR and MEGA are behind them, shuffled. All 15 spots full: ULTRA, ${slots.ULTRA}× the bet on top (the coin game pays at most ${slots.COIN_MAX_WIN}×).`,
            `No max win: the free spins always play to the end. On average the machine pays back about ${slotsRtp()}% of the bets.`,
            "The line wins of a spin that starts a bonus count as well - first the lines, then the bonus.",
            "Your coins come when the spin is over on the screen.",
            "Auto spins: the bet stays as it is while they run. Max follows your balance - every spin bets the most you may.",
            "One machine at a time: while a tab of yours spins, another tab can't.",
          ],
        },
        {
          heading: "Limits",
          items: [`🪙 ${n(L.SLOTS_MIN_BET)} to ${n(L.SLOTS_MAX_BET)} per spin.`],
        },
      ],
    };
  },

  roulette: (L) => ({
    title: "Roulette",
    sections: [
      {
        heading: "How it works",
        items: [
          "A reel of 15 slots: 7 🟥 red, 7 🟦 blue and 1 🟩 green. Everybody bets on the same roll.",
          `🟥 Red and 🟦 blue pay 2× the bet, 🟩 green pays 14×. On average the wheel pays back about ${(roulette.rtp("red") * 100).toFixed(1)}%.`,
          "Red or blue - never both in one round. Green goes with either of them.",
          `The first bet of a round starts the timer (${seconds(config.ROULETTE_TIMER)}) - more bets until it runs out, then the reel rolls. Nobody bets: no round.`,
          "Provably fair: the hash of the round's seed is shown before the bets, the seed after the roll.",
        ],
      },
      {
        heading: "Limits",
        items: [`At least 🪙 ${n(L.ROULETTE_MIN_BET)} per bet, at most 🪙 ${n(L.ROULETTE_MAX_BET)} per round (all colors together).`],
      },
    ],
  }),

  baucua: (L) => ({
    title: "Bầu Cua",
    sections: [
      {
        heading: "How it works",
        items: [
          "Three dice, every die shows one of six animals: Tiger, Gourd, Rooster, Fish, Crab and Shrimp. Everybody bets on the same roll.",
          "Bet on one animal or on several. The bowl is lifted - every bet pays by how many dice show its animal:",
          `1 die: ${baucua.PAYOUT[1]}× the bet · 2 dice: ${baucua.PAYOUT[2]}× · all 3 dice: ${baucua.PAYOUT[3]}× (your bet included). No die: the bet is lost.`,
          `On average a bet pays back about ${(baucua.rtp() * 100).toFixed(1)}% - the same for every animal.`,
          `The first bet of a round starts the timer (${seconds(config.BAUCUA_TIMER)}) - more bets until it runs out, then the bowl shakes. Nobody bets: no round.`,
          "Provably fair: the hash of the round's seed is shown before the bets, the seed after the roll.",
        ],
      },
      {
        heading: "Limits",
        items: [`At least 🪙 ${n(L.BAUCUA_MIN_BET)} per bet, at most 🪙 ${n(L.BAUCUA_MAX_BET)} per round (all animals together).`, `Up to ${n(L.BAUCUA_MAX_BETS)} bets per round.`],
      },
    ],
  }),

  leaderboard: (L, world) => ({
    title: "Leaderboard",
    sections: [
      {
        heading: "How it works",
        items: [
          "All players by their coins.",
          "Without a season it is live - always up to date. The arrows show who went up or down since midnight.",
          `${world === "/season" ? "" : "🪙 "}${n(coins.wallet(world).dailyBonus())} free coins every day for everybody - they pop up on your first visit of the day, claim them there (🎁 in the top bar: the time to the next ones).`,
          ...(L.CASHBACK_PERCENT > 0 ? [`💸 Daily cashback: after midnight ${L.CASHBACK_PERCENT}% of what you lost in the games the day before comes back${L.CASHBACK_MAX > 0 ? ` (up to ${n(L.CASHBACK_MAX)})` : ""}.`] : []),
          ...(require("./streak").current(world).on ? [`🔥 Daily streak: claim them day after day and they grow - up to ${n(Math.round((coins.wallet(world).dailyBonus() * Math.max(...require("./streak").current(world).rewards)) / 100))} a day. Miss a day and it starts over.`] : []),
        ],
      },
      {
        heading: "Ranking",
        items: [
          "The most coins first.",
          "In a season every player shows 💔 the second chances used and 🫴🏽 the coins wagered (hover over them for the words). The same coins: fewer second chances first - the same second chances: more coins wagered first. Where this made the difference, it is marked.",
          "Only players with the same coins, second chances and coins wagered share a place - and its prize (two players 1st - the next one is 3rd).",
          "Without a season: the same coins, the same place.",
        ],
      },
      {
        heading: "Seasons",
        items: [
          "A season runs from a start to an end. Hit Start to play in it - you get the start budget (and the daily coins you missed since it began). Only players who started are on the leaderboard.",
          "Everybody starts with the same coins - the most coins at the end wins (the prizes, if the season has any). The winners stay on the winner page.",
          "In a season the leaderboard is updated as often as the season says - the arrows show the change since the update before.",
          "Your balance from before the season is kept (🪙 next to the coins of the season) - when the season is over you get it back, with your season coins on top.",
          "Lost everything? A season can have second chances: start again with the budget - the first right away, every further one after the wait the season sets (usually the next day).",
          "Before a season starts and before it ends, the casino closes for a moment: running games finish, no new bets, then a short countdown.",
          "Click the season next to the title to see it: how long it runs, the coins, the prizes.",
        ],
      },
    ],
  }),
};

// The max bet by balance (every game but the overview), null: no cap
function capText(L, world, game) {
  const rule = limits.capRule(world, game);
  if (rule == null) return null;
  const x = limits.dividerOf(world, game);
  const share = Math.round(rule.share * 100) / 100;
  // (what counts: everything bet in the round - a spin, a battle, the chips at the table)
  const what = { slots: "one spin", battles: "one battle", poker: "your chips at the table" }[game] || "all your bets of one round together";
  return `Up to 🪙 ${n(rule.floor)} you can bet all your coins - with more, ${what} ${game === "slots" || game === "battles" ? "is" : "are"} at most ${share}% of your coins (rounded up to the next 100).` + (x > 1 ? ` (Slots spin fast: 1/${x} of the max bet of the other games.)` : "");
}

// world: the limits of that world ("/season": the season's own ones)
function get(game, world = "") {
  if (!Object.hasOwn(GAMES, game)) return null;
  const L = limits.forWorld(world);
  const about = GAMES[game](L, world);
  const cap = capText(L, world, game);
  if (cap && game !== "leaderboard") about.sections.push({ heading: "Max bet", items: [cap] });
  return about;
}

module.exports = { get, GAMES };
