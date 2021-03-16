var request = require('request');

request('https://www.reddit.com/r/memes/.json?limit=100', function(err, res, body) {


    if(!err && res.statusCode === 200) {
        var $ = JSON.parse(body);

        var count = 0;

        for(image of $.data.children) {
            if(count != 0) {
                console.log(image.data.url_overridden_by_dest);
            }
            count++;
        }
        console.log(count);
    } else {
        console.log(err + " " + res.statusMessage + " " + res.statusCode);
    }
});