/**
 * ============================================================================
 * BILLING_ONE CSV UTILITY & STREAMING ENGINE
 * File: app/src/csv.js
 *
 * Responsibilities:
 * 1. Standards-compliant RFC 4180 CSV cell escaping and formatting.
 * 2. UTF-8 BOM (\uFEFF) prefixing for flawless Microsoft Excel rendering on Windows.
 * 3. Memory-efficient chunked streaming to HTTP responses without pagination limits.
 * ============================================================================
 */

const UTF8_BOM = '\uFEFF';

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  // Neutralize CSV / formula injection (OWASP CWE-1236)
  if (/^[=@\t\r]/.test(str) || /^[-+](?!\d)/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function formatCsvRow(cells) {
  return cells.map(escapeCsvCell).join(',') + '\r\n';
}

function sendCsvResponse(res, { filename, headers, rows }) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Write UTF-8 BOM so Microsoft Excel automatically recognizes Vietnamese accents
  res.write(UTF8_BOM);
  res.write(formatCsvRow(headers));

  if (Array.isArray(rows)) {
    for (const row of rows) {
      res.write(formatCsvRow(row));
    }
  }

  res.end();
}

module.exports = {
  UTF8_BOM,
  escapeCsvCell,
  formatCsvRow,
  sendCsvResponse
};
