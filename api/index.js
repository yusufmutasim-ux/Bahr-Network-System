// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json).
// Static files in public/ are served directly by Vercel's CDN.
const { connect } = require('../src/db');
const { createApp } = require('../src/app');

if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
  module.exports = createApp(connect());
} else {
  // Explain the misconfiguration instead of crashing the function.
  module.exports = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Database not configured: add a Postgres database (DATABASE_URL) to this Vercel project.' }));
  };
}
