var express = require('express');
var cron = require("node-cron");
var path = require('path');
const app = express();
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const scraper = require("./meme_scrape");
const Meme = require('./models/Meme');

app.use(bodyParser.json());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

cron.schedule('0 1 * * *', () => {
    scraper.scrape();
});

app.get('/', async (req, res, next) => {
    res.sendFile('/index.html');
});

app.get('/links', async (req, res, next) => {
    const memes = await Meme.find().select('link');
    res.json(memes);
});

app.use((req, res, next) => {
    const err = new Error("I'm a teapot! I don't want to handle this request!");
    err.status = 418;
    next(err);
 })

app.use((err, req, res, next) => {
    res.status(err.status || 500);
    res.send({
       error: {
          status: err.status || 500,
          message: err.message
       }
    })
 })



mongoose.connect("mongodb://localhost:27017/MemeMory?readPreference=primary&appname=MongoDB%20Compass&ssl=false", 
    { useNewUrlParser: true, useUnifiedTopology: true },
    () => console.log('Connected to Database!')
 );

app.listen(5000);
