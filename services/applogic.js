import sql, { insertData } from './db.js';
import { getCompleteMatchesAndEvents, getMatchAndEvents, getStandings, getUpcomingFixturesForRound, getUpcomingFixturesFromDate } from './footballApi.js';
import boss from './queue.js';

const ROUND_WIN_POINTS = 
{
    1: 1,
    2: 2,
    3: 3,
    4: 6,
    5: 12,
    6: 24
}

const EXACT_SCORE_PONTS = 
{
    1: 1,
    2: 1,
    3: 2,
    4: 3,
    5: 3,
    6: 4
}

/* ========== POINTS ========== */

async function calculatePointsForGroupMatch(match_ids) {
    if (match_ids.length === 0) { return; }
    try {
        await sql`UPDATE picks p 
                    SET 
                        winner_points = CASE
                            WHEN (p.winner_id = m.winner_id) OR (p.winner_id IS NULL AND m.winner_id IS NULL)
                            THEN r.winner_points
                            ELSE 0
                        END,
                        
                        score_points = CASE
                            WHEN p.home_score = m.home_score AND p.away_score = m.away_score
                            THEN r.score_points
                            ELSE 0
                        END
                    FROM matches m
                    JOIN rounds r ON m.round = r.id
                    WHERE p.match_id = m.id AND m.id = ANY(${match_ids});`;
    } catch(err) {
        console.error(err);
    }
}

async function calculatePointsForKnockoutMatch(match_ids) {
    if (match_ids.length === 0) { return; }
    try {
        await sql`UPDATE picks p 
                    SET 
                        winner_points = r.winner_points,
                        score_points = CASE
                            WHEN p.finish_code != m.status THEN 0

                            WHEN p.home_score = m.home_score AND p.away_score = m.away_score AND (
                                (p.finish_code = 'FT') OR
                                (p.finish_code = 'AET' AND p.home_et = m.home_et AND p.away_et = m.away_et) OR
                                (p.finish_code = 'PEN' AND p.home_et = m.home_et AND p.away_et = m.away_et AND p.home_pen = m.home_pen AND p.away_pen = m.away_pen)
                            ) THEN r.score_points
                            
                            WHEN p.home_score = m.away_score AND p.away_score = m.home_score AND (
                                (p.finish_code = 'FT') OR
                                (p.finish_code = 'AET' AND p.home_et = m.away_et AND p.away_et = m.home_et) OR
                                (p.finish_code = 'PEN' AND p.home_et = m.away_et AND p.away_et = m.home_et AND p.home_pen = m.away_pen AND p.away_pen = m.home_pen)
                            ) THEN r.score_points

                            ELSE 0
                        END
                    FROM matches m
                    JOIN rounds r ON m.round = r.id
                    WHERE m.id = ANY(${match_ids}) AND p.winner_id = m.winner_id AND p.round = m.round;`;
    } catch(err) {
        console.error(err);
    }
}

async function calculatePointsForMatch(matches) {
    const groupIds = matches.filter((m) => m.round === 1).map((m) => m.id);
    const knockoutIds = matches.filter((m) => m.round > 1).map((m) => m.id);

    await calculatePointsForGroupMatch(groupIds);
    await calculatePointsForKnockoutMatch(knockoutIds);
}

export async function recalculatePointsForComplete() {
    const matches = await sql`SELECT id, round FROM matches WHERE complete = TRUE;`;
    await calculatePointsForMatch(matches);
}

/* ========== SCHEDULERS ========== */

async function scheduleMatch(id, timestamp) {
    // Make sure time is in the future
    if (Temporal.Instant.compare(timestamp, Temporal.Now.instant()) < 0) {
        console.log(`Match ${id} already passed.`);
        return;
    }

    let jobId = await boss.send(
        'track-match',
        { id: id },
        {
            startAfter: timestamp,
            singletonKey: `match-${id}`
        }
    );

    if (!jobId) {
        const jobs = await boss.findJobs('track-match', {key: `match-${id}`});
        await boss.cancel('track-match', jobs.map((j) => j.id));
        jobId = await boss.send(
            'track-match',
            { id: id },
            {
                startAfter: timestamp,
                singletonKey: `match-${id}`
            }
        );
    }

    if (jobId) {
        console.log(`Match id: ${id} scheduled succesfully.`);
        return true;
    }    

    return false;
}

export async function scheduleIncompleteMatches() {
    const matches = await sql`SELECT id, timestamp FROM matches WHERE complete = FALSE`;
    let successful = 0;

    for (const match of matches) {
        const kickoff = match.timestamp.toTemporalInstant();
        const minFinishTime = kickoff.add({minutes: 105}).toString();
        if (await scheduleMatch(match.id, minFinishTime)) {
            successful += 1;
        }
    }

    console.log(`Scheduled ${successful} matches.`);
}

