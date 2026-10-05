const Statistic = require('../models/Statistic');
const User = require('../models/User');

const MODES = ['easy', 'medium', 'hard', 'expert', 'multiplayer', 'tictactoe'];
const LIMIT = 10;

/* Returns the top players of one mode as [{username, win, lose, draw}]. */
async function topPlayers(mode) {
    const win = mode + 'Win';
    const lose = mode + 'Lose';
    const draw = mode + 'Draw'; // only Tic Tac Toe has draws

    // Fetch a few more in case some statistics have no user (e.g. deleted accounts).
    const statistics = await Statistic.find()
        // Only players who have played this mode
        .where({$or: [{[win]: {$gt: 0}}, {[lose]: {$gt: 0}}, {[draw]: {$gt: 0}}]})
        .sort({[win]: -1, [lose]: 1})
        .limit(LIMIT * 2)
        .select(win + ' ' + lose + ' ' + draw)
        .lean();

    const users = await User.find({statistics: {$in: statistics.map((s) => s._id)}})
        .select('username statistics')
        .lean();
    const usernames = new Map(users.map((u) => [String(u.statistics), u.username]));

    return statistics
        .filter((s) => usernames.has(String(s._id)))
        .slice(0, LIMIT)
        .map((s) => ({win: s[win] || 0, lose: s[lose] || 0, draw: s[draw] || 0, username: usernames.get(String(s._id))}));
}

// Get the best Users from all difficulty levels
async function getScoreboard() {
    const lists = await Promise.all(MODES.map(topPlayers));
    const result = {};
    MODES.forEach((mode, i) => { result[mode] = lists[i]; });
    return result;
}

module.exports = { getScoreboard };
