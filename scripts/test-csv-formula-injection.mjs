#!/usr/bin/env node
/**
 * ============================================================================
 * REGRESSION TEST: CSV FORMULA INJECTION MITIGATION (CWE-1236)
 * File: scripts/test-csv-formula-injection.mjs
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { escapeCsvCell, formatCsvRow, UTF8_BOM } = require('../app/src/csv.js');

console.log('================================================================');
console.log('   TESTING CSV FORMULA INJECTION MITIGATION (CWE-1236)          ');
console.log('================================================================\n');

// 1. Basic RFC 4180 escaping
assert.equal(escapeCsvCell(null), '""', 'Null should be empty quoted string');
assert.equal(escapeCsvCell(undefined), '""', 'Undefined should be empty quoted string');
assert.equal(escapeCsvCell('Normal text'), '"Normal text"', 'Standard string should be quoted');
assert.equal(escapeCsvCell('Text with "quotes"'), '"Text with ""quotes"""', 'Quotes should be doubled');
console.log('[PASS] 1. Basic RFC 4180 escaping verified.');

// 2. Numerical values preservation
assert.equal(escapeCsvCell('12345'), '"12345"', 'Positive integer should remain unmodified');
assert.equal(escapeCsvCell('-123.45'), '"-123.45"', 'Negative monetary amount should NOT be prefixed with apostrophe');
assert.equal(escapeCsvCell('+500.00'), '"+500.00"', 'Positive monetary amount should NOT be prefixed with apostrophe');
console.log('[PASS] 2. Numerical values (including negative numbers) preserved.');

// 3. Formula injection neutralization
const maliciousPayloads = [
  { input: '=cmd|\' /C calc\'!A0', expected: '"\'=cmd|\' /C calc\'!A0"' },
  { input: '=1+1', expected: '"\'=1+1"' },
  { input: '@SUM(A1:A10)', expected: '"\'@SUM(A1:A10)"' },
  { input: '+calc', expected: '"\'+calc"' },
  { input: '-calc', expected: '"\'-calc"' },
  { input: '\t=HYPERLINK("http://attacker.com")', expected: '"\'\t=HYPERLINK(""http://attacker.com"")"' }
];

for (const p of maliciousPayloads) {
  const sanitized = escapeCsvCell(p.input);
  assert.equal(sanitized, p.expected, `Payload ${p.input} must be neutralized to ${p.expected}`);
  console.log(`[PASS] Neutralized formula injection payload: ${p.input} -> ${sanitized}`);
}

// 4. Row formatting and BOM verification
const sampleRow = formatCsvRow(['John Doe', '=cmd|\' /C calc\'!A0', '-500000.00', 'ACTIVE']);
assert.equal(sampleRow, '"John Doe","\'=cmd|\' /C calc\'!A0","-500000.00","ACTIVE"\r\n');
assert.equal(UTF8_BOM, '\uFEFF');
console.log('[PASS] 4. Full row formatting and UTF-8 BOM verified.');

console.log('\n================================================================');
console.log('   ALL CSV FORMULA INJECTION TESTS PASSED (100% SECURE)         ');
console.log('================================================================');
