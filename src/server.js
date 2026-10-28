const path = require('node:path');
const { openDb, getSettings } = require('./db');
const { createApp } = require('./app');
const { runAbsenceJob } = require('./logic');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'bahr.db');

const db = openDb(DB_FILE);
const app = createApp(db);

function absenceTick() {
  try {
    const added = runAbsenceJob(db, getSettings(db));
    if (added) console.log(`[absence] recorded ${added} black point(s)`);
  } catch (err) {
    console.error('[absence] failed', err);
  }
}
absenceTick();
setInterval(absenceTick, 5 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Bahr Network System running on http://localhost:${PORT}`);
});
