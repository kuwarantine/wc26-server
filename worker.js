import boss from './services/queue.js';
import sql from './services/db.js';
import { pullNewFixturesFromToday, updateMatch, updatePoints, updateStandings } from './services/applogic.js';

async function worker() {
    boss.on('error', console.error);
    await boss.start();
    
    await boss.createQueue('track-match', {
        policy: 'stately'
    });
    await boss.createQueue('calculate-points');
    await boss.createQueue('check-fixtures');
    await boss.createQueue('check-standings');

    await boss.work('track-match', trackMatch);
    await boss.work('calculate-points', calculatePoints);

    const queuedFixtureJobs = await boss.findJobs('check-fixtures', { queued: true });
    if (queuedFixtureJobs.length === 0) {
        await boss.send('check-fixtures', {});
    }
    await boss.work('check-fixtures', checkFixtures);

    await boss.schedule('check-standings', '0 * * * *');
    await boss.work('check-standings', updateStandings);
}

// ========== HELPERS ==========

function retryTimeForStatus(status, afterBreak) {
    switch (status) {
        case '1H':
        case '2H':
        case 'ET':
        case 'P':
        case 'BT':
        case 'LIVE':
            return 60;
        case 'NS':
            return 30;
        case 'HT':
            return afterBreak ? 30 : 14*60; // Buffer minute
        case 'SUSP':
        case 'INT':
            return 120;
        case 'PST':
            return 30*60;
        default:
            return null;
    }
}

// ========== JOBS ==========

async function trackMatch([job]) {
    const id = job.data.id;
    const afterBreak = job.data.afterBreak ?? false;
    try {
        const match = await updateMatch(id);
        await sql.notify('live', `${id}`);

        if (!match.complete) {
            const retryTime = retryTimeForStatus(match.status, afterBreak);
            if (retryTime !== null) {
                const data = { id: id };
                if (match.status === 'HT') { data.afterBreak = true; }

                const timeString = Temporal.Now.instant().add({seconds: retryTime}).toString();
                await boss.send('track-match', data, { startAfter: timeString, singletonKey: `match-${id}` });
            }
        } else {
            await sql.notify('live', '0');
            await boss.send('calculate-points', { id: id, round: match.round });
        }
    } catch (err) {
        console.error(err);
    }
}

async function calculatePoints([job]) {
    const id = job.data.id;
    const round = job.data.round;

    try {
        await updatePoints(id, round);
    } catch (err) {
        console.error(err);
    }
}

async function checkFixtures() {
    try {
        await pullNewFixturesFromToday();

        const nextTime = Temporal.Now.plainDateISO('UTC').add({days: 1})
                        .toZonedDateTime({timeZone: 'UTC', plainTime: '08:00'}).toInstant().toString();
        
        await boss.send('check-fixtures', {}, {startAfter: nextTime});
    } catch (err) {
        console.error(err);
    }
}

worker().catch(err => {
    console.error('Error during worker startup:', err);
    process.exit(1);
})

async function shutdown() {
    try {
        await boss.stop();
        console.log('Shut down worker gracefully.');
        process.exit(0);
    } catch (err) {
        console.error('Error during graceful shutdown.');
        process.exit(1);
    }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);