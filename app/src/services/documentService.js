/**
 * ============================================================================
 * BILLING_ONE DOCUMENT GENERATION & PRINT ENGINE
 * File: app/src/services/documentService.js
 *
 * Responsibilities:
 * 1. Authoritative Vietnamese Number-to-Words converter (docTienBangChu).
 * 2. Server-side HTML generation for Official VAT Invoices (Nghị định 123/2020/NĐ-CP).
 * 3. Server-side HTML generation for Receipt Vouchers (Mẫu 01-TT / C40-BB theo TT 200/2014/TT-BTC).
 * 4. Server-side HTML generation for Refund Payout Vouchers (Mẫu 02-TT theo TT 200/2014/TT-BTC).
 * 5. High-fidelity print styles (@page A4, @media print, page-break management).
 * ============================================================================
 */

const DIGIT_WORDS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readThreeDigits(triplet, readZeroHundred = true) {
  const hundreds = Math.floor(triplet / 100);
  const tens = Math.floor((triplet % 100) / 10);
  const units = triplet % 10;
  let str = '';

  if (hundreds > 0 || readZeroHundred) {
    str += `${DIGIT_WORDS[hundreds]} trăm `;
  }

  if (tens > 1) {
    str += `${DIGIT_WORDS[tens]} mươi `;
    if (units === 1) str += 'mốt ';
    else if (units === 5) str += 'lăm ';
    else if (units > 0) str += `${DIGIT_WORDS[units]} `;
  } else if (tens === 1) {
    str += 'mười ';
    if (units === 5) str += 'lăm ';
    else if (units > 0) str += `${DIGIT_WORDS[units]} `;
  } else {
    // tens === 0
    if (hundreds > 0 && units > 0) {
      str += `linh ${DIGIT_WORDS[units]} `;
    } else if (hundreds === 0 && units > 0) {
      str += `${DIGIT_WORDS[units]} `;
    }
  }

  return str.trim();
}

/**
 * Converts a numeric amount to Vietnamese words string.
 * Example: 10800000 -> "Mười triệu tám trăm nghìn đồng chẵn"
 */
function docTienBangChu(amount) {
  const rawNum = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
  if (isNaN(rawNum) || rawNum === 0) return 'Không đồng';

  const isNegative = rawNum < 0;
  const absNum = Math.abs(rawNum);
  const integerPart = Math.floor(absNum);
  const fractionalPart = Math.round((absNum - integerPart) * 100);

  if (integerPart === 0 && fractionalPart > 0) {
    return `${fractionalPart} xu`;
  }

  const scales = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  let current = integerPart;
  const triplets = [];

  while (current > 0) {
    triplets.push(current % 1000);
    current = Math.floor(current / 1000);
  }

  let resultWords = '';
  for (let i = triplets.length - 1; i >= 0; i--) {
    const triplet = triplets[i];
    if (triplet === 0) continue;

    const readZeroHundred = i !== triplets.length - 1;
    const tripletText = readThreeDigits(triplet, readZeroHundred);
    const scale = scales[i];

    resultWords += `${tripletText} ${scale} `;
  }

  resultWords = resultWords.trim().replace(/\s+/g, ' ');
  let finalStr = (isNegative ? 'Âm ' : '') + resultWords.charAt(0).toUpperCase() + resultWords.slice(1) + ' đồng';

  if (fractionalPart > 0) {
    finalStr += ` và ${fractionalPart} xu`;
  } else {
    finalStr += ' chẵn';
  }

  return finalStr;
}

