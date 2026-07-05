import papa from 'papaparse';
import fs from 'fs';
import sql, { insertData } from './db.js';

const name_col = 92;
const name_row = 9;
const gb_row = 11;
const poty_row = 12;
const R32_cols = [63, 64, 65, 66]; // team name, FT, ET, pen 
const R32_rows = [9, 10, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38, 
                    41, 42, 45, 46, 49, 50, 53, 54, 57, 58, 61, 62, 65, 66, 69, 70];
const R16_cols = [70, 71, 72, 73];
const R16_rows = [11, 12, 19, 20, 27, 28, 35, 36, 43, 44, 51, 52, 59, 60, 67, 68];
const QF_cols = [77, 78, 79, 80];
const QF_rows = [15, 16, 31, 32, 47, 48, 63, 64];
const SF_cols = [84, 85, 86, 87];
const SF_rows= [22, 23, 54, 55];
const F_cols = [91, 92, 93, 94];
const F_rows = [36, 37];
const all_cols = [R32_cols, R16_cols, QF_cols, SF_cols, F_cols];
const all_rows = [R32_rows, R16_rows, QF_rows, SF_rows, F_rows];

const NUM_GROUP_GAMES = 72;
const GROUP_GAME_ROW_OFFSET = 6;
const GROUP_HOME_SCORE_COL = 5;
const GROUP_AWAY_SCORE_COL = 6;

const NUM_KNOCKOUT_ROUNDS = 5;

const teams = 
{
    'Belgium': 1,
    'France': 2,
    'Croatia': 3,
    'Sweden': 5,
    'Brazil': 6,
    'Uruguay': 7,
    'Colombia': 8,
    'Spain': 9,
    'England': 10,
    'Panama': 11,
    'Japan': 12,
    'Senegal': 13,
    'Switzerland': 15,
    'Mexico': 16,
    'Korea Republic': 17, // South Korea
    'Australia': 20,
    'Iran': 22,
    'Saudi Arabia': 23,
    'Germany': 25,
    'Argentina': 26,
    'Portugal': 27,
    'Tunisia': 28,
    'Morocco': 31,
    'Egypt': 32,
    'Czech Republic': 770,
    'Austria': 775,
    'Turkey': 777, // Türkiye
    'Norway': 1090,
    'Scotland': 1108,
    'Bosnia and Herzegovina': 1113, // Bosnia & Herzegovina
    'Netherlands': 1118,
    'Ivory Coast': 1501,
    'Ghana': 1504,
    'DR Congo': 1508, // Congo DR
    'South Africa': 1531,
    'Algeria': 1532,
    'Cape Verde': 1533, // Cape Verde Islands
    'Jordan': 1548,
    'Iraq': 1567,
    'Uzbekistan': 1568,
    'Qatar': 1569,
    'Paraguay': 2380,
    'Ecuador': 2382,
    'United States': 2384, // USA
    'Haiti': 2386,
    'New Zealand': 4673,
    'Canada': 5529,
    'Curaçao': 5530
};

const GROUP_MATCH_IDS = [1489369,1538999,1539000,1489370,1489372,1539001,1489371,1489373,1489375,1489374,1489376,1539002,
                        1489379,1489380,1489378,1489377,1489383,1539016,1489381,1489382,1489385,1489384,1539003,1489386,
                        1539004,1539005,1489387,1489388,1489389,1489390,1489391,1539006,1489393,1489392,1539007,1489394,
                        1489398,1489397,1489395,1489396,1489401,1539017,1489399,1489400,1489402,1489403,1489404,1539008,
                        1489406,1489405,1489408,1539009,1539010,1489407,1489409,1489410,1539011,1489412,1539012,1489411,
                        1489416,1539074,1489414,1489415,1489413,1489417,1489422,1489420,1489418,1489421,1489419,1539013];



// Parses csv file and gives us 2D array
function readCSV(id) {
    const csvFile = fs.readFileSync(`csvs/${id}.csv`);
    const csvData = csvFile.toString();
    const csv = papa.parse(csvData, {dynamicTyping: true}).data;

    return csv;
}

// Reads player names and GB/POTY picks
function readUserData(csv) {
    const name = csv[name_row][name_col];
    const gb_name = csv[gb_row][name_col];
    const poty_name = csv[poty_row][name_col];
    const user = { name: name, gb_name: gb_name, poty_name: poty_name };

    return user;
}

