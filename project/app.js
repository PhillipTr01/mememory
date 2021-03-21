/* Module-Imports */
const express = require('express');
const cron = require("node-cron");
const path = require('path');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

/* File-Imports */
const memeScraper = require("./meme_scraper");
const Meme = require('./models/Meme');

/* Importatn Variables */
const port = 5000;
const database = "mongodb://localhost:27017/MemeMory?readPreference=primary&ssl=false";

const app = express();
app.use(express.urlencoded({
      extended: true
   }))
   .use(express.json())
   .use(morgan('dev'))
   .use(cookieParser())
   .use(express.static(path.join(__dirname, 'public')));

/* Routes */
const loginRoute = require('./routes/login_route');
const memeRoute = require('./routes/meme_route');
const statisticRoute = require('./routes/statistic_route');
const scoreboardRoute = require('./routes/scoreboard_route');

app.use('/requests/authentication', loginRoute)
   .use('/requests/memes', memeRoute)
   .use('/requests/statistic', statisticRoute)
   .use('/requests/scoreboard', scoreboardRoute);


/* Get new Memes every hour */
cron.schedule('0 1 * * *', () => {
   memeScraper.scrape();
});

/* Error handling */
app.use((req, res, next) => {
   const err = new Error("Error! Ressource not found!");
   err.status = 404;
   next(err);
})

app.use((err, req, res, next) => {
   res.status(err.status || 500);

   if (err.status == 404) {
      res.send();
      return;
   }

   res.send({
      error: {
         status: err.status || 500,
         message: err.message
      }
   })
})


/* Connect to Database */
mongoose.connect(database, {
      useNewUrlParser: true,
      useUnifiedTopology: true
   },
   () => console.log('Connected to Database!')
);


/* Start Backend */
app.listen(port);