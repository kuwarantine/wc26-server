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

import * as requests from './services/requests.js';

app.get('/api/groups', requests.getGroups);

app.get('/api/standings', requests.getStandings);

app.get('/api/match', requests.getMatch);

app.get('/api/match/knockouts', requests.getKnockoutMatches);

app.listen(port, () => {
    console.log(`App listening on port ${port}`)
});