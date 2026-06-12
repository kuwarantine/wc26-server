import sql from './db.js';

async function getGroups(req, res) {
    try {
        const data = await sql`SELECT id, position, emoji, country, groupid, won, drawn, lost, goals_for, goals_against FROM teams ORDER BY position;`;
        res.json(data);
    } catch (err) {
        console.error(err);
    }
}

async function getKnockoutMatches(req, res) {
    try {
        const rows = await sql`SELECT * FROM matches WHERE round > 1;`;
        const matches = {};

        for (const row of rows) {
            const homeData = await sql`SELECT country, emoji FROM teams WHERE id = ${row.home_id};`;
            const home = homeData[0];
            const awayData = await sql`SELECT country, emoji FROM teams WHERE id = ${row.away_id};`;
            const away = awayData[0];

            const match = {
                    date: row.timestamp.valueOf(),
                    homeTeam: home.country,
                    awayTeam: away.country,
                    homeScore: row.home_score,
                    awayScore: row.away_score,
                    homeET: row.home_et,
                    awayET: row.away_et,
                    homePen: row.home_pen,
                    awayPen: row.away_pen,
                    homeEmoji: home.emoji,
                    awayEmoji: away.emoji,
                    matchNumber: row.number
            };

            matches[match.matchNumber] = match;
        }

        res.json(matches);
    } catch (err) {
        console.error(err);
    }
}

async function getMatch(req, res) {
    const dq = req.query.date;
    try {
        const rows = await sql`SELECT * FROM matches WHERE date(timestamp) = ${dq} ORDER BY timestamp;`;
        const matches = [];

        for (const row of rows) {
            const homeData = await sql`SELECT country, emoji FROM teams WHERE id = ${row.home_id};`;
            const home = homeData[0];
            const awayData = await sql`SELECT country, emoji FROM teams WHERE id = ${row.away_id};`;
            const away = awayData[0];
            const homeEvents = await sql`SELECT time, extra_time, player, assist, type, detail FROM events WHERE match_id = ${row.id} AND team_id = ${row.home_id} ORDER BY time, extra_time NULLS FIRST;`;
            const awayEvents = await sql`SELECT time, extra_time, player, assist, type, detail FROM events WHERE match_id = ${row.id} AND team_id = ${row.away_id} ORDER BY time, extra_time NULLS FIRST;`;

            const match = {
                date: row.timestamp.valueOf(),
                homeTeam: home.country,
                awayTeam: away.country,
                homeScore: row.home_score,
                awayScore: row.away_score,
                homeEmoji: home.emoji,
                awayEmoji: away.emoji,
                homeEvents: homeEvents,
                awayEvents: awayEvents
            };

            matches.push(match);
        }

        res.json(matches);
    } catch (err) {
        console.error(err);
    }
}

async function getStandings(req, res) {
    try {
        const rows = await sql`SELECT name, points FROM users ORDER BY points DESC, name;`;
        res.json(rows);
    } catch (err) {
        console.error(err);
    }
}

export { getGroups, getMatch, getStandings, getKnockoutMatches };