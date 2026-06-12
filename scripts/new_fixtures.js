import { getNewFixturesForRound } from "../services/applogic.js";
import sql from '../services/db.js';

const args = process.argv;
const round = args[2];

try {
    await getNewFixturesForRound(round);
} catch (err) {
    console.error('Script failed:', err.messsage); 
} finally {
    await sql.end();
}
