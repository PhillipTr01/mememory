var request = require('request');
const Meme = require('./models/Meme');
const mongoose = require('mongoose');
const shell = require('shelljs');

mongoose.connect("mongodb://localhost:27017/MemeMory?readPreference=primary&appname=MongoDB%20Compass&ssl=false", 
    { useNewUrlParser: true, useUnifiedTopology: true }
 );

if(Meme.collection != null) {
    Meme.collection.drop();
}


request('https://www.reddit.com/r/memes/.json?limit=100', async function(err, res, body) {

    if(!err && res.statusCode === 200) {
        try {
            var parsedBody = JSON.parse(body);
            var skipFirst = false;
    
            for(image of parsedBody.data.children) {
                if(skipFirst && /https\:\/\/i\.redd\.it\/([0-9A-Za-z]{13})(.jpg|.png|.gif)/.test(image.data.url_overridden_by_dest)) {
                    await Meme({link: image.data.url_overridden_by_dest}).save();
                }
                skipFirst = true;
            }

            shell.exit();
        } catch (error) {
            console.log(error);
        }
    } else {
        console.log(err + " " + res.statusMessage + " " + res.statusCode);
    }
});