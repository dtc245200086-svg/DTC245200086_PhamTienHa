const { pool } = require('./db');
const { createApp } = require('./app');
const { writeLog } = require('./logger');

const port = Number(process.env.PORT || 3000);
const cookieSecure = process.env.SESSION_COOKIE_SECURE === 'true';
const app = createApp(pool, {
  sessionSecret: process.env.SESSION_SECRET,
  cookieSecure
});

const server = app.listen(port, '0.0.0.0', () => {
  writeLog('info', 'server.started', { port });
});

async function shutdown(signal) {
  writeLog('info', 'server.stopping', { signal });
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));