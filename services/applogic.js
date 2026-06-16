import sql, { insertData } from './db.js';

const headers = {
    'x-apisports-key': process.env.API_KEY
};
const EVENT_ENDPOINT='fixtures/events?fixture=';
const FIXTURE_ENDPOINT='fixtures?id=';
const MULTI_FIXTURE_ENDPOINT='fixtures?ids=';
const ROUND_FIXTURE_ENDPOINT='fixtures?league=1&season=2026&round='
const STANDINGS_ENDPOINT='standings?league=1&season=2026';

const NUM_GROUPS = 12;
const ROUNDS = 
{
    'Group': 1,
    'Round of 32': 2,
    'Round of 16': 3,
    'Quarter-finals': 4,
    'Semi-finals': 5, 
    'Final': 6
}

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


// Fetches fixtures for given round from API and returns the JSON
async function fetchFixturesForRound(round) {
    try {
        const res = await fetch(process.env.API_URL+ROUND_FIXTURE_ENDPOINT+round, {method: 'GET', headers: headers});
        const json = await res.json();
        return json;
    } catch (err) {
        console.error(err);
    }
}

// Fetches a fixture's information from API and returns the JSON
async function fetchFixture(id) {
    try {
        const res = await fetch(process.env.API_URL+FIXTURE_ENDPOINT+id, {method: 'GET', headers: headers});
        const json = await res.json();
        return json;
    } catch (err) {
        console.error(err);
    }
}

// Fetch multiple fixtures in one API call
async function fetchMultipleFixtures(ids) {
    try {
        const idstring = ids.join('-');
        const res = await fetch(process.env.API_URL+MULTI_FIXTURE_ENDPOINT+idstring, {method: 'GET', headers: headers});
        const json = await res.json();
        return json;
    } catch (err) {
        console.error(err);
    }
}

// Helper function to parse API round into int round ID for DB
function roundIDFromString(round) {
    if (round.includes('Group')) { 
        return ROUNDS['Group']; 
    }

    return ROUNDS[round];
}

// Helper function to determine winner from game
function winnerIDFromFixture(home_id, home_win, away_id, away_win) {
    if (home_win) {
        return home_id;
    } else if (away_win) {
        return away_id;
    } else {
        return 0;
    }
}

// Parses a fixture JSON.response and returns goals and complete status
function parseFixture(match) {
    const match_id = match.fixture.id;
    const timestamp = new Date(match.fixture.timestamp * 1000);
    const home_id = match.teams.home.id;
    const away_id = match.teams.away.id;
    const round = roundIDFromString(match.league.round);
    const complete = match.fixture.status.long === 'Match Finished';
    const in_ft = match.fixture.status.short === 'FT'

    if (complete) {
        const home_score = match.score.fulltime.home;
        const away_score = match.score.fulltime.away;
        const home_et = in_ft ? null : (home_score + (match.score.extratime.home ?? 0));
        const away_et = in_ft ? null : (away_score + (match.score.extratime.away ?? 0));
        const home_pen = match.score.penalty.home;
        const away_pen = match.score.penalty.away;
        const finish_code = match.fixture.status.short;
        const winner_id = winnerIDFromFixture(home_id, match.teams.home.winner, away_id, match.teams.away.winner);
        const fixture = {id: match_id, timestamp: timestamp, home_id: home_id, away_id: away_id, home_score: home_score, away_score: away_score, home_et: home_et, away_et: away_et, home_pen: home_pen, away_pen: away_pen, complete: complete, finish_code: finish_code, round: round, winner_id: winner_id};
        return fixture;
    }

    const fixture = {id: match_id, timestamp: timestamp, home_id: home_id, away_id: away_id, round: round};
    return fixture;
}

// Fetches a fixture's events from API and returns the JSON
async function fetchEventsForFixture(id) {
    try {
        const res = await fetch(process.env.API_URL+EVENT_ENDPOINT+id, {method: 'GET', headers: headers});
        const json = await res.json();
        return json;
    } catch (err) {
        console.error(err);
    }
}

