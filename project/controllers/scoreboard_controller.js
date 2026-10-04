const Statistic = require('../models/Statistic');
const User = require('../models/User');

const MODES = ['easy', 'medium', 'hard', 'expert', 'multiplayer'];
const LIMIT = 10;

/* Returns the top players of one mode as [{username, win, lose}]. */
async function topPlayers(mode) {
    const win = mode + 'Win';
    const lose = mode + 'Lose';

    // Fetch a few more in case some statistics have no user (e.g. deleted accounts).
    const statistics = await Statistic.find()
        .sort({[win]: -1, [lose]: 1})
        .limit(LIMIT * 2)
        .select(win + ' ' + lose)
        .lean();

    const users = await User.find({statistics: {$in: statistics.map((s) => s._id)}})
        .select('username statistics')
        .lean();
    const usernames = new Map(users.map((u) => [String(u.statistics), u.username]));

    return statistics
        .filter((s) => usernames.has(String(s._id)))
        .slice(0, LIMIT)
        .map((s) => ({win: s[win] || 0, lose: s[lose] || 0, username: usernames.get(String(s._id))}));
}

// Get the best Users from all difficulty levels
async function getScoreboard() {
    const lists = await Promise.all(MODES.map(topPlayers));
    const result = {};
    MODES.forEach((mode, i) => { result[mode] = lists[i]; });
    return result;
}

module.exports = { getScoreboard };
