/*
 * Makes the hash for the admin password: npm run admin-password
 * The password is asked for (not shown), only its salted scrypt hash is
 * printed. Put the line into the environment of the server (or .env):
 *   ADMIN_PASSWORD_HASH=scrypt:...
 */
const crypto = require("crypto");
const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
// Nothing typed is shown (the questions are written by ask)
rl._writeToOutput = () => {};

// Lines can come before the question (pasted / piped): they wait in a queue
const lines = [];
let waiting = null;
rl.on("line", (line) => {
  if (waiting) {
    waiting(line);
    waiting = null;
  } else {
    lines.push(line);
  }
});

function ask(question) {
  process.stdout.write(question);
  return new Promise((resolve) => {
    const done = (answer) => {
      process.stdout.write("\n");
      resolve(answer);
    };
    if (lines.length) done(lines.shift());
    else waiting = done;
  });
}

(async () => {
  const password = await ask("Admin password (at least 12 characters): ");
  if (password.length < 12) {
    console.error("Too short - at least 12 characters.");
    process.exit(1);
  }
  if ((await ask("Once more: ")) !== password) {
    console.error("The two don't match.");
    process.exit(1);
  }
  rl.close();
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  console.log("\nPut this line into the environment of the server (or .env) and restart it:\n");
  console.log(`ADMIN_PASSWORD_HASH=scrypt:${salt.toString("hex")}:${hash.toString("hex")}`);
})();
