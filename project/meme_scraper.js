const Parser = require("rss-parser");
const parser = new Parser();
const Meme = require("./models/Meme");

module.exports.scrape = async function () {
  try {
    await Meme.collection.drop();
  } catch (err) {}

  const subreddits = [
    "dankmemes",
    "memes",
    "me_irl",
    "AnimalsBeingDerps",
    "wholesomememes",
    "antimeme",
    "ProgrammerHumor",
  ];

  for (const subreddit of subreddits) {
    await scrapeImages(`https://www.reddit.com/r/${subreddit}/.rss?limit=100`);

    console.log(`Finished ${subreddit}, waiting 30 seconds...`);

    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
};

async function scrapeImages(link) {
  try {
    const feed = await parser.parseURL(link);

    let skipFirst = false;

    for (const item of feed.items) {
      if (!skipFirst) {
        skipFirst = true;
        continue;
      }

      // Find i.redd.it image inside the RSS HTML
      const match =
        item.content?.match(
          /https:\/\/i\.redd\.it\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp)/i,
        ) ||
        item.contentSnippet?.match(
          /https:\/\/i\.redd\.it\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp)/i,
        );

      if (match) {
        await Meme({
          link: match[0],
        }).save();
      }
    }
  } catch (err) {
    console.error(`Failed to scrape ${link}:`, err.message);
  }
}