/* ========== MISC ========== */

// Caclulate points for teams that reach round of 32
async function calculatePointsForR32Picks() {
    const users = {};
    try {
        const teams = await sql`SELECT id FROM teams WHERE round > 1;`;
        const team_ids = teams.map((t) => t.id);
        
        const picks = await sql`SELECT * FROM round_picks;`;

        for (const pick of picks) {
            const user_id = pick.user_id;
            const team_id = pick.team_id;

            if (team_ids.includes(team_id)) {
                users[user_id] = users[user_id] ? users[user_id] + 1 : 1; 
            }
        }
    } catch (err) {
        console.error(err);
    }

    return users;
}

// Update picks' match id to track a real match in the knockouts
async function updatePickMatchId(id) {
    try {
        await sql`UPDATE picks
        SET match_id = m.id
        FROM matches m
        WHERE (picks.winner_id = m.home_id OR picks.winner_id = m.away_id)
        AND picks.round = m.round AND m.id = ${id};`;
        
        console.log(`Updated match id for picks (match: ${id}).`)
    } catch (err) {
        console.error(err);
    }
}

// Update next match with winner in knockout rounds
async function updateNextMatch(matches) {
    const knockoutIds = matches.filter((m) => m.round > 1).map((m) => m.id);

    if (knockoutIds.length > 0) {
        try {
            await sql`UPDATE matches next
                        SET
                            home_id = CASE 
                                WHEN previous.next_is_home THEN previous.winner_id
                                ELSE next.home_id
                            END,
                            away_id = CASE
                                WHEN NOT previous.next_is_home THEN previous.winner_id
                                ELSE next.away_id
                            END
                        FROM matches previous
                        WHERE previous.next_number = next.number AND previous.id = ANY(${knockoutIds});
                      `;
        } catch (err) {
            console.error(err);
        }
    }
}

// Push updated match data to DB
async function pushMatchData(matches) {
    const matchesArray = [];
    for (const match of matches) {
        const matchArray = [match.id, match.complete, match.home_score, match.away_score, match.home_et, match.away_et,
                            match.home_pen, match.away_pen, match.status, match.winner_id, match.elapsed_time, match.extra_elapsed_time];
        matchesArray.push(matchArray);
    }

    try {
        await sql`UPDATE matches 
                    SET complete = (nm.complete)::boolean, home_score = (nm.home_score)::int, away_score = (nm.away_score)::int, home_et = (nm.home_et)::int, 
                        away_et = (nm.away_et)::int, home_pen = (nm.home_pen)::int, away_pen = (nm.away_pen)::int, status = nm.status, winner_id = (nm.winner_id)::int,
                        elapsed_time = (nm.elapsed_time)::int, extra_elapsed_time = (nm.extra_elapsed_time)::int
                  FROM (VALUES ${sql(matchesArray)})
                  AS nm (id, complete, home_score, away_score, home_et, away_et, home_pen, away_pen, status, winner_id, elapsed_time, extra_elapsed_time) 
                  WHERE matches.id = (nm.id)::int`;
    } catch (err) {
        console.error('Failed to push match data:', err.message);
    }
}

// Push updated events to DB
async function pushEvents(events) {
    if (events.length === 0) { return; }
    try {
        await sql`INSERT INTO events ${sql(events)}
                    ON CONFLICT (match_id, event_index)
                    DO UPDATE SET
                        (team_id, time, extra_time, player, assist, type, detail, comments) =
                        (EXCLUDED.team_id, EXCLUDED.time, EXCLUDED.extra_time, EXCLUDED.player, 
                        EXCLUDED.assist, EXCLUDED.type, EXCLUDED.detail, EXCLUDED.comments)
                        
                    WHERE (events.team_id, events.time, events.extra_time, events.player, 
                        events.assist, events.type, events.detail, events.comments)
                        IS DISTINCT FROM
                        (EXCLUDED.team_id, EXCLUDED.time, EXCLUDED.extra_time, EXCLUDED.player, 
                        EXCLUDED.assist, EXCLUDED.type, EXCLUDED.detail, EXCLUDED.comments)`;
    } catch (err) {
        console.error('Failed to push events:', err.message);
    }
}

