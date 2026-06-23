import boss from './services/queue.js';
import { pullNewFixturesFromToday, updateForMatchesIfComplete, updatePoints, updateStandings } from './services/applogic.js';

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

async function trackMatch([job]) {
    const id = job.data.id;
    try {
        const matches = await updateForMatchesIfComplete([id]);
        if (matches.length === 0) {
            const retryTime = Temporal.Now.instant().add({minutes: 1}).toString();
            await boss.send('track-match', { id }, { startAfter: retryTime, singletonKey: `match-${id}` });
            return;
        }

        const match = matches[0];
        await boss.send('calculate-points', { id: id, round: match.round });
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