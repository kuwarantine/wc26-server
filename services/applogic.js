import { pool } from './db.js';

const headers = {
    'x-rapidapi-key': process.env.API_KEY,
    'x-rapidapi-host': process.env.API_HOST
};
const EVENT_ENDPOINT='fixtures/events?fixture=';
const FIXTURE_ENDPOINT='fixtures?id=';
const MULTI_FIXTURE_ENDPOINT='fixtures?ids=';
const ROUND_FIXTURE_ENDPOINT='fixtures?league=4&season=2024&round='
const STANDINGS_ENDPOINT='standings?league=4&season=2024';

const ROUNDS = 
{
    'Group': 1,
    'Round': 2,
    'Quarter-finals': 3,
    'Semi-finals': 4,
    'Final': 5
}

const ROUND_WIN_POINTS = 
{
    1: 1,
    2: 3,
    3: 6,
    4: 12,
    5: 24
}

const EXACT_SCORE_PONTS = 
{
    1: 1,
    2: 2,
    3: 2,
    4: 2,
    5: 4
}

// TEMP
import papa from 'papaparse';
import fs from 'fs';

const R16_cols = [155, 156, 157, 158]; // team name, FT, ET, pen 
const R16_rows = [9, 10, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38];
const QF_cols = [162, 163, 164, 165];
const QF_rows = [11, 12, 19, 20, 27, 28, 35, 36];
const SF_cols = [169, 170, 171, 172];
const SF_rows= [15, 16, 31, 32];
const F_cols = [176, 177, 178, 179];
const F_rows = [22, 23];
const all_cols = [R16_cols, QF_cols, SF_cols, F_cols];
const all_rows = [R16_rows, QF_rows, SF_rows, F_rows];

const teams = 
{
    'Germany': 25,
    'Hungary': 769,
    'Scotland': 1108,
    'Switzerland': 15,
    'Spain': 9,
    'Croatia': 3,
    'Italy': 768,
    'Albania': 778,
    'England': 10,
    'Denmark': 21,
    'Serbia': 14,
    'Slovenia': 1091,
    'France': 2,
    'Netherlands': 1118,
    'Austria': 775,
    'Poland': 24,
    'Belgium': 1,
    'Ukraine': 772,
    'Slovakia': 773,
    'Romania': 774,
    'Portugal': 27,
    'Turkey': 777,
    'Czech Republic': 770,
    'Georgia': 1104
};

// Reads picks from csvs and returns an array of the picks
function readKnockoutPicks() {
    const picks = [];

    for (let p=1; p<25; p++) {
        const csvFile = fs.readFileSync(`csvs/${p}.csv`);
        const csvData = csvFile.toString();
        const csv = papa.parse(csvData, {dynamicTyping: true}).data;
    
        for (let r=0; r<4; r++) {
            const cols = all_cols[r];
            const rows = all_rows[r];
            for (let i=0; i<rows.length; i+=2) {
                const home_row = csv[rows[i]];
                const away_row = csv[rows[i+1]];
        
                const home_name = home_row[cols[0]];
                const home_score = home_row[cols[1]];
                const home_et = home_row[cols[2]];
                const home_pen = home_row[cols[3]];
                const home = [home_name, home_score, home_et, home_pen];
        
                const away_name = away_row[cols[0]];
                const away_score = away_row[cols[1]];
                const away_et = away_row[cols[2]];
                const away_pen = away_row[cols[3]];
                const away = [away_name, away_score, away_et, away_pen];
        
                const match_res = matchWinner(home, away);
                const winner_id = match_res.winner_id;
                const finish_code = match_res.finish_code;
                const pick = { user_id: p, home_score: home_score, away_score: away_score, home_et: home_et, away_et: away_et, home_pen: home_pen, away_pen: away_pen, winner_id: winner_id, round: r+2, finish_code: finish_code };
                picks.push(pick);
            }
        }
    }

    return picks;
}

// Reads picks for teams that will reach round of 16
function readR16Teams() {
    const round_picks = [];

    for (let p=1; p<25; p++) {
        const csvFile = fs.readFileSync(`csvs/${p}.csv`);
        const csvData = csvFile.toString();
        const csv = papa.parse(csvData, {dynamicTyping: true}).data;

        const cols = all_cols[0];
        const rows = all_rows[0];

        for (let i=0; i<rows.length; i+=2) {
            const home_row = csv[rows[i]];
            const away_row = csv[rows[i+1]];
    
            const home_name = home_row[cols[0]];
            const away_name = away_row[cols[0]];
            const home_id = teams[home_name];
            const away_id = teams[away_name];
            const home_pick = { user_id: p, team_id: home_id, round: 2};
            const away_pick = { user_id: p, team_id: away_id, round: 2};
    
            round_picks.push(home_pick, away_pick);
        }
    }

    return round_picks;
}

