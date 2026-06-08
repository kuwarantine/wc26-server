import { recalculatePointsForComplete, pushPointsForUsers } from '../services/applogic.js';

const recalc = await recalculatePointsForComplete();
await pushPointsForUsers(recalc.new_points, recalc.match_ids);