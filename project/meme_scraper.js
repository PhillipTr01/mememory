var request = require('request');
const Meme = require('./models/Meme');

module.exports.scrape = function () {

    Meme.collection.drop();

    scrapeImages("https://www.reddit.com/r/dankmemes/.json?limit=100");
    scrapeImages("https://www.reddit.com/r/memes/.json?limit=100");
};

function scrapeImages(link) {
    request(link, async function (err, res, body) {
        if (!err && res.statusCode === 200) {
            try {
                var parsedBody = JSON.parse(body);
                var skipFirst = false;

                for (image of parsedBody.data.children) {
                    if (skipFirst && /https\:\/\/i\.redd\.it\/([0-9A-Za-z]{13})(.jpg|.png|.gif)/.test(image.data.url_overridden_by_dest)) {
                        await Meme({
                            link: image.data.url_overridden_by_dest
                        }).save();
                    }
                    skipFirst = true;
                }
            } catch (error) {
                console.log(error);
            }
        } else {
            console.log(err + " " + res.statusMessage + " " + res.statusCode);
        }
    });
}