// Reads picks from csvs for group matches
function readGroupPicks(csv, id) {
    const picks = [];

    for (let m=0; m<NUM_GROUP_GAMES; m++) {
        const row = m+GROUP_GAME_ROW_OFFSET;
        const match_row = csv[row];
        const home_score = match_row[GROUP_HOME_SCORE_COL];
        const away_score = match_row[GROUP_AWAY_SCORE_COL];
        const match_id = GROUP_MATCH_IDS[m];
        const pick = { user_id: id, match_id: match_id, home_score: home_score, away_score: away_score, round: 1 };
        picks.push(pick);
    }

    return picks;
}

// Reads picks from csvs for knockout matches
function readKnockoutPicks(csv, id) {
    const picks = [];

    for (let r=0; r<NUM_KNOCKOUT_ROUNDS; r++) {
        const cols = all_cols[r];
        const rows = all_rows[r];
        for (let i=0; i<rows.length; i+=2) {
            const home_row = csv[rows[i]];
            const away_row = csv[rows[i+1]];

            const home_name = home_row[cols[0]];
            const home_score = home_row[cols[1]];
            const home_et = home_row[cols[2]];
            const home_pen = home_row[cols[3]];
            const home = { name: home_name, score: home_score, et: home_et, pen: home_pen };

            const away_name = away_row[cols[0]];
            const away_score = away_row[cols[1]];
            const away_et = away_row[cols[2]];
            const away_pen = away_row[cols[3]];
            const away = { name: away_name, score: away_score, et: away_et, pen: away_pen };

            const match_res = knockoutMatchWinner(home, away);
            const winner_id = match_res.winner_id;
            const finish_code = match_res.finish_code;
            const pick = { user_id: id, home_score: home_score, away_score: away_score, home_et: home_et, away_et: away_et, home_pen: home_pen, away_pen: away_pen, winner_id: winner_id, round: r+2, finish_code: finish_code };
            picks.push(pick);
        }
        
    }

    return picks;
}

// Reads picks for teams that will reach round of 32
function readR32Teams(csv, id) {
    const round_picks = [];

    const cols = all_cols[0];
    const rows = all_rows[0];

    for (let i=0; i<rows.length; i+=2) {
        const home_row = csv[rows[i]];
        const away_row = csv[rows[i+1]];

        const home_name = home_row[cols[0]];
        const away_name = away_row[cols[0]];
        const home_id = teams[home_name];
        const away_id = teams[away_name];
        const home_pick = { user_id: id, team_id: home_id, round: 2};
        const away_pick = { user_id: id, team_id: away_id, round: 2};

        round_picks.push(home_pick, away_pick);
    }


    return round_picks;
}

// Reads team data from JSON
function readTeamData() {
    try {
        let rawData = fs.readFileSync('Initial_Standings.json', 'utf8');
        const json = JSON.parse(rawData);
        const standings = json.response[0].league.standings;
        
        const teams = [];
        for (let i=0; i<12; i++) {
            for (const country of standings[i]) {
                const position = country.rank;
                const name = country.team.name;
                const id = country.team.id;
                const team = { id: id, country: name, groupid: i, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, position: position, round: 1 };
                teams.push(team);
            }
        }

        return teams;
    } catch (error) {
        console.error("Error parsing JSON:", error);
    }
}

// Determine knockout match winner
function knockoutMatchWinner(home, away) {
    if (home.score === away.score) {
        if (home.et === away.et) {
            if (home.pen > away.pen) {
                return {winner_id: teams[home.name], finish_code: 'PEN'};
            } else {
                return {winner_id: teams[away.name], finish_code: 'PEN'};
            }
        }
        if (home.et > away.et) {
            return {winner_id: teams[home.name], finish_code: 'AET'};
        } else {
            return {winner_id: teams[away.name], finish_code: 'AET'};
        }
    }
    if (home.score > away.score) {
        return {winner_id: teams[home.name], finish_code: 'FT'};
    } else {
        return {winner_id: teams[away.name], finish_code: 'FT'};
    }
}

// Read and push team data
export async function readAndPushTeams() {
    const teams = readTeamData();
    await insertData('teams', teams);
}

// Read and push all csvs
export async function readAndPushPicks(num) {
    const users = [];
    const groupPicks = [];
    const knockoutPicks = [];
    const r32Teams = [];

    for (let i=0; i<num; i++) {
        const id = i+1;
        const csv = readCSV(id);
        const user = readUserData(csv);
        const group = readGroupPicks(csv, id);
        const knockout = readKnockoutPicks(csv, id);
        const r32 = readR32Teams(csv, id);

        users.push(user);
        groupPicks.push(group);
        knockoutPicks.push(knockout);
        r32Teams.push(r32);
    }

    await insertData('users', users);
    await insertData('picks', groupPicks.flat());
    await insertData('picks', knockoutPicks.flat());
    await insertData('round_picks', r32Teams.flat());
}
