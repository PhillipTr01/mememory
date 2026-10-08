/*
 * What is going on in the games right now, for the overview of the admin
 * panel: every game registers a function that tells its state in short.
 */
const games = new Map(); // name -> () => {...}

function register(name, status) {
  games.set(name, status);
}

function snapshot() {
  const result = {};
  for (const [name, status] of games) {
    try {
      result[name] = status();
    } catch (error) {
      result[name] = null;
    }
  }
  return result;
}

module.exports = { register, snapshot };
