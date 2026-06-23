import boss from "../services/queue.js";
import sql from "../services/db.js";
import { scheduleIncompleteMatches } from "../services/applogic.js";

try {
    boss.on('error', console.error);
    await boss.start();
    await scheduleIncompleteMatches();
} catch (err) {
    console.error('Script failed:', err.message);
    process.exit(1);
} finally {
    await boss.stop();
    await sql.end();
}