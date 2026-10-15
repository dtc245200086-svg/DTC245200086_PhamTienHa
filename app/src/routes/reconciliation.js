const express = require('express');
const crypto = require('node:crypto');
const { AppError, asyncRoute } = require('../errors');
const { inTransaction } = require('../db');
const { parseId, parsePage, requireDate, requireDecimal, requireObject, requireText } = require('../validation');
const { requireAuth, requirePermission } = require('./auth');
const { recordAudit } = require('../audit');
const { PaymentService } = require('../services/paymentService');
const { sendCsvResponse } = require('../csv');

function computeCanonicalBankTxHash({ bankAccount, reference, txDate, amount, txType, description }) {
  const cleanAccount = String(bankAccount || '').trim();
  const cleanRef = reference ? String(reference).trim() : '';
  const cleanType = String(txType || 'CREDIT').trim().toUpperCase() === 'DEBIT' ? 'DEBIT' : 'CREDIT';
  const cleanDesc = String(description || '').trim();
  const cleanDate = String(txDate || '').trim();
  const cleanAmount = Number(amount).toFixed(2);

  if (cleanRef !== '') {
    return crypto.createHash('sha256').update(`${cleanAccount}:${cleanRef}`).digest('hex');
  }
  return crypto.createHash('sha256').update(`${cleanAccount}:${cleanDate}:${cleanAmount}:${cleanType}:${cleanDesc}`).digest('hex');
}

