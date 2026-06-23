import { recalculatePointsForComplete, pushPointsForUsers } from '../services/applogic.js';
import sql from '../services/db.js';

try {
    const recalc = await recalculatePointsForComplete();
    await pushPointsForUsers(recalc.new_points, recalc.match_ids);
} catch (err) {
    console.error('Script failed:', err.message); 
} finally {
    await sql.end();
}