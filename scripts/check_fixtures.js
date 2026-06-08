import { updateFixtures } from '../services/applogic.js';

const MAX_HRS = process.env.MAX_HRS;
const MIN_HRS = process.env.MIN_HRS;
const now = new Date();
const hrs = now.getUTCHours();

if (hrs >= MIN_HRS && hrs <= MAX_HRS) {
    await updateFixtures();
}