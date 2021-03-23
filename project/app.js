/* Module-Imports */
const express = require('express');
const cron = require("node-cron");
const path = require('path');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

/* File-Imports */
const memeScraper = require("./meme_scraper");
const Auth = require("./middleware/auth");

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
   .use('/static', express.static(path.join(__dirname, 'public')));

/* Routes */
const loginRoute = require('./routes/login_route');
const memeRoute = require('./routes/meme_route');
const userRoute = require('./routes/user_route');
const scoreboardRoute = require('./routes/scoreboard_route');

app.use('/requests/authentication', loginRoute)
   .use('/requests/memes', memeRoute)
   .use('/requests/user', userRoute)
   .use('/requests/scoreboard', scoreboardRoute);

/* Base Routes */
app.get('/', Auth, (req, res, next) => {
   res.sendFile(__dirname + '/html/index.html');
});

app.get('/beta', Auth, (req, res, next) => {
   res.sendFile(__dirname + '/html/beta_test.html');
});

app.get('/home', Auth, (req, res, next) => {
   res.sendFile(__dirname + '/html/home.html');
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

/* Get new Memes every hour */
cron.schedule('0 1 * * *', () => {
   memeScraper.scrape();
});

/* Start Backend */
app.listen(port);