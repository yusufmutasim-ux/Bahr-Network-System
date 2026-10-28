// Local / traditional server. Uses DATABASE_URL if set, otherwise an embedded Postgres (PGlite) in ./data.
const path = require('node:path');
const { connect, getSettings } = require('./db');
const { createApp } = require('./app');
const { runAbsenceJob } = require('./logic');

const PORT = Number(process.env.PORT) || 3000;
const db = connect(undefined, { pgliteDir: process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'pglite') });
const app = createApp(db);

async function absenceTick() {
  try {
    const added = await runAbsenceJob(db, await getSettings(db));
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
