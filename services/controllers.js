import sql from './db.js';

const PICK_REFRESH_TIME = parseInt(process.env.PICK_REFRESH_TIME, 10);

async function getGroups(req, res) {
    try {
        const data = await sql`SELECT id, position, flag_code, fifa_code, country, groupid, won, drawn, lost, goals_for, goals_against FROM teams ORDER BY position;`;
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
            const homeData = await sql`SELECT country, flag_code FROM teams WHERE id = ${row.home_id};`;
            const home = homeData[0];
            const awayData = await sql`SELECT country, flag_code FROM teams WHERE id = ${row.away_id};`;
            const away = awayData[0];

            const match = {
                    date: row.timestamp.valueOf(),
                    round: row.round,
                    homeTeam: home.country,
                    awayTeam: away.country,
                    homeScore: row.home_score,
                    awayScore: row.away_score,
                    homeET: row.home_et,
                    awayET: row.away_et,
                    homePen: row.home_pen,
                    awayPen: row.away_pen,
                    homeFlagCode: home.flag_code,
                    awayFlagCode: away.flag_code,
                    homeFifaCode: home.fifa_code,
                    awayFifaCode: away.fifa_code,
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
    const date = req.query.date;
    const zone = req.query.zone;
    try {
        const plainDate = Temporal.PlainDate.from(date);
        const startUTC = plainDate.toZonedDateTime(zone).startOfDay().toInstant().toString();
        const endUTC = plainDate.toZonedDateTime(zone).startOfDay().add({days:1}).toInstant().toString();

        const rows = await sql`SELECT * FROM matches WHERE timestamp >= ${startUTC} AND timestamp < ${endUTC} ORDER BY timestamp;`;
        const matches = [];

        for (const row of rows) {
            const homeData = await sql`SELECT country, flag_code FROM teams WHERE id = ${row.home_id};`;
            const home = homeData[0];
            const awayData = await sql`SELECT country, flag_code FROM teams WHERE id = ${row.away_id};`;
            const away = awayData[0];
            const homeEvents = await sql`SELECT time, extra_time, player, assist, type, detail FROM events WHERE match_id = ${row.id} AND team_id = ${row.home_id} ORDER BY time, extra_time NULLS FIRST;`;
            const awayEvents = await sql`SELECT time, extra_time, player, assist, type, detail FROM events WHERE match_id = ${row.id} AND team_id = ${row.away_id} ORDER BY time, extra_time NULLS FIRST;`;

            const match = {
                date: row.timestamp.valueOf(),
                finishCode: row.finish_code,
                homeTeam: home.country,
                awayTeam: away.country,
                homeScore: row.home_score,
                awayScore: row.away_score,
                homeET: row.home_et,
                awayET: row.away_et,
                homePen: row.home_pen,
                awayPen: row.away_pen,
                homeFlagCode: home.flag_code,
                awayFlagCode: away.flag_code,
                homeFifaCode: home.fifa_code,
                awayFifaCode: away.fifa_code,
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
        const rows = await sql`SELECT name, points, last_match_points FROM leaderboard ORDER BY points DESC, name;`;
        res.json(rows);
    } catch (err) {
        console.error(err);
    }
}

async function getLastMatch(req, res) {
    try {
        const lastData = await sql`SELECT * FROM matches WHERE complete = TRUE ORDER BY timestamp DESC LIMIT 1;`;
        const last = lastData[0];
        const home_id = last.home_id;
        const away_id = last.away_id;
        const homeData = await sql`SELECT country, flag_code, fifa_code FROM teams WHERE id=${home_id}`;
        const awayData = await sql`SELECT country, flag_code, fifa_code FROM teams WHERE id=${away_id}`;
        const home = homeData[0];
        const away = awayData[0];

        const winner = (last.winner_id === home_id) ? 'home' : (last.winner_id === away_id) ? 'away' : 'draw';

        const match = {
                date: last.timestamp.valueOf(),
                finishCode: last.finish_code,
                winner: winner,
                homeTeam: home.country,
                awayTeam: away.country,
                homeScore: last.home_score,
                awayScore: last.away_score,
                homeET: last.home_et,
                awayET: last.away_et,
                homePen: last.home_pen,
                awayPen: last.away_pen,
                homeFlagCode: home.flag_code,
                awayFlagCode: away.flag_code,
                homeFifaCode: home.fifa_code,
                awayFifaCode: away.fifa_code,
                homeEvents: [],
                awayEvents: []
            };

        res.json(match);
    } catch (err) {
        console.error(err);
    }
}

async function getPicks(req, res) {
    const date = req.query.date;
    const zone = req.query.zone;
    try {
        const startDay = Temporal.Now.zonedDateTimeISO('UTC').subtract({hours: PICK_REFRESH_TIME}).toPlainDate();
        const startUTC = startDay.toZonedDateTime({timeZone: 'UTC', plainTime: {hour: PICK_REFRESH_TIME}}).toInstant().toString();
        const endUTC = startDay.toZonedDateTime({timeZone: 'UTC', plainTime: {hour: PICK_REFRESH_TIME}}).add({days: 1}).toInstant().toString();

        const rows = await sql`SELECT id, home_id, away_id FROM matches WHERE timestamp >= ${startUTC} AND timestamp < ${endUTC} ORDER BY timestamp;`;
        const ids = rows.map((r) => r.id);
        const picks = await sql`SELECT u.name, p.match_id, p.winner_id, p.home_score, p.away_score, p.home_et, p.away_et, p.home_pen, p.away_pen
                                FROM users u JOIN picks p ON u.id = p.user_id WHERE p.match_id = ANY(${ids})`;
        const grouped = Object.groupBy([...picks], (p) => p.match_id);
        const matchPicks = rows.map((r) =>
            ({
                match_id: r.id,
                home_id: r.home_id,
                away_id: r.away_id,
                picks: grouped[r.id]
            })
        );

        res.json(matchPicks);
    } catch (err) {
        console.error(err);
    }
}
export { getGroups, getMatch, getStandings, getKnockoutMatches, getLastMatch, getPicks };