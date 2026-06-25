import express from 'express';
const app = express();
const port = process.env.PORT || 3000;

import cors from 'cors';
const corsOptions = {
    origin: ['http://localhost:5173', process.env.FRONTEND_URL],
    credentials: true,
    optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

import * as controllers from './services/controllers.js';

app.get('/api/groups', controllers.getGroups);

app.get('/api/standings', controllers.getStandings);

app.get('/api/match', controllers.getMatch);

app.get('/api/match/knockouts', controllers.getKnockoutMatches);

app.get('/api/last', controllers.getLastMatch);

app.get('/api/picks', controllers.getPicks);

app.listen(port, () => {
    console.log(`App listening on port ${port}`)
});