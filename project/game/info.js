const config = require("./config");
const coins = require("./coins");
const slots = require("./slots");

// What the slot machine pays back on average (worked out from its reels and paytable once - it doesn't change)
const limits = require("./limits");
const baucua = require("./baucua");

/*
 * How every game works, for the little "i" next to the title. Made from the
 * config every time, so the limits are the ones the admin set.
 * {title, sub, sections: [{heading, tiles: [{icon, title, text, v}]}]}
 */
const n = (value) => Number(value).toLocaleString("en-US");
const seconds = (ms) => `${Math.round(ms / 1000)} s`;
const minutes = (ms) => `${Math.round(ms / 60000)} min`;

// A tile of a board: an icon and a title, one short line - and a picture (v): {cards}, {coins}, {emoji}, {tags},
// {split}, {steps}, {dice} / {animals} (Bầu Cua's), {grid}, {big} (public/scripts/casino_info.js draws them)
const tile = (icon, title, text, v) => ({ icon, title, text, ...(v ? { v } : {}) });
const section = (heading, tiles) => ({ heading, tiles });

// The cases as they are now (the admin can change them): the biggest item, what they pay back - by risk
function caseTiles() {
  const off = config.BATTLE_CASES_OFF || [];
  const list = require("./cases").list().filter((box) => !box.off && !off.includes(box.id));
  const of = (risk) => list.filter((box) => box.risk === risk);
  const top = (boxes) => {
    const most = Math.max(...boxes.map((box) => box.top));
    return most < 10 ? String(Math.round(most * 10) / 10) : String(Math.round(most));
  };
  const looks = { low: ["🛡️", "Low risk", "Items close to the price"], balanced: ["⚖️", "Balanced", "A bit of both"], high: ["🔥", "High risk", "Mostly cheap items with a small chance of a lot"] };
  return ["low", "balanced", "high"]
    .filter((risk) => of(risk).length)
    .map((risk) => tile(looks[risk][0], looks[risk][1], `${looks[risk][2]}.`, { tags: [[`up to ${top(of(risk))}×`, risk === "high" ? "gold" : risk === "low" ? "green" : "blue"]] }));
}

