import sql from './db.js';
import { getLiveState, liveEmitter } from './live.js';

const PICK_REFRESH_TIME = parseInt(process.env.PICK_REFRESH_TIME, 10);
const HEARTBEAT_TIME = 40 * 1000;

const QF_START = Temporal.ZonedDateTime.from({year: 2026, month: 7, day: 8, hour: PICK_REFRESH_TIME, timeZone: 'UTC'});
const QF_END = Temporal.ZonedDateTime.from({year: 2026, month: 7, day: 12, hour: PICK_REFRESH_TIME, timeZone: 'UTC'});
const SF_END = Temporal.ZonedDateTime.from({year: 2026, month: 7, day: 16, hour: PICK_REFRESH_TIME, timeZone: 'UTC'});

function packageMatch(row, homeEvents = [], awayEvents = []) {
    return {
                date: row.timestamp.valueOf(),
                number: row.number,
                round: row.round,
                status: row.status,
                elapsed: row.elapsed_time,
                extra: row.extra_elapsed_time,
                winnerID: row.winner_id,
                homeID: row.home_id,
                awayID: row.away_id,
                homeScore: row.home_score ?? 0,
                awayScore: row.away_score ?? 0,
                homeET: row.home_et,
                awayET: row.away_et,
                homePen: row.home_pen,
                awayPen: row.away_pen,
                homeEvents: homeEvents,
                awayEvents: awayEvents
            };
}

function timeNowIsBetween(start, end) {
    const now = Temporal.Now.zonedDateTimeISO('UTC');
    const isBetween = Temporal.ZonedDateTime.compare(start, now) <= 0 &&
        Temporal.ZonedDateTime.compare(now, end) <= 0;
    return isBetween;
}

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
            const match = packageMatch(row);

            matches[match.number] = match;
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
            const [homeEvents, awayEvents] = await Promise.all([
                                                    sql`SELECT time, extra_time, player, assist, type, detail FROM events WHERE match_id = ${row.id} AND team_id = ${row.home_id} ORDER BY time, extra_time NULLS FIRST`,
                                                    sql`SELECT time, extra_time, player, assist, type, detail FROM events WHERE match_id = ${row.id} AND team_id = ${row.away_id} ORDER BY time, extra_time NULLS FIRST`
                                                ]); 

            const match = packageMatch(row, homeEvents, awayEvents);

            matches.push(match);
        }

        res.json(matches);
    } catch (err) {
        console.error(err);
    }
}

async function getStandings(req, res) {
    try {
        const rows = await sql`SELECT name, points, new_points, current_rank, previous_rank FROM leaderboard`;
        res.json(rows);
    } catch (err) {
        console.error(err);
    }
}

async function getLatestMatch(req, res) {
    try {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.write('retry: 5000\n\n');

        const [matchCache, standingsCache, timeToNext] = getLiveState();

        if (!matchCache) {
            res.write('event: not-live\n');
            res.write(`data: ${JSON.stringify({timeToNext: timeToNext})}\n\n`);
            res.end();
            return;
        }

        const initialMatch = packageMatch(matchCache.match, matchCache.home, matchCache.away); 
        res.write('event: match-update\n');
        res.write(`data: ${JSON.stringify({matchData: initialMatch, standings: standingsCache})}\n\n`);

        const onMatchUpdate = (data) => {
            const matchData = data.match;
            const match = packageMatch(matchData.match, matchData.home, matchData.away);
            res.write('event: match-update\n');
            res.write(`data: ${JSON.stringify({matchData: match, standings: data.standings})}\n\n`);
        }

        const onMatchEnd = (data) => {
            res.write('event: match-end\n');
            res.write(`data: ${JSON.stringify({timeToNext: data.timeToNext})}\n\n`);
            res.end();
        }

        const heartbeat = setInterval(() => {
            res.write(':\n\n');
        }, HEARTBEAT_TIME);

        liveEmitter.on('update', onMatchUpdate);
        liveEmitter.on('end', onMatchEnd);

        req.on('close', () => {
            clearInterval(heartbeat);
            liveEmitter.off('update', onMatchUpdate);
            liveEmitter.off('end', onMatchEnd);
            res.end();
        });
    } catch (err) {
        console.error(err);
    }
}

async function getLastMatch(req, res) {
    try {
        const [last] = await sql`SELECT * FROM matches WHERE complete = TRUE ORDER BY timestamp DESC LIMIT 1`;
        const match = packageMatch(last);

        res.json(match);
    } catch (err) {
        console.error(err);
    }
}

async function getPicks(req, res) {
    const date = req.query.date;
    const zone = req.query.zone;

    try {
        let startUTC, endUTC;

        if (timeNowIsBetween(QF_START, QF_END)) {
            startUTC = QF_START.toInstant().toString();
            endUTC = QF_END.toInstant().toString();
        } else if (timeNowIsBetween(QF_END, SF_END)) {
            startUTC = QF_END.toInstant().toString();
            endUTC = SF_END.toInstant().toString();
        } else {
            const startDay = Temporal.Now.zonedDateTimeISO('UTC').subtract({hours: PICK_REFRESH_TIME}).toPlainDate();
            startUTC = startDay.toZonedDateTime({timeZone: 'UTC', plainTime: {hour: PICK_REFRESH_TIME}}).toInstant().toString();
            endUTC = startDay.toZonedDateTime({timeZone: 'UTC', plainTime: {hour: PICK_REFRESH_TIME}}).add({days: 1}).toInstant().toString();
        }
        
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

export { getGroups, getMatch, getStandings, getKnockoutMatches, getLastMatch, getPicks, getLatestMatch };