import { getNewFixturesForRound } from "../services/applogic.js";

const args = process.argv;
const round = args[2];
await getNewFixturesForRound(round);