const GAMES = {
  jackpot: (L) => ({
    title: "Jackpot",
    sub: "Everybody bets into one pot and one player wins it.",
    sections: [
      section("How it works", [
        tile("💰", "One pot", "Everybody bets into the same pot. One player wins all of it.", { coins: ["1,000", "3,000"] }),
        tile("🎯", "Your chance", "Your chance to win equals your share of the pot.", { split: [["You", 25, "gold"], ["Others", 75, "muted"]] }),
        tile("👻", "The ghost", `If you play alone for ${seconds(config.JACKPOT_GHOST_AFTER)}, the house joins once with ${config.JACKPOT_GHOST_MIN} to ${config.JACKPOT_GHOST_TOP}% of your coins, at most 🪙 ${n(config.JACKPOT_GHOST_MAX)}. If it wins, it keeps the pot.`, { emoji: ["👻"] }),
        tile("🏦", "The house", `The house keeps ${config.JACKPOT_RAKE}% of the pot, but never more than half of the other players' coins. You never win less than you bet.`, { tags: [[`${config.JACKPOT_RAKE}%`, "gold"]] }),
      ]),
      section("Limits", [
        tile("🔢", "Bets", `You can place up to ${n(L.JACKPOT_MAX_BETS)} bets per round.`, { big: n(L.JACKPOT_MAX_BETS) }),
        tile("🪙", "Coins", `You can bet at most 🪙 ${n(L.JACKPOT_MAX_COINS)} per round.`, { coins: [n(L.JACKPOT_MAX_COINS)] }),
      ]),
    ],
  }),

  battles: (L) => ({
    title: "Case Battles",
    sub: "Everybody opens the same cases and the mode decides who wins them all.",
    sections: [
      section("How it works", [
        tile("📦", "Pick cases", "Choose the cases, 2 to 4 players and a mode. Every player pays the price of all cases.", { emoji: ["📦", "📦", "🎁"] }),
        tile("🔄", "Rounds", "Each round every player opens the same case. Every item is worth coins.", { steps: ["📦", "💎", "🪙"] }),
        tile("🏆", "The winner", "The winner gets the items of all players, paid out in coins. A tie splits the pot.", { emoji: ["🏆"] }),
        tile("👥", "2v2", "Seats 1 and 2 play against seats 3 and 4. A team counts together and splits the pot.", { steps: ["🅰️🅰️", "⚔️", "🅱️🅱️"] }),
        tile("🤖", "Bots", "The creator can fill free seats with bots. Their items go to the winner as well.", { emoji: ["🤖", "🤖"] }),
        tile("⌛", "Nobody joins", `If nobody joins within ${minutes(config.BATTLE_EXPIRE)}, the battle is cancelled and you get your coins back.`, { emoji: ["⌛", "🔁"] }),
      ]),
      section("Modes", [
        tile("👑", "Classic", "The highest total value wins."),
        tile("🤡", "Crazy", "The lowest total value wins."),
        tile("🎰", "Jackpot", "A roulette draws the winner. Your chance equals your share of the total value."),
        tile("🏅", "Best of", "The best item of each case wins the round. The most rounds win."),
        tile("🥄", "Worst of", "The worst item of each case wins the round. The most rounds win."),
        tile("❓", "Random", "One of the other modes is picked at the very end."),
      ]),
      section("Cases", [tile("🔍", "Look inside", "Click a case to see every item and its chance.", { emoji: ["🔍", "📦"] }), ...caseTiles()]),
      section("Limits", [
        tile("📦", "Cases", `A battle has up to ${n(L.BATTLE_MAX_CASES)} cases.`, { big: n(L.BATTLE_MAX_CASES) }),
        tile("🪙", "Cost", `A battle costs at most 🪙 ${n(L.BATTLE_MAX_COST)} per player.`, { coins: [n(L.BATTLE_MAX_COST)] }),
        tile("📋", "Open", `You can have up to ${n(L.BATTLE_MAX_OPEN)} open battles at a time.`, { big: n(L.BATTLE_MAX_OPEN) }),
      ]),
    ],
  }),

  poker: (L) => {
    const level = (step) => `${n(config.POKER_SMALL_BLIND * step)}/${n(config.POKER_BIG_BLIND * step)}`;
    return {
      title: "Poker",
      sub: "Texas Hold'em with chips. The best five cards win the pot.",
      sections: [
        section("How it works", [
          tile("♠️", "Your hand", `Up to ${config.POKER_SEATS} players sit at a table and everybody gets 2 cards.`, { cards: ["A♠", "K♠"] }),
          tile("🃏", "The board", "Five cards come on the board. The best five of your seven cards count.", { cards: ["Q♠", "J♠", "10♠", "4♥", "2♦"] }),
          tile("🏦", "Rake", `The house keeps ${config.POKER_RAKE}% of every pot that reaches the flop.`, { tags: [[`${config.POKER_RAKE}%`, "gold"]] }),
          ...(config.POKER_BOTS ? [tile("🤖", "Bots", "Bots fill the free seats. Click a bot to take its seat once the hand is over.")] : []),
          tile("🎚️", "Betting", "Use the slider, the mouse wheel or your own presets to set your bet.", { tags: [["½ pot"], ["Pot"], ["All in", "gold"]] }),
          tile("⏱️", "Your turn", `You have ${seconds(config.POKER_TURN)} per decision. After that you check or fold.`, { big: seconds(config.POKER_TURN) }),
          tile("🙈", "Show or muck", `After a hand you have ${seconds(config.POKER_DECIDE)} to show or hide your cards. The winner of a showdown always shows.`, { cards: ["?", "?"] }),
        ]),
        section("Blinds", [
          tile("📈", "They grow", `The blinds rise every ${n(config.POKER_LEVEL_HANDS)} hands.`, { steps: config.POKER_BLIND_STEPS.slice(0, 4).map(level) }),
          tile("🔄", "Back to start", `After ${minutes(config.POKER_LEVEL_RESET)} of an empty table they reset to ${level(1)}.`, { tags: [[level(1)]] }),
        ]),
        section("Buy-in", [tile("🪙", "Coins to chips", `Buy in with 🪙 ${n(L.POKER_MIN_BUYIN)} to ${n(L.POKER_MAX_BUYIN)}. Your chips turn back into coins when you stand up.`, { coins: [n(L.POKER_MIN_BUYIN), n(L.POKER_MAX_BUYIN)] })]),
      ],
    };
  },

  blackjack: (L) => ({
    title: "Blackjack",
    sub: "Get closer to 21 than the dealer without going over.",
    sections: [
      section("How it works", [
        tile("🎯", "Beat the dealer", "Get closer to 21 than the dealer without going over.", { cards: ["K♠", "A♥"] }),
        tile("🔢", "Card values", "Number cards count their number, faces count 10 and an ace counts 1 or 11.", { cards: ["7♣", "K♦", "A♠"] }),
        tile("🕹️", "Your moves", "Hit, stand, double your bet for one more card or split a pair into up to 4 hands.", { tags: [["Hit"], ["Stand"], ["Double", "blue"], ["Split", "blue"]] }),
        tile("🤵", "The dealer", "The dealer draws to 16 and stands on every 17.", { big: "17" }),
        tile("💰", "Pays", "A win pays 2×, a blackjack pays 3:2 and a tie returns your bet.", { tags: [["Win 2×", "green"], ["Blackjack 3:2", "gold"], ["Push", "muted"]] }),
        tile("🔀", "The shoe", "Every round uses a new shoe of 6 decks.", { cards: ["?", "?", "?"] }),
        tile("🪑", "Seats", `You can take up to ${L.BJ_MY_SEATS} seats and have ${seconds(config.BJ_TURN)} per decision.`, { big: String(L.BJ_MY_SEATS) }),
      ]),
      section("Side bets", [
        tile("👯", "Perfect Pairs", "Your first two cards form a pair. Mixed pays 6:1, coloured 12:1 and perfect 25:1.", { cards: ["8♥", "8♥"] }),
        tile("🎲", "21+3", "Your two cards and the dealer's first card. Flush pays 5:1, straight 10:1, trips 30:1, straight flush 40:1 and suited trips 100:1.", { cards: ["5♥", "6♥", "7♥"] }),
        tile("📏", "How much", "Side bets go from a fifth of the min bet to half of the max bet and are placed before the deal.", { tags: [["⅕ min"], ["½ max", "gold"]] }),
      ]),
      section(
        "The 3 rooms",
        config.BJ_TABLES.map((table) => tile(table.icon, table.name, `${table.about} Side bets go up to 🪙 ${n(Math.floor(L[table.maxKey] * config.BJ_SIDE_SHARE))}.`, { coins: [n(L[table.minKey]), n(L[table.maxKey])] })),
      ),
    ],
  }),

  // The dungeon (game/rpg.js): no bets - entries, packs, a hero; its numbers from the module
  rpg: () => {
    const rpg = require("./rpg");
    const packs = Object.values(rpg.PACKS);
    return {
      title: "Dungeon",
      sub: "Build a character and a deck, then clear floors for coins.",
      sections: [
        section("Your character", [
          tile("🧙", "5 classes", `Every class is a character of its own. The first one is free, the second costs 🪙 ${n(rpg.CLASS_PRICE)} and every next one twice as much.`, { emoji: ["⚔️", "🔰", "✨", "🗡️", "🔮"] }),
          tile("📈", "Stats", `Raise your stats with coins or with points from level ups. Your main stat counts more.`, { tags: [["❤️ HP"], ["💪 Strength"], ["🛡️ Armor"], ["🍀 Luck"], ["🦊 Instinct"]] }),
          tile("⭐", "Levels", `Fights and floors give XP. New talents unlock at levels ${rpg.TALENT_LEVELS.join(", ")}.`, { big: "Lv " + rpg.HERO_LEVEL_MAX }),
          tile("🗡️", "Gear", "Weapons, armor and charms drop in the dungeon.", { emoji: ["🗡️", "🛡️", "📿"] }),
        ]),
        section("A run", [
          tile("🏰", "Floors", `Clear a floor to open the next one. Play alone or in a party of up to ${rpg.PARTY_MAX}.`, { steps: ["1", "2", "3", "…", String(rpg.FLOORS)] }),
          tile("🗺️", "The map", "Use the map to navigate further. Rooms can be sensed scaling with the instinct attribute.", { emoji: ["⚔️", "❓", "🔥", "⚖️"] }),
          tile("💰", "The pot", "Fights fill the pot. Leave between rooms to keep it. If the party falls, it is lost.", { steps: ["⚔️", "💰", "🚪"] }),
          tile("🧪", "Potions", `A potion heals ${Math.round(rpg.POTION_HEAL * 100)}% of your HP.`, { emoji: ["🧪", "🧪", "🧪"] }),
        ]),
        section("Fights", [
          tile("✋", "A turn", `Every turn you get ${rpg.ENERGY} mana and 5 cards. Drag a card onto its target and end the turn when you are done.`, { emoji: ["🃏", "🃏", "🃏", "🃏", "🃏"] }),
          tile("🛡️", "Block", "Block takes the hits until your next turn. Exhausted cards are gone until the fight ends.", { tags: [["🛡️ 12", "blue"]] }),
          tile("🏷️", "Badges", "Every monster shows what it does next.", { tags: [["⚔️ 9", "red"], ["🛡️ Defend", "blue"]] }),
          tile("😡", "Long fights", `After ${rpg.FURY_TURN} turns the monsters grow furious. They stop healing and hit harder every turn.`, { steps: ["⚔️", "⏳", "😡"] }),
        ]),
        section("Cards and packs", [
          tile("🃏", "Your deck", `Your deck holds ${rpg.DECK_MIN} to ${rpg.DECK_MAX} cards from your collection.`, { big: `${rpg.DECK_MIN}-${rpg.DECK_MAX}` }),
          tile("🛒", "The shop", "Buy card packs with coins or dust. Spare cards turn into dust that makes the cards you miss.", { emoji: packs.map((pack) => pack.icon) }),
        ]),
      ],
    };
  },

  slots: (L) => {
    // (what the buys pay back: one number when they are the same)
    const buyBack = () => {
      const all = [slots.BUY_RTP.free, slots.BUY_RTP.coins, slots.BUY_RTP.chest].map((x) => Math.round(x * 100));
      const low = Math.min(...all), high = Math.max(...all);
      return low === high ? `${low}%` : `${low}-${high}%`;
    };
    const spins = slots.BONUS_SPINS.map((f) => f.spins).join(", ");
    const starts = slots.BONUS_MULTIPLIERS.map((f) => "×" + f.multiplier).join(", ");
    const prizes = slots.COIN_VALUES.filter((v) => v.prize);
    return {
      title: "Slots",
      sub: `5 reels and ${slots.LINE_COUNT} lines with free spins and a coin game.`,
      sections: [
        section("How it works", [
          tile("🎰", "The reels", `5 reels, 3 rows and ${slots.LINE_COUNT} lines.`, { grid: [["🍌", "🐸", "💎", "🐕", "🚀"], ["🐸", "🐸", "🐸", "💰", "🍌"], ["🚀", "🐕", "🍌", "👑", "🐸"]] }),
          tile("➡️", "Line wins", "Land 3, 4 or 5 of a symbol on a line starting from the left. The paytable shows what each pays.", { emoji: ["🐸", "🐸", "🐸"] }),
          tile("👑", "Wild", "The wild stands for every symbol.", { emoji: ["👑"] }),
        ]),
        section("Free spins", [
          tile("🎁", "Start them", "Land 🎁 on reels 1, 3 and 5 at the same time.", { grid: [["🎁", "·", "🎁", "·", "🎁"]] }),
          tile("🎡", "Two wheels", `Two wheels decide your spins and the start multiplier.`, { tags: [["Spins", "blue"], ["×", "gold"]] }),
          tile("📈", "Multiplier", `Every win is multiplied. The multiplier grows by ${slots.BONUS_STEP} after every free spin.`, { steps: ["×1", "×" + (1 + slots.BONUS_STEP), "×" + (1 + 2 * slots.BONUS_STEP)] }),
          tile("🔁", "More", `Three 🎁 again give ${slots.RETRIGGER} more spins, up to ${slots.MAX_FREE_SPINS} in total.`, { tags: [[`+${slots.RETRIGGER}`, "green"]] }),
        ]),
        section("Coin game", [
          tile("🪙", "Start it", `Land ${slots.COIN_TRIGGER} or more 🪙 anywhere. The coins stay and the rest gets ${slots.COIN_RESPINS} respins. Every new coin resets them.`, { emoji: Array(slots.COIN_TRIGGER).fill("🪙") }),
          tile("💎", "Prizes", "Every coin pays its value or a prize times your bet.", { tags: prizes.map((v) => [v.prize.toUpperCase() + " " + v.x + "×", v.prize === "mini" ? "green" : v.prize === "major" ? "blue" : "gold"]) }),
          tile("🧰", "Treasure chest", "Pick one of three chests. MINI, MAJOR and MEGA are hidden behind them.", { emoji: ["🧰", "🧰", "🧰"] }),
          tile("🌟", "ULTRA", `Fill all 15 spots for ${slots.ULTRA}× your bet on top.`, { big: slots.ULTRA + "×" }),
        ]),
        section("More", [
          tile("🛒", "Bonus buy", `Buy your way into a bonus. Free spins cost ${slots.BUY_PRICES.free}×, the coin game ${slots.BUY_PRICES.coins}× and the coin game with a chest ${slots.BUY_PRICES.chest}× your bet.`, { tags: [[slots.BUY_PRICES.free + "×"], [slots.BUY_PRICES.coins + "×"], [slots.BUY_PRICES.chest + "×", "gold"]] }),
          tile("🔁", "Auto spins", "Spin 10 to 100 times or endlessly with the same bet.", { tags: [["10"], ["50"], ["100"], ["∞", "gold"]] }),
          tile("🪙", "Your bet", `Bet 🪙 ${n(L.SLOTS_MIN_BET)} to ${n(L.SLOTS_MAX_BET)} per spin.`, { coins: [n(L.SLOTS_MIN_BET), n(L.SLOTS_MAX_BET)] }),
        ]),
      ],
    };
  },

  roulette: (L) => ({
    title: "Roulette",
    sub: "Bet on red, blue or green. Everybody plays the same roll.",
    sections: [
      section("How it works", [
        tile("🎡", "The reel", "The reel has 7 red, 7 blue and 1 green slot.", { emoji: ["🟥", "🟦", "🟥", "🟦", "🟩", "🟥", "🟦"] }),
        tile("💰", "Pays", "Red and blue pay 2×, green pays 14×.", { tags: [["🟥 2×", "red"], ["🟦 2×", "blue"], ["🟩 14×", "green"]] }),
        tile("⚖️", "Red or blue", "You can bet on red or blue in a round, never both. Green goes with either.", { tags: [["🟥 + 🟩"], ["🟦 + 🟩"]] }),
      ]),
      section("Limits", [tile("🪙", "Bets", `Bet at least 🪙 ${n(L.ROULETTE_MIN_BET)} and at most 🪙 ${n(L.ROULETTE_MAX_BET)} per round.`, { coins: [n(L.ROULETTE_MIN_BET), n(L.ROULETTE_MAX_BET)] })]),
    ],
  }),

  baucua: (L) => ({
    title: "Bầu Cua",
    sub: "Bet on the animals the three dice will show.",
    sections: [
      section("How it works", [
        tile("🎲", "Three dice", "Every die shows one of six animals.", { dice: ["tiger", "crab", "fish"] }),
        tile("🎯", "Your bet", "Bet on one animal or several. Everybody plays the same roll.", { animals: ["tiger", "gourd", "rooster", "fish", "crab", "shrimp"] }),
        tile("💰", "Pays", `One die with your animal pays ${baucua.PAYOUT[1]}×, two pay ${baucua.PAYOUT[2]}× and three pay ${baucua.PAYOUT[3]}×.`, { tags: [[`1 · ${baucua.PAYOUT[1]}×`], [`2 · ${baucua.PAYOUT[2]}×`, "blue"], [`3 · ${baucua.PAYOUT[3]}×`, "gold"]] }),
      ]),
      section("Limits", [
        tile("🪙", "Bets", `Bet at least 🪙 ${n(L.BAUCUA_MIN_BET)} and at most 🪙 ${n(L.BAUCUA_MAX_BET)} per round.`, { coins: [n(L.BAUCUA_MIN_BET), n(L.BAUCUA_MAX_BET)] }),
        tile("🔢", "Count", `You can place up to ${n(L.BAUCUA_MAX_BETS)} bets per round.`, { big: n(L.BAUCUA_MAX_BETS) }),
      ]),
    ],
  }),

  runner: (L) => {
    const pct = (share) => Math.round(share * 1000) / 10;
    const t = require("./runner").table();
    return {
      title: "Runner",
      sub: "Run as far as you can. The farther you get, the more you win.",
      sections: [
        section("How it works", [
          tile("🏃", "The run", "Change lanes to dodge trains, jump over barriers and roll under bars. The run gets faster the longer it goes.", { tags: [["← →"], ["↑ jump"], ["↓ roll"]] }),
          tile("💰", "Pays", `From ${n(t.min)} m you get part of your entry back. At ${n(t.even)} m you get your entry back, and longer runs pay up to ${t.max}×.`, { tags: [[`${n(t.min)} m · ${t.minMult}×`], [`${n(t.even)} m · 1×`, "blue"], [`${n(t.top)} m · ${t.max}×`, "gold"]] }),
          tile("🪙", "Coins", `Every coin you pick up adds ${pct(config.RUNNER_COIN_BONUS)}% to your payout, up to ${pct(config.RUNNER_COIN_CAP)}%.`, { big: "+" + pct(config.RUNNER_COIN_BONUS) + "%" }),
          tile("🎟️", "Entry", `Enter with 🪙 ${n(L.RUNNER_MIN_BET)} to 🪙 ${n(L.RUNNER_MAX_BET)}.`, { coins: [n(L.RUNNER_MIN_BET), n(L.RUNNER_MAX_BET)] }),
          ...(config.RUNNER_DAILY > 0 ? [tile("📅", "Per day", `You can play ${n(config.RUNNER_DAILY)} paid runs a day. Practice is always free.`, { big: n(config.RUNNER_DAILY) })] : []),
          tile("🎯", "Practice", "Practice runs are free and pay nothing. Use them to get better first."),
        ]),
      ],
    };
  },

  leaderboard: (L, world) => {
    const season = require("./season_slots").isSeason(world);
    const streak = require("./streak").current(world);
    const daily = coins.wallet(world).dailyBonus();
    return {
      title: "Leaderboard",
      sub: "All players ranked by their coins.",
      sections: [
        section("How it works", [
          tile("🏆", "By coins", "The player with the most coins leads.", { emoji: ["🥇", "🥈", "🥉"] }),
          tile("🎁", "Daily coins", `Claim ${season ? "" : "🪙 "}${n(daily)} free coins every day.`, { coins: [n(daily)] }),
          ...(L.CASHBACK_PERCENT > 0 ? [tile("💸", "Cashback", `After midnight ${L.CASHBACK_PERCENT}% of yesterday's losses come back${L.CASHBACK_MAX > 0 ? `, up to ${n(L.CASHBACK_MAX)}` : ""}.`, { tags: [[`${L.CASHBACK_PERCENT}%`, "green"]] })] : []),
          ...(streak.on ? [tile("🔥", "Daily streak", `Claim every day and your daily coins grow up to ${n(Math.round((daily * Math.max(...streak.rewards)) / 100))}. Missing a day starts the streak over.`, { steps: ["🔥", "🔥🔥", "🔥🔥🔥"] })] : []),
        ]),
        section("Ranking", [
          tile("💔", "In a season", "With the same coins, fewer second chances rank higher, then more coins wagered.", { tags: [["💔 1"], ["🫴🏽 50k"]] }),
          tile("🎟️", "A place", "To get a place you have to wager the start coins times the season's factor.", { steps: ["🪙", "🫴🏽", "🏅"] }),
          tile("🤝", "Shared places", "Players with the same coins, chances and wagers share a place and its prize.", { tags: [["1st"], ["1st"], ["3rd", "muted"]] }),
        ]),
        section("Seasons", [
          tile("🗓️", "Start", "Hit Start to play with the start budget.", { steps: ["▶️", "🪙", "🏁"] }),
          tile("🏁", "Win", "Everybody starts with the same coins. The most coins at the end win the prizes.", { emoji: ["🏆"] }),
          tile("💼", "Your coins", "Your coins are kept aside and come back after the season together with your season coins.", { coins: ["kept"] }),
          tile("💔", "Second chances", "If you lose everything, you can start again with the budget. The next chance comes after a wait.", { emoji: ["💔", "🔁"] }),
        ]),
      ],
    };
  },
};

