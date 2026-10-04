const Parser = require("rss-parser");
const Meme = require("./models/Meme");

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "MemeMory/1.0 (meme memory game)" },
});

const SUBREDDITS = [
  "dankmemes",
  "memes",
  "me_irl",
  "AnimalsBeingDerps",
  "wholesomememes",
  "antimeme",
  "ProgrammerHumor",
];

// A board needs 33 different memes, keep the old ones if we found fewer.
const MIN_MEMES = 33;
const DELAY_BETWEEN_SUBREDDITS = 30000;
const IMAGE_REGEX = /https:\/\/i\.redd\.it\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp)/i;

let running = false;

/*
 * Fetches new memes and replaces the old ones afterwards.
 * The old memes are only removed once enough new ones were found, so the game
 * keeps working while scraping and when Reddit is not reachable.
 */
module.exports.scrape = async function () {
  // Don't start a second run while the previous one is still going.
  if (running) return;
  running = true;

  try {
    const links = new Set();

    for (let i = 0; i < SUBREDDITS.length; i++) {
      const found = await scrapeImages(
        `https://www.reddit.com/r/${SUBREDDITS[i]}/.rss?limit=100`,
      );
      found.forEach((link) => links.add(link));

      console.log(`Finished ${SUBREDDITS[i]} (${found.length} memes)`);

      if (i < SUBREDDITS.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_SUBREDDITS));
      }
    }

    if (links.size < MIN_MEMES) {
      console.warn(
        `Only found ${links.size} memes, keeping the existing ones (need at least ${MIN_MEMES}).`,
      );
      return;
    }

    const newLinks = [...links];

    // Insert the new memes (without duplicates) ...
    await Meme.bulkWrite(
      newLinks.map((link) => ({
        updateOne: { filter: { link }, update: { $set: { link } }, upsert: true },
      })),
      { ordered: false },
    );
    // ... and only then remove the old ones.
    await Meme.deleteMany({ link: { $nin: newLinks } });

    console.log(`Meme update finished: ${newLinks.length} memes.`);
  } catch (err) {
    console.error("Meme update failed:", err.message);
  } finally {
    running = false;
  }
};

async function scrapeImages(link) {
  const links = [];

  try {
    const feed = await parser.parseURL(link);

    // The first entry is skipped (usually a pinned post)
    for (const item of feed.items.slice(1)) {
      // Find i.redd.it image inside the RSS HTML
      const match =
        (item.content && item.content.match(IMAGE_REGEX)) ||
        (item.contentSnippet && item.contentSnippet.match(IMAGE_REGEX));

      if (match) {
        links.push(match[0]);
      }
    }
  } catch (err) {
    console.error(`Failed to scrape ${link}:`, err.message);
  }

  return links;
}
