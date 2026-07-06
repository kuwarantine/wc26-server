import express from 'express';
const app = express();
const port = process.env.PORT || 3000;

import cors from 'cors';
const isProd = process.env.NODE_ENV === 'production';
const corsOptions = {
    origin: isProd ? process.env.FRONTEND_URL : '*',
    credentials: true,
    optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

import * as controllers from './services/controllers.js';
import { initLiveService } from './services/live.js';

app.get('/api/groups', controllers.getGroups);

app.get('/api/standings', controllers.getStandings);

app.get('/api/match', controllers.getMatch);

app.get('/api/match/knockouts', controllers.getKnockoutMatches);

app.get('/api/last', controllers.getLastMatch);

app.get('/api/picks', controllers.getPicks);

app.get('/api/latest', controllers.getLatestMatch);

async function start() {
    await initLiveService();
    app.listen(port, () => {
        console.log(`App listening on port ${port}`)
    });
}

start().catch(err => {
    console.error('Error during server startup:', err);
    process.exit(1);
});