// The max bet by balance (every game but the overview), null: no cap
function capText(L, world, game) {
  const rule = limits.capRule(world, game);
  if (rule == null) return null;
  const x = limits.dividerOf(world, game);
  const share = Math.round(rule.share * 100) / 100;
  // (what counts: everything bet in the round - a spin, a battle, the chips at the table)
  const what = { slots: "one spin", battles: "one battle", poker: "your chips at the table", runner: "the entry of a run" }[game] || "all your bets of one round together";
  return `With up to 🪙 ${n(rule.floor)} you can bet all your coins. With more, ${what} ${["slots", "battles", "runner"].includes(game) ? "is" : "are"} limited to ${share}% of your coins.` + (x > 1 ? ` Slots allow 1/${x} of the max bet of the other games.` : "");
}

// world: the limits of that world ("/season": the season's own ones)
function get(game, world = "") {
  if (!Object.hasOwn(GAMES, game)) return null;
  const L = limits.forWorld(world);
  const about = GAMES[game](L, world);
  const cap = capText(L, world, game);
  if (cap && game !== "leaderboard" && game !== "rpg") about.sections.push(section("Max bet", [tile("📏", "By your balance", cap, { tags: [[`${Math.round(limits.capRule(world, game).share * 100) / 100}%`, "gold"]] })]));
  return about;
}

module.exports = { get, GAMES };