function formatCurrencyVND(amount) {
  const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount || 0);
  return new Intl.NumberFormat('vi-VN', { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(num) + ' ₫';
}

function formatDateVN(dateStr) {
  if (!dateStr) return '...';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const COMMON_PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 12mm 15mm 15mm 15mm;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1a202c;
    background: #f7fafc;
    margin: 0;
    padding: 20px;
    font-size: 13px;
    line-height: 1.5;
  }
  .doc-container {
    max-width: 800px;
    margin: 0 auto;
    background: #ffffff;
    padding: 30px 40px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    position: relative;
  }
  @media print {
    body {
      background: #ffffff;
      padding: 0;
    }
    .doc-container {
      border: none;
      box-shadow: none;
      padding: 0;
      max-width: 100%;
    }
    .no-print {
      display: none !important;
    }
    .page-break {
      page-break-before: always;
    }
  }
  .print-actions {
    max-width: 800px;
    margin: 0 auto 15px auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .btn-print {
    background: #2b6cb0;
    color: #ffffff;
    border: none;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .btn-print:hover {
    background: #2c5282;
  }
  .header-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  .header-table td {
    vertical-align: top;
  }
  .company-title {
    font-size: 15px;
    font-weight: 700;
    color: #2b6cb0;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .company-info {
    font-size: 12px;
    color: #4a5568;
    line-height: 1.4;
  }
  .doc-title-block {
    text-align: center;
    margin: 20px 0 15px 0;
  }
  .doc-main-title {
    font-size: 22px;
    font-weight: 800;
    color: #1a365d;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 4px 0;
  }
  .doc-subtitle {
    font-size: 13px;
    color: #4a5568;
    font-style: italic;
  }
  .meta-box {
    text-align: right;
    font-size: 12px;
    color: #4a5568;
  }
  .meta-highlight {
    font-weight: 700;
    color: #c53030;
    font-size: 14px;
  }
  .party-section {
    border-top: 1px dashed #cbd5e0;
    border-bottom: 1px dashed #cbd5e0;
    padding: 10px 0;
    margin-bottom: 15px;
    font-size: 13px;
  }
  .party-row {
    display: flex;
    margin-bottom: 4px;
  }
  .party-label {
    width: 140px;
    font-weight: 600;
    color: #4a5568;
    flex-shrink: 0;
  }
  .party-value {
    flex: 1;
    color: #2d3748;
  }
  .table-data {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 15px;
  }
  .table-data th, .table-data td {
    border: 1px solid #cbd5e0;
    padding: 7px 10px;
    font-size: 12px;
  }
  .table-data th {
    background: #edf2f7;
    font-weight: 700;
    color: #2d3748;
    text-align: center;
  }
  .text-center { text-align: center; }
  .text-right { text-align: right; }
  .text-left { text-align: left; }
  .font-bold { font-weight: 700; }
  .totals-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 10px;
  }
  .totals-table td {
    padding: 4px 10px;
    font-size: 13px;
  }
  .totals-table .total-label {
    text-align: right;
    font-weight: 600;
    color: #4a5568;
    width: 70%;
  }
  .totals-table .total-amount {
    text-align: right;
    font-weight: 700;
    color: #1a202c;
    width: 30%;
  }
  .words-row {
    background: #f7fafc;
    border-left: 3px solid #3182ce;
    padding: 8px 12px;
    font-size: 13px;
    font-style: italic;
    color: #2d3748;
    margin-bottom: 25px;
  }
  .signatures-grid {
    display: flex;
    justify-content: space-between;
    margin-top: 25px;
    page-break-inside: avoid;
    text-align: center;
  }
  .sig-col {
    flex: 1;
    padding: 0 5px;
  }
  .sig-title {
    font-weight: 700;
    font-size: 12px;
    color: #2d3748;
    text-transform: uppercase;
  }
  .sig-subtitle {
    font-size: 11px;
    color: #718096;
    font-style: italic;
    margin-top: 2px;
  }
  .sig-space {
    height: 60px;
  }
  .sig-name {
    font-weight: 600;
    font-size: 12px;
    color: #2d3748;
  }
  .badge-status {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .badge-paid { background: #c6f6d5; color: #22543d; }
  .badge-issued { background: #bee3f8; color: #2a4365; }
  .badge-overdue { background: #fed7d7; color: #742a2a; }
  .badge-draft { background: #e2e8f0; color: #4a5568; }
`;

/**
 * Server-side generation of Official VAT Invoice HTML
 */
function renderInvoiceHtml({ invoice, items = [], customer = {}, company = {}, adjustments = [] }) {
  const invNo = invoice.invoice_no || `DRAFT-${invoice.id}`;
  const issueDateFormatted = formatDateVN(invoice.issue_date);
  const dueDateFormatted = formatDateVN(invoice.due_date);
  const wordsAmount = docTienBangChu(invoice.total);

  // Group items by VAT rate for multi-rate breakdown display
  const vatRatesMap = new Map();
  for (const item of items) {
    const rate = Number(item.vat_rate || 0);
    const key = (rate * 100).toFixed(0) + '%';
    if (!vatRatesMap.has(key)) {
      vatRatesMap.set(key, { rate, net: 0, vat: 0, total: 0 });
    }
    const entry = vatRatesMap.get(key);
    entry.net += parseFloat(item.line_total || 0);
    entry.vat += parseFloat(item.vat_amount || 0);
    entry.total += parseFloat(item.total_amount || (parseFloat(item.line_total || 0) + parseFloat(item.vat_amount || 0)));
  }
  const vatBreakdownRows = Array.from(vatRatesMap.entries()).sort((a, b) => b[1].rate - a[1].rate);

  const safeComp = {
    company_name: escapeHtml(company.company_name || 'CÔNG TY CỔ PHẦN CÔNG NGHỆ TÀI CHÍNH BILLING ONE'),
    tax_code: escapeHtml(company.tax_code || '0109887766'),
    address: escapeHtml(company.address || 'Tòa nhà Keangnam Landmark 72, Hà Nội'),
    bank_account: escapeHtml(company.bank_account || '19036788889999'),
    bank_name: escapeHtml(company.bank_name || 'Techcombank'),
    tax_provider: escapeHtml(company.tax_provider || 'VNPT-CA Cloud HSM Level 3')
  };
  const safeCust = {
    name: escapeHtml(customer.name || 'Khách hàng lẻ'),
    tax_code: escapeHtml(customer.tax_code || 'Không có'),
    address: escapeHtml(customer.address || 'Chưa cập nhật'),
    email: escapeHtml(customer.email || ''),
    phone: escapeHtml(customer.phone || '')
  };

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Hóa đơn GTGT - ${invNo}</title>
  <style>${COMMON_PRINT_CSS}</style>
</head>
<body>
  <div class="print-actions no-print">
    <a href="/#/invoices/${invoice.id}" style="color: #4a5568; text-decoration: none; font-size: 13px;">&larr; Quay lại danh sách hóa đơn</a>
    <button class="btn-print" onclick="window.print()">
      <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"/><path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2H5zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4V3zm1 5a2 2 0 0 0-2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2H5zm7 2v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1z"/></svg>
      In Hóa đơn (Print)
    </button>
  </div>

  <div class="doc-container">
    <!-- Header: Company Info -->
    <table class="header-table">
      <tr>
        <td style="width: 65%;">
          <div class="company-title">${safeComp.company_name}</div>
          <div class="company-info">
            <strong>Mã số thuế:</strong> ${safeComp.tax_code}<br>
            <strong>Địa chỉ:</strong> ${safeComp.address}<br>
            <strong>Tài khoản ngân hàng:</strong> ${safeComp.bank_account} tại ${safeComp.bank_name}<br>
            <strong>Nhà cung cấp CQT:</strong> ${safeComp.tax_provider}
          </div>
        </td>
        <td style="width: 35%;" class="meta-box">
          <div>Mẫu số: <strong>01GTKT0/001</strong></div>
          <div>Ký hiệu: <strong>1C25TND</strong></div>
          <div>Số hóa đơn: <span class="meta-highlight">${invNo}</span></div>
          <div>Mã tra cứu: <strong>${invoice.e_invoice_code || invoice.einvoice_code || 'Chưa cấp'}</strong></div>
          <div>Trạng thái: <span class="badge-status badge-${invoice.status?.toLowerCase()}">${invoice.status}</span></div>
        </td>
      </tr>
    </table>

    <div class="doc-title-block">
      <h1 class="doc-main-title">HÓA ĐƠN GIÁ TRỊ GIA TĂNG</h1>
      <div class="doc-subtitle">(BẢN THỂ HIỆN HÓA ĐƠN ĐIỆN TỬ THEO NGHỊ ĐỊNH 123/2020/NĐ-CP & THÔNG TƯ 78/2021/TT-BTC)</div>
      <div style="font-size: 12px; margin-top: 4px; color: #4a5568;">
        Ngày lập: ${issueDateFormatted} &bull; Ngày đáo hạn: ${dueDateFormatted}
      </div>
    </div>

    <!-- Buyer Details -->
    <div class="party-section">
      <div class="party-row">
        <div class="party-label">Tên người mua:</div>
        <div class="party-value"><strong>${safeCust.name}</strong></div>
      </div>
      <div class="party-row">
        <div class="party-label">Mã số thuế:</div>
        <div class="party-value">${safeCust.tax_code}</div>
      </div>
      <div class="party-row">
        <div class="party-label">Địa chỉ:</div>
        <div class="party-value">${safeCust.address}</div>
      </div>
      <div class="party-row">
        <div class="party-label">Email / Điện thoại:</div>
        <div class="party-value">${safeCust.email} ${safeCust.phone ? `(${safeCust.phone})` : ''}</div>
      </div>
      <div class="party-row">
        <div class="party-label">Hình thức thanh toán:</div>
        <div class="party-value">Chuyển khoản / Tiền mặt (TM/CK)</div>
      </div>
    </div>

    <!-- Line Items Table -->
    <table class="table-data">
      <thead>
        <tr>
          <th style="width: 5%;">STT</th>
          <th style="width: 40%;">Tên hàng hóa, dịch vụ</th>
          <th style="width: 8%;">ĐVT</th>
          <th style="width: 8%;">SL</th>
          <th style="width: 14%;">Đơn giá</th>
          <th style="width: 7%;">Thuế</th>
          <th style="width: 18%;">Thành tiền</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, idx) => `
          <tr>
            <td class="text-center">${idx + 1}</td>
            <td class="text-left">${escapeHtml(item.description)}</td>
            <td class="text-center">${escapeHtml(item.unit || 'Gói')}</td>
            <td class="text-center">${item.quantity}</td>
            <td class="text-right">${formatCurrencyVND(item.unit_price)}</td>
            <td class="text-center font-bold">${Number(item.vat_rate || 0) * 100}%</td>
            <td class="text-right">${formatCurrencyVND(item.line_total)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- VAT Breakdown & Adjustments Summary -->
    <div style="display: flex; gap: 20px; margin-bottom: 10px;">
      <div style="flex: 1;">
        <table class="table-data" style="margin-bottom: 0;">
          <thead>
            <tr>
              <th>Thuế suất</th>
              <th>Tiền hàng chưa thuế</th>
              <th>Thuế GTGT</th>
            </tr>
          </thead>
          <tbody>
            ${vatBreakdownRows.map(([rateLabel, row]) => `
              <tr>
                <td class="text-center font-bold">${rateLabel}</td>
                <td class="text-right">${formatCurrencyVND(row.net)}</td>
                <td class="text-right">${formatCurrencyVND(row.vat)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="flex: 1;">
        <table class="totals-table">
          <tr>
            <td class="total-label">Cộng tiền hàng (Subtotal):</td>
            <td class="total-amount">${formatCurrencyVND(invoice.subtotal)}</td>
          </tr>
          <tr>
            <td class="total-label">Tiền thuế GTGT (VAT Amount):</td>
            <td class="total-amount">${formatCurrencyVND(invoice.tax_amount)}</td>
          </tr>
          ${adjustments && adjustments.length > 0 ? `
            <tr>
              <td class="total-label" style="color: #c53030;">Giảm trừ (Adjustments):</td>
              <td class="total-amount" style="color: #c53030;">-${formatCurrencyVND(adjustments.reduce((acc, a) => acc + parseFloat(a.amount || 0), 0))}</td>
            </tr>
          ` : ''}
          <tr style="border-top: 2px solid #2b6cb0;">
            <td class="total-label" style="font-size: 15px; color: #1a365d;">Tổng cộng thanh toán (Total):</td>
            <td class="total-amount" style="font-size: 16px; color: #c53030;">${formatCurrencyVND(invoice.total)}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Amount in Words -->
    <div class="words-row">
      <strong>Số tiền viết bằng chữ:</strong> ${wordsAmount}
    </div>

    <!-- Signatures -->
    <div class="signatures-grid">
      <div class="sig-col">
        <div class="sig-title">Người mua hàng</div>
        <div class="sig-subtitle">(Ký, ghi rõ họ tên)</div>
        <div class="sig-space"></div>
        <div class="sig-name">${customer.name || ''}</div>
      </div>
      <div class="sig-col">
        <div class="sig-title">Người bán hàng</div>
        <div class="sig-subtitle">(Ký điện tử bởi đại diện pháp luật)</div>
        <div class="sig-space" style="display: flex; align-items: center; justify-content: center;">
          <div style="border: 1px dashed #38a169; color: #276749; padding: 4px 8px; font-size: 10px; font-weight: 700; border-radius: 4px;">
            [ĐÃ KÝ ĐIỆN TỬ: ${company.company_name || 'BILLING ONE'}]
          </div>
        </div>
        <div class="sig-name">Đại diện pháp luật</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Server-side generation of Payment Receipt Voucher (Mẫu 01-TT / C40-BB theo TT 200/2014/TT-BTC)
 */
function renderPaymentReceiptHtml({ payment, customer = {}, company = {}, allocations = [] }) {
  const receiptNo = payment.reference || `PT-${new Date(payment.paid_at || Date.now()).getFullYear()}-${String(payment.id).padStart(4, '0')}`;
  const paidDateFormatted = formatDateVN(payment.paid_at || payment.created_at);
  const wordsAmount = docTienBangChu(payment.amount);

  const safeComp = {
    company_name: escapeHtml(company.company_name || 'CÔNG TY CỔ PHẦN CÔNG NGHỆ TÀI CHÍNH BILLING ONE'),
    tax_code: escapeHtml(company.tax_code || '0109887766'),
    address: escapeHtml(company.address || 'Tòa nhà Keangnam Landmark 72, Hà Nội')
  };
  const safeCust = {
    name: escapeHtml(customer.name || 'Khách hàng vãng lai'),
    tax_code: escapeHtml(customer.tax_code || 'Không có'),
    address: escapeHtml(customer.address || 'Chưa cập nhật')
  };

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Phiếu thu - ${receiptNo}</title>
  <style>${COMMON_PRINT_CSS}</style>
</head>
<body>
  <div class="print-actions no-print">
    <a href="/#/payments" style="color: #4a5568; text-decoration: none; font-size: 13px;">&larr; Quay lại danh sách thanh toán</a>
    <button class="btn-print" onclick="window.print()">
      <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"/><path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2H5zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4V3zm1 5a2 2 0 0 0-2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2H5zm7 2v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1z"/></svg>
      In Phiếu thu (Print)
    </button>
  </div>

  <div class="doc-container">
    <!-- Header: Company & Circular reference -->
    <table class="header-table">
      <tr>
        <td style="width: 60%;">
          <div class="company-title">${safeComp.company_name}</div>
          <div class="company-info">
            <strong>Mã số thuế:</strong> ${safeComp.tax_code}<br>
            <strong>Địa chỉ:</strong> ${safeComp.address}
          </div>
        </td>
        <td style="width: 40%; text-align: right;" class="meta-box">
          <div><strong>Mẫu số: 01 - TT</strong></div>
          <div style="font-size: 11px; font-style: italic; color: #718096;">(Ban hành theo Thông tư số 200/2014/TT-BTC ngày 22/12/2014 của BTC)</div>
          <div style="margin-top: 5px;">Số phiếu: <span class="meta-highlight">${receiptNo}</span></div>
          <div>Mã GD thanh toán: <strong>#PAY-${payment.id}</strong></div>
        </td>
      </tr>
    </table>

    <div class="doc-title-block">
      <h1 class="doc-main-title">PHIẾU THU</h1>
      <div class="doc-subtitle">(RECEIPT VOUCHER)</div>
      <div style="font-size: 12px; margin-top: 4px; color: #4a5568;">
        Ngày thu tiền: ${paidDateFormatted}
      </div>
    </div>

    <!-- Payer Info -->
    <div class="party-section">
      <div class="party-row">
        <div class="party-label">Họ và tên người nộp:</div>
        <div class="party-value"><strong>${safeCust.name}</strong></div>
      </div>
      <div class="party-row">
        <div class="party-label">Địa chỉ:</div>
        <div class="party-value">${safeCust.address}</div>
      </div>
      <div class="party-row">
        <div class="party-label">Lý do nộp:</div>
        <div class="party-value">${escapeHtml(payment.notes || `Thanh toán công nợ tiền hàng / hóa đơn`)}</div>
      </div>
      <div class="party-row">
        <div class="party-label">Phương thức thanh toán:</div>
        <div class="party-value"><strong>${escapeHtml(payment.method)}</strong> ${payment.bank_name ? `(Ngân hàng: ${escapeHtml(payment.bank_name)})` : ''}</div>
      </div>
      <div class="party-row">
        <div class="party-label">Số tiền thu:</div>
        <div class="party-value font-bold" style="font-size: 16px; color: #2b6cb0;">${formatCurrencyVND(payment.amount)}</div>
      </div>
    </div>

    <!-- Amount in Words -->
    <div class="words-row">
      <strong>Viết bằng chữ:</strong> ${wordsAmount}
    </div>

    <!-- Allocation Breakdown Table if exists -->
    ${allocations && allocations.length > 0 ? `
      <div style="margin-bottom: 8px; font-weight: 600; font-size: 12px; color: #4a5568;">Chứng từ thanh toán kèm theo (Chi tiết phân bổ hóa đơn):</div>
      <table class="table-data" style="margin-bottom: 20px;">
        <thead>
          <tr>
            <th style="width: 8%;">STT</th>
            <th style="width: 25%;">Số hóa đơn</th>
            <th style="width: 20%;">Ngày hóa đơn</th>
            <th style="width: 25%;">Số tiền phân bổ</th>
            <th style="width: 22%;">Trạng thái sau phân bổ</th>
          </tr>
        </thead>
        <tbody>
          ${allocations.map((alloc, idx) => `
            <tr>
              <td class="text-center">${idx + 1}</td>
              <td class="text-left font-bold">${alloc.invoice_no || `HĐ #${alloc.invoice_id}`}</td>
              <td class="text-center">${formatDateVN(alloc.issue_date || alloc.created_at)}</td>
              <td class="text-right font-bold">${formatCurrencyVND(alloc.allocated_amount || alloc.amount)}</td>
              <td class="text-center"><span class="badge-status badge-paid">ĐÃ THANH TOÁN</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : ''}

    <!-- Standard 5 Signatures according to TT 200/2014/TT-BTC -->
    <div class="signatures-grid">
      <div class="sig-col">
        <div class="sig-title">Thủ trưởng đơn vị</div>
        <div class="sig-subtitle">(Ký, đóng dấu)</div>
        <div class="sig-space"></div>
        <div class="sig-name">Ban Giám Đốc</div>
      </div>
      <div class="sig-col">
        <div class="sig-title">Kế toán trưởng</div>
        <div class="sig-subtitle">(Ký, họ tên)</div>
        <div class="sig-space"></div>
        <div class="sig-name">Kế toán trưởng</div>
      </div>
      <div class="sig-col">
        <div class="sig-title">Người nộp tiền</div>
        <div class="sig-subtitle">(Ký, họ tên)</div>
        <div class="sig-space"></div>
        <div class="sig-name">${customer.name || ''}</div>
      </div>
      <div class="sig-col">
        <div class="sig-title">Người lập phiếu</div>
        <div class="sig-subtitle">(Ký, họ tên)</div>
        <div class="sig-space"></div>
        <div class="sig-name">Kế toán viên</div>
      </div>
      <div class="sig-col">
        <div class="sig-title">Thủ quỹ</div>
        <div class="sig-subtitle">(Ký, họ tên)</div>
        <div class="sig-space"></div>
        <div class="sig-name">Thủ quỹ</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Server-side generation of Refund Payout Voucher (Mẫu 02-TT theo TT 200/2014/TT-BTC)
 */
function renderRefundVoucherHtml({ refund, customer = {}, company = {}, originalInvoice = {}, adjustment = {} }) {
  const voucherNo = refund.refund_no || `PC-${refund.id}`;
  const settleDateFormatted = formatDateVN(refund.settled_at || refund.created_at);
  const wordsAmount = docTienBangChu(refund.amount);

  const safeComp = {
    company_name: escapeHtml(company.company_name || 'CÔNG TY CỔ PHẦN CÔNG NGHỆ TÀI CHÍNH BILLING ONE'),
    tax_code: escapeHtml(company.tax_code || '0109887766'),
    address: escapeHtml(company.address || 'Tòa nhà Keangnam Landmark 72, Hà Nội')
  };
  const safeCust = {
    name: escapeHtml(customer.name || ''),
    tax_code: escapeHtml(customer.tax_code || 'Không có'),
    address: escapeHtml(customer.address || 'Chưa cập nhật')
  };

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Phiếu chi hoàn tiền - ${voucherNo}</title>
  <style>${COMMON_PRINT_CSS}</style>
</head>
<body>
  <div class="print-actions no-print">
    <a href="/#/refunds" style="color: #4a5568; text-decoration: none; font-size: 13px;">&larr; Quay lại danh sách hoàn tiền</a>
    <button class="btn-print" onclick="window.print()">
      <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"/><path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2H5zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4V3zm1 5a2 2 0 0 0-2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2H5zm7 2v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1z"/></svg>
      In Phiếu chi (Print)
    </button>
  </div>

  <div class="doc-container">
    <table class="header-table">
      <tr>
        <td style="width: 60%;">
          <div class="company-title">${safeComp.company_name}</div>
          <div class="company-info">
            <strong>Mã số thuế:</strong> ${safeComp.tax_code}<br>
            <strong>Địa chỉ:</strong> ${safeComp.address}
          </div>
        </td>
        <td style="width: 40%; text-align: right;" class="meta-box">
          <div><strong>Mẫu số: 02 - TT</strong></div>
          <div style="font-size: 11px; font-style: italic; color: #718096;">(Ban hành theo Thông tư số 200/2014/TT-BTC ngày 22/12/2014 của BTC)</div>
          <div style="margin-top: 5px;">Số phiếu: <span class="meta-highlight">${voucherNo}</span></div>
          <div>Mã hoàn trả: <strong>#REF-${refund.id}</strong></div>
        </td>
      </tr>
    </table>

    <div class="doc-title-block">
      <h1 class="doc-main-title">PHIẾU CHI HOÀN TIỀN</h1>
      <div class="doc-subtitle">(PAYOUT REFUND VOUCHER)</div>
      <div style="font-size: 12px; margin-top: 4px; color: #4a5568;">
        Ngày chi trả: ${settleDateFormatted}
      </div>
    </div>

    <div class="party-section">
      <div class="party-row">
        <div class="party-label">Họ và tên người nhận:</div>
        <div class="party-value"><strong>${safeCust.name}</strong></div>
      </div>
      <div class="party-row">
        <div class="party-label">Địa chỉ:</div>
        <div class="party-value">${safeCust.address}</div>
      </div>
      <div class="party-row">
        <div class="party-label">Lý do chi:</div>
        <div class="party-value">${escapeHtml(refund.reason || 'Hoàn tiền giảm trừ theo Biên bản điều chỉnh hóa đơn')}</div>
      </div>
      <div class="party-row">
        <div class="party-label">Căn cứ chứng từ:</div>
        <div class="party-value">Biên bản điều chỉnh: <strong>${adjustment.credit_note_no || `#ADJ-${refund.adjustment_id}`}</strong> cho Hóa đơn: <strong>${originalInvoice.invoice_no || `#INV-${refund.invoice_id}`}</strong></div>
      </div>
      <div class="party-row">
        <div class="party-label">Phương thức chi:</div>
        <div class="party-value"><strong>${escapeHtml(refund.payout_method || 'BANK_TRANSFER')}</strong> ${refund.payout_reference ? `(Mã tham chiếu: ${escapeHtml(refund.payout_reference)})` : ''}</div>
      </div>
      <div class="party-row">
        <div class="party-label">Số tiền chi:</div>
        <div class="party-value font-bold" style="font-size: 16px; color: #c53030;">${formatCurrencyVND(refund.amount)}</div>
      </div>
    </div>

    <div class="words-row">
      <strong>Viết bằng chữ:</strong> ${wordsAmount}
    </div>

    <!-- Standard 5 Signatures according to TT 200/2014/TT-BTC -->
    <div class="signatures-grid">
      <div class="sig-col">
        <div class="sig-title">Thủ trưởng đơn vị</div>
        <div class="sig-subtitle">(Ký, đóng dấu)</div>
        <div class="sig-space"></div>
        <div class="sig-name">Ban Giám Đốc</div>
      </div>
      <div class="sig-col">
        <div class="sig-title">Kế toán trưởng</div>
        <div class="sig-subtitle">(Ký, họ tên)</div>
        <div class="sig-space"></div>
        <div class="sig-name">Kế toán trưởng</div>
      </div>
      <div class="sig-col">
        <div class="sig-title">Người nhận tiền</div>
        <div class="sig-subtitle">(Ký, họ tên)</div>
        <div class="sig-space"></div>
        <div class="sig-name">${customer.name || ''}</div>
      </div>
      <div class="sig-col">
        <div class="sig-title">Người lập phiếu</div>
        <div class="sig-subtitle">(Ký, họ tên)</div>
        <div class="sig-space"></div>
        <div class="sig-name">Kế toán viên</div>
      </div>
      <div class="sig-col">
        <div class="sig-title">Thủ quỹ</div>
        <div class="sig-subtitle">(Ký, họ tên)</div>
        <div class="sig-space"></div>
        <div class="sig-name">Thủ quỹ</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  docTienBangChu,
  formatCurrencyVND,
  formatDateVN,
  renderInvoiceHtml,
  renderPaymentReceiptHtml,
  renderRefundVoucherHtml
};
