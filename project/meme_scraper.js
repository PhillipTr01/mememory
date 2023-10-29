var got = require('got');
const Meme = require('./models/Meme');

module.exports.scrape = function () {
    Meme.collection.drop();
    scrapeImages("https://www.reddit.com/r/dankmemes/.json?limit=100");
    scrapeImages("https://www.reddit.com/r/memes/.json?limit=100");
};

function scrapeImages(link) {
    got(link).then(async (response) => {
        var parsedBody = JSON.parse(response.body);

        for (image of parsedBody.data.children.slice(1)) {
            if (/https\:\/\/i\.redd\.it\/([0-9A-Za-z]{13})(.jpg|.png|.gif)/.test(image.data.url_overridden_by_dest)) {
                console.log(image.data.url_overridden_by_dest)
                await Meme({
                    link: image.data.url_overridden_by_dest
                }).save();
            }
        }
      }).catch(error => {
        console.log(error);
      });
}
