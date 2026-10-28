// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json).
// Static files in public/ are served directly by Vercel's CDN.
const { connect, databaseUrl } = require('../src/db');
const { createApp } = require('../src/app');

const url = databaseUrl();

if (url) {
  module.exports = createApp(connect(url));
} else {
  // Explain the misconfiguration instead of crashing the function.
  const env = process.env.VERCEL_ENV || 'unknown';
  module.exports = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error:
          `Database not configured for this ${env} deployment: no DATABASE_URL found. ` +
          `In Vercel → Settings → Environment Variables, make sure DATABASE_URL is enabled for "${env}", then redeploy.`,
      }),
    );
  };
}
