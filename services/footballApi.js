const headers = {
    'x-apisports-key': process.env.API_KEY
};
const EVENT_ENDPOINT='fixtures/events?fixture=';
const FIXTURE_ENDPOINT='fixtures?id=';
const MULTI_FIXTURE_ENDPOINT='fixtures?ids=';
const ROUND_FIXTURE_ENDPOINT='fixtures?league=1&season=2026&round=';
const DATE_FIXTURE_ENDPOINT='fixtures?league=1&season=2026&from=';
const STANDINGS_ENDPOINT='standings?league=1&season=2026';
const FINAL_DATE = '2026-07-19';

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

/* ========== HELPERS ========== */

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
        return null;
    }
}

/* ========== FETCHERS ========== */

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

async function fetchFixturesFromDate(date) {
    try {
        const res = await fetch(process.env.API_URL+DATE_FIXTURE_ENDPOINT+date+'&to='+FINAL_DATE, {method: 'GET', headers: headers});
        const json = await res.json();
        return json;
    } catch (err) {
        console.error(err);
    }
}

/* ========== PARSERS ========== */

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

// Parses a fixture JSON.response and returns goals and complete status
function parseFixture(match) {
    const match_id = match.fixture.id;
    const timestamp = Temporal.Instant.fromEpochMilliseconds(match.fixture.timestamp * 1000).toString();
    const home_id = match.teams.home.id;
    const away_id = match.teams.away.id;
    const round = roundIDFromString(match.league.round);
    const complete = match.fixture.status.long === 'Match Finished';
    const status = match.fixture.status.short;
    const after_ft = match.fixture.status.elapsed > 90;

    const home_score = match.score.fulltime.home;
    const away_score = match.score.fulltime.away;
    const home_et = after_ft ? (home_score + (match.score.extratime.home ?? 0)) : null;
    const away_et = after_ft ? (away_score + (match.score.extratime.away ?? 0)) : null;
    const home_pen = match.score.penalty.home;
    const away_pen = match.score.penalty.away;

    const winner_id = complete ? winnerIDFromFixture(home_id, match.teams.home.winner, away_id, match.teams.away.winner) : null;

    const fixture = {id: match_id, timestamp: timestamp, home_id: home_id, away_id: away_id, home_score: home_score, away_score: away_score, home_et: home_et, away_et: away_et, home_pen: home_pen, away_pen: away_pen, complete: complete, status: status, round: round, winner_id: winner_id};
    return fixture;
}

// Parses a fixture events JSON  and returns an events array to be pushed into DB
function parseEvents(id, event_json) {
    const events = [];
    for (const event of event_json) {
        const team_id = event.team.id;
        const time = event.time.elapsed;
        const extra_time = event.time.extra;
        const player = event.player.name;
        const assist = event.assist.name;
        const type = event.type;
        const detail = event.detail;
        const comments = event.comments;

        const e = {
            match_id: id,
            team_id: team_id,
            time: time,
            extra_time: extra_time,
            player: player,
            assist: assist,
            type: type,
            detail: detail,
            comments: comments
        };

        events.push(e);
    }

    return events;
}

/* ========== EXPORTS ========== */

export async function getStandings() {
    const standingsJSON = await fetchStandings();
    const standings = standingsJSON.response[0].league.standings;
    const teams = parseStandings(standings);
    return teams;
}

export async function getUpcomingFixturesForRound(round) {
    const fixturesJSON = await fetchFixturesForRound(round);
    const fixtures = fixturesJSON.response.filter((m) => m.fixture.status.short === 'NS').map((m) => parseFixture(m));
    return fixtures;
}

export async function getCompleteMatchesAndEvents(ids) {
    const fixturesJSON = await fetchMultipleFixtures(ids);
    const completeFixtures = fixturesJSON.response.filter((m) => m.fixture.status.long === 'Match Finished');
    const matches = [];
    let events = [];
    
    for (const match of completeFixtures) {
        const m = parseFixture(match);
        matches.push(m);
        const e = parseEvents(m.id, match.events);
        events = events.concat(e);
    }

    return [matches, events];
}

export async function getUpcomingFixturesFromDate(date) {
    const fixturesJSON = await fetchFixturesFromDate(date);
    const fixtures = fixturesJSON.response.filter((m) => m.fixture.status.short === 'NS').map((m) => parseFixture(m));
    return fixtures;
}