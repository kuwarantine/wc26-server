import sql, { insertData } from './db.js';
import { getCompleteMatchesAndEvents, getStandings, getUpcomingFixturesForRound, getUpcomingFixturesFromDate } from './footballApi.js';
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

// Helper function to determine match result, 1 is home win, 0 is draw, -1 is away win
function matchResult(home_score, away_score) {
    if (home_score > away_score) { return 1; }
    else if (away_score > home_score) { return -1; }
    else { return 0; }
}

// Helper function for knockout exact score points
function pointsForExactScore(match, pick, round) {
    if (match.finish_code === pick.finish_code) {
        if (match.home_score === pick.home_score && match.away_score === pick.away_score) {
            if (match.finish_code === 'FT') { return EXACT_SCORE_PONTS[round]; }
            if (match.home_et === pick.home_et && match.away_et === pick.away_et) {
                if (match.finish_code === 'AET') { return EXACT_SCORE_PONTS[round]; }
                if (match.home_pen === pick.home_pen && match.away_pen === pick.away_pen) { return EXACT_SCORE_PONTS[round]; }
            }
        }
        else if (match.home_score === pick.away_score && match.away_score === pick.home_score) {
            if (match.finish_code === 'FT') { return EXACT_SCORE_PONTS[round]; }
            if (match.home_et === pick.away_et && match.away_et === pick.home_et) {
                if (match.finish_code === 'AET') { return EXACT_SCORE_PONTS[round]; }
                if (match.home_pen === pick.away_pen && match.away_pen === pick.home_pen) { return EXACT_SCORE_PONTS[round]; }
            }
        }
    }
    return 0;
}

/* ========== OLD ========== */

// Checks the points each user got from the match and returns a map of user id to points
async function calculatePointsForGroupMatch(match) {
    try {
        const match_result = matchResult(match.home_score, match.away_score);

        const picks = await sql`SELECT user_id, home_score, away_score FROM picks WHERE match_id=${match.id};`;

        const users = {};
        for (const pick of picks) {
            let points = 0;
            const pick_result = matchResult(pick.home_score, pick.away_score);
            if (pick_result === match_result) { points += 1 }
            if (pick.home_score === match.home_score && pick.away_score === match.away_score) { points += 1 }
            users[pick.user_id] = points;
        }

        return users;
    } catch(err) {
        console.error(err);
    }
}

// Checks the points each user got after a knockout match finishes, correct winner is given if they have the team getting out of the round, score given if they win with the exact score
async function calculatePointsForKnockoutMatch(match) {
    try {
        const winner_id = match.winner_id;
        const round = match.round;
        
        const picks = await sql`SELECT user_id, home_score, away_score, home_et, away_et, home_pen, away_pen, finish_code FROM picks WHERE winner_id=${winner_id} AND round=${round};`;

        const users = {};
        for (const pick of picks) {
            let points = ROUND_WIN_POINTS[round];
            points += pointsForExactScore(match, pick, round);
            users[pick.user_id] = points;
        }

        return users;
    } catch(err) {
        console.error(err);
    }
}

// Combines group + knockout match points checking
async function calculatePointsForMatch(match_id) {
    const matches = await sql`SELECT id, winner_id, home_score, away_score, home_et, away_et, home_pen, away_pen, round, finish_code FROM matches WHERE id=${match_id};`;
    const match = matches[0];
    const users = (match.round > 1) ? await calculatePointsForKnockoutMatch(match) : await calculatePointsForGroupMatch(match);
    return users;
}

// Same as above but multiple matches
async function calculatePointsForMatches(match_ids) {
    const users = {};
    for (const match_id of match_ids) {
        let match_points = await calculatePointsForMatch(match_id);
        for (const user_id in match_points) {
            users[user_id] = (users[user_id] || 0) + match_points[user_id];
        }
    }
    return users;
}

// Check any fixtures that we haven't pulled and push to DB if complete, also update standings, defaults to knockout
export async function updateFixturesOld() {
    const matches = await sql`SELECT id FROM matches WHERE complete = FALSE AND timestamp < now();`;
    const ids = matches.map((m) => m.id);
    const completedMatches = await updateForMatchesIfComplete(ids);
    if (completedMatches.length > 0) {
        const completedMatchIds = completedMatches.map((m) => m.id);
        const new_points = await calculatePointsForMatches(completedMatchIds);
        await pushPointsForUsers(new_points, completedMatchIds);
        console.log(`Updated for ${completedMatchIds.length} matches: ${completedMatchIds.toString()}.`);
        await updateStandings();
    } else {
        console.log(`No matches ready for update.`);
    }
    
}

/* ========== NEW ========== */

