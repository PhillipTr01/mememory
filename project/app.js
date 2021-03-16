var express = require('express');
var cron = require("node-cron");
var path = require('path');
let shell = require('shelljs');
const app = express();
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const Meme = require('./models/Meme');

app.use(bodyParser.json());
app.use(morgan('dev'));

cron.schedule("0 1 * * *", function() {
    if(shell.exec("node meme_scrape.js").code !== 0) {
        console.log("Something went wrong!")
    }
});

app.get('/', async (req, res, next) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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

app.listen(3000);
