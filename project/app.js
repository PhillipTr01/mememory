/* Libraries */
require('dotenv').config()
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
//const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const http = require('http');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.urlencoded({extended: true}))
   .use(express.json())
   //.use(morgan('dev'))
   .use(cookieParser())
   .use('/static', express.static(path.join(__dirname, 'public')));

/* Modules */
const memeScraper = require("./meme_scraper");
const Auth = require("./middleware/auth");
require('./sockets/lobby_server')(io);
require('./sockets/singleplayer_server')(io);
require('./sockets/multiplayer_server')(io);

/* Page routes */
const authenticationRoute = require('./routes/authentication_route');
const memeRoute = require('./routes/meme_route');
const userRoute = require('./routes/user_route');
const scoreboardRoute = require('./routes/scoreboard_route');

/* API routes */
const authenticationAPIRoute = require('./API/routes/authentication_route');
const memeAPIRoute = require('./API/routes/meme_route');
const userAPIRoute = require('./API/routes/user_route');
const scoreboardAPIRoute = require('./API/routes/scoreboard_route');

app.use('/requests/authentication', authenticationRoute)
   .use('/requests/memes', memeRoute)
   .use('/requests/user', userRoute)
   .use('/requests/scoreboard', scoreboardRoute)
   .use('/v1/API/authentication', authenticationAPIRoute)
   .use('/v1/API/memes', memeAPIRoute)
   .use('/v1/API/user', userAPIRoute)
   .use('/v1/API/scoreboard', scoreboardAPIRoute);

/* Base routes */
app.get('/', Auth, (req, res, next) => {
   res.sendFile(__dirname + '/html/index.html');
});

app.get('/beta', (req, res, next) => {
   res.sendFile(__dirname + '/html/beta_test.html');
});

app.get('/home', Auth, (req, res, next) => {
   res.sendFile(__dirname + '/html/home.html');
});

app.get('/user', Auth, (req, res, next) => {
   res.sendFile(__dirname + '/html/user_profile.html');
});

app.get('/lobby', Auth, (req, res, next) => {
   res.sendFile(__dirname + '/html/lobby.html');
});

app.get('/settings', Auth, (req, res, next) => {
   res.sendFile(__dirname + '/html/settings.html');
});

app.get('/play', Auth, (req, res, next) => {
   res.sendFile(__dirname + '/html/multiplayer.html');
})

app.get('/singleplayer', Auth, (req, res, next) => {
   res.sendFile(__dirname + '/html/singleplayer.html');
})

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
   res.send({error: {status: err.status || 500, message: err.message}})
});

/* Connect to Database */
mongoose.connect(process.env.DB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true
});

/* Get new Memes every 10 minutes */
setInterval(() => memeScraper.scrape(), 600000);

/* Start Backend */
server.listen(process.env.PORT);