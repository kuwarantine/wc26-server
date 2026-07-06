import { EventEmitter } from 'events';
import sql from './db.js';

export const liveEmitter = new EventEmitter();

let liveMatchId = null;
let liveMatchCache = null;
let timeToNext = null;
let liveStandingsCache = null;

export function getLiveState() {
    return [liveMatchCache, liveStandingsCache, timeToNext];
}

async function refreshTimeToNext() {
    try {
        const [nextMatch] = await sql`SELECT timestamp FROM matches WHERE timestamp > NOW() ORDER BY timestamp ASC LIMIT 1`;
        timeToNext = nextMatch ? nextMatch.timestamp - Date.now() : null;
    } catch (err) {
        console.error('[Live] Error caching next match:', err);
    }
}

export async function initLiveService() {
    try {
        const [liveMatch] = await sql`SELECT * FROM matches WHERE complete = FALSE AND elapsed_time IS NOT NULL LIMIT 1`;
        if (liveMatch) {
            liveMatchId = liveMatch.id;
            const [homeEvents, awayEvents] = await Promise.all([
                                                    sql`SELECT time, extra_time, player, assist, type, detail FROM events WHERE match_id = ${liveMatchId} AND team_id = ${liveMatch.home_id} ORDER BY time, extra_time NULLS FIRST`,
                                                    sql`SELECT time, extra_time, player, assist, type, detail FROM events WHERE match_id = ${liveMatchId} AND team_id = ${liveMatch.away_id} ORDER BY time, extra_time NULLS FIRST`
                                                ]);
            const liveStandings = await sql`SELECT name, points, new_points, current_rank, previous_rank FROM live_leaderboard`;
            liveStandingsCache = liveStandings;
            liveMatchCache = {match: liveMatch, home: homeEvents, away: awayEvents };
        } else {
            await refreshTimeToNext();
        }
    } catch (err) {
        console.error('[Live] Error during init:', err);
    }

    await sql.listen('live', async (id) => {
        if (id === '0') {
            liveMatchId = null;
            liveMatchCache = null;
            liveStandingsCache = null;

            await refreshTimeToNext();
            liveEmitter.emit('end', { timeToNext });
            return;
        }

        liveMatchId = parseInt(id);
        timeToNext = null;

        try {
            const [liveMatch] = await sql`SELECT * FROM matches WHERE id = ${liveMatchId}`;
            const [homeEvents, awayEvents] = await Promise.all([
                                                    sql`SELECT time, extra_time, player, assist, type, detail FROM events WHERE match_id = ${liveMatchId} AND team_id = ${liveMatch.home_id} ORDER BY time, extra_time NULLS FIRST`,
                                                    sql`SELECT time, extra_time, player, assist, type, detail FROM events WHERE match_id = ${liveMatchId} AND team_id = ${liveMatch.away_id} ORDER BY time, extra_time NULLS FIRST`
                                                ]);
            liveMatchCache = {match: liveMatch, home: homeEvents, away: awayEvents };
            const liveStandings = await sql`SELECT name, points, new_points, current_rank, previous_rank FROM live_leaderboard`;
            liveStandingsCache = liveStandings;

            liveEmitter.emit('update', {match: liveMatchCache, standings: liveStandingsCache});
        } catch (err) {
            console.error('[Live] Error during live query:', err);
        }
    });
}