async function calculatePointsForGroupMatch2(match_ids) {
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

async function calculatePointsForKnockoutMatch2(match_ids) {
    if (match_ids.length === 0) { return; }
    try {
        await sql`UPDATE picks p 
                    SET 
                        winner_points = r.winner_points,
                        score_points = CASE
                            WHEN p.finish_code != m.finish_code THEN 0

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

async function calculatePointsForMatch2(matches) {
    const groupIds = matches.filter((m) => m.round === 1).map((m) => m.id);
    const knockoutIds = matches.filter((m) => m.round > 1).map((m) => m.id);

    await calculatePointsForGroupMatch2(groupIds);
    await calculatePointsForKnockoutMatch2(knockoutIds);
}

export async function recalculatePointsForComplete2() {
    const matches = await sql`SELECT id, round FROM matches WHERE complete = TRUE;`;
    await calculatePointsForMatch2(matches);
}

async function updateFixtures2() {
    const matches = await sql`SELECT id FROM matches WHERE complete = FALSE AND timestamp < now();`;
    const ids = matches.map((m) => m.id);
    const completedMatches = await updateForMatchesIfComplete(ids);
    if (completedMatches.length > 0) {
        await calculatePointsForMatch2(completedMatches);
        console.log(`Updated for ${completedMatches.length} matches: ${completedMatches.map((m) => m.id)}.`)
    }
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
            { id },
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
    const successful = 0;

    for (const match of matches) {
        const kickoff = match.timestamp.toTemporalInstant();
        const minFinishTime = kickoff.add({minutes: 105}).toString();
        if (await scheduleMatch(match.id, minFinishTime)) {
            successful += 1;
        }
    }

    console.log(`Scheduled ${successful} matches.`);
}

/* ========== BOTH ========== */

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

// Push updated match data to DB
async function pushMatchData(matches) {
    const matchesArray = [];
    for (const match of matches) {
        const matchArray = [match.id, match.complete, match.home_score, match.away_score, match.home_et, match.away_et,
                            match.home_pen, match.away_pen, match.finish_code, match.winner_id];
        matchesArray.push(matchArray);
    }

    try {
        await sql`UPDATE matches SET complete = (nm.complete)::boolean, home_score = (nm.home_score)::int, away_score = (nm.away_score)::int, home_et = (nm.home_et)::int, 
                  away_et = (nm.away_et)::int, home_pen = (nm.home_pen)::int, away_pen = (nm.away_pen)::int, finish_code = nm.finish_code, winner_id = (nm.winner_id)::int 
                  FROM (VALUES ${sql(matchesArray)}) AS nm (id, complete, home_score, away_score, home_et, away_et, home_pen, away_pen, finish_code, winner_id) 
                  WHERE matches.id = (nm.id)::int`;
    } catch (err) {
        console.error('Failed to push match data:', err.message);
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

export async function recalculatePointsForComplete() {
    try {
        const matches = await sql`SELECT id FROM matches WHERE complete=TRUE AND parsed=false;`;
        const ids = matches.map((m) => m.id);
        const users = await calculatePointsForMatches(ids);

        return {new_points: users, match_ids: ids};
    } catch (err) {
        console.error(err);
    }
}

// Add points to users in DB
export async function pushPointsForUsers(new_points, match_ids) {
    try {
        const users = await sql`SELECT id, points FROM users;`;
        const usersArray = []
        for (const user of users) {
            user.points += new_points[user.id] ?? 0;
            usersArray.push([user.id, user.points]);
        }

        
        await sql`UPDATE users SET points = (np.points)::int FROM (VALUES ${sql(usersArray)}) as np (id, points) WHERE users.id = (np.id)::int`;
        if (match_ids.length > 0) { await sql`UPDATE matches SET parsed = TRUE WHERE id = ANY(${match_ids});`; }
    } catch(err) {
        console.error(err);
    }
}

export async function updateFixtures() {
    const matches = await sql`SELECT id FROM matches WHERE complete = FALSE AND timestamp < now();`;
    const ids = matches.map((m) => m.id);
    const completedMatches = await updateForMatchesIfComplete(ids);
    if (completedMatches.length > 0) {
        const completedMatchIds = completedMatches.map((m) => m.id);
        const new_points = await calculatePointsForMatches(completedMatchIds);
        await pushPointsForUsers(new_points, completedMatchIds);

        await calculatePointsForMatch2(completedMatches);
        console.log(`Updated for ${completedMatches.length} matches: ${completedMatches.map((m) => m.id)}.`);
        await updateStandings();
    } else {
        console.log(`No matches ready for update.`);
    }
}

// Fetches matches, checks if they are complete, and if so pushes matches/events for complete, and return completed matches
export async function updateForMatchesIfComplete(ids) {
    const [matches, events] = await getCompleteMatchesAndEvents(ids);

    if (matches.length > 0) {
        await pushMatchData(matches);
        await insertData('events', events);
        console.log(`Updated ${matches.length} matches and events: ${matches.map((m) => m.id)}.`);
    }

    return matches;
}

export async function updatePoints(id, round) {
    const new_points = await calculatePointsForMatches([id]);
    await pushPointsForUsers(new_points, [id]);

    await calculatePointsForMatch2([{id: id, round: round}]);
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

    if (matches.length > 0) {
        const addedMatches = await sql`INSERT INTO matches ${sql(matches)}
                  ON CONFLICT (id)
                  DO UPDATE SET
                    timestamp = EXCLUDED.timestamp
                  WHERE matches.timestamp IS DISTINCT FROM EXCLUDED.timestamp
                  RETURNING id, timestamp`;
        console.log(`Added ${addedMatches.length} new fixtures for round ${round}.`);

        for (const match of addedMatches) {
            await scheduleMatch(match.id, match.timestamp.toISOString());
        }
    }
}

export async function pullNewFixturesFromDate(date) {
    const matches = await getUpcomingFixturesFromDate(date);

    if (matches.length > 0) {
        const addedMatches = await sql`INSERT INTO matches ${sql(matches)}
                  ON CONFLICT (id)
                  DO UPDATE SET
                    timestamp = EXCLUDED.timestamp
                  WHERE matches.timestamp IS DISTINCT FROM EXCLUDED.timestamp
                  RETURNING id, timestamp`;
        console.log(`Added ${addedMatches.length} new fixtures from ${date} and later.`);

        for (const match of addedMatches) {
            await scheduleMatch(match.id, match.timestamp.toISOString());
        }
    }
}

export async function pullNewFixturesFromToday() {
    const todayUtc = Temporal.Now.plainDateISO('UTC').toString();
    await pullNewFixturesFromDate(todayUtc);
}