// Parses a fixture events JSON  and returns an events array to be pushed into DB
function parseEvents(id, event_json) {
    const events = [];
    for (let event of event_json) {
        const team_id = event.team.id;
        const time = event.time.elapsed;
        const extra_time = event.time.extra;
        const player = event.player.name;
        const assist = event.assist.name;
        const type = event.type;
        const detail = event.detail;

        const e = {
            match_id: id,
            team_id: team_id,
            time: time,
            extra_time: extra_time,
            player: player,
            assist: assist,
            type: type,
            detail: detail
        };

        events.push(e);
    }

    return events;
}

// Fetch group standings from the API and return the JSON
async function fetchStandings() {
    try {
        const res = await fetch(process.env.API_URL+STANDINGS_ENDPOINT, {method: 'GET', headers: headers});
        const json = await res.json();
        return json;
    } catch (err) {
        console.error(err);
    }
}

// Parses the standings and returns an array with info to push to DB
function parseStandings(standings) {
    const teams = [];

    for (let i=0; i<NUM_GROUPS; i++) {
        for (const team of standings[i]) {
            const team_id = team.team.id;
            const position = team.rank;
            const won = team.all.win;
            const drawn = team.all.draw;
            const lost = team.all.lose;
            const goals_for = team.all.goals.for;
            const goals_against = team.all.goals.against;

            const t = {
                id: team_id,
                position: position,
                won: won,
                drawn: drawn,
                lost: lost,
                goals_for: goals_for,
                goals_against: goals_against
            };
            teams.push(t);
        }
    }

    return teams;
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
        if (match_ids.length > 0) { await sql`UPDATE matches SET parsed = TRUE WHERE id IN ${sql(match_ids)};`; }
    } catch(err) {
        console.error(err);
    }
}

// Check any fixtures that we haven't pulled and push to DB if complete, also update standings, defaults to knockout
export async function updateFixtures() {
    const matches = await sql`SELECT id FROM matches WHERE complete = FALSE AND timestamp < now();`;
    const ids = matches.map((m) => m.id);
    const completedMatchIds = await updateForMatchesIfComplete(ids);
    if (completedMatchIds.length > 0) {
        const new_points = await calculatePointsForMatches(completedMatchIds);
        await pushPointsForUsers(new_points, completedMatchIds);
        console.log(`Updated for ${completedMatchIds.length} matches: ${completedMatchIds.toString()}.`);
        await updateStandings();
    } else {
        console.log(`No matches ready for update.`);
    }
    
}

// Fetches matches, checks if they are complete, and if so pushes matches/events for complete, and return completed match count
async function updateForMatchesIfComplete(ids) {
    const fixturesJSON = await fetchMultipleFixtures(ids);
    const matches = [];
    let events = [];
    const completedMatchIds = [];
    for (const match of fixturesJSON.response) {
        const m = parseFixture(match);
        if (m.complete) {
            completedMatchIds.push(m.id);
            matches.push(m);
            const e = parseEvents(m.id, match.events);
            events = events.concat(e);
        }
    }
    if (completedMatchIds.length > 0) {
        await pushMatchData(matches);
        await insertData('events', events);
    }

    return completedMatchIds;
}

// Fetches, parses, and pushes standings to DB
async function updateStandings() {
    const standingsJSON = await fetchStandings();
    const standings = standingsJSON.response[0].league.standings;
    const teams = parseStandings(standings);
    await pushStandings(teams);
    console.log('Updated standings.');
}

// Fetches, parses, and pushes new fixtures to DB by round
export async function getNewFixturesForRound(round) {
    const fixturesJSON = await fetchFixturesForRound(round);
    const matches = [];
    for (const match of fixturesJSON.response) {
        const m = parseFixture(match);
        matches.push(m);
    }
    await insertData('matches', matches, true);
}