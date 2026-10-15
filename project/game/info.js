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
  const range = (boxes) => {
    const low = Math.round(Math.min(...boxes.map((box) => box.rtp)) * 100);
    const high = Math.round(Math.max(...boxes.map((box) => box.rtp)) * 100);
    return low === high ? `${low}%` : `${low}-${high}%`;
  };
  const top = (boxes) => {
    const most = Math.max(...boxes.map((box) => box.top));
    return most < 10 ? String(Math.round(most * 10) / 10) : String(Math.round(most));
  };
  const looks = { low: ["🛡️", "Low risk", "Items close to the price"], balanced: ["⚖️", "Balanced", "A bit of both"], high: ["🔥", "High risk", "Mostly cheap - a small chance of a lot"] };
  return ["low", "balanced", "high"]
    .filter((risk) => of(risk).length)
    .map((risk) => tile(looks[risk][0], looks[risk][1], `${looks[risk][2]}. Pays back ${range(of(risk))} on average.`, { tags: [[`up to ${top(of(risk))}×`, risk === "high" ? "gold" : risk === "low" ? "green" : "blue"]] }));
}

const GAMES = {
  jackpot: (L) => ({
    title: "Jackpot",
    sub: "One pot, one winner - your chance is your share.",
    sections: [
      section("How it works", [
        tile("💰", "One pot", "Everybody bets into one pot. One player wins all of it.", { coins: ["1,000", "3,000"] }),
        tile("🎯", "Your chance", "Your share of the pot: 1,000 of 4,000 = 25%.", { split: [["You", 25, "gold"], ["Others", 75, "muted"]] }),
        tile("⏱️", "Countdown", `${seconds(config.JACKPOT_COUNTDOWN)} from the second player on - bets during it still count.`, { steps: ["👤", "👥", "⏱️", "🎉"] }),
        tile("👻", "The ghost", `Alone for ${seconds(config.JACKPOT_GHOST_AFTER)}: the house joins once with ${config.JACKPOT_GHOST_MIN}-${config.JACKPOT_GHOST_TOP}% of your coins (max 🪙 ${n(config.JACKPOT_GHOST_MAX)}). If it wins, it keeps the pot.`, { emoji: ["👻"] }),
        tile("🏦", "The house", `Keeps ${config.JACKPOT_RAKE}% of the pot - never more than half of the others' coins: you never win less than you bet.`, { tags: [[`${config.JACKPOT_RAKE}%`, "gold"]] }),
        tile("🛬", "Bets land", `After ${seconds(config.JACKPOT_BET_DELAY[0])}-${seconds(config.JACKPOT_BET_DELAY[1])}. Too late for the draw: into the next pot.`, { steps: ["🪙", "⏳", "🍯"] }),
        tile("🎡", "The draw", "A random animation picks the winner - your spot means nothing. Paid when it's over.", { emoji: ["🎡", "🏇", "🎰"] }),
      ]),
      section("Limits", [
        tile("🔢", "Bets", `Up to ${n(L.JACKPOT_MAX_BETS)} bets per round.`, { big: n(L.JACKPOT_MAX_BETS) }),
        tile("🪙", "Coins", `At most 🪙 ${n(L.JACKPOT_MAX_COINS)} per player and round.`, { coins: [n(L.JACKPOT_MAX_COINS)] }),
      ]),
    ],
  }),

  battles: (L) => ({
    title: "Case Battles",
    sub: "Everybody opens the same cases - the mode decides who takes it all.",
    sections: [
      section("How it works", [
        tile("📦", "Pick cases", "Cases, 2 to 4 players and a mode. Everybody pays the cost of all the cases.", { emoji: ["📦", "📦", "🎁"] }),
        tile("🔄", "Rounds", "Every round everybody opens the same case. Its items are worth coins.", { steps: ["📦", "💎", "🪙"] }),
        tile("🏆", "The winner", "Takes the items of everybody, paid in coins at the end. A tie splits the pot.", { emoji: ["🏆"] }),
        tile("👥", "2v2", "Seats 1-2 against 3-4. A team counts together and splits the pot.", { steps: ["🅰️🅰️", "⚔️", "🅱️🅱️"] }),
        tile("🤖", "Bots", "The creator can fill free seats with bots - their items go to the winner too.", { emoji: ["🤖", "🤖"] }),
        tile("⌛", "Nobody joins", `Within ${minutes(config.BATTLE_EXPIRE)}: cancelled, your coins come back. Done: start it again with one click.`, { emoji: ["⌛", "🔁"] }),
      ]),
      section("Modes", [
        tile("👑", "Classic", "The most worth wins."),
        tile("🤡", "Crazy", "The lowest worth wins."),
        tile("🎰", "Jackpot", "A roulette draws one winner - your chance is your share of the worth."),
        tile("🏅", "Best of", "The best item of a case wins the round - the most rounds win."),
        tile("🥄", "Worst of", "The worst item wins the round - the most rounds win."),
        tile("❓", "Random", "One of the others, picked at the very end."),
      ]),
      section("Cases", [tile("🔍", "Look inside", "Click a case: every item and its chance.", { emoji: ["🔍", "📦"] }), ...caseTiles(), tile("🔒", "Provably fair", "The seed's hash shows before the battle, the seed after it.", { emoji: ["🔒", "🔑"] })]),
      section("Limits", [
        tile("📦", "Cases", `Up to ${n(L.BATTLE_MAX_CASES)} per battle.`, { big: n(L.BATTLE_MAX_CASES) }),
        tile("🪙", "Cost", `At most 🪙 ${n(L.BATTLE_MAX_COST)} per player.`, { coins: [n(L.BATTLE_MAX_COST)] }),
        tile("📋", "Open", `Up to ${n(L.BATTLE_MAX_OPEN)} battles of your own at a time.`, { big: n(L.BATTLE_MAX_OPEN) }),
      ]),
    ],
  }),

  poker: (L) => {
    const level = (step) => `${n(config.POKER_SMALL_BLIND * step)}/${n(config.POKER_BIG_BLIND * step)}`;
    return {
      title: "Poker",
      sub: "Texas Hold'em with chips - the best five cards take the pot.",
      sections: [
        section("How it works", [
          tile("♠️", "Your hand", `Up to ${config.POKER_SEATS} players. Everybody gets 2 cards.`, { cards: ["A♠", "K♠"] }),
          tile("🃏", "The board", "Flop, turn, river: 5 cards. The best 5 of your 7 win.", { cards: ["Q♠", "J♠", "10♠", "4♥", "2♦"] }),
          tile("🏦", "Rake", `The house keeps ${config.POKER_RAKE}% of a pot that sees the flop.`, { tags: [[`${config.POKER_RAKE}%`, "gold"]] }),
          tile("🎚️", "Betting", "The slider, the mouse wheel or your own presets - in big blinds.", { tags: [["½ pot"], ["Pot"], ["All in", "gold"]] }),
          tile("⏱️", "Your turn", `${seconds(config.POKER_TURN)} per decision - then check, or fold.`, { big: seconds(config.POKER_TURN) }),
          tile("🙈", "Show or muck", `After a hand, ${seconds(config.POKER_DECIDE)} to show or hide your cards. A showdown's winner always shows.`, { cards: ["?", "?"] }),
        ]),
        section("Blinds", [
          tile("📈", "They grow", `Every ${n(config.POKER_LEVEL_HANDS)} hands.`, { steps: config.POKER_BLIND_STEPS.slice(0, 4).map(level) }),
          tile("🔄", "Back to start", `An empty table for ${minutes(config.POKER_LEVEL_RESET)}: back to ${level(1)}.`, { tags: [[level(1)]] }),
        ]),
        section("Buy-in", [tile("🪙", "Coins to chips", `🪙 ${n(L.POKER_MIN_BUYIN)} to ${n(L.POKER_MAX_BUYIN)}. Stand up: chips become coins again.`, { coins: [n(L.POKER_MIN_BUYIN), n(L.POKER_MAX_BUYIN)] })]),
      ],
    };
  },

  blackjack: (L) => ({
    title: "Blackjack",
    sub: "Closer to 21 than the dealer - without going over.",
    sections: [
      section("How it works", [
        tile("🎯", "Beat the dealer", "Get closer to 21 than the dealer without going over.", { cards: ["K♠", "A♥"] }),
        tile("🔢", "Card values", "2-10 their number, J Q K 10, an ace 1 or 11.", { cards: ["7♣", "K♦", "A♠"] }),
        tile("🕹️", "Your moves", "Hit, stand, double (one card, double bet) or split a pair - up to 4 hands.", { tags: [["Hit"], ["Stand"], ["Double", "blue"], ["Split", "blue"]] }),
        tile("🤵", "The dealer", "Draws to 16, stands on every 17.", { big: "17" }),
        tile("💰", "Pays", "A win 2× your bet, blackjack 3:2, the same total: your bet back.", { tags: [["Win 2×", "green"], ["Blackjack 3:2", "gold"], ["Push", "muted"]] }),
        tile("🔀", "The shoe", "A new 6-deck shoe every round - counting doesn't help.", { cards: ["?", "?", "?"] }),
        tile("🪑", "Seats", `Up to ${L.BJ_MY_SEATS} seats at a table, ${seconds(config.BJ_TURN)} per decision.`, { big: String(L.BJ_MY_SEATS) }),
      ]),
      section("Side bets", [
        tile("👯", "Perfect Pairs", "Your first two cards a pair: mixed 6:1, coloured 12:1, perfect 25:1.", { cards: ["8♥", "8♥"] }),
        tile("🎲", "21+3", "Your cards + the dealer's: flush 5:1, straight 10:1, trips 30:1, straight flush 40:1, suited trips 100:1.", { cards: ["5♥", "6♥", "7♥"] }),
        tile("📏", "How much", "From a fifth of the min bet to half the max bet, before the deal.", { tags: [["⅕ min"], ["½ max", "gold"]] }),
      ]),
      section(
        "The 3 rooms",
        config.BJ_TABLES.map((table) => tile(table.icon, table.name, `${table.about} Side bets up to 🪙 ${n(Math.floor(L[table.maxKey] * config.BJ_SIDE_SHARE))}.`, { coins: [n(L[table.minKey]), n(L[table.maxKey])] })),
      ),
    ],
  }),

  // The dungeon (game/rpg.js): no bets - entries, packs, a hero; its numbers from the module
  rpg: () => {
    const rpg = require("./rpg");
    const rarities = Object.values(rpg.CARD_RARITIES).filter((r) => r.value);
    const packs = Object.values(rpg.PACKS);
    return {
      title: "⚔️ Dungeon",
      sub: "A character, a deck of cards - and floors that pay.",
      sections: [
        section("Your character", [
          tile("🧙", "5 classes", `Each its own character. The first is free, others 🪙 ${n(rpg.CLASS_PRICE)}.`, { emoji: ["⚔️", "🔰", "✨", "🗡️", "🔮"] }),
          tile("📈", "Stats", `Coins (from 🪙 ${n(rpg.upgradeCost(0))}) or level-up points. Your main stat counts more.`, { tags: [["❤️ HP"], ["⚔️ Attack"], ["🛡️ Armor"], ["🍀 Luck"], ["🦊 Instinct"]] }),
          tile("⭐", "Levels", `XP from fights and floors. Talents at ${rpg.TALENT_LEVELS.join(", ")}.`, { big: "Lv " + rpg.HERO_LEVEL_MAX }),
          tile("🗡️", "Gear", "Weapons, armor and charms drop in the dungeon.", { emoji: ["🗡️", "🛡️", "📿"] }),
        ]),
        section("A run", [
          tile("🏰", "Floors", `${rpg.FLOORS} floors, each opens the next. Alone or a party of up to ${rpg.PARTY_MAX}. Floor 1: 🪙 ${n(rpg.entryCost(1))}.`, { steps: ["1", "2", "3", "…", String(rpg.FLOORS)] }),
          tile("🗺️", "The map", "Pick the next room; a party votes. Rooms are hidden - instinct senses them.", { emoji: ["⚔️", "❓", "🔥", "⚖️"] }),
          tile("💰", "The pot", "Fights fill it. Leave between rooms with it - all down: it's lost.", { steps: ["⚔️", "💰", "🚪"] }),
          tile("🧪", "Potions", `Heal ${Math.round(rpg.POTION_HEAL * 100)}%. From 🪙 ${n(rpg.potionPrice(1))}.`, { emoji: ["🧪", "🧪", "🧪"] }),
        ]),
        section("Fights", [
          tile("✋", "A turn", `${rpg.ENERGY} mana, 5 cards. Drag a card onto its target, then end the turn.`, { emoji: ["🃏", "🃏", "🃏", "🃏", "🃏"] }),
          tile("🛡️", "Block", "Takes the hits of this turn. Exhaust: gone for the fight.", { tags: [["🛡️ 12", "blue"]] }),
          tile("🏷️", "Badges", "Every monster shows what it does next.", { tags: [["⚔️ 9", "red"], ["🛡️ Defend", "blue"]] }),
        ]),
        section("Cards and packs", [
          tile("🃏", "Your deck", `${rpg.DECK_MIN} to ${rpg.DECK_MAX} cards from your collection.`, { big: `${rpg.DECK_MIN}-${rpg.DECK_MAX}` }),
          ...packs.map((pack) => tile(pack.icon, pack.name, pack.about, { coins: [n(pack.price)] })),
          tile("💸", "Spares", `${rpg.PACK_BUNDLE}+ packs: ${Math.round(rpg.BUNDLE_OFF * 100)}% off. Extra copies sell: ${rarities.map((r) => r.name + " " + n(r.value)).join(", ")}.`, { tags: [[`-${Math.round(rpg.BUNDLE_OFF * 100)}%`, "green"]] }),
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
      sub: `5 reels, ${slots.LINE_COUNT} lines - free spins and a coin game on top.`,
      sections: [
        section("How it works", [
          tile("🎰", "The reels", `5 reels, 3 rows, ${slots.LINE_COUNT} lines - all play. The bet is for the whole spin.`, { grid: [["🍌", "🐸", "💎", "🐕", "🚀"], ["🐸", "🐸", "🐸", "💰", "🍌"], ["🚀", "🐕", "🍌", "👑", "🐸"]] }),
          tile("➡️", "Line wins", "3, 4 or 5 of a symbol on a line, from the left reel. The paytable shows what each pays.", { emoji: ["🐸", "🐸", "🐸"] }),
          tile("👑", "Wild", "Stands for every symbol.", { emoji: ["👑"] }),
          tile("📊", "Payback", `About ${slotsRtp()}% of the bets on average. Coins come when the spin is over.`, { big: slotsRtp() + "%" }),
        ]),
        section("Free spins", [
          tile("🎁", "Start them", "🎁 on reels 1, 3 and 5 at once.", { grid: [["🎁", "·", "🎁", "·", "🎁"]] }),
          tile("🎡", "Two wheels", `Your spins (${spins}) and the start multiplier (${starts}).`, { tags: [["Spins", "blue"], ["×", "gold"]] }),
          tile("📈", "Multiplier", `Every win × it - it grows by ${slots.BONUS_STEP} after every free spin.`, { steps: ["×1", "×" + (1 + slots.BONUS_STEP), "×" + (1 + 2 * slots.BONUS_STEP)] }),
          tile("🔁", "More", `Three 🎁 again: ${slots.RETRIGGER} spins more (up to ${slots.MAX_FREE_SPINS}).`, { tags: [[`+${slots.RETRIGGER}`, "green"]] }),
        ]),
        section("Coin game", [
          tile("🪙", "Start it", `${slots.COIN_TRIGGER}+ 🪙 anywhere. The coins stay, the rest get ${slots.COIN_RESPINS} respins - every new coin resets them.`, { emoji: Array(slots.COIN_TRIGGER).fill("🪙") }),
          tile("💎", "Prizes", "Every coin pays its value or a prize (× the bet).", { tags: prizes.map((v) => [v.prize.toUpperCase() + " " + v.x + "×", v.prize === "mini" ? "green" : v.prize === "major" ? "blue" : "gold"]) }),
          tile("🧰", "Treasure chest", "Pick one of three: MINI, MAJOR and MEGA are behind them.", { emoji: ["🧰", "🧰", "🧰"] }),
          tile("🌟", "ULTRA", `All 15 spots full: ${slots.ULTRA}× the bet on top (at most ${slots.COIN_MAX_WIN}×).`, { big: slots.ULTRA + "×" }),
        ]),
        section("More", [
          tile("🛒", "Bonus buy", `Right into a bonus: free games ${slots.BUY_PRICES.free}×, coin game ${slots.BUY_PRICES.coins}×, with a 🧰 ${slots.BUY_PRICES.chest}× - about ${buyBack()} back.`, { tags: [[slots.BUY_PRICES.free + "×"], [slots.BUY_PRICES.coins + "×"], [slots.BUY_PRICES.chest + "×", "gold"]] }),
          tile("🔁", "Auto spins", "10 to 100 or ∞ - the bet stays. One machine at a time.", { tags: [["10"], ["50"], ["100"], ["∞", "gold"]] }),
          tile("🪙", "Your bet", `🪙 ${n(L.SLOTS_MIN_BET)} to ${n(L.SLOTS_MAX_BET)} per spin.`, { coins: [n(L.SLOTS_MIN_BET), n(L.SLOTS_MAX_BET)] }),
        ]),
      ],
    };
  },

  roulette: (L) => ({
    title: "Roulette",
    sub: "Red, blue or the green one - everybody bets on the same roll.",
    sections: [
      section("How it works", [
        tile("🎡", "The reel", "15 slots: 7 red, 7 blue and 1 green.", { emoji: ["🟥", "🟦", "🟥", "🟦", "🟩", "🟥", "🟦"] }),
        tile("💰", "Pays", `Red and blue 2×, green 14×. About ${(roulette.rtp("red") * 100).toFixed(1)}% back on average.`, { tags: [["🟥 2×", "red"], ["🟦 2×", "blue"], ["🟩 14×", "green"]] }),
        tile("⚖️", "Red or blue", "Never both in a round - green goes with either.", { tags: [["🟥 + 🟩"], ["🟦 + 🟩"]] }),
        tile("⏱️", "The timer", `The first bet starts it (${seconds(config.ROULETTE_TIMER)}) - then the reel rolls.`, { steps: ["🪙", "⏱️", "🎡"] }),
        tile("🔒", "Provably fair", "The seed's hash before the bets, the seed after the roll.", { emoji: ["🔒", "🔑"] }),
      ]),
      section("Limits", [tile("🪙", "Bets", `At least 🪙 ${n(L.ROULETTE_MIN_BET)} per bet, at most 🪙 ${n(L.ROULETTE_MAX_BET)} per round.`, { coins: [n(L.ROULETTE_MIN_BET), n(L.ROULETTE_MAX_BET)] })]),
    ],
  }),

  baucua: (L) => ({
    title: "Bầu Cua",
    sub: "Three dice, six animals - bet on the ones that come up.",
    sections: [
      section("How it works", [
        tile("🎲", "Three dice", "Every die shows one of six animals: tiger, gourd, rooster, fish, crab, shrimp.", { dice: ["tiger", "crab", "fish"] }),
        tile("🎯", "Your bet", "On one animal or several - everybody bets on the same roll.", { animals: ["tiger", "gourd", "rooster", "fish", "crab", "shrimp"] }),
        tile("💰", "Pays", `Per die with your animal: 1 ${baucua.PAYOUT[1]}×, 2 ${baucua.PAYOUT[2]}×, 3 ${baucua.PAYOUT[3]}× (your bet included).`, { tags: [[`1 · ${baucua.PAYOUT[1]}×`], [`2 · ${baucua.PAYOUT[2]}×`, "blue"], [`3 · ${baucua.PAYOUT[3]}×`, "gold"]] }),
        tile("📊", "Payback", `About ${(baucua.rtp() * 100).toFixed(1)}% - the same for every animal.`, { big: (baucua.rtp() * 100).toFixed(1) + "%" }),
        tile("⏱️", "The timer", `The first bet starts it (${seconds(config.BAUCUA_TIMER)}) - then the bowl shakes.`, { steps: ["🪙", "⏱️", "🥣"] }),
        tile("🔒", "Provably fair", "The seed's hash before the bets, the seed after the roll.", { emoji: ["🔒", "🔑"] }),
      ]),
      section("Limits", [
        tile("🪙", "Bets", `At least 🪙 ${n(L.BAUCUA_MIN_BET)} per bet, at most 🪙 ${n(L.BAUCUA_MAX_BET)} per round.`, { coins: [n(L.BAUCUA_MIN_BET), n(L.BAUCUA_MAX_BET)] }),
        tile("🔢", "Count", `Up to ${n(L.BAUCUA_MAX_BETS)} bets per round.`, { big: n(L.BAUCUA_MAX_BETS) }),
      ]),
    ],
  }),

  leaderboard: (L, world) => {
    const season = require("./season_slots").isSeason(world);
    const streak = require("./streak").current(world);
    const daily = coins.wallet(world).dailyBonus();
    return {
      title: "Leaderboard",
      sub: "Everybody by their coins - and the seasons to win.",
      sections: [
        section("How it works", [
          tile("🏆", "By coins", "All players, the most coins first.", { emoji: ["🥇", "🥈", "🥉"] }),
          tile("📶", "Live", "Without a season always up to date. The arrows: up or down since midnight.", { tags: [["▲ 2", "green"], ["▼ 1", "red"]] }),
          tile("🎁", "Daily coins", `${season ? "" : "🪙 "}${n(daily)} free every day - claim them on your first visit.`, { coins: [n(daily)] }),
          ...(L.CASHBACK_PERCENT > 0 ? [tile("💸", "Cashback", `After midnight ${L.CASHBACK_PERCENT}% of yesterday's losses come back${L.CASHBACK_MAX > 0 ? ` (up to ${n(L.CASHBACK_MAX)})` : ""}.${season ? " Second chances' coins don't count." : ""}`, { tags: [[`${L.CASHBACK_PERCENT}%`, "green"]] })] : []),
          ...(streak.on ? [tile("🔥", "Daily streak", `Claim day after day and it grows - up to ${n(Math.round((daily * Math.max(...streak.rewards)) / 100))} a day. Miss one: it starts over.`, { steps: ["🔥", "🔥🔥", "🔥🔥🔥"] })] : []),
        ]),
        section("Ranking", [
          tile("💔", "In a season", "The same coins: fewer second chances first - then more coins wagered.", { tags: [["💔 1"], ["🫴🏽 50k"]] }),
          tile("🎟️", "A place", "Needs a wager: the start coins × the season's factor (daily bonuses add to it).", { steps: ["🪙", "🫴🏽", "🏅"] }),
          tile("🤝", "Shared places", "Only the same coins, chances and wagers share a place - and its prize.", { tags: [["1st"], ["1st"], ["3rd", "muted"]] }),
        ]),
        section("Seasons", [
          tile("🗓️", "Start", "Hit Start to play: the start budget (and the daily coins you missed).", { steps: ["▶️", "🪙", "🏁"] }),
          tile("🏁", "Win", "The same coins for everybody - the most at the end wins the prizes.", { emoji: ["🏆"] }),
          tile("💼", "Your coins", "Kept aside meanwhile - back after the season, with your season coins on top.", { coins: ["kept"] }),
          tile("💔", "Second chances", "Lost everything? Start again with the budget - the next one after a wait.", { emoji: ["💔", "🔁"] }),
          tile("⏸️", "Closing", "Before a season starts and ends the casino closes for a moment.", { steps: ["🎲", "⏸️", "▶️"] }),
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
  const what = { slots: "one spin", battles: "one battle", poker: "your chips at the table" }[game] || "all your bets of one round together";
  return `Up to 🪙 ${n(rule.floor)} you can bet all your coins - with more, ${what} ${game === "slots" || game === "battles" ? "is" : "are"} at most ${share}% of your coins (rounded up to the next 100).` + (x > 1 ? ` (Slots spin fast: 1/${x} of the max bet of the other games.)` : "");
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