// Helper function to push picks for teams that reach R16
function roundPicksString(round_picks) {
    const out = round_picks.map((p) => `(${p.user_id}, ${p.team_id}, ${p.round})`);
    return out.join(',');
}

// Helper function for pushing picks
function knockoutPicksString(picks) {
    const out = picks.map((p) => `(${p.user_id}, ${p.home_score}, ${p.away_score}, ${p.home_et}::INT, ${p.away_et}::INT, ${p.home_pen}::INT, ${p.away_pen}::INT, ${p.winner_id}, ${p.round}, '${p.finish_code}')`);
    return out.join(',');
}

// Push picks for teams that reach round of 16 to DB
async function pushRoundPicks(round_picks) {
    try {
        await pool.query(`INSERT INTO round_picks (user_id, team_id, round) VALUES ${roundPicksString(round_picks)};`);
    } catch (err) {
        console.error(err);
    }
}

// Pushes knockout picks to DB
async function pushKnockoutPicks(picks) {
    try {
        await pool.query(`INSERT INTO picks (user_id, home_score, away_score, home_et, away_et, home_pen, away_pen, winner_id, round, finish_code) VALUES ${knockoutPicksString(picks)};`);
    } catch (err) {
        console.error(err);
    }
}

function matchWinner(home, away) {
    if (home[1] === away[1]) {
        if (home[2] === away[2]) {
            if (home[3] > away[3]) {
                return {winner_id: teams[home[0]], finish_code: 'PEN'};
            } else {
                return {winner_id: teams[away[0]], finish_code: 'PEN'};
            }
        }
        if (home[2] > away[2]) {
            return {winner_id: teams[home[0]], finish_code: 'AET'};
        } else {
            return {winner_id: teams[away[0]], finish_code: 'AET'};
        }
    }
    if (home[1] > away[1]) {
        return {winner_id: teams[home[0]], finish_code: 'FT'};
    } else {
        return {winner_id: teams[away[0]], finish_code: 'FT'};
    }
}

// TEMP

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
    const split = round.split(' ');
    return ROUNDS[split[0]];
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
    const timestamp = match.fixture.timestamp;
    const home_id = match.teams.home.id;
    const away_id = match.teams.away.id;
    const home_score = match.score.fulltime.home;
    const away_score = match.score.fulltime.away;
    const home_et = match.score.extratime.home ? (match.score.extratime.home + home_score) : null;
    const away_et = match.score.extratime.away ? (match.score.extratime.away + away_score) : null;
    const home_pen = match.score.penalty.home;
    const away_pen = match.score.penalty.away;
    const complete = match.fixture.status.long === 'Match Finished';
    const finish_code = match.fixture.status.short;
    const round = roundIDFromString(match.league.round);
    const winner_id = winnerIDFromFixture(home_id, match.teams.home.winner, away_id, match.teams.away.winner);
    const fixture = {id: match_id, timestamp: timestamp, home_id: home_id, away_id: away_id, home_score: home_score, away_score: away_score, home_et: home_et, away_et: away_et, home_pen: home_pen, away_pen: away_pen, complete: complete, finish_code: finish_code, round: round, winner_id: winner_id};
    return fixture;
}

// Helper function for matches
function matchesString(matches) {
    const strings = matches.map((m) => `(${m.id}, ${m.home_score}, ${m.away_score}, ${m.home_et}::INT, ${m.away_et}::INT, ${m.home_pen}::INT, ${m.away_pen}::INT, ${m.complete}, '${m.finish_code}', ${m.winner_id})`);
    const out = strings.join(',');
    return out;
}

// Helper function for new matches
function newMatchesString(matches) {
    const strings = matches.map((m) => `(${m.id}, TO_TIMESTAMP(${m.timestamp}), ${m.home_id}, ${m.away_id}, ${m.round})`);
    const out = strings.join(',');
    return out;
}

// Push details of new fixtures that are not played into DB
async function pushNewFixtures(matches) {
    try {
        await pool.query(`INSERT INTO matches (id, timestamp, home_id, away_id, round) VALUES ${newMatchesString(matches)} ON CONFLICT DO NOTHING;`);
    } catch(err) {
        console.error(err);
    }
}

