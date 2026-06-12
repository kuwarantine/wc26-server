import { updateFixtures } from '../services/applogic.js';
import sql from '../services/db.js';

/*const MAX_HRS = process.env.MAX_HRS;
const MIN_HRS = process.env.MIN_HRS;
const now = new Date();
const hrs = now.getUTCHours();*/

try {
    await updateFixtures();
} catch (err) {
    console.error('Script failed:', err.messsage); 
} finally {
    await sql.end();
}