// Push updated team standings to DB
async function pushStandings(teams) {
    const teamsArray = [];
    for (const team of teams) {
        const teamArray = [team.id, team.position, team.won, team.drawn, team.lost, team.goals_for, team.goals_against];
        teamsArray.push(teamArray);
    }

    try {
        await sql`UPDATE teams SET position = (ns.position)::int, won = (ns.won)::int, drawn = (ns.drawn)::int, lost = (ns.lost)::int, goals_for = (ns.goals_for)::int, goals_against = (ns.goals_against)::int
                  FROM (VALUES ${sql(teamsArray)}) as ns (id, position, won, drawn, lost, goals_for, goals_against) WHERE teams.id = (ns.id)::int;`
    } catch (err) {
        console.error('Failed to push team standings data:', err.message);
    }
}

export async function updateFixtures() {
    const matches = await sql`SELECT id FROM matches WHERE complete = FALSE AND timestamp < now();`;
    const ids = matches.map((m) => m.id);
    const completedMatches = await updateForMatchesIfComplete(ids);
    if (completedMatches.length > 0) {
        await calculatePointsForMatch(completedMatches);
        console.log(`Updated for ${completedMatches.length} matches: ${completedMatches.map((m) => m.id)}.`);
        await updateStandings();
    } else {
        console.log(`No matches ready for update.`);
    }
}

export async function updateMatch(id) {
    const [match, events] = await getMatchAndEvents(id);

    await pushMatchData([match]);
    await pushEvents(events);

    if (match.complete) { updateNextMatch([match]) }

    return match;
}

// Fetches matches, checks if they are complete, and if so pushes matches/events for complete, and return completed matches
export async function updateForMatchesIfComplete(ids) {
    const [matches, events] = await getCompleteMatchesAndEvents(ids);

    if (matches.length > 0) {
        await pushMatchData(matches);
        await insertData('events', events);
        await updateNextMatch(matches);
        console.log(`Updated ${matches.length} matches and events: ${matches.map((m) => m.id)}.`);
    }

    return matches;
}

export async function updatePoints(id, round) {
    await calculatePointsForMatch([{id: id, round: round}]);
    console.log(`Updated points for match ${id}.`);
}

// Fetches, parses, and pushes standings to DB
export async function updateStandings() {
    const teams = await getStandings();
    await pushStandings(teams);
    console.log('Updated standings.');
}

// Fetches, parses, and pushes new fixtures to DB by round
export async function pullNewFixturesForRound(round) {
    const matches = await getUpcomingFixturesForRound(round);
    const matchesArray = matches.map((m) => [m.id, m.timestamp, m.home_id, m.away_id, m.round]);

    if (matches.length > 0) {
        const addedMatches = await sql`
                UPDATE matches m
                SET id = (nm.id)::int,
                    timestamp = (nm.timestamp)::timestamptz
                FROM (VALUES ${sql(matchesArray)}) AS nm (id, timestamp, home_id, away_id, round)
                WHERE m.home_id = (nm.home_id)::int AND m.away_id = (nm.away_id)::int AND m.round = (nm.round)::int
                    AND (m.id IS NULL OR m.timestamp IS DISTINCT FROM (nm.timestamp)::timestamptz)
                RETURNING m.id, m.timestamp`;
        console.log(`Added ${addedMatches.length} new fixtures for round ${round}.`);

        for (const match of addedMatches) {
            await scheduleMatch(match.id, match.timestamp.toISOString());
            await updatePickMatchId(match.id);
        }
    }
}

export async function pullNewFixturesFromDate(date) {
    const matches = await getUpcomingFixturesFromDate(date);
    const matchesArray = matches.map((m) => [m.id, m.timestamp, m.home_id, m.away_id, m.round]);

    if (matches.length > 0) {
        const addedMatches = await sql`
                UPDATE matches m
                SET id = (nm.id)::int,
                    timestamp = (nm.timestamp)::timestamptz
                FROM (VALUES ${sql(matchesArray)}) AS nm (id, timestamp, home_id, away_id, round)
                WHERE m.home_id = (nm.home_id)::int AND m.away_id = (nm.away_id)::int AND m.round = (nm.round)::int
                    AND (m.id IS NULL OR m.timestamp IS DISTINCT FROM (nm.timestamp)::timestamptz)
                RETURNING m.id, m.timestamp`;
        console.log(`Added ${addedMatches.length} new fixtures from ${date} and later.`);

        for (const match of addedMatches) {
            await scheduleMatch(match.id, match.timestamp.toISOString());
            await updatePickMatchId(match.id);
        }
    }
}

export async function pullNewFixturesFromToday() {
    const todayUtc = Temporal.Now.plainDateISO('UTC').toString();
    await pullNewFixturesFromDate(todayUtc);
}