// Push fixtures to DB
async function pushFixtures(matches) {
    try {
        await pool.query(`UPDATE matches 
            SET home_score = nm.home_score, away_score = nm.away_score, home_et = nm.home_et, away_et = nm.away_et, home_pen = nm.home_pen, away_pen = nm.away_pen, complete = nm.complete, finish_code = nm.finish_code, winner_id = nm.winner_id 
            FROM (VALUES ${matchesString(matches)}) as nm (id, home_score, away_score, home_et, away_et, home_pen, away_pen, complete, finish_code, winner_id) 
            WHERE matches.id = nm.id;`);
    } catch (err) {
        console.error(err);
    }
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

// Helper function for events (match_id, team_id, time, extra_time, player, assist, type, detail)
function eventsString(events) {
    let out = '';
    for (let e of events) {
        const assist = e.assist ? `'${e.assist}'` : null;
        out += `(${e.match_id}, ${e.team_id}, ${e.time}, ${e.extra_time}, '${e.player}', ${assist}, '${e.type}', '${e.detail}'),`;
    }

    return out.substring(0, out.length-1);
}

// Push events array to DB
async function pushEvents(events) {
    try {
        await pool.query(`INSERT INTO events (match_id, team_id, time, extra_time, player, assist, type, detail) VALUES ${eventsString(events)};`);
    } catch (err) {
        console.error(err);
    }
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
    const num_groups = 6;
    const teams = [];
    for (let i=0; i<num_groups; i++) {
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

// Helper function for standings
function standingsString(standings) {
    const strings = standings.map((s) => `(${s.id}, ${s.position}, ${s.won}, ${s.drawn}, ${s.lost}, ${s.goals_for}, ${s.goals_against})`);
    const out = strings.join(',');
    return out;
}

// Push standings to DB
async function pushStandings(teams) {
    try {
        await pool.query(`UPDATE teams SET position = ns.position, won = ns.won, drawn = ns.drawn, lost = ns.lost, goals_for = ns.goals_for, goals_against = ns.goals_against FROM (VALUES ${standingsString(teams)}) as ns (id, position, won, drawn, lost, goals_for, goals_against) WHERE teams.id = ns.id;`);
    } catch (err) {
        console.error(err);
    }
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
        
        const picks_res = await pool.query(`SELECT user_id, home_score, away_score, home_et, away_et, home_pen, away_pen, finish_code FROM picks WHERE winner_id=${winner_id} AND round=${round};`);
        const picks_rows = picks_res.rows;

        const users = {};
        for (const pick of picks_rows) {
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

        const picks_res = await pool.query(`SELECT user_id, home_score, away_score FROM picks WHERE match_id=${match.id};`);
        const picks_rows = picks_res.rows;

        const users = {};
        for (let pick of picks_rows) {
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
    const match_res = await pool.query(`SELECT id, winner_id, home_score, away_score, home_et, away_et, home_pen, away_pen, round, finish_code FROM matches WHERE id=${match_id};`);
    const match = match_res.rows[0];
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

// Caclulate points for teams that reach round of 16
async function calculatePointsForR16Picks() {
    const users = {};
    try {
        const teams = await pool.query(`SELECT id FROM teams WHERE round > 1;`);
        const team_ids = teams.rows.map((t) => t.id);
        
        const picks = await pool.query(`SELECT * FROM round_picks;`);
        const picks_rows = picks.rows;

        for (const pick of picks_rows) {
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


export async function recalculatePointsForComplete() {
    try {
        const matches = await pool.query(`SELECT id FROM matches WHERE complete=TRUE AND parsed=false;`);
        const ids = matches.rows.map((m) => m.id);
        const users = await calculatePointsForMatches(ids);

        return {new_points: users, match_ids: ids};
    } catch (err) {
        console.error(err);
    }
}

// Helper function for points values
function pointsString(points) {
    let out = '';
    for (let user_id in points) {
        out += `(${user_id}, ${points[user_id]}),`;
    }

    return out.substring(0, out.length-1);
}

// Add points to users in DB
export async function pushPointsForUsers(new_points, match_ids) {
    try {
        const res = await pool.query(`SELECT id, points FROM users;`);
        const rows = res.rows;
        const points = {};
        for (let user of rows) {
            points[user.id] = user.points;
        }
        for (let user_id in new_points) {
            if (points[user_id] != null) { points[user_id] += new_points[user_id]; }
        }
        await pool.query(`UPDATE users SET points = np.points FROM (VALUES ${pointsString(points)}) as np (id, points) WHERE users.id = np.id;`);
        if (match_ids.length > 0) { await pool.query(`UPDATE matches SET parsed = TRUE WHERE id IN (${match_ids.join(',')});`); }
    } catch(err) {
        console.error(err);
    }
}

// Check any fixtures that we haven't pulled and push to DB if complete, also update standings , defaults to knockout
export async function updateFixtures() {
    const res = await pool.query(`SELECT id FROM matches WHERE complete = FALSE AND timestamp < now();`);
    const ids = res.rows.map((m) => m.id);
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
        await pushFixtures(matches);
        await pushEvents(events);
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
    await pushNewFixtures(matches);
}