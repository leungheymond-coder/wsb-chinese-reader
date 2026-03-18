// scheduler.js — Cron jobs for auto-fetching and translating
import { config as dotenvConfig } from 'dotenv'; dotenvConfig({ override: true });
import cron from 'node-cron';
import { discoverAndFetchNew } from './fetcher.js';
import { translatePending } from './translator.js';
import { notifyPending } from './emailer.js';

// Concurrency guard — prevent overlapping fetch+translate runs
let pipelineRunning = false;

export async function runPipeline(label = 'scheduled') {
  if (pipelineRunning) {
    console.log(`[pipeline] Already running — skipping ${label} trigger`);
    return false;
  }
  pipelineRunning = true;
  try {
    await discoverAndFetchNew();
    await translatePending();
    await notifyPending();
  } catch (err) {
    console.error(`[pipeline] Error (${label}):`, err);
  } finally {
    pipelineRunning = false;
  }
  return true;
}

export function isPipelineRunning() {
  return pipelineRunning;
}

// Scheduler wrapper with timestamp logging
async function scheduledRun() {
  console.log(`\n[scheduler] ⏰ Pipeline started at ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })} EST`);
  await runPipeline('scheduler');
}

// Schedule: every 30 min during morning (7–10 AM) and afternoon (12–3 PM) EST
// Running frequently is safe — fetcher skips already-complete articles,
// emailer skips already-notified articles. This survives Mac sleep/wake.
export function startScheduler() {
  cron.schedule('*/30 7-10 * * *', scheduledRun, {
    timezone: 'America/Toronto'
  });

  cron.schedule('*/30 12-15 * * *', scheduledRun, {
    timezone: 'America/Toronto'
  });

  console.log('[scheduler] Scheduled: every 30 min, 7–10 AM and 12–3 PM EST');
}

// CLI: node backend/scheduler.js --run-now  (manual trigger)
if (process.argv[1]?.includes('scheduler')) {
  if (process.argv.includes('--run-now')) {
    runPipeline('cli').then(() => process.exit(0)).catch(console.error);
  } else {
    startScheduler();
    console.log('[scheduler] Running. Press Ctrl+C to stop.');
  }
}
