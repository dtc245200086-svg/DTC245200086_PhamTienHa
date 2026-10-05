function writeLog(level, msg, fields = {}) {
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

module.exports = { writeLog };