function reconciliationRouter(pool) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /api/bank-transactions AND /api/reconciliation/transactions
  const listTransactionsHandler = asyncRoute(async (req, res) => {
    const { page, limit, page_size, offset } = parsePage(req.query);
    const status = req.query.status ? req.query.status : null;
    const bankName = req.query.bank_name ? req.query.bank_name : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT b.id, b.tx_date, b.tx_time, b.description, b.amount::text,
                b.tx_type, b.reference, b.bank_name, b.bank_account, b.status,
                b.unapplied_amount::text,
                b.matched_invoice_id, i.invoice_no AS matched_invoice_no,
                c.name AS matched_customer_name, b.matched_payment_id, b.created_at
         FROM public.bank_transactions b
         LEFT JOIN public.invoices i ON i.id = b.matched_invoice_id
         LEFT JOIN public.customers c ON c.id = i.customer_id
         WHERE ($1::text IS NULL OR b.status = $1)
           AND ($2::text IS NULL OR b.bank_name = $2)
           AND ($3::date IS NULL OR b.tx_date >= $3)
           AND ($4::date IS NULL OR b.tx_date <= $4)
           AND ($5::text IS NULL OR b.description ILIKE $5 OR b.reference ILIKE $5 OR i.invoice_no ILIKE $5 OR c.name ILIKE $5 OR b.bank_account ILIKE $5 OR b.bank_name ILIKE $5 OR b.status ILIKE $5)
         ORDER BY b.tx_date DESC, b.id DESC LIMIT $6 OFFSET $7`,
        [status, bankName, from, to, pattern, limit, offset]
      ),
      pool.query(
        `SELECT count(*)::text AS total
         FROM public.bank_transactions b
         LEFT JOIN public.invoices i ON i.id = b.matched_invoice_id
         LEFT JOIN public.customers c ON c.id = i.customer_id
         WHERE ($1::text IS NULL OR b.status = $1)
           AND ($2::text IS NULL OR b.bank_name = $2)
           AND ($3::date IS NULL OR b.tx_date >= $3)
           AND ($4::date IS NULL OR b.tx_date <= $4)
           AND ($5::text IS NULL OR b.description ILIKE $5 OR b.reference ILIKE $5 OR i.invoice_no ILIKE $5 OR c.name ILIKE $5 OR b.bank_account ILIKE $5 OR b.bank_name ILIKE $5 OR b.status ILIKE $5)`,
        [status, bankName, from, to, pattern]
      )
    ]);

    res.json({ items: items.rows, transactions: items.rows, total: Number(count.rows[0].total), page, limit, page_size: limit });
  });

  // GET /api/reconciliation/export.csv (Server-side unpaginated CSV export with exact query filter consistency)
  const exportTransactionsHandler = asyncRoute(async (req, res) => {
    const status = req.query.status ? req.query.status : null;
    const bankName = req.query.bank_name ? req.query.bank_name : null;
    const from = req.query.from ? requireDate(req.query.from, 'from') : null;
    const to = req.query.to ? requireDate(req.query.to, 'to') : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = search ? `%${search}%` : null;

    const items = await pool.query(
      `SELECT b.id, b.tx_date, b.tx_time, b.description, b.amount::text, b.tx_type,
              b.reference, b.bank_name, b.bank_account, b.status,
              b.matched_invoice_id, i.invoice_no AS matched_invoice_no,
              c.name AS matched_customer_name
       FROM public.bank_transactions b
       LEFT JOIN public.invoices i ON i.id = b.matched_invoice_id
       LEFT JOIN public.customers c ON c.id = i.customer_id
       WHERE ($1::text IS NULL OR b.status = $1)
         AND ($2::text IS NULL OR b.bank_name = $2)
         AND ($3::date IS NULL OR b.tx_date >= $3)
         AND ($4::date IS NULL OR b.tx_date <= $4)
         AND ($5::text IS NULL OR b.description ILIKE $5 OR b.reference ILIKE $5 OR i.invoice_no ILIKE $5 OR c.name ILIKE $5 OR b.bank_account ILIKE $5 OR b.bank_name ILIKE $5 OR b.status ILIKE $5)
       ORDER BY b.tx_date DESC, b.id DESC`,
      [status, bankName, from, to, pattern]
    );

    const headers = ['Ngày GD', 'Tài khoản ngân hàng', 'Tên ngân hàng', 'Mã GD (FT/Reference)', 'Nội dung', 'Số tiền (VND)', 'Trạng thái', 'Hóa đơn khớp', 'Khách hàng khớp'];
    const rows = items.rows.map(tx => [
      tx.tx_date ? new Date(tx.tx_date).toISOString().slice(0, 10) : '',
      tx.bank_account || '',
      tx.bank_name || '',
      tx.reference || '',
      tx.description || '',
      tx.amount || '0',
      tx.status || '',
      tx.matched_invoice_no || (tx.matched_invoice_id ? `#${tx.matched_invoice_id}` : ''),
      tx.matched_customer_name || ''
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    sendCsvResponse(res, {
      filename: `doi_soat_ngan_hang_${dateStr}.csv`,
      headers,
      rows
    });
  });

  router.get('/export.csv', requirePermission('reconciliation.manage'), exportTransactionsHandler);
  router.get('/reconciliation/export.csv', requirePermission('reconciliation.manage'), exportTransactionsHandler);
  router.get('/bank-transactions/export.csv', requirePermission('reconciliation.manage'), exportTransactionsHandler);
  router.get('/transactions/export.csv', requirePermission('reconciliation.manage'), exportTransactionsHandler);

  router.get('/bank-transactions', requirePermission('reconciliation.manage'), listTransactionsHandler);
  router.get('/reconciliation/transactions', requirePermission('reconciliation.manage'), listTransactionsHandler);
  router.get('/transactions', requirePermission('reconciliation.manage'), listTransactionsHandler);

  // POST /api/bank-transactions AND /api/reconciliation/transactions
  const createTransactionHandler = asyncRoute(async (req, res) => {
    requireObject(req.body);
    const txDate = requireDate(req.body.tx_date, 'tx_date');
    const description = requireText(req.body.description, 'description', 1000);
    const amount = requireDecimal(req.body.amount, 'amount');
    const txType = req.body.tx_type === 'DEBIT' ? 'DEBIT' : 'CREDIT';
    const reference = requireText(req.body.reference, 'reference', 120, { optional: true });
    const bankName = requireText(req.body.bank_name || 'Vietcombank', 'bank_name', 100);
    const bankAccount = requireText(req.body.bank_account || '0011004392819', 'bank_account', 50);

    try {
      const createdTx = await inTransaction(async (client) => {
        const result = await client.query(
          `INSERT INTO public.bank_transactions
            (tx_date, description, amount, tx_type, reference, bank_name, bank_account, status, unapplied_amount)
           VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, 'UNMATCHED', 0)
           RETURNING id, tx_date, tx_time, description, amount::text, tx_type, reference, bank_name, bank_account, status, unapplied_amount::text, tx_hash, created_at`,
          [txDate, description, amount, txType, reference, bankName, bankAccount]
        );
        const tx = result.rows[0];

        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'reconciliation',
          action: 'BANK_TRANSACTION_RECORDED',
          targetRef: tx.reference || `#TX-${tx.id}`,
          severity: 'INFO',
          summary: `Ghi nhận giao dịch ngân hàng ${tx.amount} ₫ (${tx.tx_type}) - ${tx.bank_name}`,
          metadata: tx,
          throwOnError: true
        });

        return tx;
      });

      res.status(201).json({ transaction: createdTx });
    } catch (err) {
      if (err.code === '23505' && (err.constraint === 'bank_transactions_tx_hash_key' || (err.message && err.message.includes('tx_hash')))) {
        throw new AppError(409, 'DUPLICATE_TRANSACTION', 'Bank transaction already exists with this identity reference or transaction details.');
      }
      throw err;
    }
  });

  router.post('/bank-transactions', requirePermission('reconciliation.manage'), createTransactionHandler);
  router.post('/reconciliation/transactions', requirePermission('reconciliation.manage'), createTransactionHandler);
  router.post('/transactions', requirePermission('reconciliation.manage'), createTransactionHandler);

  // Helper function to parse CSV safely
  function parseCsvRecords(csvText) {
    const lines = [];
    let currentLine = [];
    let currentField = '';
    let insideQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (insideQuotes) {
        if (char === '"' && nextChar === '"') {
          currentField += '"';
          i++;
        } else if (char === '"') {
          insideQuotes = false;
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
          insideQuotes = true;
        } else if (char === ',') {
          currentLine.push(currentField.trim());
          currentField = '';
        } else if (char === '\r') {
          // ignore CR
        } else if (char === '\n') {
          currentLine.push(currentField.trim());
          if (currentLine.some((f) => f.length > 0)) {
            lines.push(currentLine);
          }
          currentLine = [];
          currentField = '';
        } else {
          currentField += char;
        }
      }
    }
    if (currentField.length > 0 || currentLine.length > 0) {
      currentLine.push(currentField.trim());
      if (currentLine.some((f) => f.length > 0)) {
        lines.push(currentLine);
      }
    }

    if (lines.length < 2) return [];

    const headers = lines[0].map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    const rows = [];
    for (let r = 1; r < lines.length; r++) {
      const line = lines[r];
      const rowObj = {};
      for (let c = 0; c < headers.length; c++) {
        rowObj[headers[c]] = line[c] !== undefined ? line[c] : '';
      }
      rows.push(rowObj);
    }
    return rows;
  }

  // POST /api/bank-transactions/batch AND /api/reconciliation/batch
  const batchImportHandler = asyncRoute(async (req, res) => {
    let rawRows = [];

    if (req.body && typeof req.body.csv === 'string') {
      rawRows = parseCsvRecords(req.body.csv);
    } else if (Array.isArray(req.body)) {
      rawRows = req.body;
    } else if (req.body && Array.isArray(req.body.rows)) {
      rawRows = req.body.rows;
    } else if (req.body && Array.isArray(req.body.transactions)) {
      rawRows = req.body.transactions;
    } else {
      throw new AppError(400, 'INVALID_BATCH_FORMAT', 'Batch body must contain "csv", "rows", or "transactions" array.');
    }

    const totalRows = rawRows.length;
    const accepted = [];
    const duplicates = [];
    const rejected = [];
    const seenBatchHashes = new Set();
    const crypto = require('crypto');

    // Parse and validate each row
    const candidates = [];
    for (let idx = 0; idx < totalRows; idx++) {
      const row = rawRows[idx];
      const rowNum = idx + 1;

      if (!row || typeof row !== 'object') {
        rejected.push({ row_index: rowNum, error: 'Row must be a valid object' });
        continue;
      }

      const txDateStr = String(row.tx_date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(txDateStr) || isNaN(Date.parse(txDateStr))) {
        rejected.push({ row_index: rowNum, error: 'Invalid or missing tx_date (expected YYYY-MM-DD)', row });
        continue;
      }

      const rawAmount = String(row.amount || '').trim();
      const numAmount = parseFloat(rawAmount);
      if (!rawAmount || isNaN(numAmount) || numAmount <= 0) {
        rejected.push({ row_index: rowNum, error: 'Invalid amount (must be positive numeric)', row });
        continue;
      }
      const amountStr = numAmount.toFixed(2);

      const description = String(row.description || '').trim();
      if (!description) {
        rejected.push({ row_index: rowNum, error: 'Description is required', row });
        continue;
      }

      const txType = String(row.tx_type || 'CREDIT').trim().toUpperCase() === 'DEBIT' ? 'DEBIT' : 'CREDIT';
      const reference = row.reference ? String(row.reference).trim() : null;
      const bankName = String(row.bank_name || 'Vietcombank').trim();
      const bankAccount = String(row.bank_account || '0011004392819').trim();

      // Compute canonical identity hash using authoritative algorithm
      const hash = computeCanonicalBankTxHash({
        bankAccount,
        reference,
        txDate: txDateStr,
        amount: amountStr,
        txType,
        description
      });

      // Check for in-batch duplicate
      if (seenBatchHashes.has(hash)) {
        duplicates.push({ row_index: rowNum, reason: 'Duplicate transaction within same batch', reference, tx_hash: hash });
        continue;
      }
      seenBatchHashes.add(hash);

      candidates.push({
        rowIndex: rowNum,
        txDate: txDateStr,
        description,
        amount: amountStr,
        txType,
        reference,
        bankName,
        bankAccount,
        hash
      });
    }

    // Persist candidates into database within transaction
    await inTransaction(async (client) => {
      for (const item of candidates) {
        const insertRes = await client.query(
          `INSERT INTO public.bank_transactions
            (tx_date, description, amount, tx_type, reference, bank_name, bank_account, status, unapplied_amount, tx_hash)
           VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, 'UNMATCHED', 0, $8)
           ON CONFLICT (tx_hash) DO NOTHING
           RETURNING id, tx_date, tx_time, description, amount::text, tx_type, reference, bank_name, bank_account, status, unapplied_amount::text, tx_hash, created_at`,
          [item.txDate, item.description, item.amount, item.txType, item.reference, item.bankName, item.bankAccount, item.hash]
        );

        if (insertRes.rowCount > 0) {
          accepted.push(insertRes.rows[0]);
        } else {
          // Existed in DB already
          duplicates.push({
            row_index: item.rowIndex,
            reason: 'Transaction already exists in database',
            reference: item.reference,
            tx_hash: item.hash
          });
        }
      }

      if (accepted.length > 0) {
        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'reconciliation',
          action: 'BANK_TRANSACTION_IMPORTED',
          targetRef: `BATCH-${Date.now()}`,
          severity: 'INFO',
          summary: `Nhập lô sao kê ngân hàng: ${accepted.length} thành công, ${duplicates.length} trùng, ${rejected.length} lỗi`,
          metadata: {
            total_rows: totalRows,
            accepted: accepted.length,
            duplicates: duplicates.length,
            rejected: rejected.length
          },
          throwOnError: true
        });
      }

      if (duplicates.length > 0) {
        await recordAudit(client, {
          user: req.user,
          ip: req.ip,
          module: 'reconciliation',
          action: 'BANK_TRANSACTION_DEDUPLICATED',
          targetRef: `BATCH-DEDUP-${Date.now()}`,
          severity: 'INFO',
          summary: `Phát hiện và loại bỏ ${duplicates.length} giao dịch trùng lặp trong quá trình đối soát`,
          metadata: {
            duplicate_count: duplicates.length,
            duplicates: duplicates.slice(0, 20)
          },
          throwOnError: true
        });
      }
    });

    res.status(200).json({
      total_rows: totalRows,
      accepted: accepted.length,
      duplicates: duplicates.length,
      rejected: rejected.length,
      errors: rejected,
      imported_transactions: accepted
    });
  });

  router.post('/bank-transactions/batch', requirePermission('reconciliation.manage'), batchImportHandler);
  router.post('/reconciliation/batch', requirePermission('reconciliation.manage'), batchImportHandler);
  router.post('/reconciliation/transactions/batch', requirePermission('reconciliation.manage'), batchImportHandler);
  router.post('/bank-transactions/import', requirePermission('reconciliation.manage'), batchImportHandler);
  router.post('/reconciliation/import', requirePermission('reconciliation.manage'), batchImportHandler);
  router.post('/batch', requirePermission('reconciliation.manage'), batchImportHandler);

  // POST /api/reconciliation/auto-match and /api/auto-match
  const autoMatchHandler = asyncRoute(async (req, res) => {
    const matchedCount = await inTransaction(async (client) => {
      // 1. Fetch unmatched credit transactions
      const unmatchedRes = await client.query(
        `SELECT id, description, amount::text, reference, tx_date, bank_name, bank_account
         FROM public.bank_transactions
         WHERE status = 'UNMATCHED' AND tx_type = 'CREDIT' FOR UPDATE`
      );

      let matchedTotal = 0;
      for (const tx of unmatchedRes.rows) {
        // Try to find matching invoice
        const invoiceRes = await client.query(
          `SELECT i.id, i.invoice_no, i.total::text, i.paid_total::text, i.adjusted_total::text,
                  (i.total - i.paid_total - i.adjusted_total)::numeric(14, 2) AS outstanding,
                  c.name AS customer_name, c.tax_code AS customer_tax_code
           FROM public.invoices i
           JOIN public.customers c ON c.id = i.customer_id
           WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
             AND (
               $1 ILIKE ('%' || i.invoice_no || '%')
               OR (c.tax_code IS NOT NULL AND $1 ILIKE ('%' || c.tax_code || '%') AND (i.total - i.paid_total - i.adjusted_total) = $2::numeric)
               OR ((i.total - i.paid_total - i.adjusted_total) = $2::numeric AND $1 ILIKE ('%' || substring(c.name from 1 for 10) || '%'))
             )
           LIMIT 1 FOR UPDATE`,
          [tx.description, tx.amount]
        );

        if (invoiceRes.rowCount > 0) {
          const inv = invoiceRes.rows[0];
          const txAmt = Number(tx.amount);
          const outstandingAmt = Number(inv.outstanding);
          const payAmt = Math.min(txAmt, outstandingAmt).toFixed(2);
          const unappliedAmt = Math.max(0, txAmt - outstandingAmt).toFixed(2);
          const noteText = Number(unappliedAmt) > 0
            ? `Khớp tự động sao kê ngân hàng (Đã khớp: ${payAmt} ₫, Tiền chưa phân bổ/thừa: ${unappliedAmt} ₫)`
            : 'Khớp tự động sao kê ngân hàng';

          // Create canonical payment & allocation via PaymentService
          const payResult = await PaymentService.createPayment(client, {
            customerId: inv.customer_id,
            invoiceId: inv.id,
            amount: txAmt,
            method: 'BANK_TRANSFER',
            paidAt: tx.tx_date,
            reference: tx.reference || `BANK-TX-${tx.id}`,
            bankName: tx.bank_name,
            bankAccount: tx.bank_account,
            notes: noteText,
            recordedBy: req.user.id,
            allocations: [{ invoiceId: inv.id, amount: payAmt }],
            idempotencyKey: `BANK-TX-MATCH-${tx.id}`
          });
          const paymentId = payResult.payment.id;

          // Mark bank transaction as matched / partially matched with unapplied_amount
          const newStatus = Number(unappliedAmt) > 0 ? 'PARTIALLY_MATCHED' : 'MATCHED';
          await client.query(
            `UPDATE public.bank_transactions
             SET status = $4, matched_invoice_id = $2, matched_payment_id = $3, unapplied_amount = $5::numeric
             WHERE id = $1`,
            [tx.id, inv.id, paymentId, newStatus, unappliedAmt]
          );

          matchedTotal++;
        }
      }

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'reconciliation',
        action: 'AUTO_RECONCILIATION_RUN',
        severity: 'INFO',
        summary: `Chạy đối soát tự động: Khớp thành công ${matchedTotal} giao dịch sao kê ngân hàng`,
        throwOnError: true
      });

      return matchedTotal;
    });

    res.json({ matched_count: matchedCount, message: `Đã đối soát thành công ${matchedCount} giao dịch.` });
  });

  router.post('/reconciliation/auto-match', requirePermission('reconciliation.manage'), autoMatchHandler);
  router.post('/auto-match', requirePermission('reconciliation.manage'), autoMatchHandler);

  // POST /api/reconciliation/manual-match and /api/manual-match
  const manualMatchHandler = asyncRoute(async (req, res) => {
    requireObject(req.body);
    const txId = parseId(req.body.transaction_id, 'transaction_id');
    const invoiceId = parseId(req.body.invoice_id, 'invoice_id');

    const result = await inTransaction(async (client) => {
      const txRes = await client.query(
        `SELECT id, description, amount::text, reference, tx_date, bank_name, bank_account, status
         FROM public.bank_transactions WHERE id = $1 FOR UPDATE`,
        [txId]
      );
      if (!txRes.rowCount) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Bank transaction was not found.');
      const tx = txRes.rows[0];

      if (tx.status !== 'UNMATCHED') {
        throw new AppError(409, 'TRANSACTION_ALREADY_MATCHED', `Bank transaction is already ${tx.status} and cannot be matched again.`);
      }

      const invRes = await client.query(
        `SELECT id, invoice_no, status, total::text, paid_total::text, adjusted_total::text,
                (total - paid_total - adjusted_total)::numeric(14, 2) AS outstanding
         FROM public.invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId]
      );
      if (!invRes.rowCount) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice was not found.');
      const inv = invRes.rows[0];

      if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status)) {
        throw new AppError(409, 'INVOICE_NOT_PAYABLE', 'Invoice is not in payable state.');
      }

      const txAmt = Number(tx.amount);
      const outstandingAmt = Number(inv.outstanding);
      if (outstandingAmt <= 0) {
        throw new AppError(409, 'INVOICE_ALREADY_SETTLED', 'Invoice has no outstanding balance to match.');
      }

      const payAmt = Math.min(txAmt, outstandingAmt).toFixed(2);
      const unappliedAmt = Math.max(0, txAmt - outstandingAmt).toFixed(2);
      const noteText = Number(unappliedAmt) > 0
        ? `Khớp thủ công sao kê ngân hàng (Đã khớp: ${payAmt} ₫, Tiền chưa phân bổ/thừa: ${unappliedAmt} ₫)`
        : 'Khớp thủ công sao kê ngân hàng';

      // Create canonical payment & allocation via PaymentService
      const payResult = await PaymentService.createPayment(client, {
        customerId: inv.customer_id,
        invoiceId: invoiceId,
        amount: txAmt,
        method: 'BANK_TRANSFER',
        paidAt: tx.tx_date,
        reference: tx.reference || `BANK-TX-${txId}`,
        bankName: tx.bank_name,
        bankAccount: tx.bank_account,
        notes: noteText,
        recordedBy: req.user.id,
        allocations: [{ invoiceId, amount: payAmt }],
        idempotencyKey: `BANK-TX-MATCH-${txId}`
      });
      const paymentId = payResult.payment.id;

      // Update bank transaction with unapplied amount
      const newStatus = Number(unappliedAmt) > 0 ? 'PARTIALLY_MATCHED' : 'MATCHED';
      await client.query(
        `UPDATE public.bank_transactions
         SET status = $4, matched_invoice_id = $2, matched_payment_id = $3, unapplied_amount = $5::numeric
         WHERE id = $1`,
        [txId, invoiceId, paymentId, newStatus, unappliedAmt]
      );

      const matchSummary = {
        tx_id: txId,
        invoice_no: inv.invoice_no,
        amount: payAmt,
        unapplied_amount: unappliedAmt,
        payment_id: paymentId,
        status: newStatus
      };

      await recordAudit(client, {
        user: req.user,
        ip: req.ip,
        module: 'reconciliation',
        action: 'BANK_TRANSACTION_MATCHED',
        targetRef: matchSummary.invoice_no,
        severity: 'INFO',
        summary: `Khớp thủ công giao dịch #${matchSummary.tx_id} (${matchSummary.amount} ₫) vào hóa đơn ${matchSummary.invoice_no}`,
        metadata: matchSummary,
        throwOnError: true
      });

      return matchSummary;
    });

    res.json({ result });
  });

  router.post('/reconciliation/manual-match', requirePermission('reconciliation.manage'), manualMatchHandler);
  router.post('/manual-match', requirePermission('reconciliation.manage'), manualMatchHandler);

  return router;
}

module.exports = { reconciliationRouter };
