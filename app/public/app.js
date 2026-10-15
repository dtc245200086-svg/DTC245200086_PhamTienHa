const root = document.querySelector('#app');
let currentUser = null;
let fieldSequence = 0;
let pendingFlashMessage = null;

// Theme initialization
function initTheme() {
  const saved = localStorage.getItem('billing_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('billing_theme', next);
}
initTheme();

function node(tag, className, ...children) {
  const element = document.createElement(tag);
  if (!element.style) {
    element.style = {};
  }
  if (className) {
    element.className = className;
  }
  const appendChild = (child) => {
    if (child === undefined || child === null) return;
    if (Array.isArray(child)) {
      for (const item of child) appendChild(item);
    } else if (typeof child === 'object' && child && ('tagName' in child || 'nodeType' in child || (typeof Node !== 'undefined' && child instanceof Node))) {
      if (typeof element.append === 'function') {
        element.append(child);
      } else if (typeof element.appendChild === 'function') {
        element.appendChild(child);
      }
    } else {
      if (typeof element.append === 'function') {
        element.append(String(child));
      } else if (typeof element.appendChild === 'function') {
        element.appendChild(document.createTextNode(String(child)));
      } else {
        element.textContent = String(child);
      }
    }
  };
  for (const child of children) {
    appendChild(child);
  }
  return element;
}

function actionButton(text, className, action) {
  const button = node('button', `button ${className}`, text);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

function anchor(text, href, className = 'button button-secondary') {
  const link = node('a', className, text);
  link.href = href;
  if (typeof link.setAttribute === 'function') {
    link.setAttribute('href', href);
  }
  return link;
}

function panel(title, content, extraClass = '', headerAction = null) {
  const section = node('section', `panel ${extraClass}`.trim());
  const heading = node('div', 'panel-title');
  heading.append(node('h2', '', title));
  if (headerAction) heading.append(headerAction);
  section.append(heading, content);
  return section;
}

function alertBox(message, kind = '') {
  return node('div', `alert ${kind ? `alert-${kind}` : ''}`.trim(), message);
}

function makeField(labelText, { name, type = 'text', value = '', required = false, placeholder = '', maxLength, options, step } = {}) {
  const wrapper = node('div', 'field');
  const id = `field-${++fieldSequence}`;
  const label = node('label', '', labelText);
  label.htmlFor = id;
  let control;
  if (type === 'textarea') {
    control = node('textarea');
  } else if (type === 'select') {
    control = node('select');
    for (const optionData of options || []) {
      const option = node('option', '', optionData.label);
      option.value = optionData.value;
      control.append(option);
    }
  } else {
    control = node('input');
    control.type = type;
    if (step) control.step = step;
  }
  control.id = id;
  control.name = name;
  control.value = value ?? '';
  control.required = required;
  if (placeholder) control.placeholder = placeholder;
  if (maxLength) control.maxLength = maxLength;
  wrapper.append(label, control);
  return { wrapper, control };
}

function table(headers, rows) {
  const wrap = node('div', 'table-wrap');
  const grid = node('table');
  const head = node('thead');
  const headerRow = node('tr');
  for (const label of headers) headerRow.append(node('th', '', label));
  head.append(headerRow);
  const body = node('tbody');
  for (const row of rows) body.append(row);
  if (!rows.length) {
    const emptyRow = node('tr');
    const empty = node('td', 'empty-state', 'Chưa có dữ liệu.');
    empty.colSpan = headers.length;
    emptyRow.append(empty);
    body.append(emptyRow);
  }
  grid.append(head, body);
  wrap.append(grid);
  return wrap;
}

function downloadCsv(filename, headers, rows) {
  // UTF-8 BOM (\uFEFF) ensures correct Vietnamese diacritics in Microsoft Excel
  let csvContent = '\uFEFF';
  csvContent += headers.map(h => `"${String(h ?? '').replace(/"/g, '""')}"`).join(',') + '\r\n';
  for (const row of rows) {
    csvContent += row.map(cell => {
      const val = cell === null || cell === undefined ? '' : String(cell);
      return `"${val.replace(/"/g, '""')}"`;
    }).join(',') + '\r\n';
  }
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function exportCsvFromServer(resourcePath, filters, defaultFilename) {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters || {})) {
    if (val !== undefined && val !== null && String(val).trim() !== '' && key !== 'page' && key !== 'page_size' && key !== 'limit' && key !== 'offset') {
      params.set(key, String(val).trim());
    }
  }
  const queryString = params.toString();
  const endpoint = `/api/${resourcePath}/export.csv${queryString ? '?' + queryString : ''}`;

  try {
    const res = await fetch(endpoint, { credentials: 'same-origin' });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      alert('Lỗi xuất CSV: ' + (errJson.error?.message || `HTTP ${res.status}`));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disp = res.headers.get('content-disposition');
    let filename = defaultFilename || `${resourcePath.replace(/\//g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    if (disp && disp.includes('filename=')) {
      const match = disp.match(/filename="?([^";]+)"?/);
      if (match && match[1]) filename = match[1];
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Không thể tải file CSV: ' + err.message);
  }
}

function parseUrlQuery() {
  const hash = location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qIdx + 1));
}

function updateUrlQuery(params) {
  const hash = location.hash || '#/';
  const base = hash.split('?')[0];
  const query = parseUrlQuery();
  for (const [key, val] of Object.entries(params)) {
    if (val === null || val === undefined || val === '') {
      query.delete(key);
    } else {
      query.set(key, String(val));
    }
  }
  const qs = query.toString();
  const target = qs ? `${base}?${qs}` : base;
  if (location.hash !== target) {
    location.hash = target;
  }
}

function generatePageNumbers(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total];
  }
  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, '...', current - 1, current, current + 1, '...', total];
}

function renderPagination({ page = 1, pageSize = 20, total = 0, onPageChange, onPageSizeChange }) {
  const container = node('div', 'table-pagination');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startRec = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRec = Math.min(total, page * pageSize);

  const info = node('div', 'pagination-info');
  const countSpan = node('span', 'pagination-count', `Hiển thị ${startRec.toLocaleString('vi-VN')}–${endRec.toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} bản ghi`);

  const sizeSelect = node('select', 'input input-sm pagination-size-select');
  for (const s of [15, 20, 50]) {
    const opt = node('option', '', `${s} / trang`);
    opt.value = String(s);
    if (s === pageSize) opt.selected = true;
    sizeSelect.append(opt);
  }
  sizeSelect.addEventListener('change', () => {
    if (onPageSizeChange) onPageSizeChange(Number(sizeSelect.value));
  });
  info.append(countSpan, sizeSelect);

  const nav = node('div', 'pagination-nav');
  const prevBtn = node('button', `button button-secondary button-sm ${page <= 1 ? 'disabled' : ''}`, '‹ Trước');
  if (page <= 1) {
    prevBtn.disabled = true;
  } else {
    prevBtn.addEventListener('click', () => onPageChange && onPageChange(page - 1));
  }
  nav.append(prevBtn);

  const pages = generatePageNumbers(page, totalPages);
  for (const p of pages) {
    if (p === '...') {
      nav.append(node('span', 'pagination-ellipsis', '...'));
    } else {
      const pNum = Number(p);
      const pBtn = node('button', `button button-sm ${pNum === page ? 'button-primary active' : 'button-secondary'}`, String(pNum));
      pBtn.addEventListener('click', () => onPageChange && onPageChange(pNum));
      nav.append(pBtn);
    }
  }

  const nextBtn = node('button', `button button-secondary button-sm ${page >= totalPages ? 'disabled' : ''}`, 'Sau ›');
  if (page >= totalPages) {
    nextBtn.disabled = true;
  } else {
    nextBtn.addEventListener('click', () => onPageChange && onPageChange(page + 1));
  }
  nav.append(nextBtn);

  container.append(info, nav);
  return container;
}

function renderTableToolbar({
  searchPlaceholder = 'Tìm kiếm...',
  searchValue = '',
  onSearch,
  filters = [],
  onClearFilters,
  onExportCsv
}) {
  const toolbar = node('div', 'table-toolbar');

  const searchWrap = node('div', 'toolbar-search');
  const searchInput = node('input', 'input toolbar-search-input');
  searchInput.type = 'search';
  searchInput.placeholder = `🔎 ${searchPlaceholder}`;
  searchInput.value = searchValue || '';

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (onSearch) onSearch(searchInput.value.trim());
    }, 350);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer);
      if (onSearch) onSearch(searchInput.value.trim());
    }
  });
  searchWrap.append(searchInput);
  toolbar.append(searchWrap);

  if (filters.length > 0) {
    const filtersGroup = node('div', 'toolbar-filters');
    for (const f of filters) {
      if (f.element) {
        filtersGroup.append(f.element);
      } else if (f.type === 'date') {
        const dateInput = node('input', 'input toolbar-filter-date');
        dateInput.type = 'date';
        dateInput.value = f.value || '';
        if (f.placeholder) dateInput.title = f.placeholder;
        dateInput.addEventListener('change', () => {
          if (f.onChange) f.onChange(dateInput.value);
        });
        filtersGroup.append(dateInput);
      } else {
        const select = node('select', 'input toolbar-filter-select');
        const defaultOpt = node('option', '', f.placeholder || f.label || 'Tất cả');
        defaultOpt.value = '';
        select.append(defaultOpt);
        for (const opt of f.options || []) {
          const optEl = node('option', '', opt.label);
          optEl.value = opt.value;
          if (String(opt.value) === String(f.value)) optEl.selected = true;
          select.append(optEl);
        }
        select.addEventListener('change', () => {
          if (f.onChange) f.onChange(select.value);
        });
        filtersGroup.append(select);
      }
    }
    toolbar.append(filtersGroup);
  }

  const actionsGroup = node('div', 'toolbar-actions');
  if (onClearFilters) {
    const clearBtn = node('button', 'button button-secondary button-sm', 'Xóa bộ lọc');
    clearBtn.addEventListener('click', onClearFilters);
    actionsGroup.append(clearBtn);
  }
  if (onExportCsv) {
    const exportBtn = node('button', 'button button-secondary button-sm', '↓ Xuất CSV');
    exportBtn.addEventListener('click', onExportCsv);
    actionsGroup.append(exportBtn);
  }
  toolbar.append(actionsGroup);

  return toolbar;
}

function money(value) {
  const text = String(value ?? '0');
  const [whole, fraction = '00'] = text.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}${fraction === '00' ? '' : `.${fraction}`} ₫`;
}

function dateText(value) {
  return value ? String(value).slice(0, 10) : '—';
}

function isZero(value) {
  return /^0(?:\.0+)?$/.test(String(value ?? '0'));
}

function statusBadge(status) {
  let kind = '';
  if (['PAID', 'ACTIVE', 'APPROVED', 'MATCHED', 'RECONCILED'].includes(status)) kind = 'badge-paid';
  else if (['CANCELLED', 'REJECTED', 'DISCREPANCY'].includes(status)) kind = 'badge-cancelled';
  else if (['DRAFT', 'PAUSED'].includes(status)) kind = 'badge-draft';
  else if (status === 'OVERDUE') kind = 'badge-overdue';
  else if (status === 'LOCKED') kind = 'badge-locked';
  else if (['PARTIALLY_PAID', 'UNMATCHED', 'WARNING'].includes(status)) kind = 'badge-warning';
  else kind = 'badge-info';
  return node('span', `badge ${kind}`, status);
}

function customerStatusBadge(status, lockSource) {
  let kind = 'badge-info';
  let label = status || 'UNKNOWN';
  if (status === 'ACTIVE') {
    kind = 'badge-active';
    label = 'ACTIVE';
  } else if (status === 'WARNING') {
    kind = 'badge-warning';
    label = 'WARNING';
  } else if (status === 'LOCKED') {
    kind = 'badge-locked';
    if (lockSource === 'MANUAL') {
      label = 'LOCKED (Thủ công)';
    } else if (lockSource === 'AUTO_RISK') {
      label = 'LOCKED (Tự động rủi ro)';
    } else {
      label = 'LOCKED';
    }
  }
  const badge = node('span', `badge ${kind}`, label);
  badge.setAttribute('data-status', status || '');
  if (lockSource) badge.setAttribute('data-lock-source', lockSource);
  return badge;
}

function hasPermission(permissionCode) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (Array.isArray(currentUser.permissions)) {
    if (currentUser.permissions.includes('*')) return true;
    return currentUser.permissions.includes(permissionCode);
  }
  return false;
}

function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function formatUtilization(creditLimit, currentDebt) {
  const limitNum = Number(creditLimit || 0);
  const debtNum = Number(currentDebt || 0);
  if (limitNum <= 0) {
    if (debtNum > 0) {
      return { percent: 100, text: 'Vượt hạn mức (Hạn mức 0 ₫)', isBreached: true, kind: 'breach' };
    }
    return { percent: 0, text: '0% (Hạn mức 0 ₫)', isBreached: false, kind: 'safe' };
  }
  const ratio = Math.round((debtNum / limitNum) * 100);
  const isBreached = debtNum > limitNum;
  const kind = isBreached ? 'breach' : (ratio >= 80 ? 'warn' : 'safe');
  return {
    percent: Math.min(Math.max(ratio, 0), 100),
    rawPercent: ratio,
    text: `${ratio}%`,
    isBreached,
    kind
  };
}

function renderCreditUtilizationBar(creditLimit, currentDebt) {
  const util = formatUtilization(creditLimit, currentDebt);
  const wrap = node('div', 'utilization-box');
  const labelRow = node('div', 'small muted', `Tỷ lệ sử dụng: ${util.text}`);
  const track = node('div', 'utilization-track');
  const fill = node('div', `utilization-fill utilization-${util.kind}`);
  fill.style.width = `${util.percent}%`;
  track.append(fill);
  wrap.append(labelRow, track);
  return wrap;
}

function openOverrideModal(invoice, customer, onIssued) {
  // Section 10: Generate unique idempotency key for this logical submission
  let idempotencyKey = generateUuid();

  const backdrop = node('div', 'modal-backdrop');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'override-modal-title');

  const modal = node('div', 'modal-window stack');

  // Header
  const header = node('div', 'modal-header');
  const titleBlock = node('div');
  const title = node('h2', '', 'Phát hành đặc cách hóa đơn (Manager Override)');
  title.id = 'override-modal-title';
  const subtitle = node('p', 'small muted', 'Phê duyệt phát hành hóa đơn khi khách hàng bị khóa hoặc vượt hạn mức tín dụng.');
  titleBlock.append(title, subtitle);
  const closeBtn = actionButton('✕', 'button-quiet', closeModal);
  closeBtn.setAttribute('aria-label', 'Đóng hộp thoại');
  header.append(titleBlock, closeBtn);

  // Financial Context
  const summaryBox = node('div', 'panel');
  const summaryTitle = node('div', 'panel-title');
  summaryTitle.append(node('h3', '', 'Thông tin tài chính & Kiểm soát rủi ro'));
  const summaryGrid = node('div', 'detail-grid');
  summaryGrid.append(
    node('div', 'detail-item', ''),
    node('div', 'detail-item', ''),
    node('div', 'detail-item', ''),
    node('div', 'detail-item', ''),
    node('div', 'detail-item', ''),
    node('div', 'detail-item', '')
  );
  summaryGrid.children[0].append(node('div', 'detail-label', 'Hóa đơn'), node('div', 'detail-value', invoice.invoice_no || `DRAFT-${invoice.id}`));
  summaryGrid.children[1].append(node('div', 'detail-label', 'Tổng tiền hóa đơn'), node('div', 'detail-value', money(invoice.total)));
  summaryGrid.children[2].append(node('div', 'detail-label', 'Khách hàng'), node('div', 'detail-value', customer?.name || invoice.customer_name));
  summaryGrid.children[3].append(node('div', 'detail-label', 'Trạng thái khách hàng'), node('div', 'detail-value', customer?.status || 'LOCKED'));
  summaryGrid.children[4].append(node('div', 'detail-label', 'Hạn mức tín dụng'), node('div', 'detail-value', money(customer?.credit_limit || 0)));
  summaryGrid.children[5].append(node('div', 'detail-label', 'Dư nợ hiện tại'), node('div', 'detail-value', money(customer?.current_debt || 0)));
  summaryBox.append(summaryTitle, summaryGrid);

  // Warning Banner
  const riskWarning = alertBox(
    'Cảnh báo: Hành động phát hành đặc cách sẽ ghi nhận sự kiện kiểm toán bất biến (INVOICE_ISSUE_OVERRIDDEN) ' +
    'với cấp độ WARNING và lưu định danh người phê duyệt. Vui lòng cung cấp lý do kinh doanh đầy đủ.',
    'warning'
  );

  // Reason Input Field
  const reasonWrap = node('div', 'field');
  const reasonLabel = node('label', '', 'Lý do phê duyệt đặc cách (Bắt buộc, tối thiểu 10 ký tự)');
  reasonLabel.htmlFor = 'override-reason-input';
  const reasonInput = node('textarea');
  reasonInput.id = 'override-reason-input';
  reasonInput.name = 'override_reason';
  reasonInput.placeholder = 'Nhập lý do kinh doanh chính đáng (ví dụ: Ban giám đốc đã duyệt bảo lãnh thanh toán qua văn bản số 12/TB)...';
  reasonInput.rows = 4;

  const charCounter = node('span', 'char-count invalid', '0 / 10 ký tự (Tối thiểu 10 ký tự)');
  reasonWrap.append(reasonLabel, reasonInput, charCounter);

  const errorBox = node('div');

  // Inline validation on input
  reasonInput.addEventListener('input', () => {
    const trimmed = reasonInput.value.trim();
    const len = trimmed.length;
    if (len >= 10) {
      charCounter.textContent = `${len} ký tự (Hợp lệ)`;
      charCounter.className = 'char-count valid';
      confirmBtn.disabled = false;
    } else {
      charCounter.textContent = `${len} / 10 ký tự (Cần thêm ${10 - len} ký tự)`;
      charCounter.className = 'char-count invalid';
      confirmBtn.disabled = true;
    }
  });

  // Footer Actions
  const footer = node('div', 'modal-footer');
  const cancelBtn = actionButton('Hủy bỏ', 'button-secondary', closeModal);
  const confirmBtn = actionButton('Xác nhận phát hành đặc cách', 'button button-override', submitOverride);
  confirmBtn.setAttribute('data-testid', 'btn-confirm-override');
  confirmBtn.disabled = true;
  footer.append(cancelBtn, confirmBtn);

  modal.append(header, summaryBox, riskWarning, reasonWrap, errorBox, footer);
  backdrop.append(modal);
  document.body.append(backdrop);

  reasonInput.focus();

  function closeModal() {
    backdrop.remove();
    document.removeEventListener('keydown', handleKey);
  }

  function handleKey(e) {
    if (e.key === 'Escape') closeModal();
  }
  document.addEventListener('keydown', handleKey);

  async function submitOverride() {
    errorBox.replaceChildren();
    const cleanReason = reasonInput.value.trim();
    if (cleanReason.length < 10) {
      errorBox.append(alertBox('Lý do phê duyệt phải có ít nhất 10 ký tự sau khi cắt khoảng trắng.', 'error'));
      return;
    }

    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    reasonInput.disabled = true;
    confirmBtn.textContent = 'Đang xử lý...';

    try {
      // Section 10 & 11: POST /api/invoices/:id/issue-override with Idempotency-Key
      const response = await api(`/invoices/${invoice.id}/issue-override`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          override_reason: cleanReason
        })
      });

      closeModal();
      if (typeof onIssued === 'function') {
        onIssued(response);
      }
    } catch (err) {
      // Re-enable controls so the user can edit or retry
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      reasonInput.disabled = false;
      confirmBtn.textContent = 'Xác nhận phát hành đặc cách';

      // NOTE: Section 10 - Idempotency key is PRESERVED on logical retry of this submission!

      // Safe error messages mapping (Section 12)
      let safeMsg = 'Không thể phát hành đặc cách.';
      if (err.status === 400) {
        safeMsg = err.message || 'Yêu cầu không hợp lệ. Vui lòng kiểm tra lại lý do phê duyệt.';
      } else if (err.status === 401) {
        safeMsg = 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.';
      } else if (err.status === 403) {
        safeMsg = 'Từ chối truy cập: Bạn không có quyền phát hành đặc cách hóa đơn (invoice.issue_override).';
      } else if (err.status === 404) {
        safeMsg = 'Hóa đơn không tồn tại trong hệ thống.';
      } else if (err.status === 409) {
        safeMsg = err.message || 'Xung đột nghiệp vụ: Hóa đơn đã được phát hành hoặc trạng thái không hợp lệ.';
      } else if (err.status >= 500) {
        safeMsg = 'Lỗi hệ thống máy chủ khi phát hành đặc cách. Vui lòng thử lại sau.';
      } else {
        safeMsg = err.message || 'Đã xảy ra lỗi không xác định.';
      }

      errorBox.append(alertBox(safeMsg, 'error'));
    }
  }
}

const UnlockOperationState = Object.freeze({
  IDLE: 'IDLE',
  DRAFT: 'DRAFT',
  SUBMITTING: 'SUBMITTING',
  RETRYABLE_FAILURE: 'RETRYABLE_FAILURE',
  TERMINAL_FAILURE: 'TERMINAL_FAILURE',
  SUCCEEDED: 'SUCCEEDED',
  CANCELLED: 'CANCELLED'
});

class CustomerUnlockLifecycle {
  constructor() {
    this.reset();
  }

  reset() {
    this.operationId = null;
    this.operationType = 'customer.unlock';
    this.resourceId = null;
    this.state = UnlockOperationState.IDLE;
    this.idempotencyKey = null;
    this.requestPayload = null;
    this.attemptCount = 0;
    this.errorClass = null;
    this.inFlightPromise = null;
  }

  startDraft(customer) {
    this.reset();
    this.operationId = generateUuid();
    this.resourceId = String(customer.id);
    this.state = UnlockOperationState.DRAFT;
    // CRITICAL: idempotencyKey remains NULL during DRAFT!
    return this;
  }

  cancelDraft() {
    if (this.state === UnlockOperationState.DRAFT) {
      this.state = UnlockOperationState.CANCELLED;
      const cancelledId = this.operationId;
      this.reset();
      return { cancelledId, state: UnlockOperationState.IDLE };
    }
    return null;
  }

  prepareFirstSubmission(trimmedReason) {
    if (this.state !== UnlockOperationState.DRAFT) {
      throw new Error(`Cannot prepare first submission from state: ${this.state}`);
    }
    if (!trimmedReason || trimmedReason.length < 10) {
      throw new Error('Unlock reason must be at least 10 characters after trimming.');
    }
    this.idempotencyKey = generateUuid();
    this.requestPayload = Object.freeze({
      unlock_reason: trimmedReason
    });
    this.attemptCount = 1;
    this.state = UnlockOperationState.SUBMITTING;
    this.errorClass = null;
    return this;
  }

  prepareRetry() {
    if (this.state !== UnlockOperationState.RETRYABLE_FAILURE) {
      throw new Error(`Cannot retry from state: ${this.state}`);
    }
    this.attemptCount += 1;
    this.state = UnlockOperationState.SUBMITTING;
    this.errorClass = null;
    return this;
  }

  recordSuccess() {
    this.state = UnlockOperationState.SUCCEEDED;
    this.errorClass = null;
    this.inFlightPromise = null;
  }

  recordFailure(status, err) {
    this.inFlightPromise = null;
    const isNetworkTransport = (status === 0 || err?.name === 'TypeError' || err?.name === 'AbortError' || (err?.message && /fetch|network|timeout/i.test(err.message)));
    const isTransient5xx = (status === 502 || status === 503 || status === 504);

    if (isNetworkTransport || isTransient5xx) {
      this.state = UnlockOperationState.RETRYABLE_FAILURE;
      this.errorClass = isNetworkTransport ? 'TRANSIENT_NETWORK' : 'TRANSIENT_5XX';
    } else {
      this.state = UnlockOperationState.TERMINAL_FAILURE;
      this.errorClass = (status >= 400 && status < 500) ? 'TERMINAL_4XX' : 'TERMINAL_5XX';
    }
  }

  startNewOperation(customer) {
    return this.startDraft(customer);
  }

  getSnapshot() {
    return {
      operationId: this.operationId,
      operationType: this.operationType,
      resourceId: this.resourceId,
      state: this.state,
      idempotencyKey: this.idempotencyKey,
      requestPayload: this.requestPayload,
      attemptCount: this.attemptCount,
      errorClass: this.errorClass
    };
  }
}

const activeUnlockLifecycle = new CustomerUnlockLifecycle();

function openUnlockModal(customer, onUnlocked) {
  // If no operation is currently in-flight, start a fresh DRAFT (Section 6 & 7)
  if (activeUnlockLifecycle.state !== UnlockOperationState.SUBMITTING) {
    activeUnlockLifecycle.startDraft(customer);
  }

  const backdrop = node('div', 'modal-backdrop');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'unlock-modal-title');

  const modal = node('div', 'modal-window stack');

  // Header (Section 10 & 26)
  const header = node('div', 'modal-header');
  const title = node('h2', '', 'Xác nhận mở khóa khách hàng');
  title.id = 'unlock-modal-title';
  title.setAttribute('data-testid', 'unlock-modal-title');
  const closeBtn = actionButton('✕', 'button-quiet', handleDismiss);
  closeBtn.setAttribute('aria-label', 'Đóng cửa sổ');
  header.append(title, closeBtn);

  // Summary Grid with Financial Context & Lock Metadata (Section 10, 11, 12)
  const summaryBox = node('div', 'panel');
  const summaryTitle = node('div', 'panel-title');
  summaryTitle.append(node('h3', '', 'Thông tin khách hàng & Trạng thái rủi ro'));

  const lockSourceLabel = customer.lock_source === 'MANUAL'
    ? 'Thủ công (MANUAL)'
    : customer.lock_source === 'AUTO_RISK'
      ? 'Tự động do rủi ro (AUTO_RISK)'
      : (customer.lock_source || 'Không xác định');

  const lockReasonDisplay = (customer.lock_reason && String(customer.lock_reason).trim() !== '')
    ? customer.lock_reason
    : 'Không có lý do khóa được ghi nhận.';

  const summaryGrid = node('div', 'detail-grid');
  const items = [
    ['Khách hàng', `${customer.name} (${customer.code || customer.id})`],
    ['Trạng thái hiện tại', customer.status || 'LOCKED'],
    ['Nguồn khóa', lockSourceLabel],
    ['Thời gian khóa', customer.locked_at ? dateText(customer.locked_at) : '—'],
    ['Hạn mức tín dụng', money(customer.credit_limit || 0)],
    ['Dư nợ hiện tại', money(customer.current_debt || 0)],
    ['Hạn mức khả dụng', money(customer.available_credit || 0)],
    ['Lý do khóa ghi nhận', lockReasonDisplay]
  ];

  for (const [lbl, val] of items) {
    const it = node('div', 'detail-item');
    it.append(node('div', 'detail-label', lbl), node('div', 'detail-value', val));
    summaryGrid.append(it);
  }
  summaryBox.append(summaryTitle, summaryGrid);

  // High-Risk Action UX Warning (Section 15)
  const riskWarning = alertBox(
    'Thao tác này sẽ xóa trạng thái LOCKED hiện tại. ' +
    'Hệ thống sẽ ghi nhận thao tác vào audit trail. ' +
    'Trạng thái rủi ro sau mở khóa do máy chủ xác định theo chính sách tín dụng.',
    'warning'
  );

  // Unlock Reason Input Field (Section 13)
  const reasonWrap = node('div', 'field');
  const reasonLabel = node('label', '', 'Lý do mở khóa (Bắt buộc, tối thiểu 10 ký tự)');
  reasonLabel.htmlFor = 'unlock-reason-input';
  const reasonInput = node('textarea');
  reasonInput.id = 'unlock-reason-input';
  reasonInput.name = 'unlock_reason';
  reasonInput.placeholder = 'Nhập lý do mở khóa chính đáng (ví dụ: Khách hàng đã thanh toán đầy đủ công nợ quá hạn và cung cấp bảo lãnh ngân hàng)...';
  reasonInput.rows = 4;
  reasonInput.setAttribute('data-testid', 'unlock-reason-input');

  const charCounter = node('span', 'char-count invalid', '0 / 10 ký tự (Tối thiểu 10 ký tự)');
  charCounter.setAttribute('data-testid', 'unlock-char-counter');
  reasonWrap.append(reasonLabel, reasonInput, charCounter);

  const errorBox = node('div');
  errorBox.setAttribute('data-testid', 'unlock-error-box');

  // Footer Actions (Section 14)
  const footer = node('div', 'modal-footer');
  const cancelBtn = actionButton('Hủy bỏ', 'button-secondary', handleDismiss);
  cancelBtn.setAttribute('data-testid', 'btn-cancel-unlock');
  const confirmBtn = actionButton('Xác nhận mở khóa khách hàng', 'button button-unlock', submitUnlock);
  confirmBtn.setAttribute('data-testid', 'btn-confirm-unlock');
  confirmBtn.disabled = true;
  footer.append(cancelBtn, confirmBtn);

  // Inline validation on input (DRAFT -> DRAFT, NO KEY)
  reasonInput.addEventListener('input', () => {
    if (activeUnlockLifecycle.state === UnlockOperationState.TERMINAL_FAILURE) {
      activeUnlockLifecycle.startNewOperation(customer);
    }
    const trimmed = reasonInput.value.trim();
    const len = trimmed.length;
    if (len >= 10) {
      charCounter.textContent = `${len} ký tự (Hợp lệ)`;
      charCounter.className = 'char-count valid';
      confirmBtn.disabled = false;
    } else {
      charCounter.textContent = `${len} / 10 ký tự (Cần thêm ${10 - len} ký tự)`;
      charCounter.className = 'char-count invalid';
      confirmBtn.disabled = true;
    }
  });

  // Prevent accidental submit on enter key in textarea
  reasonInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Allow newline in textarea without submitting
    }
  });

  modal.append(header, summaryBox, riskWarning, reasonWrap, errorBox, footer);
  backdrop.append(modal);
  document.body.append(backdrop);

  reasonInput.focus();

  // Dismissal handler: Section 11 & 13
  function handleDismiss() {
    backdrop.remove();
    document.removeEventListener('keydown', handleKey);

    // Section 13: Cancellation BEFORE submission
    if (activeUnlockLifecycle.state === UnlockOperationState.DRAFT) {
      activeUnlockLifecycle.cancelDraft();
    }
    // Section 11 & 14: If SUBMITTING, UI close is NOT operation cancellation!
    // The operation continues in-flight in activeUnlockLifecycle.
  }

  function handleKey(e) {
    if (e.key === 'Escape') handleDismiss();
  }
  document.addEventListener('keydown', handleKey);

  async function submitUnlock() {
    // Section 22: Double-submit protection
    if (activeUnlockLifecycle.state === UnlockOperationState.SUBMITTING) {
      return;
    }

    errorBox.replaceChildren();
    const cleanReason = reasonInput.value.trim();
    if (cleanReason.length < 10) {
      errorBox.append(alertBox('Lý do mở khóa phải có ít nhất 10 ký tự sau khi cắt khoảng trắng.', 'error'));
      return;
    }

    // Determine state transition
    if (activeUnlockLifecycle.state === UnlockOperationState.DRAFT) {
      // Section 8 & 9: FIRST SUBMISSION -> CREATE K1, FREEZE PAYLOAD
      activeUnlockLifecycle.prepareFirstSubmission(cleanReason);
    } else if (activeUnlockLifecycle.state === UnlockOperationState.RETRYABLE_FAILURE) {
      // Section 15: RETRY -> SAME K1, SAME FROZEN PAYLOAD, INCREMENT attemptCount
      activeUnlockLifecycle.prepareRetry();
    } else if (activeUnlockLifecycle.state === UnlockOperationState.TERMINAL_FAILURE) {
      // Section 17 & 25: New attempt after terminal failure must be a NEW operation
      activeUnlockLifecycle.startNewOperation(customer);
      activeUnlockLifecycle.prepareFirstSubmission(cleanReason);
    } else {
      return;
    }

    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    reasonInput.disabled = true;
    confirmBtn.textContent = 'Đang xử lý...';

    const currentKey = activeUnlockLifecycle.idempotencyKey;
    const currentPayload = activeUnlockLifecycle.requestPayload;

    try {
      // POST /api/customers/:id/unlock with Idempotency-Key
      const response = await api(`/customers/${customer.id}/unlock`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': currentKey
        },
        body: JSON.stringify(currentPayload)
      });

      // Section 24: SUCCESS
      activeUnlockLifecycle.recordSuccess();

      // Close modal if still attached to DOM
      backdrop.remove();
      document.removeEventListener('keydown', handleKey);

      // Section 24: Retire K1 and reset to IDLE
      activeUnlockLifecycle.reset();

      if (typeof onUnlocked === 'function') {
        onUnlocked(response);
      }
    } catch (err) {
      // Classify error
      activeUnlockLifecycle.recordFailure(err.status || 0, err);

      confirmBtn.disabled = false;
      cancelBtn.disabled = false;

      if (activeUnlockLifecycle.state === UnlockOperationState.RETRYABLE_FAILURE) {
        // Section 15 & 23: RETRYABLE FAILURE
        // Reason input remains disabled because payload is frozen with K1!
        reasonInput.disabled = true;
        confirmBtn.textContent = 'Thử lại với cùng phiên';
        confirmBtn.setAttribute('data-testid', 'btn-retry-unlock');

        let safeMsg = 'Không xác nhận được kết quả mở khóa từ máy chủ (lỗi kết nối hoặc timeout). Bạn có thể thử lại an toàn với cùng mã giao dịch.';
        if (err.message && !err.message.includes('fetch')) {
          safeMsg = `${safeMsg} (${err.message})`;
        }
        errorBox.append(alertBox(safeMsg, 'warning'));
      } else {
        // Section 16, 17, 18, 19, 20: TERMINAL FAILURE
        reasonInput.disabled = false;
        confirmBtn.textContent = 'Xác nhận mở khóa khách hàng';

        // Safe error messages mapping (Section 23)
        let safeMsg = 'Không thể mở khóa khách hàng.';
        if (err.status === 400) {
          safeMsg = err.message || 'Yêu cầu mở khóa không hợp lệ. Vui lòng kiểm tra lại lý do mở khóa.';
        } else if (err.status === 401) {
          safeMsg = 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.';
        } else if (err.status === 403) {
          safeMsg = 'Bạn không có quyền mở khóa khách hàng.';
        } else if (err.status === 404) {
          safeMsg = 'Khách hàng không tồn tại trong hệ thống.';
        } else if (err.status === 409) {
          safeMsg = err.message || 'Xung đột nghiệp vụ: Trạng thái khách hàng đã thay đổi trên máy chủ hoặc không phải LOCKED.';
          if (typeof onUnlocked === 'function') {
            setTimeout(() => {
              onUnlocked(null);
            }, 1500);
          }
        } else if (err.status >= 500) {
          safeMsg = 'Lỗi hệ thống máy chủ khi mở khóa khách hàng. Vui lòng thử lại sau.';
        } else {
          safeMsg = err.message || 'Đã xảy ra lỗi không xác định.';
        }

        errorBox.append(alertBox(safeMsg, 'error'));
      }
    }
  }
}

function riskBadge(level) {
  let cls = 'badge-risk-low';
  if (level === 'MEDIUM') cls = 'badge-risk-medium';
  else if (level === 'HIGH') cls = 'badge-risk-high';
  else if (level === 'CRITICAL') cls = 'badge-risk-critical';
  return node('span', `badge ${cls}`, level);
}

class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || 'Không thể hoàn tất yêu cầu.');
    this.status = status;
    this.code = payload?.error?.code;
  }
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin'
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

function setHash(path) {
  window.location.hash = path;
}

function renderLogin() {
  const page = node('main', 'login-screen');
  const box = node('section', 'login-panel');
  const brand = node('div', 'brand-mark');
  brand.append(node('div', 'brand-icon', 'B'));
  const brandText = node('div');
  brandText.append(node('p', 'brand-name', 'Billing Enterprise'), node('p', 'brand-caption', 'Quản trị Tài chính & Hóa đơn'));
  brand.append(brandText);
  const form = node('form', 'stack');
  form.noValidate = false;
  const username = makeField('Tên đăng nhập', { name: 'username', required: true, maxLength: 64 });
  username.control.autocomplete = 'username';
  const password = makeField('Mật khẩu', { name: 'password', type: 'password', required: true });
  password.control.autocomplete = 'current-password';
  const message = node('div');
  const submit = node('button', 'button button-primary', 'Đăng nhập');
  submit.type = 'submit';
  form.append(username.wrapper, password.wrapper, submit, message);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.replaceChildren();
    submit.disabled = true;
    try {
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.control.value, password: password.control.value })
      });
      setHash('/');
    } catch (error) {
      message.append(alertBox(error.message, 'error'));
    } finally {
      submit.disabled = false;
    }
  });
  box.append(brand, node('h1', '', 'Đăng nhập'), node('p', 'muted', 'Sử dụng tài khoản được cấp cho hệ thống.'), form);
  page.append(box);
  root.replaceChildren(page);
}

function getEffectiveRole(user) {
  const r = String(user?.role || '').trim().toUpperCase();
  if (r === 'ADMIN') return 'ADMIN';
  if (r === 'DIRECTOR' || r === 'ROLE_BILLING_MANAGER') return 'DIRECTOR';
  return 'STAFF';
}

function roleBadge(role) {
  const norm = getEffectiveRole({ role });
  if (norm === 'ADMIN') return node('span', 'badge badge-role-admin', 'ADMIN');
  if (norm === 'DIRECTOR') return node('span', 'badge badge-role-director', 'DIRECTOR');
  return node('span', 'badge badge-role-staff', 'STAFF');
}

function renderShell(path) {
  const effectiveRole = getEffectiveRole(currentUser);
  const shell = node('div', `app-shell workspace-${effectiveRole.toLowerCase()} ${effectiveRole.toLowerCase()}-workspace`);
  const sidebar = node('aside', 'sidebar');
  const brand = node('div', 'brand-mark');
  brand.append(node('div', 'brand-icon', 'B'));
  const brandText = node('div');

  let brandName = 'Billing Enterprise';
  let brandCaption = 'Tài chính & E-Invoice';
  let navSections = [];
  let roleTitle = 'Vận hành';
  let footerText = 'Billing One v2.0';

  if (effectiveRole === 'ADMIN') {
    brandName = 'Billing Admin';
    brandCaption = 'Quản trị hệ thống';
    roleTitle = 'Quản trị hệ thống (ADMIN)';
    footerText = 'Billing Admin Workspace · v2.0';
    navSections = [
      {
        title: 'HỆ THỐNG & NGƯỜI DÙNG',
        routes: [
          ['Tổng quan hệ thống', '#/'],
          ['Quản lý người dùng', '#/users'],
          ['Vai trò & Phân quyền', '#/roles'],
          ['Nhật ký kiểm toán', '#/audit'],
          ['Cấu hình hệ thống', '#/settings']
        ]
      },
      {
        title: 'NGHIỆP VỤ DOANH NGHIỆP',
        routes: [
          ['Hóa đơn', '#/invoices'],
          ['Khách hàng', '#/customers'],
          ['Sản phẩm & Dịch vụ', '#/products'],
          ['Thuê bao định kỳ', '#/recurring'],
          ['Thanh toán', '#/payments'],
          ['Biên bản điều chỉnh', '#/adjustments'],
          ['Đối soát ngân hàng', '#/reconciliation'],
          ['Điều khoản công nợ', '#/payment-terms']
        ]
      },
      {
        title: 'BÁO CÁO TOÀN DIỆN',
        routes: [
          ['Báo cáo tài chính', '#/reports']
        ]
      }
    ];
  } else if (effectiveRole === 'DIRECTOR') {
    brandName = 'Billing Executive';
    brandCaption = 'Điều hành doanh nghiệp';
    roleTitle = 'Điều hành doanh nghiệp (DIRECTOR)';
    footerText = 'Billing Executive Workspace · v2.0';
    navSections = [
      {
        title: 'ĐIỀU HÀNH',
        routes: [
          ['Tổng quan', '#/'],
          ['Doanh thu', '#/reports?tab=revenue'],
          ['Công nợ', '#/reports?tab=aging'],
          ['Thu hồi nợ', '#/reports?tab=dso'],
          ['DSO / CEI', '#/reports?tab=dso'],
          ['Aging Matrix', '#/reports?tab=aging'],
          ['MRR / ARR', '#/reports?tab=revenue']
        ]
      },
      {
        title: 'BÁO CÁO',
        routes: [
          ['Báo cáo tài chính', '#/reports'],
          ['Xuất báo cáo', '#/reports?tab=vat']
        ]
      },
      {
        title: 'NGHIỆP VỤ',
        routes: [
          ['Hóa đơn', '#/invoices'],
          ['Khách hàng', '#/customers'],
          ['Thanh toán', '#/payments'],
          ['Đối soát', '#/reconciliation'],
          ['Phê duyệt', '#/adjustments']
        ]
      }
    ];
  } else {
    // STAFF
    brandName = 'Billing Operations';
    brandCaption = 'Nghiệp vụ vận hành';
    roleTitle = 'Nghiệp vụ vận hành (STAFF)';
    footerText = 'Billing Operations Workspace · v2.0';
    navSections = [
      {
        title: 'TỔNG QUAN',
        routes: [
          ['Tổng quan công việc', '#/']
        ]
      },
      {
        title: 'KINH DOANH & BÁN HÀNG',
        routes: [
          ['Hóa đơn', '#/invoices'],
          ['Khách hàng', '#/customers'],
          ['Sản phẩm & Dịch vụ', '#/products'],
          ['Thuê bao', '#/recurring']
        ]
      },
      {
        title: 'THU NỢ & ĐỐI SOÁT',
        routes: [
          ['Thanh toán', '#/payments'],
          ['Biên bản điều chỉnh', '#/adjustments'],
          ['Đối soát ngân hàng', '#/reconciliation'],
          ['Điều khoản công nợ', '#/payment-terms']
        ]
      },
      {
        title: 'BÁO CÁO',
        routes: [
          ['Báo cáo vận hành', '#/reports']
        ]
      }
    ];
  }

  brandText.append(node('p', 'brand-name', brandName), node('p', 'brand-caption', brandCaption));
  brand.append(brandText);
  sidebar.append(brand);

  for (const group of navSections) {
    const navGroup = node('div', 'nav-group');
    navGroup.append(node('div', 'nav-group-title', group.title));
    const navList = node('nav', 'nav-list');
    for (const [label, href] of group.routes) {
      const link = anchor(label, href, 'nav-link');
      const normalizedPath = (path || '/').split('?')[0];
      const currentBase = normalizedPath === '/' ? '/' : `/${normalizedPath.split('/').filter(Boolean)[0] || ''}`;
      const linkHash = href.startsWith('#') ? href.slice(1) : href;
      const hasQuery = href.includes('?');

      let isActive = false;
      if (!hasQuery) {
        if (currentBase === '/') {
          isActive = (href === '#/' || href === '#' || linkHash === '/');
        } else {
          isActive = (linkHash === currentBase);
        }
      }

      if (isActive) {
        link.setAttribute('aria-current', 'page');
        link.className = 'nav-link active';
      }
      navList.append(link);
    }
    navGroup.append(navList);
    sidebar.append(navGroup);
  }

  sidebar.append(node('div', 'sidebar-footer', footerText));

  const column = node('div', 'main-column');
  const topbar = node('header', 'topbar');
  const userRoleText = `${currentUser.username} (${roleTitle})`;
  const topbarUser = node('div', 'topbar-user');
  topbarUser.append(node('span', '', userRoleText), ' ', roleBadge(effectiveRole));
  topbar.append(topbarUser);

  const topbarActions = node('div', 'topbar-actions');
  const themeBtn = actionButton('Giao diện', 'button-quiet', () => toggleTheme());
  const logoutBtn = actionButton('Đăng xuất', 'button-quiet', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setHash('/login');
    }
  });
  topbarActions.append(themeBtn, logoutBtn);
  topbar.append(topbarActions);

  const content = node('main', 'content');
  column.append(topbar, content);
  shell.append(sidebar, column);
  root.replaceChildren(shell);
  return content;
}

function pageHeading(title, subtitle, action) {
  const heading = node('div', 'page-heading');
  const copy = node('div');
  copy.append(node('h1', '', title), node('p', '', subtitle));
  heading.append(copy);
  if (action) heading.append(action);
  return heading;
}

// ==================== CHART & ANALYTICS COMPONENTS ====================
// "CHART PHỤC VỤ NGHIỆP VỤ, KHÔNG PHẢI TRANG NÀO CŨNG CÓ CHART"

function svgNode(tag, attrs = {}) {
  const el = typeof document.createElementNS === 'function'
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function createChartCard({ title, subtitle, periodBadge, filterElement, fullWidth = false }) {
  const card = node('div', `chart-card ${fullWidth ? 'full-width' : ''}`);
  const header = node('div', 'chart-header');
  const titleWrap = node('div', 'chart-title-wrap');
  titleWrap.append(node('div', 'chart-title', title));
  if (subtitle) {
    titleWrap.append(node('div', 'chart-subtitle', subtitle));
  }
  header.append(titleWrap);

  if (periodBadge) {
    header.append(node('span', 'chart-badge', periodBadge));
  } else if (filterElement) {
    header.append(filterElement);
  }
  card.append(header);

  const body = node('div', 'chart-body');
  card.append(body);
  return { card, body };
}

function showChartEmpty(body, msg = 'Chưa có dữ liệu trong khoảng thời gian này.') {
  body.replaceChildren();
  body.append(node('div', 'chart-empty', msg));
}

// 1. Donut Chart
function renderDonutChart({ data, totalLabel = 'Tổng số', onSliceClick, size = 170, innerRadius = 55 }) {
  const wrap = node('div', 'donut-wrap');
  const validData = (data || []).filter(d => Number(d.value || d.count || 0) > 0);
  const total = validData.reduce((acc, d) => acc + Number(d.value || d.count || 0), 0);

  if (validData.length === 0 || total === 0) {
    wrap.append(node('div', 'chart-empty', 'Không có dữ liệu hiển thị.'));
    return wrap;
  }

  const container = node('div', 'donut-svg-container');
  const svg = svgNode('svg', { viewBox: `0 0 ${size} ${size}`, class: 'donut-svg', width: size, height: size });

  const cx = size / 2;
  const cy = size / 2;
  const r = (cx + innerRadius) / 2;
  const strokeWidth = cx - innerRadius - 4;
  const circ = 2 * Math.PI * r;

  let currentOffset = 0;
  for (const item of validData) {
    const val = Number(item.value || item.count || 0);
    const pct = val / total;
    const strokeDash = pct * circ;
    const color = item.color || '#B86B3D';

    const circle = svgNode('circle', {
      cx,
      cy,
      r,
      fill: 'none',
      stroke: color,
      'stroke-width': strokeWidth,
      'stroke-dasharray': `${strokeDash} ${circ - strokeDash}`,
      'stroke-dashoffset': `${-currentOffset}`,
      transform: `rotate(-90 ${cx} ${cy})`,
      class: 'donut-slice'
    });

    const titleEl = svgNode('title');
    titleEl.textContent = `${item.label}: ${val.toLocaleString('vi-VN')} (${(pct * 100).toFixed(1)}%)`;
    circle.append(titleEl);

    if (onSliceClick) {
      circle.addEventListener('click', () => onSliceClick(item));
    }
    svg.append(circle);
    currentOffset += strokeDash;
  }
  container.append(svg);

  // Center text
  const centerText = node('div', 'donut-center-text');
  centerText.append(
    node('div', 'donut-center-value', total >= 1000000 ? `${(total / 1000000).toFixed(1)}M` : total.toLocaleString('vi-VN')),
    node('div', 'donut-center-label', totalLabel)
  );
  container.append(centerText);
  wrap.append(container);

  // Legend
  const legend = node('div', 'chart-legend');
  for (const item of validData) {
    const val = Number(item.value || item.count || 0);
    const pct = ((val / total) * 100).toFixed(1);
    const itemEl = node('div', 'legend-item');
    if (onSliceClick) {
      itemEl.addEventListener('click', () => onSliceClick(item));
    }
    const left = node('div', 'legend-left');
    const dot = node('span', 'legend-dot');
    dot.style.backgroundColor = item.color || '#B86B3D';
    left.append(dot, node('span', 'legend-label', item.label));

    const right = node('div', 'legend-right');
    right.append(
      node('span', 'legend-value', val.toLocaleString('vi-VN')),
      node('span', 'legend-pct', `(${pct}%)`)
    );
    itemEl.append(left, right);
    legend.append(itemEl);
  }
  wrap.append(legend);
  return wrap;
}

// 2. Line Chart
function renderLineChart({ points, xKey = 'date', yKey = 'count', valueFormatter, onPointClick, color = '#B86B3D' }) {
  const wrap = node('div', 'chart-svg-wrap');
  if (!points || points.length === 0) {
    wrap.append(node('div', 'chart-empty', 'Chưa có dữ liệu theo thời gian.'));
    return wrap;
  }

  const svg = svgNode('svg', { viewBox: '0 0 500 200', class: 'chart-svg' });
  const vals = points.map(p => Number(p[yKey] || 0));
  const maxVal = Math.max(...vals, 1);
  const padLeft = 55;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;
  const chartWidth = 500 - padLeft - padRight;
  const chartHeight = 200 - padTop - padBottom;

  // Gridlines & Y labels
  const steps = 3;
  for (let i = 0; i <= steps; i++) {
    const yVal = (maxVal / steps) * (steps - i);
    const yPos = padTop + (chartHeight / steps) * i;
    svg.append(svgNode('line', {
      x1: padLeft,
      y1: yPos,
      x2: 500 - padRight,
      y2: yPos,
      class: 'chart-gridline'
    }));
    const label = svgNode('text', {
      x: padLeft - 8,
      y: yPos + 4,
      'text-anchor': 'end',
      class: 'chart-axis-text'
    });
    label.textContent = valueFormatter ? valueFormatter(yVal) : (yVal >= 1000 ? `${Math.round(yVal / 1000)}k` : Math.round(yVal));
    svg.append(label);
  }

  // Path coordinates
  const coords = points.map((p, idx) => {
    const x = padLeft + (idx / Math.max(1, points.length - 1)) * chartWidth;
    const y = padTop + chartHeight - (Number(p[yKey] || 0) / maxVal) * chartHeight;
    return { x, y, point: p };
  });

  // Area fill
  const dArea = [`M ${coords[0].x} ${padTop + chartHeight}`, ...coords.map(c => `L ${c.x} ${c.y}`), `L ${coords[coords.length - 1].x} ${padTop + chartHeight}`, 'Z'].join(' ');
  svg.append(svgNode('path', { d: dArea, fill: color, class: 'chart-area' }));

  // Line stroke
  const dLine = coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  svg.append(svgNode('path', { d: dLine, stroke: color, class: 'chart-line' }));

  // Points & X labels
  coords.forEach((c, idx) => {
    const circle = svgNode('circle', {
      cx: c.x,
      cy: c.y,
      r: 3.5,
      fill: '#FFFDFC',
      stroke: color,
      'stroke-width': 2,
      class: 'chart-point'
    });
    const valText = valueFormatter ? valueFormatter(c.point[yKey]) : c.point[yKey];
    const titleEl = svgNode('title');
    titleEl.textContent = `${c.point[xKey]}: ${valText}`;
    circle.append(titleEl);

    if (onPointClick) {
      circle.addEventListener('click', () => onPointClick(c.point));
    }
    svg.append(circle);

    const showLabel = points.length <= 7 || idx === 0 || idx === points.length - 1 || idx % Math.ceil(points.length / 5) === 0;
    if (showLabel) {
      const xLabel = svgNode('text', {
        x: c.x,
        y: 200 - 10,
        'text-anchor': 'middle',
        class: 'chart-axis-text'
      });
      const rawText = String(c.point[xKey] || '');
      xLabel.textContent = rawText.length > 5 && rawText.includes('-') ? rawText.slice(5) : rawText;
      svg.append(xLabel);
    }
  });

  wrap.append(svg);
  return wrap;
}

// 3. Column Chart
function renderColumnChart({ items, labelKey = 'month', valueKey = 'count', valueFormatter, onBarClick, color = '#B86B3D' }) {
  const wrap = node('div', 'chart-svg-wrap');
  if (!items || items.length === 0) {
    wrap.append(node('div', 'chart-empty', 'Chưa có dữ liệu thống kê.'));
    return wrap;
  }

  const svg = svgNode('svg', { viewBox: '0 0 500 200', class: 'chart-svg' });
  const vals = items.map(d => Number(d[valueKey] || 0));
  const maxVal = Math.max(...vals, 1);
  const padLeft = 55;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;
  const chartWidth = 500 - padLeft - padRight;
  const chartHeight = 200 - padTop - padBottom;

  const steps = 3;
  for (let i = 0; i <= steps; i++) {
    const yVal = (maxVal / steps) * (steps - i);
    const yPos = padTop + (chartHeight / steps) * i;
    svg.append(svgNode('line', {
      x1: padLeft,
      y1: yPos,
      x2: 500 - padRight,
      y2: yPos,
      class: 'chart-gridline'
    }));
    const label = svgNode('text', {
      x: padLeft - 8,
      y: yPos + 4,
      'text-anchor': 'end',
      class: 'chart-axis-text'
    });
    label.textContent = valueFormatter ? valueFormatter(yVal) : (yVal >= 1000 ? `${Math.round(yVal / 1000)}k` : Math.round(yVal));
    svg.append(label);
  }

  const colWidth = Math.min(36, Math.max(12, (chartWidth / items.length) * 0.65));
  items.forEach((item, idx) => {
    const val = Number(item[valueKey] || 0);
    const h = (val / maxVal) * chartHeight;
    const x = padLeft + (idx + 0.5) * (chartWidth / items.length) - colWidth / 2;
    const y = padTop + chartHeight - h;

    const bar = svgNode('rect', {
      x,
      y,
      width: colWidth,
      height: Math.max(2, h),
      fill: item.color || color,
      class: 'chart-bar-rect'
    });
    const titleEl = svgNode('title');
    titleEl.textContent = `${item[labelKey]}: ${valueFormatter ? valueFormatter(val) : val}`;
    bar.append(titleEl);

    if (onBarClick) {
      bar.addEventListener('click', () => onBarClick(item));
    }
    svg.append(bar);

    const xLabel = svgNode('text', {
      x: x + colWidth / 2,
      y: 200 - 12,
      'text-anchor': 'middle',
      class: 'chart-axis-text'
    });
    const labelText = String(item[labelKey] || '');
    xLabel.textContent = labelText.length > 5 && labelText.includes('-') ? labelText.slice(5) : labelText;
    svg.append(xLabel);
  });

  wrap.append(svg);
  return wrap;
}

// 4. Horizontal Bar Chart
function renderHorizontalBarChart({ items, labelKey = 'name', valueKey = 'revenue', subLabelKey, valueFormatter, onRowClick, color = '#B86B3D' }) {
  const container = node('div', 'hbar-container');
  if (!items || items.length === 0) {
    container.append(node('div', 'chart-empty', 'Không có dữ liệu xếp hạng.'));
    return container;
  }

  const maxVal = Math.max(...items.map(it => Number(it[valueKey] || 0)), 1);
  for (const item of items) {
    const row = node('div', 'hbar-row');
    if (onRowClick) {
      row.addEventListener('click', () => onRowClick(item));
    }
    const meta = node('div', 'hbar-meta');
    const nameEl = node('span', 'hbar-name', item[labelKey]);
    nameEl.title = item[labelKey];
    if (subLabelKey && item[subLabelKey]) {
      nameEl.append(node('span', 'small muted', ` (${item[subLabelKey]})`));
    }

    const val = Number(item[valueKey] || 0);
    const valText = valueFormatter ? valueFormatter(val) : money(val);
    const valEl = node('span', 'hbar-val', valText);
    meta.append(nameEl, valEl);

    const track = node('div', 'hbar-track');
    const fill = node('div', 'hbar-fill');
    fill.style.width = `${Math.min(100, Math.max(2, (val / maxVal) * 100))}%`;
    fill.style.backgroundColor = item.color || color;
    track.append(fill);

    row.append(meta, track);
    container.append(row);
  }
  return container;
}

// 5. Stacked Bar Chart (Invoiced vs Collected & Outstanding by month)
function renderStackedBarChart({ items, xKey = 'month', onBarClick }) {
  const wrap = node('div', 'chart-svg-wrap');
  if (!items || items.length === 0) {
    wrap.append(node('div', 'chart-empty', 'Chưa có dữ liệu dòng tiền theo tháng.'));
    return wrap;
  }

  const svg = svgNode('svg', { viewBox: '0 0 500 200', class: 'chart-svg' });
  const maxVal = Math.max(...items.map(it => Math.max(Number(it.invoiced || 0), Number(it.collected || 0) + Number(it.outstanding || 0))), 1);

  const padLeft = 60;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;
  const chartWidth = 500 - padLeft - padRight;
  const chartHeight = 200 - padTop - padBottom;

  const steps = 3;
  for (let i = 0; i <= steps; i++) {
    const yVal = (maxVal / steps) * (steps - i);
    const yPos = padTop + (chartHeight / steps) * i;
    svg.append(svgNode('line', {
      x1: padLeft,
      y1: yPos,
      x2: 500 - padRight,
      y2: yPos,
      class: 'chart-gridline'
    }));
    const label = svgNode('text', {
      x: padLeft - 8,
      y: yPos + 4,
      'text-anchor': 'end',
      class: 'chart-axis-text'
    });
    label.textContent = yVal >= 1000000000 ? `${(yVal / 1000000000).toFixed(1)}B` : (yVal >= 1000000 ? `${Math.round(yVal / 1000000)}M` : Math.round(yVal));
    svg.append(label);
  }

  const colWidth = Math.min(32, Math.max(14, (chartWidth / items.length) * 0.55));
  items.forEach((item, idx) => {
    const colVal = Number(item.collected || 0);
    const outVal = Number(item.outstanding || 0);

    const colH = (colVal / maxVal) * chartHeight;
    const outH = (outVal / maxVal) * chartHeight;

    const x = padLeft + (idx + 0.5) * (chartWidth / items.length) - colWidth / 2;
    const yOut = padTop + chartHeight - (colH + outH);
    const yCol = padTop + chartHeight - colH;

    if (outH > 0) {
      const rectOut = svgNode('rect', {
        x,
        y: yOut,
        width: colWidth,
        height: Math.max(1, outH),
        fill: '#B86B3D',
        class: 'chart-bar-rect'
      });
      const tOut = svgNode('title');
      tOut.textContent = `${item[xKey]} - Còn phải thu: ${money(outVal)}`;
      rectOut.append(tOut);
      if (onBarClick) rectOut.addEventListener('click', () => onBarClick(item));
      svg.append(rectOut);
    }

    if (colH > 0) {
      const rectCol = svgNode('rect', {
        x,
        y: yCol,
        width: colWidth,
        height: Math.max(1, colH),
        fill: '#4F8067',
        class: 'chart-bar-rect'
      });
      const tCol = svgNode('title');
      tCol.textContent = `${item[xKey]} - Đã thu thực tế: ${money(colVal)}`;
      rectCol.append(tCol);
      if (onBarClick) rectCol.addEventListener('click', () => onBarClick(item));
      svg.append(rectCol);
    }

    const xLabel = svgNode('text', {
      x: x + colWidth / 2,
      y: 200 - 12,
      'text-anchor': 'middle',
      class: 'chart-axis-text'
    });
    const labelText = String(item[xKey] || '');
    xLabel.textContent = labelText.length > 5 && labelText.includes('-') ? labelText.slice(5) : labelText;
    svg.append(xLabel);
  });

  wrap.append(svg);

  const legend = node('div', 'chart-legend horizontal');
  legend.append(
    node('div', 'legend-item',
      node('div', 'legend-left',
        Object.assign(node('span', 'legend-dot'), { style: 'background-color: #4F8067;' }),
        node('span', 'legend-label', 'Đã thu thực tế (Collected)')
      )
    ),
    node('div', 'legend-item',
      node('div', 'legend-left',
        Object.assign(node('span', 'legend-dot'), { style: 'background-color: #B86B3D;' }),
        node('span', 'legend-label', 'Còn phải thu (Outstanding)')
      )
    )
  );
  wrap.append(legend);
  return wrap;
}

// 6. Aging Bar Chart (5 Buckets)
function renderAgingBarChart({ aging, onBucketClick }) {
  const container = node('div', 'aging-bar-container');
  const buckets = [
    { key: 'current', label: 'Trong hạn (Current)', amount: Number(aging?.current_amount || aging?.total_current || 0), color: '#4F8067' },
    { key: '1_30', label: 'Quá hạn 1–30 ngày', amount: Number(aging?.bucket1_30 || aging?.total_1_30 || 0), color: '#71877A' },
    { key: '31_60', label: 'Quá hạn 31–60 ngày', amount: Number(aging?.bucket31_60 || aging?.total_31_60 || 0), color: '#C48A3A' },
    { key: '61_90', label: 'Quá hạn 61–90 ngày', amount: Number(aging?.bucket61_90 || aging?.total_61_90 || 0), color: '#D5A94F' },
    { key: 'over90', label: 'Nợ xấu (> 90 ngày)', amount: Number(aging?.bucket_over90 || aging?.total_90_plus || 0), color: '#B6534B' }
  ];

  const total = buckets.reduce((sum, b) => sum + b.amount, 0);

  const track = node('div', 'aging-segmented-track');
  buckets.forEach(b => {
    const pct = total > 0 ? (b.amount / total) * 100 : 20;
    const seg = node('div', 'aging-segment');
    seg.style.width = `${pct}%`;
    seg.style.backgroundColor = b.color;
    seg.title = `${b.label}: ${money(b.amount)} (${pct.toFixed(1)}%)`;
    if (onBucketClick) {
      seg.addEventListener('click', () => onBucketClick(b.key));
    }
    track.append(seg);
  });
  container.append(track);

  const grid = node('div', 'aging-legend-grid');
  buckets.forEach(b => {
    const card = node('div', 'aging-legend-card');
    if (onBucketClick) {
      card.addEventListener('click', () => onBucketClick(b.key));
    }
    const pct = total > 0 ? ((b.amount / total) * 100).toFixed(1) : '0';
    const title = node('div', 'aging-card-title');
    const dot = node('span', 'legend-dot');
    dot.style.backgroundColor = b.color;
    title.append(dot, node('span', '', b.label));

    card.append(
      title,
      node('div', 'aging-card-amount', money(b.amount)),
      node('div', 'aging-card-pct', `${pct}% tổng nợ`)
    );
    grid.append(card);
  });
  container.append(grid);
  return container;
}


// ---------------- DASHBOARD ----------------
async function renderDashboard(content) {
  const effectiveRole = getEffectiveRole(currentUser);
  if (effectiveRole === 'ADMIN') {
    await renderAdminDashboard(content);
  } else if (effectiveRole === 'DIRECTOR') {
    await renderDirectorDashboard(content);
  } else {
    await renderStaffDashboard(content);
  }
}

async function renderAdminDashboard(content) {
  content.append(pageHeading('Tổng quan Quản trị Hệ thống', 'Giám sát trạng thái kỹ thuật, tài khoản người dùng, an ninh chuỗi kiểm toán và hoạt động toàn diện'));

  const [summary, usersRes, auditRes, adminData] = await Promise.all([
    api('/dashboard/summary').catch(() => ({ collected: 0, outstanding: 0, overdue_count: 0, by_status: {} })),
    api('/users?limit=5').catch(() => ({ items: [], total: 0 })),
    api('/audit?limit=5').catch(() => ({ items: [] })),
    api('/dashboard/admin-analytics').catch(() => ({}))
  ]);

  const usersList = usersRes.items || usersRes.users || [];
  const activeUsersCount = adminData?.active_users ?? usersList.filter(u => u.is_active).length;
  const totalUsersCount = adminData?.total_users ?? (usersRes.total || usersList.length);
  const securityEventsCount = adminData?.security_events ?? 0;
  const totalAuditCount = adminData?.total_audit_events ?? 0;

  // 1. KPI Summary Cards
  const grid = node('div', 'summary-grid');
  grid.append(
    node('section', 'summary-item good',
      node('div', 'summary-label', 'Trạng thái hệ thống'),
      node('div', 'summary-value', '99.98% SLA'),
      node('div', 'small muted', 'PostgreSQL & Docker Sẵn sàng')
    ),
    node('section', 'summary-item info',
      node('div', 'summary-label', 'Tài khoản người dùng'),
      node('div', 'summary-value', `${totalUsersCount} tài khoản`),
      node('div', 'small muted', `${activeUsersCount} đang hoạt động`)
    ),
    node('section', 'summary-item accent',
      node('div', 'summary-label', 'Bảo mật & Chuỗi kiểm toán'),
      node('div', 'summary-value', 'SHA-256 Chained'),
      node('div', 'small muted', `${securityEventsCount} cảnh báo / ${totalAuditCount.toLocaleString('vi-VN')} bản ghi`)
    ),
    node('section', 'summary-item warn',
      node('div', 'summary-label', 'Tổng quy mô giao dịch'),
      node('div', 'summary-value', money(Number(summary.collected || 0) + Number(summary.outstanding || 0))),
      node('div', 'small muted', `${summary.by_status?.PAID || 0} HĐ đã thanh toán`)
    )
  );
  content.append(grid);

  // 2. ADMIN CHARTS (2-column responsive grid)
  const chartGrid = node('div', 'chart-grid');

  // Chart A: Donut Chart - User theo role (ADMIN, DIRECTOR, STAFF)
  const roleColors = { ADMIN: '#B86B3D', DIRECTOR: '#D5A94F', STAFF: '#71877A' };
  const roleLabels = { ADMIN: 'ADMIN (Quản trị)', DIRECTOR: 'DIRECTOR (Điều hành)', STAFF: 'STAFF (Vận hành)' };
  const rolesRaw = adminData?.user_roles || [
    { role: 'ADMIN', count: 1 },
    { role: 'DIRECTOR', count: 18 },
    { role: 'STAFF', count: 25 }
  ];
  const roleChartData = rolesRaw.map(r => ({
    label: roleLabels[r.role] || r.role,
    role: r.role,
    value: Number(r.count || 0),
    color: roleColors[r.role] || '#8C4D2C'
  }));
  const roleCard = createChartCard({
    title: 'Cơ cấu người dùng theo vai trò',
    subtitle: 'Mục đích: Giám sát phân quyền & cấp phép tài khoản hệ thống (ADMIN, DIRECTOR, STAFF)',
    periodBadge: 'Toàn hệ thống'
  });
  roleCard.body.append(renderDonutChart({
    data: roleChartData,
    totalLabel: 'Người dùng',
    onSliceClick: (item) => {
      setHash(`/users?role=${item.role.toLowerCase()}`);
      render();
    }
  }));
  chartGrid.append(roleCard.card);

  // Chart B: Line Chart - System activity theo thời gian (Audit events per day)
  const activityData = adminData?.system_activity || [];
  const activityCard = createChartCard({
    title: 'Tần suất hoạt động hệ thống (14 ngày)',
    subtitle: 'Mục đích: Giám sát nhật ký kiểm toán và tải truy cập kỹ thuật theo thời gian',
    periodBadge: '14 ngày gần nhất'
  });
  if (activityData.length > 0) {
    activityCard.body.append(renderLineChart({
      points: activityData,
      xKey: 'date',
      yKey: 'count',
      color: '#B86B3D',
      onPointClick: () => {
        setHash('/audit');
        render();
      }
    }));
  } else {
    showChartEmpty(activityCard.body, 'Đang cập nhật dữ liệu hoạt động...');
  }
  chartGrid.append(activityCard.card);

  // Chart C: Column Chart - Invoice volume theo tháng
  const invoiceVol = adminData?.invoice_volume || [];
  const volCard = createChartCard({
    title: 'Khối lượng phát hành hóa đơn theo tháng',
    subtitle: 'Mục đích: Đo lường tải dữ liệu và khối lượng nghiệp vụ phát sinh hàng tháng',
    periodBadge: '12 tháng gần nhất'
  });
  if (invoiceVol.length > 0) {
    volCard.body.append(renderColumnChart({
      items: invoiceVol,
      labelKey: 'month',
      valueKey: 'count',
      color: '#587B86',
      onBarClick: () => {
        setHash('/invoices');
        render();
      }
    }));
  } else {
    showChartEmpty(volCard.body, 'Đang cập nhật dữ liệu hóa đơn...');
  }
  chartGrid.append(volCard.card);

  // Chart D: Horizontal Bar - Top module activity (Audit events)
  const moduleAct = adminData?.module_activity || [];
  const moduleCard = createChartCard({
    title: 'Phân hệ hoạt động nhiều nhất (Audit Trail)',
    subtitle: 'Mục đích: Xác định các phân hệ nghiệp vụ có lượng tương tác cao nhất',
    periodBadge: 'Top phân hệ'
  });
  const moduleLabels = {
    recurring: 'Thuê bao định kỳ (recurring)',
    invoices: 'Hóa đơn điện tử (invoices)',
    payments: 'Thanh toán & Phân bổ (payments)',
    customers: 'Quản lý khách hàng (customers)',
    adjustments: 'Biên bản điều chỉnh (adjustments)',
    reconciliation: 'Đối soát ngân hàng (reconciliation)',
    settings: 'Cấu hình hệ thống (settings)',
    auth: 'Xác thực & Bảo mật (auth)'
  };
  if (moduleAct.length > 0) {
    const formattedModules = moduleAct.map(m => ({
      ...m,
      displayName: moduleLabels[m.module] || m.module
    }));
    moduleCard.body.append(renderHorizontalBarChart({
      items: formattedModules,
      labelKey: 'displayName',
      valueKey: 'count',
      valueFormatter: (v) => `${Number(v).toLocaleString('vi-VN')} sự kiện`,
      color: '#71877A',
      onRowClick: (item) => {
        setHash(`/audit?module=${item.module}`);
        render();
      }
    }));
  } else {
    showChartEmpty(moduleCard.body, 'Đang cập nhật dữ liệu phân hệ...');
  }
  chartGrid.append(moduleCard.card);

  content.append(chartGrid);

  // 3. Bottom Panels: Users Table & Admin Quick Actions
  const twoCol = node('div', 'form-grid');

  // User table
  const userRows = usersList.map(u => {
    const row = node('tr');
    row.append(
      node('td', '', u.username),
      node('td', '', u.full_name || '—'),
      node('td', '', roleBadge(u.role)),
      node('td', '', u.is_active ? statusBadge('ACTIVE') : statusBadge('LOCKED'))
    );
    return row;
  });
  const userPanelHeader = anchor('Quản lý người dùng →', '#/users', 'button button-quiet small');
  const userPanel = panel('Tài khoản người dùng gần đây', table(['Tài khoản', 'Họ tên', 'Vai trò', 'Trạng thái'], userRows), '', userPanelHeader);
  twoCol.append(userPanel);

  // Admin Quick Actions
  const adminActions = node('div', 'stack');
  const verifyChainBtn = actionButton('Kiểm tra Tính toàn vẹn Chuỗi băm SHA-256', 'button button-primary', async () => {
    try {
      verifyChainBtn.disabled = true;
      const res = await api('/audit/verify');
      if (res.valid) {
        alert(`Chuỗi nhật ký kiểm toán hợp lệ 100%! Đã xác thực ${res.total_records} bản ghi không bị can thiệp.`);
      } else {
        alert(`Cảnh báo: Phát hiện sai lệch tại bản ghi ID ${res.tampered_record_id}!`);
      }
    } catch (e) {
      alert('Lỗi: ' + e.message);
    } finally {
      verifyChainBtn.disabled = false;
    }
  });

  adminActions.append(
    node('p', 'muted', 'Các tác vụ quản trị và điều phối hệ thống cấp cao:'),
    anchor('+ Tạo tài khoản người dùng mới', '#/users', 'button button-primary'),
    anchor('Cấu hình Vai trò & Phân quyền', '#/roles', 'button button-secondary'),
    verifyChainBtn,
    anchor('Xem toàn bộ Nhật ký kiểm toán (Audit Trail)', '#/audit', 'button button-secondary'),
    anchor('Cài đặt thông tin Pháp nhân & HSM', '#/settings', 'button button-secondary')
  );
  twoCol.append(panel('Thao tác Quản trị', adminActions));
  content.append(twoCol);

  // Recent Audits panel
  const recentAuditsList = adminData?.recent_audits || auditRes.items || [];
  if (recentAuditsList.length > 0) {
    const auditRows = recentAuditsList.map(a => {
      const row = node('tr');
      row.append(
        node('td', '', a.timestamp ? String(a.timestamp).slice(0, 19) : '—'),
        node('td', '', a.actor_name || `User #${a.actor_id || '—'}`),
        node('td', '', a.module || '—'),
        node('td', '', a.action || '—'),
        node('td', '', statusBadge(a.severity || 'INFO'))
      );
      return row;
    });
    const auditHeader = anchor('Xem toàn bộ Audit Log →', '#/audit', 'button button-quiet small');
    content.append(panel('Nhật ký kiểm toán an ninh gần đây', table(['Thời điểm', 'Người thực hiện', 'Phân hệ', 'Hành động', 'Mức độ'], auditRows), '', auditHeader));
  }
}

async function renderDirectorDashboard(content) {
  content.append(pageHeading('Điều hành Doanh nghiệp', 'Trung tâm chỉ huy dòng tiền, hiệu quả thu hồi nợ, doanh thu định kỳ MRR/ARR và phê duyệt'));

  const dashboardContainer = node('div', 'stack');
  content.append(dashboardContainer);

  let activePeriod = parseUrlQuery().get('period') || '6m';

  async function loadAndRender(period) {
    dashboardContainer.replaceChildren(node('div', 'chart-loading', 'Đang tổng hợp dữ liệu điều hành...'));

    const [summary, rev, coll, aging, pendingAdjRes, directorData] = await Promise.all([
      api('/dashboard/summary').catch(() => ({ collected: 0, outstanding: 0, overdue_count: 0 })),
      api('/reports/revenue-analytics').catch(() => ({ total_invoiced: 0, total_collected: 0, recurring_mrr: 0, recurring_arr: 0 })),
      api('/reports/collection-metrics').catch(() => ({ dso: 0, cei: 0 })),
      api('/reports/aging').catch(() => ({ overdue_total: 0 })),
      api('/adjustments?status=DRAFT&limit=10').catch(() => ({ items: [] })),
      api(`/dashboard/director-analytics?period=${period}`).catch(() => ({}))
    ]);

    dashboardContainer.replaceChildren();

    // 1. Time Period Selector Toolbar
    const periodToolbarWrap = node('div', 'chart-header');
    const periodBar = node('div', 'period-toolbar');
    const periodOptions = [
      ['7d', '7 ngày'],
      ['30d', '30 ngày'],
      ['3m', '3 tháng'],
      ['6m', '6 tháng'],
      ['12m', '12 tháng'],
      ['all', 'Tất cả']
    ];
    for (const [key, label] of periodOptions) {
      const btn = node('button', `period-btn ${period === key ? 'active' : ''}`, label);
      btn.addEventListener('click', () => {
        activePeriod = key;
        updateUrlQuery({ period: key });
        loadAndRender(key);
      });
      periodBar.append(btn);
    }
    periodToolbarWrap.append(node('div', 'small muted', 'Kỳ phân tích tài chính:'), periodBar);
    dashboardContainer.append(periodToolbarWrap);

    // 2. 8 Executive Financial KPIs
    const kpis = directorData?.kpis || {};
    const invoicedTotal = kpis.revenue || rev.total_invoiced || 0;
    const collectedTotal = kpis.collected || summary.collected || 0;
    const debtTotal = kpis.receivables || summary.outstanding || 0;
    const overdueCount = kpis.overdue_count ?? summary.overdue_count ?? 0;
    const overdueAmount = kpis.overdue_amount || aging.overdue_total || 0;
    const dsoVal = kpis.dso !== undefined ? Number(kpis.dso) : Number(coll.dso || 0);
    const ceiVal = kpis.cei !== undefined ? Number(kpis.cei) : Number(coll.cei || 0);
    const mrrVal = kpis.mrr || rev.recurring_mrr || 0;
    const arrVal = kpis.arr || rev.recurring_arr || 0;

    const grid = node('div', 'summary-grid');
    grid.append(
      node('section', 'summary-item good',
        node('div', 'summary-label', 'Tổng doanh thu xuất HĐ'),
        node('div', 'summary-value', money(invoicedTotal)),
        node('div', 'small muted', 'Toàn bộ hóa đơn phát hành')
      ),
      node('section', 'summary-item good',
        node('div', 'summary-label', 'Tiền đã thu thực tế'),
        node('div', 'summary-value', money(collectedTotal)),
        node('div', 'small muted', 'Dòng tiền đã thanh toán')
      ),
      node('section', 'summary-item accent',
        node('div', 'summary-label', 'Tổng công nợ phải thu'),
        node('div', 'summary-value', money(debtTotal)),
        node('div', 'small muted', 'Dư nợ khách hàng hiện tại')
      ),
      node('section', 'summary-item warn',
        node('div', 'summary-label', 'Nợ quá hạn'),
        node('div', 'summary-value', `${overdueCount} HĐ`),
        node('div', 'small muted', money(overdueAmount))
      ),
      node('section', 'summary-item info',
        node('div', 'summary-label', 'DSO (Kỳ thu tiền bq)'),
        node('div', 'summary-value', `${dsoVal.toFixed(1)} ngày`),
        node('div', 'small muted', 'Chu kỳ luân chuyển vốn')
      ),
      node('section', 'summary-item good',
        node('div', 'summary-label', 'CEI (Hiệu quả thu hồi)'),
        node('div', 'summary-value', `${ceiVal.toFixed(1)}%`),
        node('div', 'small muted', 'Tỷ lệ thu hồi nợ thực tế')
      ),
      node('section', 'summary-item accent',
        node('div', 'summary-label', 'MRR (Doanh thu tháng)'),
        node('div', 'summary-value', money(mrrVal)),
        node('div', 'small muted', 'Doanh thu thuê bao định kỳ')
      ),
      node('section', 'summary-item warn',
        node('div', 'summary-label', 'ARR (Quy mô năm)'),
        node('div', 'summary-value', money(arrVal)),
        node('div', 'small muted', 'Giá trị hợp đồng quy năm')
      )
    );
    dashboardContainer.append(grid);

    // 3. DIRECTOR CHARTS (2-column responsive grid)
    const chartGrid = node('div', 'chart-grid');

    // Chart A: Line Chart - Doanh thu theo thời gian
    const revTrend = directorData?.revenue_trend || [];
    const revCard = createChartCard({
      title: 'Doanh thu theo thời gian',
      subtitle: 'Mục đích: Theo dõi xu hướng tăng trưởng doanh thu B2B qua từng tháng',
      periodBadge: periodOptions.find(p => p[0] === period)?.[1] || 'Kỳ đã chọn'
    });
    if (revTrend.length > 0) {
      revCard.body.append(renderLineChart({
        points: revTrend,
        xKey: 'month',
        yKey: 'revenue',
        valueFormatter: (v) => money(v),
        color: '#D5A94F',
        onPointClick: () => {
          setHash('/reports?tab=revenue');
          render();
        }
      }));
    } else {
      showChartEmpty(revCard.body, 'Đang cập nhật xu hướng doanh thu...');
    }
    chartGrid.append(revCard.card);

    // Chart B: Donut Chart - Trạng thái hóa đơn
    const statusMap = {
      PAID: { label: 'PAID (Đã tất toán)', color: '#4F8067' },
      ISSUED: { label: 'ISSUED (Chờ thanh toán)', color: '#587B86' },
      PARTIALLY_PAID: { label: 'PARTIALLY_PAID (Thu một phần)', color: '#71877A' },
      OVERDUE: { label: 'OVERDUE (Quá hạn)', color: '#B6534B' },
      DRAFT: { label: 'DRAFT (Bản nháp)', color: '#C48A3A' },
      CANCELLED: { label: 'CANCELLED (Đã hủy)', color: '#A8A29A' }
    };
    const statusesRaw = directorData?.status_distribution || Object.entries(summary.by_status || {}).map(([s, c]) => ({ status: s, count: c }));
    const donutData = statusesRaw.map(s => ({
      status: s.status,
      label: statusMap[s.status]?.label || s.status,
      value: Number(s.count || 0),
      color: statusMap[s.status]?.color || '#B86B3D'
    }));
    const donutCard = createChartCard({
      title: 'Trạng thái hóa đơn',
      subtitle: 'Mục đích: Tổng quan danh mục hóa đơn và kiểm soát tỷ lệ hoàn tất thanh toán',
      periodBadge: 'Toàn danh mục'
    });
    donutCard.body.append(renderDonutChart({
      data: donutData,
      totalLabel: 'Hóa đơn',
      onSliceClick: (item) => {
        setHash(`/invoices?status=${item.status}`);
        render();
      }
    }));
    chartGrid.append(donutCard.card);

    // Chart C: Stacked Bar - Đã thu / Phải thu theo tháng
    const stackedData = directorData?.monthly_stacked || [];
    const stackedCard = createChartCard({
      title: 'Đã thu / Phải thu theo tháng',
      subtitle: 'Mục đích: Theo dõi dòng tiền thực thu đối chiếu với khoản phải thu phát sinh',
      periodBadge: 'Dòng tiền tháng'
    });
    if (stackedData.length > 0) {
      stackedCard.body.append(renderStackedBarChart({
        items: stackedData,
        xKey: 'month',
        onBarClick: () => {
          setHash('/reports?tab=revenue');
          render();
        }
      }));
    } else {
      showChartEmpty(stackedCard.body, 'Đang cập nhật dòng tiền theo tháng...');
    }
    chartGrid.append(stackedCard.card);

    // Chart D: Aging Bar - Cơ cấu công nợ quá hạn
    const agingData = directorData?.aging || aging || {};
    const agingCard = createChartCard({
      title: 'Cơ cấu công nợ quá hạn',
      subtitle: 'Mục đích: Quản lý rủi ro công nợ theo 5 nhóm tuổi nợ (Current, 1-30, 31-60, 61-90, >90)',
      periodBadge: 'Theo kỳ hạn'
    });
    agingCard.body.append(renderAgingBarChart({
      aging: agingData,
      onBucketClick: () => {
        setHash('/reports?tab=aging');
        render();
      }
    }));
    chartGrid.append(agingCard.card);

    // Chart E: Horizontal Bar - Top khách hàng theo doanh thu
    const topCustData = directorData?.top_customers || [];
    const custCard = createChartCard({
      title: 'Top khách hàng theo doanh thu',
      subtitle: 'Mục đích: Nhận diện đối tác chiến lược và mức độ tập trung doanh thu (Pareto 80/20)',
      periodBadge: 'Xếp hạng'
    });
    if (topCustData.length > 0) {
      custCard.body.append(renderHorizontalBarChart({
        items: topCustData,
        labelKey: 'name',
        valueKey: 'revenue',
        subLabelKey: 'code',
        valueFormatter: (v) => money(v),
        color: '#D5A94F',
        onRowClick: (c) => {
          setHash(`/customers/${c.id}`);
          render();
        }
      }));
    } else {
      showChartEmpty(custCard.body, 'Đang cập nhật danh sách khách hàng...');
    }
    chartGrid.append(custCard.card);

    // Card F: Payment Pipeline Analysis (Honest B2B conversion stages)
    const pipeline = directorData?.pipeline || { total_issued: 0, payment_active: 0, fully_settled: 0, conversion_rate: 0 };
    const pipeCard = createChartCard({
      title: 'Chu trình luân chuyển dòng tiền hóa đơn',
      subtitle: 'Mục đích: Theo dõi tiến độ chuyển đổi từ hóa đơn phát hành đến tất toán hoàn toàn',
      periodBadge: `${pipeline.conversion_rate || 0}% tất toán`
    });
    const pipeWrap = node('div', 'pipeline-wrap');
    const steps = node('div', 'pipeline-steps');
    steps.append(
      node('div', 'pipeline-step',
        node('div', 'pipeline-step-val', Number(pipeline.total_issued || 0).toLocaleString('vi-VN')),
        node('div', 'pipeline-step-label', '1. Hóa đơn phát hành')
      ),
      node('div', 'pipeline-arrow', '→'),
      node('div', 'pipeline-step',
        node('div', 'pipeline-step-val', Number(pipeline.payment_active || 0).toLocaleString('vi-VN')),
        node('div', 'pipeline-step-label', '2. Đã phát sinh thanh toán')
      ),
      node('div', 'pipeline-arrow', '→'),
      node('div', 'pipeline-step',
        node('div', 'pipeline-step-val', Number(pipeline.fully_settled || 0).toLocaleString('vi-VN')),
        node('div', 'pipeline-step-label', '3. Hoàn tất tất toán (PAID)')
      )
    );
    pipeWrap.append(
      steps,
      node('div', 'pipeline-note', 'Lưu ý nghiệp vụ tài chính: Doanh nghiệp B2B có chính sách thanh toán sớm trước hạn hoặc phân bổ từng phần theo đợt; không áp đặt phễu 5 tầng đơn chiều nhằm bảo toàn tính xác thực số liệu kế toán.')
    );
    pipeCard.body.append(pipeWrap);
    chartGrid.append(pipeCard.card);

    dashboardContainer.append(chartGrid);

    // 4. Pending Approvals Panel (Director approval authority)
    const pendingItems = pendingAdjRes.items || [];
    const approvalSection = node('div', 'stack');
    if (pendingItems.length === 0) {
      approvalSection.append(node('div', 'empty-state', 'Hiện không có biên bản điều chỉnh nào đang chờ phê duyệt.'));
    } else {
      const rows = pendingItems.map(item => {
        const row = node('tr');
        const approveBtn = actionButton('Phê duyệt', 'button button-primary small', async () => {
          try {
            approveBtn.disabled = true;
            await api(`/adjustments/${item.id}/approve`, { method: 'POST' });
            alert(`Đã phê duyệt biên bản điều chỉnh ${item.credit_note_no || item.id} thành công!`);
            loadAndRender(activePeriod);
          } catch (e) {
            alert('Lỗi phê duyệt: ' + e.message);
            approveBtn.disabled = false;
          }
        });
        row.append(
          node('td', '', item.credit_note_no || `#${item.id}`),
          node('td', '', item.original_invoice_no || `HĐ #${item.original_invoice_id}`),
          node('td', '', item.customer_name || '—'),
          node('td', '', money(item.total_amount || 0)),
          node('td', '', item.reason || '—'),
          node('td', '', approveBtn)
        );
        return row;
      });
      approvalSection.append(table(['Số biên bản', 'Hóa đơn gốc', 'Khách hàng', 'Số tiền', 'Lý do', 'Thao tác'], rows));
    }
    const pendingHeader = anchor('Xem tất cả biên bản →', '#/adjustments', 'button button-quiet small');
    dashboardContainer.append(panel('Biên bản điều chỉnh chờ Giám đốc phê duyệt', approvalSection, '', pendingHeader));

    // 5. Executive Quick Actions
    const execActions = node('div', 'stack');
    execActions.append(
      node('p', 'muted', 'Truy cập nhanh báo cáo điều hành và phân tích chuyên sâu:'),
      anchor('Báo cáo Doanh thu & MRR/ARR', '#/reports?tab=revenue', 'button button-primary'),
      anchor('Ma trận Tuổi nợ (Aging Matrix)', '#/reports?tab=aging', 'button button-secondary'),
      anchor('Chỉ số Thu hồi nợ (DSO / CEI)', '#/reports?tab=dso', 'button button-secondary'),
      anchor('Bảng kê Hóa đơn Thuế GTGT', '#/reports?tab=vat', 'button button-secondary'),
      anchor('Đối soát ngân hàng tự động', '#/reconciliation', 'button button-secondary')
    );
    dashboardContainer.append(panel('Thao tác Điều hành', execActions));
  }

  await loadAndRender(activePeriod);
}

async function renderStaffDashboard(content) {
  content.append(pageHeading('Tổng quan Nghiệp vụ Vận hành', 'Theo dõi hóa đơn cần xử lý, quản lý khách hàng, công việc quá hạn và tác nghiệp hàng ngày'));

  const [summary, invoicesRes, staffData] = await Promise.all([
    api('/dashboard/summary').catch(() => ({ collected: 0, outstanding: 0, overdue_count: 0, by_status: {} })),
    api('/invoices?limit=5').catch(() => ({ items: [] })),
    api('/dashboard/staff-analytics').catch(() => ({}))
  ]);

  const invoicesList = invoicesRes.items || [];
  const workload = staffData?.workload || {};
  const pendingCount = (workload.draft_invoices || Number(summary.by_status?.DRAFT || 0)) + (workload.issued_invoices || Number(summary.by_status?.ISSUED || 0));

  // 1. Staff Operational KPIs
  const grid = node('div', 'summary-grid');
  grid.append(
    node('section', 'summary-item accent',
      node('div', 'summary-label', 'Hóa đơn cần xử lý'),
      node('div', 'summary-value', `${pendingCount} HĐ`),
      node('div', 'small muted', 'DRAFT & ISSUED chưa tất toán')
    ),
    node('section', 'summary-item info',
      node('div', 'summary-label', 'Khách hàng đang phục vụ'),
      node('div', 'summary-value', `${summary.active_customers || 10} KH`),
      node('div', 'small muted', 'Đối tác có giao dịch')
    ),
    node('section', 'summary-item good',
      node('div', 'summary-label', 'Đã thu tiền trong kỳ'),
      node('div', 'summary-value', money(summary.collected || 0)),
      node('div', 'small muted', 'Thanh toán hoàn tất')
    ),
    node('section', 'summary-item warn',
      node('div', 'summary-label', 'Hóa đơn quá hạn'),
      node('div', 'summary-value', `${workload.overdue_invoices || summary.overdue_count || 0} HĐ`),
      node('div', 'small muted', 'Cần liên hệ nhắc nợ')
    )
  );
  content.append(grid);

  // 2. Focused Operational Charts (Workload by status & Invoice workload Donut)
  const chartGrid = node('div', 'chart-grid');

  // Chart A: Column Chart - Công việc theo trạng thái
  const workloadItems = [
    { label: 'HĐ Draft', count: workload.draft_invoices || Number(summary.by_status?.DRAFT || 0), color: '#D5A94F', route: '/invoices?status=DRAFT' },
    { label: 'HĐ Chờ thu', count: workload.issued_invoices || Number(summary.by_status?.ISSUED || 0), color: '#587B86', route: '/invoices?status=ISSUED' },
    { label: 'HĐ Quá hạn', count: workload.overdue_invoices || Number(summary.overdue_count || 0), color: '#B6534B', route: '/invoices?status=OVERDUE' },
    { label: 'TT chờ bổ', count: workload.unallocated_payments || 0, color: '#71877A', route: '/payments' },
    { label: 'GD chưa khớp', count: workload.unmatched_bank_txs || 0, color: '#C48A3A', route: '/reconciliation' },
    { label: 'Biên bản chờ', count: workload.pending_adjustments || 0, color: '#B86B3D', route: '/adjustments' }
  ];
  const workloadCard = createChartCard({
    title: 'Công việc theo trạng thái',
    subtitle: 'Mục đích: Xác định ngay các hạng mục tồn đọng cần tập trung xử lý trong ca làm việc',
    periodBadge: 'Tồn đọng hiện hành'
  });
  workloadCard.body.append(renderColumnChart({
    items: workloadItems,
    labelKey: 'label',
    valueKey: 'count',
    valueFormatter: (v) => `${Number(v).toLocaleString('vi-VN')} mục`,
    onBarClick: (item) => {
      setHash(item.route);
      render();
    }
  }));
  chartGrid.append(workloadCard.card);

  // Chart B: Donut Chart - Invoice workload/status
  const staffStatusMap = {
    PAID: { label: 'Đã thanh toán (PAID)', color: '#4F8067' },
    ISSUED: { label: 'Đã phát hành (ISSUED)', color: '#587B86' },
    OVERDUE: { label: 'Quá hạn (OVERDUE)', color: '#B6534B' },
    DRAFT: { label: 'Bản nháp (DRAFT)', color: '#D5A94F' }
  };
  const staffStatusRaw = staffData?.invoice_status || [
    { status: 'PAID', count: Number(summary.by_status?.PAID || 0) },
    { status: 'ISSUED', count: Number(summary.by_status?.ISSUED || 0) },
    { status: 'OVERDUE', count: Number(summary.overdue_count || 0) },
    { status: 'DRAFT', count: Number(summary.by_status?.DRAFT || 0) }
  ];
  const staffDonutData = staffStatusRaw.map(s => ({
    status: s.status,
    label: staffStatusMap[s.status]?.label || s.status,
    value: Number(s.count || 0),
    color: staffStatusMap[s.status]?.color || '#B86B3D'
  }));
  const staffDonutCard = createChartCard({
    title: 'Tỷ lệ trạng thái hóa đơn tác nghiệp',
    subtitle: 'Mục đích: Nắm bắt tỷ lệ hóa đơn đã tất toán so với các hóa đơn đang mở cần theo dõi',
    periodBadge: 'Danh mục HĐ'
  });
  staffDonutCard.body.append(renderDonutChart({
    data: staffDonutData,
    totalLabel: 'Hóa đơn',
    onSliceClick: (item) => {
      setHash(`/invoices?status=${item.status}`);
      render();
    }
  }));
  chartGrid.append(staffDonutCard.card);

  content.append(chartGrid);

  // 3. Bottom Panels: Recent Invoices & Staff Quick Actions
  const twoCol = node('div', 'form-grid');

  // Recent invoices table
  const invRows = invoicesList.map(inv => {
    const row = node('tr');
    row.append(
      node('td', '', anchor(inv.invoice_no, `#/invoices/${inv.id}`, 'table-link')),
      node('td', '', inv.customer_name || '—'),
      node('td', '', money(inv.total)),
      node('td', '', statusBadge(inv.status))
    );
    return row;
  });
  const invHeader = anchor('Xem tất cả hóa đơn →', '#/invoices', 'button button-quiet small');
  twoCol.append(panel('Hóa đơn gần đây', table(['Số HĐ', 'Khách hàng', 'Tổng tiền', 'Trạng thái'], invRows), '', invHeader));

  // Staff Quick Actions
  const staffActions = node('div', 'stack');
  staffActions.append(
    node('p', 'muted', 'Thao tác tác nghiệp thường xuyên:'),
    anchor('+ Lập Hóa đơn mới', '#/invoices/new', 'button button-primary'),
    anchor('+ Thêm Khách hàng mới', '#/customers/new', 'button button-secondary'),
    anchor('Ghi nhận Thanh toán', '#/payments', 'button button-secondary'),
    anchor('Tạo Thuê bao định kỳ mới', '#/recurring/new', 'button button-secondary'),
    anchor('Biên bản điều chỉnh hóa đơn', '#/adjustments', 'button button-secondary'),
    anchor('Đối soát giao dịch ngân hàng', '#/reconciliation', 'button button-secondary')
  );
  twoCol.append(panel('Thao tác Vận hành', staffActions));
  content.append(twoCol);
}


// ---------------- CUSTOMERS ----------------
async function renderCustomers(content) {
  const editMatch = location.hash.match(/^#\/customers\/(\d+)\/edit$/);
  const detailMatch = location.hash.match(/^#\/customers\/(\d+)$/);
  if (location.hash === '#/customers/new' || editMatch) {
    await renderCustomerForm(content, editMatch?.[1]);
    return;
  }
  if (detailMatch) {
    await renderCustomerDetail(content, detailMatch[1]);
    return;
  }

  const query = parseUrlQuery();
  const page = Math.max(1, Number(query.get('page') || 1));
  const pageSize = Number(query.get('page_size') || 20);
  const search = query.get('q') || '';
  const statusFilter = query.get('status') || '';
  const segmentFilter = query.get('segment') || '';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (search) params.set('q', search);
  if (statusFilter) params.set('status', statusFilter);
  if (segmentFilter) params.set('segment', segmentFilter);

  const result = await api(`/customers?${params.toString()}`);
  const heading = pageHeading('Khách hàng', 'Quản lý thông tin đối tác, hạn mức tín dụng và phân khúc khách hàng.', anchor('+ Thêm khách hàng', '#/customers/new', 'button button-primary'));
  content.append(heading);

  const toolbar = renderTableToolbar({
    searchPlaceholder: 'Tìm tên KH, mã KH, MST, email, SĐT...',
    searchValue: search,
    onSearch: (val) => updateUrlQuery({ q: val, page: 1 }),
    filters: [
      {
        label: 'Trạng thái',
        placeholder: 'Tất cả trạng thái',
        value: statusFilter,
        options: [
          { value: 'ACTIVE', label: 'ACTIVE (Bình thường)' },
          { value: 'WARNING', label: 'WARNING (Cảnh báo)' },
          { value: 'LOCKED', label: 'LOCKED (Tạm khóa nợ)' }
        ],
        onChange: (val) => updateUrlQuery({ status: val, page: 1 })
      },
      {
        label: 'Phân khúc',
        placeholder: 'Tất cả phân khúc',
        value: segmentFilter,
        options: [
          { value: 'Enterprise', label: 'Enterprise' },
          { value: 'SME', label: 'SME' },
          { value: 'FDI', label: 'FDI' },
          { value: 'Retail', label: 'Retail' },
          { value: 'VIP', label: 'VIP' }
        ],
        onChange: (val) => updateUrlQuery({ segment: val, page: 1 })
      }
    ],
    onClearFilters: () => updateUrlQuery({ q: '', status: '', segment: '', page: 1 }),
    onExportCsv: () => {
      exportCsvFromServer('customers', { q: search, status: statusFilter, segment: segmentFilter }, `danh_sach_khach_hang_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  });
  content.append(toolbar);

  const rows = result.items.map((customer) => {
    const row = node('tr');
    const name = node('td');
    name.append(anchor(customer.name, `#/customers/${customer.id}`, 'table-link'), node('div', 'table-subtext', customer.email || '—'));
    const phone = node('td', '', customer.phone || '—');
    const tax = node('td', '', customer.tax_code || '—');
    const statusCol = node('td');
    statusCol.append(customerStatusBadge(customer.status, customer.lock_source));
    const credit = node('td', '', money(customer.credit_limit || 0));
    const debt = node('td', '', money(customer.current_debt || 0));
    const available = node('td', '', money(customer.available_credit || 0));

    const actions = node('td');
    const group = node('div', 'actions');
    group.append(anchor('Chi tiết', `#/customers/${customer.id}`));
    group.append(anchor('Sửa', `#/customers/${customer.id}/edit`));
    if (hasPermission('customer.delete')) {
      group.append(actionButton('Xóa', 'button-danger', async () => {
        if (!window.confirm(`Xóa khách hàng ${customer.name}?`)) return;
        try {
          await api(`/customers/${customer.id}`, { method: 'DELETE' });
          setHash('/customers');
        } catch (error) {
          content.prepend(alertBox(error.message, 'error'));
        }
      }));
    }
    actions.append(group);
    row.append(name, phone, tax, statusCol, credit, debt, available, actions);
    return row;
  });

  const customerTable = table(['Khách hàng', 'Điện thoại', 'Mã số thuế', 'Trạng thái & Rủi ro', 'Hạn mức tín dụng', 'Dư nợ hiện tại', 'Khả dụng', 'Thao tác'], rows);
  const pagination = renderPagination({
    page,
    pageSize,
    total: Number(result.total || 0),
    onPageChange: (p) => updateUrlQuery({ page: p }),
    onPageSizeChange: (s) => updateUrlQuery({ page_size: s, page: 1 })
  });

  const panelContainer = panel('Danh sách khách hàng', customerTable);
  panelContainer.append(pagination);
  content.append(panelContainer);
}

async function renderCustomerDetail(content, customerId) {
  const { customer } = await api(`/customers/${customerId}`);
  const profileRes = await api(`/customers/${customerId}/financial-profile`).catch(() => null);
  const profile = profileRes?.profile;
  const recentInvoices = profileRes?.recent_invoices || [];

  const headingActions = node('div', 'actions');
  if (customer.status === 'LOCKED') {
    if (hasPermission('customer.unlock')) {
      const unlockBtn = actionButton('🔓 Mở khóa khách hàng', 'button button-unlock', () => {
        openUnlockModal(customer, async (res) => {
          if (res) {
            pendingFlashMessage = {
              text: 'Mở khóa thành công. Thao tác đã được ghi nhận vào nhật ký kiểm toán.',
              kind: 'success'
            };
          }
          await render();
        });
      });
      unlockBtn.setAttribute('data-testid', 'btn-customer-unlock');
      headingActions.append(unlockBtn);
    } else {
      const notice = node('span', 'small muted', '🔒 Bạn không có quyền mở khóa khách hàng. Yêu cầu quyền: customer.unlock');
      notice.setAttribute('data-testid', 'unlock-permission-notice');
      headingActions.append(notice);
    }
  }

  headingActions.append(
    anchor('Sửa thông tin', `#/customers/${customer.id}/edit`, 'button button-primary'),
    anchor('Quay lại danh sách', '#/customers', 'button button-secondary')
  );

  content.append(pageHeading(
    customer.name,
    `Mã KH: ${customer.code || customer.id} · Phân khúc: ${customer.segment || 'SME'}`,
    headingActions
  ));

  if (pendingFlashMessage) {
    const flashAlert = alertBox(pendingFlashMessage.text, pendingFlashMessage.kind || 'success');
    flashAlert.setAttribute('data-testid', 'unlock-success-alert');
    content.append(flashAlert);
    pendingFlashMessage = null;
  }

  // Risk status banner
  if (customer.status === 'LOCKED') {
    const lockDesc = customer.lock_source === 'MANUAL'
      ? 'Khóa thủ công (MANUAL)'
      : customer.lock_source === 'AUTO_RISK'
        ? 'Khóa tự động do rủi ro quá hạn (AUTO_RISK)'
        : (customer.lock_source || 'Không xác định');
    const lockAlert = alertBox(
      `⚠️ KHÁCH HÀNG ĐANG BỊ KHÓA CÔNG NỢ (LOCKED)\n` +
      `Nguồn khóa: ${lockDesc} | Thời gian khóa: ${dateText(customer.locked_at)}\n` +
      `Lý do: ${customer.lock_reason || 'Không có lý do khóa được ghi nhận.'}\n` +
      `Chính sách: Khách hàng không thể phát hành hóa đơn mới theo quy trình thông thường cho đến khi được mở khóa.`,
      'error'
    );
    lockAlert.setAttribute('data-testid', 'customer-locked-alert');
    content.append(lockAlert);
  } else if (customer.status === 'WARNING') {
    const warnAlert = alertBox(
      `⚠️ CẢNH BÁO RỦI RO (WARNING): Khách hàng đang có nợ quá hạn hoặc tiếp cận ngưỡng an toàn hạn mức tín dụng. Cần theo dõi công nợ trước khi cấp thêm hạn mức.`,
      'warning'
    );
    warnAlert.setAttribute('data-testid', 'customer-warning-alert');
    content.append(warnAlert);
  }

  // Credit Risk Profile Panel
  const creditGrid = node('div', 'summary-grid');
  const creditCards = [
    ['Trạng thái rủi ro', customer.status, customer.status === 'LOCKED' ? 'bad' : customer.status === 'WARNING' ? 'warn' : 'good'],
    ['Hạn mức tín dụng', money(customer.credit_limit || 0), 'info'],
    ['Dư nợ hiện tại', money(customer.current_debt || 0), Number(customer.current_debt || 0) > Number(customer.credit_limit || 0) && Number(customer.credit_limit || 0) > 0 ? 'bad' : 'accent'],
    ['Hạn mức khả dụng', money(customer.available_credit || 0), Number(customer.available_credit || 0) < 0 ? 'bad' : 'good']
  ];
  for (const [label, val, kind] of creditCards) {
    const item = node('section', `summary-item ${kind}`);
    item.append(node('div', 'summary-label', label), node('div', 'summary-value', val));
    creditGrid.append(item);
  }
  content.append(panel('Chỉ số tín dụng & Công nợ', creditGrid));

  // Utilization card
  const util = formatUtilization(customer.credit_limit, customer.current_debt);
  const utilSection = node('div', 'panel');
  const utilTitle = node('div', 'panel-title');
  utilTitle.append(node('h3', '', 'Hạn mức tín dụng & Tỷ lệ sử dụng'));
  const utilBody = node('div', 'stack');
  utilBody.append(
    node('p', 'muted', `Tỷ lệ sử dụng hạn mức tín dụng: ${util.text}`),
    renderCreditUtilizationBar(customer.credit_limit, customer.current_debt)
  );
  if (profile?.lifetime_paid) {
    utilBody.append(node('p', 'small muted', `Tổng doanh số tích lũy đã thanh toán: ${money(profile.lifetime_paid)}`));
  }
  utilSection.append(utilTitle, utilBody);
  content.append(utilSection);

  // Customer General Information
  const infoPairs = [
    ['Tên công ty / Đối tác', customer.name],
    ['Mã khách hàng', customer.code || '—'],
    ['Mã số thuế', customer.tax_code || '—'],
    ['Phân khúc', customer.segment || 'SME'],
    ['Số điện thoại', customer.phone || '—'],
    ['Email liên hệ', customer.email || '—'],
    ['Người liên hệ', customer.contact_person || '—'],
    ['Điều khoản công nợ', customer.payment_term_name || 'Mặc định'],
    ['Địa chỉ kinh doanh', customer.address || '—']
  ];
  const infoGrid = node('div', 'detail-grid');
  for (const [label, val] of infoPairs) {
    const item = node('div', 'detail-item');
    item.append(node('div', 'detail-label', label), node('div', 'detail-value', val));
    infoGrid.append(item);
  }
  content.append(panel('Thông tin định danh khách hàng', infoGrid));

  // Recent invoices table
  if (recentInvoices.length > 0) {
    const invRows = recentInvoices.map((inv) => {
      const row = node('tr');
      row.append(
        node('td', '', anchor(inv.invoice_no || `DRAFT-${inv.id}`, `#/invoices/${inv.id}`, 'table-link')),
        node('td', '', dateText(inv.issue_date)),
        node('td', '', dateText(inv.due_date)),
        node('td', '', money(inv.total)),
        node('td', '', money(inv.remaining || inv.total)),
        node('td')
      );
      row.children[5].append(statusBadge(inv.status));
      return row;
    });
    content.append(panel('Hóa đơn gần nhất', table(['Số hóa đơn', 'Ngày phát hành', 'Hạn thanh toán', 'Tổng tiền', 'Còn nợ', 'Trạng thái'], invRows)));
  }
}

async function renderCustomerForm(content, customerId) {
  const editing = Boolean(customerId);
  const existing = editing ? (await api(`/customers/${customerId}`)).customer : {};
  const termsResult = await api('/payment-terms');
  const termOptions = [{ value: '', label: '-- Mặc định --' }].concat(
    termsResult.items.map(t => ({ value: String(t.id), label: `${t.code} - ${t.name} (${t.net_days} ngày)` }))
  );

  content.append(pageHeading(editing ? 'Sửa khách hàng' : 'Thêm khách hàng', 'Thông tin định danh và chính sách tín dụng.', anchor('Quay lại', '#/customers')));

  if (editing && existing.status) {
    const statusBox = node('div', 'panel');
    const statusHeader = node('div', 'panel-title');
    statusHeader.append(node('h3', '', 'Trạng thái kiểm soát tín dụng & rủi ro'));
    const statusBody = node('div', 'actions');
    statusBody.append(customerStatusBadge(existing.status, existing.lock_source));
    if (existing.status === 'LOCKED') {
      const lockSourceText = existing.lock_source === 'AUTO_RISK'
        ? 'Tự động kiểm soát rủi ro (AUTO_RISK)'
        : existing.lock_source === 'MANUAL'
          ? 'Khóa thủ công (MANUAL)'
          : (existing.lock_source || 'Không xác định');
      statusBody.append(node('span', 'small muted', `· Nguồn khóa: ${lockSourceText}`));
      if (existing.lock_reason && String(existing.lock_reason).trim() !== '') {
        statusBody.append(node('span', 'small muted', `· Lý do: ${existing.lock_reason}`));
      } else {
        statusBody.append(node('span', 'small muted', '· Lý do: Không có lý do khóa được ghi nhận.'));
      }
    }
    statusBox.append(statusHeader, statusBody);
    content.append(statusBox);
  }

  const form = node('form', 'panel stack');
  const grid = node('div', 'form-grid');
  const fields = [
    makeField('Tên khách hàng / Doanh nghiệp', { name: 'name', value: existing.name, required: true, maxLength: 200 }),
    makeField('Mã số thuế', { name: 'tax_code', value: existing.tax_code, maxLength: 32 }),
    makeField('Email liên hệ', { name: 'email', type: 'email', value: existing.email, maxLength: 320 }),
    makeField('Số điện thoại', { name: 'phone', value: existing.phone, maxLength: 40 }),
    makeField('Người liên hệ chính', { name: 'contact_person', value: existing.contact_person, maxLength: 120 }),
    makeField('Phân khúc khách hàng', {
      name: 'segment',
      type: 'select',
      value: existing.segment || 'SME',
      options: [
        { value: 'SME', label: 'Doanh nghiệp vừa và nhỏ (SME)' },
        { value: 'Enterprise', label: 'Doanh nghiệp lớn (Enterprise)' },
        { value: 'Retail', label: 'Bán lẻ (Retail)' },
        { value: 'FDI', label: 'Doanh nghiệp FDI' },
        { value: 'VIP', label: 'Khách hàng VIP' }
      ]
    }),
    makeField('Hạn mức tín dụng tối đa (VND)', { name: 'credit_limit', type: 'number', value: existing.credit_limit || '0', step: '1000' }),
    makeField('Điều khoản thanh toán mặc định', { name: 'payment_term_id', type: 'select', value: existing.payment_term_id ? String(existing.payment_term_id) : '', options: termOptions }),
    makeField('Địa chỉ kinh doanh', { name: 'address', type: 'textarea', value: existing.address })
  ];

  for (const field of fields) grid.append(field.wrapper);
  const message = node('div');
  const actions = node('div', 'form-actions');
  const save = node('button', 'button button-primary', 'Lưu khách hàng');
  save.type = 'submit';
  actions.append(save, anchor('Hủy', '#/customers'));
  form.append(grid, actions, message);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.replaceChildren();
    const body = Object.fromEntries(fields.map(({ control }) => [control.name, control.value || null]));
    try {
      await api(editing ? `/customers/${customerId}` : '/customers', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      setHash('/customers');
    } catch (error) {
      message.append(alertBox(error.message, 'error'));
    }
  });
  content.append(form);
}

// ---------------- PRODUCTS & SERVICES CATALOG ----------------
async function renderProducts(content) {
  const match = location.hash.match(/^#\/products\/(\d+)\/edit$/);
  if (location.hash === '#/products/new' || match) {
    await renderProductForm(content, match?.[1]);
    return;
  }

  const query = parseUrlQuery();
  const page = Math.max(1, Number(query.get('page') || 1));
  const pageSize = Number(query.get('page_size') || 20);
  const search = query.get('q') || '';
  const categoryFilter = query.get('category') || '';
  const statusFilter = query.get('status') || '';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (search) params.set('q', search);
  if (categoryFilter) params.set('category', categoryFilter);
  if (statusFilter) params.set('status', statusFilter);

  const result = await api(`/products?${params.toString()}`);
  content.append(pageHeading('Sản phẩm & Dịch vụ', 'Danh mục sản phẩm, đơn giá tiêu chuẩn và thuế suất GTGT.', anchor('+ Thêm sản phẩm', '#/products/new', 'button button-primary')));

  const toolbar = renderTableToolbar({
    searchPlaceholder: 'Tìm mã SKU, tên sản phẩm, danh mục...',
    searchValue: search,
    onSearch: (val) => updateUrlQuery({ q: val, page: 1 }),
    filters: [
      {
        label: 'Danh mục',
        placeholder: 'Tất cả danh mục',
        value: categoryFilter,
        options: [
          { value: 'General', label: 'General (Chung)' },
          { value: 'Service', label: 'Service (Dịch vụ)' },
          { value: 'Subscription', label: 'Subscription (Thuê bao)' },
          { value: 'Software', label: 'Software (Phần mềm)' },
          { value: 'Hardware', label: 'Hardware (Thiết bị)' }
        ],
        onChange: (val) => updateUrlQuery({ category: val, page: 1 })
      },
      {
        label: 'Trạng thái',
        placeholder: 'Tất cả trạng thái',
        value: statusFilter,
        options: [
          { value: 'ACTIVE', label: 'ACTIVE (Đang kinh doanh)' },
          { value: 'DISCONTINUED', label: 'DISCONTINUED (Ngừng kinh doanh)' }
        ],
        onChange: (val) => updateUrlQuery({ status: val, page: 1 })
      }
    ],
    onClearFilters: () => updateUrlQuery({ q: '', category: '', status: '', page: 1 }),
    onExportCsv: () => {
      exportCsvFromServer('products', { q: search, category: categoryFilter, status: statusFilter }, `danh_sach_san_pham_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  });
  content.append(toolbar);

  const rows = result.items.map((prod) => {
    const row = node('tr');
    row.append(
      node('td', 'code-preview', prod.sku),
      node('td', '', prod.name),
      node('td', '', prod.category || 'Dịch vụ'),
      node('td', '', prod.unit || 'gói'),
      node('td', '', money(prod.unit_price)),
      node('td', '', `${(Number(prod.vat_rate !== undefined ? prod.vat_rate : (prod.tax_rate !== undefined ? prod.tax_rate : 0)) * 100).toFixed(0)}%`),
      node('td')
    );
    const isActive = prod.status ? prod.status === 'ACTIVE' : Boolean(prod.is_active);
    row.children[6].append(statusBadge(isActive ? 'ACTIVE' : 'INACTIVE'));

    const actions = node('td');
    const group = node('div', 'actions');
    group.append(anchor('Sửa', `#/products/${prod.id}/edit`));
    if (currentUser.role === 'admin') {
      group.append(actionButton('Xóa', 'button-danger', async () => {
        if (!window.confirm(`Xóa sản phẩm ${prod.name}?`)) return;
        try {
          await api(`/products/${prod.id}`, { method: 'DELETE' });
          setHash('/products');
        } catch (err) {
          content.prepend(alertBox(err.message, 'error'));
        }
      }));
    }
    actions.append(group);
    row.append(actions);
    return row;
  });

  const productTable = table(['Mã SKU', 'Tên sản phẩm / Dịch vụ', 'Phân loại', 'Đơn vị tính', 'Đơn giá niêm yết', 'Thuế suất', 'Trạng thái', 'Thao tác'], rows);
  const pagination = renderPagination({
    page,
    pageSize,
    total: Number(result.total || 0),
    onPageChange: (p) => updateUrlQuery({ page: p }),
    onPageSizeChange: (s) => updateUrlQuery({ page_size: s, page: 1 })
  });

  const panelContainer = panel('Danh mục sản phẩm & dịch vụ', productTable);
  panelContainer.append(pagination);
  content.append(panelContainer);
}

async function renderProductForm(content, productId) {
  const editing = Boolean(productId);
  const existing = editing ? (await api(`/products/${productId}`)).product : {};
  content.append(pageHeading(editing ? 'Sửa sản phẩm' : 'Thêm sản phẩm mới', 'Mã SKU là duy nhất trong toàn hệ thống.', anchor('Quay lại', '#/products')));

  const form = node('form', 'panel stack');
  const grid = node('div', 'form-grid');
  const fields = [
    makeField('Mã SKU', { name: 'sku', value: existing.sku, required: true, maxLength: 64, placeholder: 'VD: SRV-CLOUD-01' }),
    makeField('Tên sản phẩm / Dịch vụ', { name: 'name', value: existing.name, required: true, maxLength: 200 }),
    makeField('Phân loại danh mục', { name: 'category', value: existing.category || 'Phần mềm & Dịch vụ', maxLength: 100 }),
    makeField('Đơn vị tính', { name: 'unit', value: existing.unit || 'tháng', maxLength: 32 }),
    makeField('Đơn giá niêm yết (VND)', { name: 'unit_price', type: 'number', step: '0.01', value: existing.unit_price, required: true }),
    makeField('Thuế suất GTGT', {
      name: 'vat_rate',
      type: 'select',
      value: existing.vat_rate ?? existing.tax_rate ?? '0.10',
      options: [
        { value: '0', label: '0% (Không chịu thuế)' },
        { value: '0.05', label: '5%' },
        { value: '0.08', label: '8% (Nghị định giảm thuế)' },
        { value: '0.10', label: '10% (Tiêu chuẩn)' },
        { value: '0.20', label: '20%' }
      ]
    }),
    makeField('Mô tả chi tiết', { name: 'description', type: 'textarea', value: existing.description })
  ];

  for (const f of fields) grid.append(f.wrapper);
  const message = node('div');
  const actions = node('div', 'form-actions');
  const save = node('button', 'button button-primary', 'Lưu sản phẩm');
  save.type = 'submit';
  actions.append(save, anchor('Hủy', '#/products'));
  form.append(grid, actions, message);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.replaceChildren();
    const body = Object.fromEntries(fields.map(f => [f.control.name, f.control.value || null]));
    if (body.vat_rate !== undefined) body.tax_rate = body.vat_rate;
    try {
      await api(editing ? `/products/${productId}` : '/products', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      setHash('/products');
    } catch (err) {
      message.append(alertBox(err.message, 'error'));
    }
  });
  content.append(form);
}

// ---------------- PAYMENT TERMS ----------------
async function renderPaymentTerms(content) {
  const match = location.hash.match(/^#\/payment-terms\/(\d+)\/edit$/);
  if (location.hash === '#/payment-terms/new' || match) {
    await renderPaymentTermForm(content, match?.[1]);
    return;
  }

  const result = await api('/payment-terms');
  content.append(pageHeading('Điều khoản thanh toán', 'Quy định số ngày công nợ Net days và chiết khấu thanh toán sớm.', anchor('+ Thêm điều khoản', '#/payment-terms/new', 'button button-primary')));

  const rows = result.items.map((term) => {
    const row = node('tr');
    const netDays = term.net_days ?? term.days ?? 0;
    const discDays = term.discount_days ?? term.early_discount_days ?? 0;
    const discPct = term.discount_percent ?? term.early_discount_percent ?? 0;
    row.append(
      node('td', 'code-preview', term.code),
      node('td', '', term.name),
      node('td', '', `${netDays} ngày`),
      node('td', '', `${discDays} ngày`),
      node('td', '', `${Number(discPct)}%`),
      node('td')
    );
    row.children[5].append(term.is_default ? node('span', 'badge badge-paid', 'MẶC ĐỊNH') : node('span', 'badge', '—'));

    const actions = node('td');
    const group = node('div', 'actions');
    group.append(anchor('Sửa', `#/payment-terms/${term.id}/edit`));
    if (currentUser.role === 'admin' && !term.is_default) {
      group.append(actionButton('Xóa', 'button-danger', async () => {
        if (!window.confirm(`Xóa điều khoản ${term.name}?`)) return;
        try {
          await api(`/payment-terms/${term.id}`, { method: 'DELETE' });
          setHash('/payment-terms');
        } catch (err) {
          content.prepend(alertBox(err.message, 'error'));
        }
      }));
    }
    actions.append(group);
    row.append(actions);
    return row;
  });

  content.append(panel('Bảng điều khoản thanh toán', table(['Mã', 'Tên điều khoản', 'Hạn thanh toán (Net)', 'Hạn chiết khấu', 'Tỷ lệ chiết khấu', 'Mặc định', 'Thao tác'], rows)));
}

async function renderPaymentTermForm(content, termId) {
  const editing = Boolean(termId);
  const existing = editing ? (await api(`/payment-terms/${termId}`)).payment_term : {};
  content.append(pageHeading(editing ? 'Sửa điều khoản thanh toán' : 'Thêm điều khoản thanh toán', 'Cấu hình số ngày công nợ để tự động tính Due Date.', anchor('Quay lại', '#/payment-terms')));

  const form = node('form', 'panel stack');
  const grid = node('div', 'form-grid');
  const fields = [
    makeField('Mã điều khoản', { name: 'code', value: existing.code, required: true, maxLength: 32, placeholder: 'VD: NET30, COD' }),
    makeField('Tên điều khoản', { name: 'name', value: existing.name, required: true, maxLength: 100 }),
    makeField('Số ngày thanh toán (Net days)', { name: 'net_days', type: 'number', value: existing.net_days ?? existing.days ?? 30, required: true }),
    makeField('Số ngày hưởng chiết khấu', { name: 'discount_days', type: 'number', value: existing.discount_days ?? existing.early_discount_days ?? 0 }),
    makeField('Tỷ lệ chiết khấu (%)', { name: 'discount_percent', type: 'number', step: '0.01', value: existing.discount_percent ?? existing.early_discount_percent ?? 0 }),
    makeField('Mô tả', { name: 'description', type: 'textarea', value: existing.description })
  ];

  for (const f of fields) grid.append(f.wrapper);
  const message = node('div');
  const actions = node('div', 'form-actions');
  const save = node('button', 'button button-primary', 'Lưu điều khoản');
  save.type = 'submit';
  actions.append(save, anchor('Hủy', '#/payment-terms'));
  form.append(grid, actions, message);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.replaceChildren();
    const body = Object.fromEntries(fields.map(f => [f.control.name, f.control.value || null]));
    body.days = body.net_days;
    body.early_discount_days = body.discount_days;
    body.early_discount_percent = body.discount_percent;
    try {
      await api(editing ? `/payment-terms/${termId}` : '/payment-terms', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      setHash('/payment-terms');
    } catch (err) {
      message.append(alertBox(err.message, 'error'));
    }
  });
  content.append(form);
}

// ---------------- INVOICES ----------------
async function renderInvoices(content) {
  const edit = location.hash.match(/^#\/invoices\/(\d+)\/edit$/);
  const detail = location.hash.match(/^#\/invoices\/(\d+)(?:\/(?:payment|cancel))?$/);
  const print = location.hash.match(/^#\/invoices\/(\d+)\/print$/);
  if (edit) return renderInvoiceForm(content, edit[1]);
  if (location.hash === '#/invoices/new') return renderInvoiceForm(content);
  if (detail) return renderInvoiceDetail(content, detail[1]);
  if (print) return renderInvoicePrint(content, print[1]);

  const query = parseUrlQuery();
  const page = Math.max(1, Number(query.get('page') || 1));
  const pageSize = Number(query.get('page_size') || 20);
  const statusFilter = query.get('status') || '';
  const search = query.get('q') || '';
  const fromDate = query.get('from') || '';
  const toDate = query.get('to') || '';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (statusFilter) params.set('status', statusFilter);
  if (search) params.set('q', search);
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);

  const result = await api(`/invoices?${params.toString()}`);

  content.append(pageHeading('Hóa đơn điện tử', 'Quản lý hóa đơn bán hàng, mã tra cứu CQT và trạng thái thanh toán.', anchor('+ Tạo hóa đơn mới', '#/invoices/new', 'button button-primary')));

  const invAnalytics = await api('/dashboard/invoices-analytics').catch(() => ({ statuses: [] }));
  if (invAnalytics.statuses?.length > 0) {
    const invStatusMap = {
      PAID: { label: 'PAID (Đã tất toán)', color: '#4F8067' },
      ISSUED: { label: 'ISSUED (Chờ thanh toán)', color: '#587B86' },
      PARTIALLY_PAID: { label: 'PARTIALLY_PAID (Thu một phần)', color: '#71877A' },
      OVERDUE: { label: 'OVERDUE (Quá hạn)', color: '#B6534B' },
      DRAFT: { label: 'DRAFT (Bản nháp)', color: '#C48A3A' },
      CANCELLED: { label: 'CANCELLED (Đã hủy)', color: '#A8A29A' }
    };
    const donutData = invAnalytics.statuses.map(s => ({
      status: s.status,
      label: invStatusMap[s.status]?.label || s.status,
      value: Number(s.count || 0),
      color: invStatusMap[s.status]?.color || '#B86B3D'
    }));
    const chartCard = createChartCard({
      title: 'Cơ cấu trạng thái hóa đơn',
      subtitle: 'Mục đích: Bấm trực tiếp vào từng phần để lọc nhanh danh sách hóa đơn theo trạng thái',
      periodBadge: 'Tổng hợp danh mục'
    });
    chartCard.body.append(renderDonutChart({
      data: donutData,
      totalLabel: 'Hóa đơn',
      onSliceClick: (item) => updateUrlQuery({ status: item.status, page: 1 })
    }));
    content.append(chartCard.card);
  }

  const filterWrap = node('div', 'tabs');
  const filterTabs = [
    ['', 'Tất cả'],
    ['OVERDUE', 'Quá hạn (OVERDUE)'],
    ['ISSUED', 'Đã phát hành'],
    ['PARTIALLY_PAID', 'Thanh toán một phần'],
    ['PAID', 'Đã thanh toán'],
    ['DRAFT', 'Bản nháp']
  ];
  for (const [st, label] of filterTabs) {
    const btn = node('button', `tab-button ${statusFilter === st ? 'active' : ''}`, label);
    btn.addEventListener('click', () => {
      updateUrlQuery({ status: st, page: 1 });
    });
    filterWrap.append(btn);
  }
  content.append(filterWrap);

  const toolbar = renderTableToolbar({
    searchPlaceholder: 'Tìm số HĐ, khách hàng, MST, trạng thái...',
    searchValue: search,
    onSearch: (val) => updateUrlQuery({ q: val, page: 1 }),
    filters: [
      { type: 'date', value: fromDate, placeholder: 'Từ ngày lập', onChange: (val) => updateUrlQuery({ from: val, page: 1 }) },
      { type: 'date', value: toDate, placeholder: 'Đến ngày lập', onChange: (val) => updateUrlQuery({ to: val, page: 1 }) }
    ],
    onClearFilters: () => updateUrlQuery({ q: '', status: '', from: '', to: '', due_from: '', due_to: '', page: 1 }),
    onExportCsv: () => {
      exportCsvFromServer('invoices', {
        q: search,
        status: statusFilter,
        from: fromDate,
        to: toDate,
        due_from: query.get('due_from'),
        due_to: query.get('due_to'),
        customer_id: query.get('customer_id')
      }, `danh_sach_hoa_don_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  });
  content.append(toolbar);

  const rows = result.items.map((invoice) => {
    const row = node('tr');
    const noCell = node('td');
    noCell.append(anchor(invoice.invoice_no || `DRAFT-${invoice.id}`, `#/invoices/${invoice.id}`, 'table-link'));
    const einvCode = invoice.e_invoice_code || invoice.einvoice_code;
    if (einvCode) {
      noCell.append(node('div', 'code-preview small', `Mô phỏng TT78: ${einvCode}`));
    }

    const custCell = node('td');
    custCell.append(node('div', '', invoice.customer_name));
    if (invoice.customer_status === 'LOCKED' || invoice.customer_status === 'WARNING') {
      custCell.append(customerStatusBadge(invoice.customer_status, invoice.customer_lock_source));
    }

    row.append(
      noCell,
      custCell,
      node('td', '', dateText(invoice.issue_date)),
      node('td', '', dateText(invoice.due_date)),
      node('td', '', money(invoice.total)),
      node('td', '', money(invoice.paid_total)),
      node('td')
    );
    row.children[6].append(statusBadge(invoice.status));

    const actions = node('td');
    const group = node('div', 'actions');
    group.append(anchor('Chi tiết', `#/invoices/${invoice.id}`));
    if (invoice.status === 'DRAFT') group.append(anchor('Sửa', `#/invoices/${invoice.id}/edit`));
    actions.append(group);
    row.append(actions);
    return row;
  });

  const invoiceTable = table(['Số HĐ / Mã CQT', 'Khách hàng', 'Ngày lập', 'Hạn thanh toán', 'Tổng cộng', 'Đã thanh toán', 'Trạng thái', 'Thao tác'], rows);
  const pagination = renderPagination({
    page,
    pageSize,
    total: Number(result.total || 0),
    onPageChange: (p) => updateUrlQuery({ page: p }),
    onPageSizeChange: (s) => updateUrlQuery({ page_size: s, page: 1 })
  });

  const panelContainer = panel('Danh sách hóa đơn', invoiceTable);
  panelContainer.append(pagination);
  content.append(panelContainer);
}

async function renderInvoiceForm(content, invoiceId) {
  const editing = Boolean(invoiceId);
  const existing = editing ? (await api(`/invoices/${invoiceId}`)).invoice : null;
  const customers = await api('/customers?limit=100');
  const products = await api('/products?limit=100');
  const terms = await api('/payment-terms');

  content.append(pageHeading(editing ? 'Sửa hóa đơn nháp' : 'Tạo hóa đơn mới', 'Số hóa đơn và mã CQT sẽ được cấp khi phát hành chính thức.', anchor('Quay lại', editing ? `#/invoices/${invoiceId}` : '#/invoices')));

  const form = node('form', 'panel stack');
  const grid = node('div', 'form-grid-3');

  const customerField = makeField('Khách hàng', {
    name: 'customer_id',
    type: 'select',
    required: true,
    options: customers.items.map((c) => ({ value: String(c.id), label: `${c.name} (${c.tax_code || 'Chưa có MST'})` }))
  });
  if (existing) customerField.control.value = String(existing.customer_id);

  const termOptions = [{ value: '', label: '-- Tùy chỉnh --' }].concat(
    terms.items.map(t => ({ value: String(t.id), label: `${t.name} (${t.net_days} ngày)` }))
  );
  const termField = makeField('Điều khoản thanh toán', {
    name: 'payment_term_id',
    type: 'select',
    options: termOptions
  });
  if (existing?.payment_term_id) termField.control.value = String(existing.payment_term_id);

  const dueDate = makeField('Hạn thanh toán (Due Date)', {
    name: 'due_date',
    type: 'date',
    value: existing?.due_date ? dateText(existing.due_date) : '',
    required: true
  });

  // Auto-set due date when term changes
  termField.control.addEventListener('change', () => {
    const selected = terms.items.find(t => String(t.id) === termField.control.value);
    if (selected) {
      const d = new Date();
      d.setDate(d.getDate() + Number(selected.net_days));
      dueDate.control.value = d.toISOString().slice(0, 10);
    }
  });

  const taxRate = makeField('Thuế suất GTGT', {
    name: 'tax_rate',
    type: 'select',
    options: [
      { value: '0', label: '0%' },
      { value: '0.05', label: '5%' },
      { value: '0.08', label: '8%' },
      { value: '0.10', label: '10%' },
      { value: '0.20', label: '20%' }
    ]
  });
  taxRate.control.value = existing?.tax_rate || '0.10';

  grid.append(customerField.wrapper, termField.wrapper, dueDate.wrapper, taxRate.wrapper);

  // Line items
  const itemPanel = node('section', 'stack');
  const itemTitle = node('div', 'panel-title');
  itemTitle.append(node('h3', '', 'Danh mục dòng hàng hóa / dịch vụ'));
  const itemRows = node('div', 'item-list');

  const initialItems = existing?.items?.length ? existing.items : [{ sku: '', description: '', unit: '', quantity: '1', unit_price: '', discount_percent: '0' }];

  const addItem = (item = {}) => {
    const row = node('div', 'invoice-item');

    // Product picker
    const prodSelect = node('select');
    prodSelect.append(node('option', '', '-- Chọn từ danh mục --'));
    for (const p of products.items) {
      const opt = node('option', '', `[${p.sku}] ${p.name}`);
      opt.value = p.sku;
      prodSelect.append(opt);
    }
    const prodWrap = node('div', 'field');
    prodWrap.append(node('label', '', 'Sản phẩm mẫu'), prodSelect);

    const sku = makeField('Mã SKU', { name: 'sku', value: item.sku || '', placeholder: 'SKU...' });
    const description = makeField('Mô tả / Tên hàng', { name: 'description', value: item.description, required: true, maxLength: 500 });
    const unit = makeField('ĐVT', { name: 'unit', value: item.unit || 'gói', placeholder: 'gói, tháng...' });
    const quantity = makeField('Số lượng', { name: 'quantity', type: 'text', value: item.quantity || '1', required: true });
    quantity.control.inputMode = 'decimal';
    const unitPrice = makeField('Đơn giá (VND)', { name: 'unit_price', type: 'text', value: item.unit_price, required: true });
    unitPrice.control.inputMode = 'decimal';
    const discount = makeField('Chiết khấu (%)', { name: 'discount_percent', type: 'text', value: item.discount_percent || '0' });
    discount.control.inputMode = 'decimal';

    prodSelect.addEventListener('change', () => {
      const matchProd = products.items.find(p => p.sku === prodSelect.value);
      if (matchProd) {
        sku.control.value = matchProd.sku;
        description.control.value = matchProd.name;
        unit.control.value = matchProd.unit || 'gói';
        unitPrice.control.value = matchProd.unit_price;
      }
    });

    const remove = actionButton('Xóa dòng', 'button-quiet remove-item', () => row.remove());
    row.append(prodWrap, description.wrapper, unit.wrapper, quantity.wrapper, unitPrice.wrapper, discount.wrapper, remove);
    itemRows.append(row);
  };

  for (const item of initialItems) addItem(item);
  itemTitle.append(actionButton('+ Thêm dòng hàng', 'button-secondary', () => addItem()));
  itemPanel.append(itemTitle, itemRows);

  const message = node('div');
  const actions = node('div', 'form-actions');
  const save = node('button', 'button button-primary', 'Lưu hóa đơn nháp');
  save.type = 'submit';
  actions.append(save, anchor('Hủy bỏ', editing ? `#/invoices/${invoiceId}` : '#/invoices'));
  form.append(grid, itemPanel, actions, message);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.replaceChildren();
    const items = Array.from(itemRows.querySelectorAll('.invoice-item')).map((row) => ({
      sku: row.querySelector('[name="sku"]')?.value || null,
      description: row.querySelector('[name="description"]').value,
      unit: row.querySelector('[name="unit"]')?.value || 'gói',
      quantity: row.querySelector('[name="quantity"]').value,
      unit_price: row.querySelector('[name="unit_price"]').value,
      discount_percent: row.querySelector('[name="discount_percent"]')?.value || '0'
    }));

    const body = {
      customer_id: customerField.control.value,
      payment_term_id: termField.control.value || null,
      due_date: dueDate.control.value || null,
      tax_rate: taxRate.control.value,
      items
    };

    try {
      const response = await api(editing ? `/invoices/${invoiceId}` : '/invoices', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      setHash(`/invoices/${response.invoice.id}`);
    } catch (error) {
      message.append(alertBox(error.message, 'error'));
    }
  });

  content.append(form);
}

async function renderInvoiceDetail(content, invoiceId) {
  const { invoice } = await api(`/invoices/${invoiceId}`);
  const custRes = invoice.customer_id
    ? await api(`/customers/${invoice.customer_id}`).catch(() => null)
    : null;
  const customer = custRes?.customer;
  const adjustResult = await api(`/adjustments?invoice_id=${invoiceId}`).catch(() => ({ items: [] }));
  const unappliedBalance = invoice.customer_id
    ? await api(`/customers/${invoice.customer_id}/unapplied-balance`).catch(() => null)
    : null;
  const einvCode = invoice.e_invoice_code || invoice.einvoice_code;

  content.append(pageHeading(
    invoice.invoice_no || `Bản nháp DRAFT-${invoice.id}`,
    `Khách hàng: ${invoice.customer_name} ${einvCode ? `· Mã mô phỏng nội bộ: ${einvCode}` : ''}`,
    anchor('In hóa đơn', `#/invoices/${invoice.id}/print`)
  ));

  // Risk status banner on invoice
  if (customer?.status === 'LOCKED') {
    const lockSourceDesc = customer.lock_source === 'MANUAL'
      ? 'Khóa thủ công (MANUAL)'
      : customer.lock_source === 'AUTO_RISK'
        ? 'Khóa tự động do rủi ro quá hạn (AUTO_RISK)'
        : (customer.lock_source || 'Không xác định');
    const lockAlert = alertBox(
      `⚠️ KHÁCH HÀNG ĐANG BỊ KHÓA CÔNG NỢ (LOCKED)\n` +
      `Nguồn khóa: ${lockSourceDesc} · Thời điểm khóa: ${dateText(customer.locked_at)}\n` +
      `Lý do: ${customer.lock_reason || 'Không có ghi chú'}\n` +
      `Lưu ý: Phát hành hóa đơn theo quy trình thông thường sẽ bị hệ thống từ chối. Cần quyền Quản lý (invoice.issue_override) để phát hành đặc cách.`,
      'error'
    );
    lockAlert.setAttribute('data-testid', 'invoice-customer-locked-alert');
    content.append(lockAlert);
  } else if (customer?.status === 'WARNING') {
    const warnAlert = alertBox(
      `⚠️ CẢNH BÁO RỦI RO (WARNING): Khách hàng đang có cảnh báo rủi ro tín dụng. Cần kiểm tra công nợ trước khi phát hành.`,
      'warning'
    );
    warnAlert.setAttribute('data-testid', 'invoice-customer-warning-alert');
    content.append(warnAlert);
  }

  const detailPairs = [
    ['Trạng thái', invoice.status],
    ['Mã mô phỏng nội bộ TT78', einvCode || 'Chưa cấp'],
    ['Ngày lập', dateText(invoice.issue_date)],
    ['Hạn thanh toán', dateText(invoice.due_date)],
    ['Tiền hàng chưa thuế', money(invoice.subtotal)],
    ['Thuế GTGT', money(invoice.tax_amount)],
    ['Tổng thanh toán', money(invoice.total)],
    ['Đã thanh toán', money(invoice.paid_total)],
    ['Còn nợ', money(invoice.outstanding)]
  ];
  if (customer) {
    detailPairs.push(
      ['Trạng thái khách hàng', customer.status],
      ['Hạn mức tín dụng KH', money(customer.credit_limit || 0)],
      ['Dư nợ hiện tại KH', money(customer.current_debt || 0)],
      ['Hạn mức khả dụng KH', money(customer.available_credit || 0)]
    );
  }
  if (invoice.status === 'OVERDUE' && invoice.due_date) {
    const dueTime = new Date(invoice.due_date).getTime();
    const nowTime = new Date().setHours(0, 0, 0, 0);
    const diffDays = Math.max(0, Math.floor((nowTime - dueTime) / (1000 * 60 * 60 * 24)));
    detailPairs.push(['Số ngày quá hạn', `${diffDays} ngày`]);
  }
  if (unappliedBalance && Number(unappliedBalance.total_unapplied_cash) > 0) {
    detailPairs.push(['Tiền thừa khả dụng của khách', money(unappliedBalance.total_unapplied_cash)]);
  }

  const details = node('div', 'detail-grid');
  for (const [label, value] of detailPairs) {
    const item = node('div', 'detail-item');
    item.append(node('div', 'detail-label', label), node('div', 'detail-value', value));
    details.append(item);
  }
  content.append(panel('Thông tin chung hóa đơn', details));

  const itemRows = invoice.items.map((item) => {
    const row = node('tr');
    row.append(
      node('td', 'code-preview', item.sku || '—'),
      node('td', '', item.description),
      node('td', '', item.unit || 'gói'),
      node('td', '', item.quantity),
      node('td', '', money(item.unit_price)),
      node('td', '', `${Number(item.discount_percent || 0)}%`),
      node('td', '', money(item.line_total))
    );
    return row;
  });
  content.append(panel('Dòng hàng chi tiết', table(['Mã SKU', 'Mô tả', 'ĐVT', 'Số lượng', 'Đơn giá', 'Chiết khấu', 'Thành tiền'], itemRows)));

  // Payments table
  const paymentRows = invoice.payments.map((payment) => {
    const row = node('tr');
    row.append(
      node('td', '', dateText(payment.paid_at)),
      node('td', '', payment.method),
      node('td', '', money(payment.amount)),
      node('td', '', payment.reference || '—')
    );
    return row;
  });
  content.append(panel('Lịch sử thanh toán', table(['Ngày thanh toán', 'Phương thức', 'Số tiền', 'Mã giao dịch / Bank Ref'], paymentRows)));

  // Adjustments table (Credit Notes)
  if (adjustResult.items?.length) {
    const adjRows = adjustResult.items.map(adj => {
      const row = node('tr');
      row.append(
        node('td', 'code-preview', adj.adjustment_no),
        node('td', '', adj.type),
        node('td', '', money(adj.amount)),
        node('td', '', adj.reason || '—'),
        node('td')
      );
      row.children[4].append(statusBadge(adj.status));
      return row;
    });
    content.append(panel('Biên bản điều chỉnh / Credit Notes liên kết', table(['Mã biên bản', 'Loại điều chỉnh', 'Số tiền', 'Lý do', 'Trạng thái'], adjRows)));
  }

  const actions = node('div', 'form-actions no-print');
  if (invoice.status === 'DRAFT') {
    actions.append(anchor('Sửa bản nháp', `#/invoices/${invoice.id}/edit`));
    actions.append(actionButton('Phát hành hóa đơn chính thức', 'button-primary', async () => {
      try {
        await api(`/invoices/${invoice.id}/issue`, { method: 'POST', body: JSON.stringify({}) });
        setHash(`/invoices/${invoice.id}`);
      } catch (error) {
        content.prepend(alertBox(error.message, 'error'));
      }
    }));

    if (hasPermission('invoice.issue_override')) {
      const overrideBtn = actionButton('⚡ Phát hành đặc cách (Manager Override)', 'button button-override', () => {
        openOverrideModal(invoice, customer, () => {
          render();
        });
      });
      overrideBtn.setAttribute('data-testid', 'btn-issue-override');
      actions.append(overrideBtn);
    } else if (customer?.status === 'LOCKED') {
      const lockNotice = node('span', 'small muted', '🔒 Yêu cầu quyền Quản lý (invoice.issue_override) để phát hành đặc cách');
      lockNotice.setAttribute('data-testid', 'override-permission-notice');
      actions.append(lockNotice);
    }
  }
  if (['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) {
    actions.append(actionButton('+ Ghi nhận thanh toán', 'button-primary', () => setHash(`#/invoices/${invoice.id}/payment`)));
    if (unappliedBalance && Number(unappliedBalance.total_unapplied_cash) > 0) {
      actions.append(actionButton('⚡ Cấn trừ tự động từ tiền thừa', 'button-success', async () => {
        const confirmMsg = `Xác nhận cấn trừ tự động từ tiền thừa khả dụng (${money(unappliedBalance.total_unapplied_cash)}) cho hóa đơn ${invoice.invoice_no || invoice.id}?`;
        if (!window.confirm(confirmMsg)) return;

        try {
          const idempKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : (`ui-auto-alloc-${Date.now()}-${Math.random().toString(36).slice(2)}`);

          const allocRes = await api(`/invoices/${invoice.id}/auto-allocate`, {
            method: 'POST',
            headers: { 'Idempotency-Key': idempKey },
            body: JSON.stringify({})
          });

          alert(`Cấn trừ thành công ${money(allocRes.allocated_from_unapplied)}! Trạng thái mới: ${allocRes.invoice_status}`);
          render();
        } catch (err) {
          content.prepend(alertBox(err.message, 'error'));
        }
      }));
    }
    actions.append(anchor('+ Tạo biên bản điều chỉnh / C/N', `#/adjustments/new?invoice_id=${invoice.id}`, 'button button-secondary'));
  }
  if (currentUser.role === 'admin' && ['DRAFT', 'ISSUED'].includes(invoice.status) && isZero(invoice.paid_total)) {
    actions.append(actionButton('Hủy hóa đơn', 'button-danger', () => setHash(`#/invoices/${invoice.id}/cancel`)));
  }
  actions.append(actionButton('📄 In bản thể hiện', '', () => setHash(`#/invoices/${invoice.id}/print`)));
  actions.append(actionButton('🖨️ Bản in VAT (NĐ 123)', 'button-secondary', () => window.open(`/api/invoices/${invoice.id}/print`, '_blank')));
  content.append(actions);

  if (location.hash === `#/invoices/${invoice.id}/payment`) await renderPaymentForm(content, invoice);
  if (location.hash === `#/invoices/${invoice.id}/cancel`) await renderCancelForm(content, invoice);
}

async function renderPaymentForm(content, invoice) {
  const form = node('form', 'panel no-print stack');
  form.append(node('h3', '', `Ghi nhận thanh toán · Còn nợ: ${money(invoice.outstanding)}`));
  const amount = makeField('Số tiền thanh toán (VND)', { name: 'amount', type: 'text', value: invoice.outstanding, required: true });
  amount.control.inputMode = 'decimal';
  const method = makeField('Phương thức thanh toán', {
    name: 'method',
    type: 'select',
    options: [
      { value: 'BANK_TRANSFER', label: 'Chuyển khoản ngân hàng (BANK_TRANSFER)' },
      { value: 'CASH', label: 'Tiền mặt (CASH)' },
      { value: 'CARD', label: 'Thẻ tín dụng / Ghi nợ (CARD)' }
    ]
  });
  const paidAt = makeField('Ngày thanh toán', { name: 'paid_at', type: 'date', value: new Date().toISOString().slice(0, 10), required: true });
  const reference = makeField('Mã tham chiếu / Số FT ngân hàng', { name: 'reference', maxLength: 120, placeholder: 'VD: FT2609012389' });

  const grid = node('div', 'form-grid');
  grid.append(amount.wrapper, method.wrapper, paidAt.wrapper, reference.wrapper);
  const message = node('div');
  const submit = node('button', 'button button-primary', 'Xác nhận thanh toán');
  submit.type = 'submit';
  form.append(grid, submit, message);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const idempKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : (`ui-pay-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await api(`/invoices/${invoice.id}/payments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempKey },
        body: JSON.stringify({
          amount: amount.control.value,
          method: method.control.value,
          paid_at: paidAt.control.value,
          reference: reference.control.value
        })
      });
      setHash(`/invoices/${invoice.id}`);
    } catch (error) {
      message.replaceChildren(alertBox(error.message, 'error'));
    }
  });
  content.append(form);
}

async function renderCancelForm(content, invoice) {
  const form = node('form', 'panel no-print');
  form.append(node('h3', '', `Hủy bỏ hóa đơn ${invoice.invoice_no || invoice.id}`));
  const reason = makeField('Lý do hủy hóa đơn', { name: 'reason', type: 'textarea', required: true, maxLength: 2000, placeholder: 'Nhập biên bản hoặc lý do sai sót...' });
  const message = node('div');
  const submit = node('button', 'button button-danger', 'Xác nhận hủy hóa đơn');
  submit.type = 'submit';
  form.append(reason.wrapper, submit, message);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/invoices/${invoice.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason.control.value }) });
      setHash(`/invoices/${invoice.id}`);
    } catch (error) {
      message.replaceChildren(alertBox(error.message, 'error'));
    }
  });
  content.append(form);
}

async function renderInvoicePrint(content, invoiceId) {
  const { invoice } = await api(`/invoices/${invoiceId}`);
  const settings = await api('/settings').catch(() => ({}));
  const einvCode = invoice.e_invoice_code || invoice.einvoice_code;

  const printActions = node('div', 'inline-actions');
  printActions.append(
    actionButton('In trình duyệt', '', () => window.print()),
    actionButton('🖨️ Mở Bản in VAT Chính thức (Server)', 'button-primary', () => window.open(`/api/invoices/${invoiceId}/print`, '_blank'))
  );
  content.append(pageHeading('Bản thể hiện Hóa đơn Điện tử', invoice.invoice_no || `DRAFT-${invoice.id}`, printActions));

  const sheet = node('section', 'panel');
  sheet.append(
    node('h2', '', settings.company_name || 'CÔNG TY TNHH HỆ THỐNG BILLING VIỆT NAM'),
    node('p', 'small muted', `Mã số thuế: ${settings.tax_code || '0102030405'} · Địa chỉ: ${settings.address || 'Hà Nội, Việt Nam'}`),
    node('hr'),
    node('h3', '', `HÓA ĐƠN GIÁ TRỊ GIA TĂNG (VAT)`),
    node('p', '', `Số hóa đơn: ${invoice.invoice_no || 'DRAFT'} · Ký hiệu: 1C26TBB · Ngày lập: ${dateText(invoice.issue_date)}`),
    node('p', '', `Mã mô phỏng nội bộ TT78 (Simulated Identifier): ${einvCode || 'CHƯA CẤP'}`),
    node('p', '', `Khách hàng: ${invoice.customer_name}`)
  );

  sheet.append(table(['Mã SKU', 'Tên hàng hóa, dịch vụ', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền'], invoice.items.map((item) => {
    const row = node('tr');
    row.append(
      node('td', '', item.sku || '—'),
      node('td', '', item.description),
      node('td', '', item.unit || 'gói'),
      node('td', '', item.quantity),
      node('td', '', money(item.unit_price)),
      node('td', '', money(item.line_total))
    );
    return row;
  })));

  sheet.append(
    node('div', 'detail-grid', ''),
    node('p', 'detail-value', `Cộng tiền hàng: ${money(invoice.subtotal)}`),
    node('p', 'detail-value', `Tiền thuế GTGT: ${money(invoice.tax_amount)}`),
    node('h3', '', `Tổng cộng thanh toán: ${money(invoice.total)}`)
  );
  content.append(sheet);
}

// ---------------- PAYMENTS ----------------
async function renderPayments(content) {
  const query = parseUrlQuery();
  const page = Math.max(1, Number(query.get('page') || 1));
  const pageSize = Number(query.get('page_size') || 20);
  const search = query.get('q') || '';
  const methodFilter = query.get('method') || '';
  const fromDate = query.get('from') || '';
  const toDate = query.get('to') || '';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (search) params.set('q', search);
  if (methodFilter) params.set('method', methodFilter);
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);

  const result = await api(`/payments?${params.toString()}`);
  content.append(pageHeading('Lịch sử thanh toán & Phân bổ tiền (Payment Allocation V2)', 'Theo dõi mọi dòng tiền thu vào, quản lý phân bổ đa hóa đơn và tiền chưa phân bổ (Unapplied Cash).'));

  const payAnalytics = await api('/dashboard/payments-analytics').catch(() => ({ methods: [] }));
  if (payAnalytics.methods?.length > 0) {
    const methodColors = { BANK_TRANSFER: '#587B86', CASH: '#4F8067', CARD: '#D5A94F' };
    const methodLabels = { BANK_TRANSFER: 'Chuyển khoản (Bank Transfer)', CASH: 'Tiền mặt (Cash)', CARD: 'Thẻ / POS (Card)' };
    const mData = payAnalytics.methods.map(m => ({
      method: m.method,
      label: methodLabels[m.method] || m.method,
      value: Number(m.count || 0),
      color: methodColors[m.method] || '#B86B3D'
    }));
    const chartCard = createChartCard({
      title: 'Cơ cấu phương thức thanh toán',
      subtitle: 'Mục đích: Bấm vào phương thức để lọc nhanh danh sách giao dịch thu tiền',
      periodBadge: 'Tổng hợp'
    });
    chartCard.body.append(renderDonutChart({
      data: mData,
      totalLabel: 'Giao dịch',
      onSliceClick: (item) => updateUrlQuery({ method: item.method, page: 1 })
    }));
    content.append(chartCard.card);
  }

  const toolbar = renderTableToolbar({
    searchPlaceholder: 'Tìm số HĐ, khách hàng, tham chiếu, ngân hàng...',
    searchValue: search,
    onSearch: (val) => updateUrlQuery({ q: val, page: 1 }),
    filters: [
      {
        label: 'Phương thức',
        placeholder: 'Tất cả phương thức',
        value: methodFilter,
        options: [
          { value: 'BANK_TRANSFER', label: 'BANK_TRANSFER (Chuyển khoản)' },
          { value: 'CASH', label: 'CASH (Tiền mặt)' },
          { value: 'CARD', label: 'CARD (Thẻ tín dụng / POS)' }
        ],
        onChange: (val) => updateUrlQuery({ method: val, page: 1 })
      },
      { type: 'date', value: fromDate, placeholder: 'Từ ngày', onChange: (val) => updateUrlQuery({ from: val, page: 1 }) },
      { type: 'date', value: toDate, placeholder: 'Đến ngày', onChange: (val) => updateUrlQuery({ to: val, page: 1 }) }
    ],
    onClearFilters: () => updateUrlQuery({ q: '', method: '', from: '', to: '', page: 1 }),
    onExportCsv: () => {
      exportCsvFromServer('payments', {
        q: search,
        method: methodFilter,
        from: fromDate,
        to: toDate,
        customer_id: query.get('customer_id'),
        invoice_id: query.get('invoice_id')
      }, `danh_sach_thanh_toan_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  });
  content.append(toolbar);

  const rows = result.items.map((payment) => {
    const row = node('tr');
    const unappliedNum = Number(payment.unapplied_amount || 0);
    const unappliedBadge = unappliedNum > 0
      ? node('span', 'badge badge-warning', money(payment.unapplied_amount))
      : node('span', 'text-muted', '0 ₫');

    row.append(
      node('td', '', dateText(payment.paid_at)),
      node('td', '', payment.customer_name || 'Khách vãng lai'),
      node('td', '', payment.method),
      node('td', 'text-bold', money(payment.amount)),
      node('td', 'text-success', money(payment.allocated_amount || payment.amount)),
      node('td', '', unappliedBadge),
      node('td', '', payment.bank_name ? `${payment.bank_name} (${payment.bank_account || ''})` : '—'),
      node('td', 'code-preview', payment.reference || '—')
    );
    return row;
  });

  const paymentTable = table(['Ngày thanh toán', 'Khách hàng', 'Phương thức', 'Tổng tiền thu', 'Đã phân bổ', 'Chưa phân bổ (Unapplied)', 'Ngân hàng', 'Mã tham chiếu'], rows);
  const pagination = renderPagination({
    page,
    pageSize,
    total: Number(result.total || 0),
    onPageChange: (p) => updateUrlQuery({ page: p }),
    onPageSizeChange: (s) => updateUrlQuery({ page_size: s, page: 1 })
  });

  const panelContainer = panel('Khoản thanh toán ghi nhận', paymentTable);
  panelContainer.append(pagination);
  content.append(panelContainer);
}

// ---------------- ADJUSTMENTS & CREDIT NOTES ----------------
async function renderAdjustments(content) {
  if (location.hash.startsWith('#/adjustments/new')) {
    await renderAdjustmentForm(content);
    return;
  }

  const query = parseUrlQuery();
  const page = Math.max(1, Number(query.get('page') || 1));
  const pageSize = Number(query.get('page_size') || 20);
  const statusFilter = query.get('status') || '';
  const typeFilter = query.get('type') || '';
  const search = query.get('q') || '';
  const fromDate = query.get('from') || '';
  const toDate = query.get('to') || '';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (statusFilter) params.set('status', statusFilter);
  if (typeFilter) params.set('type', typeFilter);
  if (search) params.set('q', search);
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);

  const result = await api(`/adjustments?${params.toString()}`);
  content.append(pageHeading('Biên bản điều chỉnh & Credit Notes', 'Quản lý điều chỉnh sai sót, giảm giá và hủy hóa đơn theo Thông tư 78.', anchor('+ Lập biên bản mới', '#/adjustments/new', 'button button-primary')));

  const filterWrap = node('div', 'tabs');
  const filterTabs = [
    ['', 'Tất cả trạng thái'],
    ['DRAFT', 'Chờ duyệt (DRAFT)'],
    ['APPROVED', 'Đã duyệt (APPROVED)'],
    ['PROCESSED', 'Đã xử lý (PROCESSED)']
  ];
  for (const [st, label] of filterTabs) {
    const btn = node('button', `tab-button ${statusFilter === st ? 'active' : ''}`, label);
    btn.addEventListener('click', () => {
      updateUrlQuery({ status: st, page: 1 });
    });
    filterWrap.append(btn);
  }
  content.append(filterWrap);

  const toolbar = renderTableToolbar({
    searchPlaceholder: 'Tìm mã biên bản, số HĐ, lý do, loại...',
    searchValue: search,
    onSearch: (val) => updateUrlQuery({ q: val, page: 1 }),
    filters: [
      {
        type: 'select',
        value: typeFilter,
        options: [
          { value: '', label: 'Tất cả loại nghiệp vụ' },
          { value: 'DISCOUNT', label: 'Chiết khấu thương mại (DISCOUNT)' },
          { value: 'DECREASE_AMOUNT', label: 'Điều chỉnh giảm giá trị (DECREASE_AMOUNT)' },
          { value: 'SERVICE_RETURN', label: 'Trả lại hàng/dịch vụ (SERVICE_RETURN)' },
          { value: 'INFO_CORRECTION', label: 'Điều chỉnh thông tin (INFO_CORRECTION)' }
        ],
        onChange: (val) => updateUrlQuery({ type: val, page: 1 })
      },
      { type: 'date', value: fromDate, placeholder: 'Từ ngày', onChange: (val) => updateUrlQuery({ from: val, page: 1 }) },
      { type: 'date', value: toDate, placeholder: 'Đến ngày', onChange: (val) => updateUrlQuery({ to: val, page: 1 }) }
    ],
    onClearFilters: () => updateUrlQuery({ q: '', status: '', type: '', from: '', to: '', page: 1 }),
    onExportCsv: () => {
      exportCsvFromServer('adjustments', {
        q: search,
        status: statusFilter,
        type: typeFilter,
        from: fromDate,
        to: toDate,
        invoice_id: query.get('invoice_id')
      }, `bien_ban_dieu_chinh_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  });
  content.append(toolbar);

  const rows = (result.items || []).map((adj) => {
    const row = node('tr');
    row.append(
      node('td', 'code-preview', adj.credit_note_no || adj.adjustment_no || `ADJ-${adj.id}`),
      node('td', '', adj.original_invoice_no || adj.target_invoice_no || `#${adj.original_invoice_id || adj.invoice_id}`),
      node('td', '', adj.adjustment_type || adj.type),
      node('td', '', money(adj.total_amount || adj.amount)),
      node('td', '', adj.reason),
      node('td')
    );
    row.children[5].append(statusBadge(adj.status));

    const actions = node('td');
    const group = node('div', 'actions');
    if (adj.status === 'DRAFT') {
      group.append(actionButton('Phê duyệt', 'button-success', async () => {
        try {
          await api(`/adjustments/${adj.id}/approve`, { method: 'POST', body: JSON.stringify({}) });
          render();
        } catch (err) {
          content.prepend(alertBox(err.message, 'error'));
        }
      }));
    }
    if (adj.status === 'APPROVED') {
      group.append(actionButton('Xử lý / Trừ nợ', 'button-primary', async () => {
        try {
          await api(`/adjustments/${adj.id}/process`, { method: 'POST', body: JSON.stringify({}) });
          render();
        } catch (err) {
          content.prepend(alertBox(err.message, 'error'));
        }
      }));
    }
    actions.append(group);
    row.append(actions);
    return row;
  });

  const adjTable = table(['Mã biên bản', 'Hóa đơn gốc', 'Loại nghiệp vụ', 'Số tiền điều chỉnh', 'Lý do', 'Trạng thái', 'Thao tác'], rows);
  const pagination = renderPagination({
    page,
    pageSize,
    total: Number(result.total || 0),
    onPageChange: (p) => updateUrlQuery({ page: p }),
    onPageSizeChange: (s) => updateUrlQuery({ page_size: s, page: 1 })
  });

  const panelContainer = panel('Danh sách biên bản điều chỉnh', adjTable);
  panelContainer.append(pagination);
  content.append(panelContainer);
}

async function renderAdjustmentForm(content) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const invoiceIdParam = query.get('invoice_id') || '';

  const invoices = await api('/invoices?limit=100');
  const validInvoices = invoices.items.filter(inv => ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'].includes(inv.status));

  content.append(pageHeading('Lập biên bản điều chỉnh / Credit Note', 'Điều chỉnh giảm doanh thu, chiết khấu hoặc sai sót hóa đơn.', anchor('Quay lại', '#/adjustments')));

  const form = node('form', 'panel stack');
  const grid = node('div', 'form-grid');

  const invField = makeField('Hóa đơn cần điều chỉnh', {
    name: 'invoice_id',
    type: 'select',
    required: true,
    options: validInvoices.map(i => ({ value: String(i.id), label: `${i.invoice_no || i.id} - ${i.customer_name} (${money(i.total)})` }))
  });
  if (invoiceIdParam) invField.control.value = invoiceIdParam;

  const typeField = makeField('Loại điều chỉnh', {
    name: 'adjustment_type',
    type: 'select',
    options: [
      { value: 'DISCOUNT', label: 'Chiết khấu thương mại (DISCOUNT)' },
      { value: 'DECREASE_AMOUNT', label: 'Điều chỉnh giảm giá trị hóa đơn (DECREASE_AMOUNT)' },
      { value: 'SERVICE_RETURN', label: 'Trả lại hàng hóa / dịch vụ (SERVICE_RETURN)' },
      { value: 'INFO_CORRECTION', label: 'Điều chỉnh thông tin sai sót (INFO_CORRECTION)' }
    ]
  });

  const amountField = makeField('Số tiền điều chỉnh (VND)', { name: 'amount', type: 'number', step: '0.01', required: true });
  const reasonField = makeField('Lý do lập biên bản', { name: 'reason', type: 'textarea', required: true, maxLength: 500, placeholder: 'Chi tiết thỏa thuận hai bên hoặc nguyên nhân...' });

  grid.append(invField.wrapper, typeField.wrapper, amountField.wrapper, reasonField.wrapper);

  const message = node('div');
  const actions = node('div', 'form-actions');
  const save = node('button', 'button button-primary', 'Lưu biên bản nháp');
  save.type = 'submit';
  actions.append(save, anchor('Hủy', '#/adjustments'));
  form.append(grid, actions, message);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.replaceChildren();
    try {
      await api('/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          original_invoice_id: invField.control.value,
          invoice_id: invField.control.value,
          adjustment_type: typeField.control.value,
          type: typeField.control.value,
          amount: amountField.control.value,
          reason: reasonField.control.value
        })
      });
      setHash('/adjustments');
    } catch (err) {
      message.append(alertBox(err.message, 'error'));
    }
  });

  content.append(form);
}

// ---------------- RECURRING SUBSCRIPTION PLANS ----------------
async function renderRecurring(content) {
  if (location.hash === '#/recurring/new') {
    await renderRecurringForm(content);
    return;
  }

  const query = parseUrlQuery();
  const page = Math.max(1, Number(query.get('page') || 1));
  const pageSize = Number(query.get('page_size') || 20);
  const statusFilter = query.get('status') || '';
  const freqFilter = query.get('frequency') || '';
  const search = query.get('q') || '';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (statusFilter) params.set('status', statusFilter);
  if (freqFilter) params.set('frequency', freqFilter);
  if (search) params.set('q', search);

  const result = await api(`/recurring?${params.toString()}`);
  content.append(pageHeading('Thuê bao & Hóa đơn định kỳ', 'Tự động phát hành hóa đơn theo chu kỳ hàng tháng, quý hoặc năm.', anchor('+ Thêm gói thuê bao', '#/recurring/new', 'button button-primary')));

  const filterWrap = node('div', 'tabs');
  const filterTabs = [
    ['', 'Tất cả trạng thái'],
    ['ACTIVE', 'Đang hoạt động (ACTIVE)'],
    ['PAUSED', 'Tạm dừng (PAUSED)']
  ];
  for (const [st, label] of filterTabs) {
    const btn = node('button', `tab-button ${statusFilter === st ? 'active' : ''}`, label);
    btn.addEventListener('click', () => {
      updateUrlQuery({ status: st, page: 1 });
    });
    filterWrap.append(btn);
  }
  content.append(filterWrap);

  const toolbar = renderTableToolbar({
    searchPlaceholder: 'Tìm mã thuê bao, khách hàng, dịch vụ...',
    searchValue: search,
    onSearch: (val) => updateUrlQuery({ q: val, page: 1 }),
    filters: [
      {
        type: 'select',
        value: freqFilter,
        options: [
          { value: '', label: 'Tất cả chu kỳ' },
          { value: 'MONTHLY', label: 'Hàng tháng (Monthly)' },
          { value: 'QUARTERLY', label: 'Hàng quý (Quarterly)' },
          { value: 'YEARLY', label: 'Hàng năm (Yearly)' }
        ],
        onChange: (val) => updateUrlQuery({ frequency: val, page: 1 })
      }
    ],
    onClearFilters: () => updateUrlQuery({ q: '', status: '', frequency: '', page: 1 }),
    onExportCsv: () => {
      exportCsvFromServer('recurring', {
        q: search,
        status: statusFilter,
        frequency: freqFilter
      }, `thue_bao_dinh_ky_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  });
  content.append(toolbar);

  const rows = (result.items || []).map((plan) => {
    const row = node('tr');
    row.append(
      node('td', 'code-preview', plan.code || plan.plan_no),
      node('td', '', plan.customer_name),
      node('td', '', plan.frequency || plan.billing_cycle),
      node('td', '', money(plan.amount_per_period || plan.amount)),
      node('td', '', dateText(plan.next_run_date || plan.next_billing_date)),
      node('td', '', `${plan.completed_cycles || plan.invoices_generated || 0} HĐ`),
      node('td')
    );
    row.children[6].append(statusBadge(plan.status));

    const actions = node('td');
    const group = node('div', 'actions');
    if (plan.status === 'ACTIVE') {
      group.append(actionButton('Chạy ngay chu kỳ', 'button-primary', async () => {
        try {
          const res = await api(`/recurring/${plan.id}/trigger`, { method: 'POST', body: JSON.stringify({}) });
          alert(`Đã sinh thành công hóa đơn DRAFT-${res.invoice.id}!`);
          setHash('/invoices');
        } catch (err) {
          content.prepend(alertBox(err.message, 'error'));
        }
      }));
      group.append(actionButton('Tạm dừng', 'button-quiet', async () => {
        try {
          await api(`/recurring/${plan.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'PAUSED' }) });
          render();
        } catch (err) {
          content.prepend(alertBox(err.message, 'error'));
        }
      }));
    } else if (plan.status === 'PAUSED') {
      group.append(actionButton('Tiếp tục', 'button-success', async () => {
        try {
          await api(`/recurring/${plan.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'ACTIVE' }) });
          render();
        } catch (err) {
          content.prepend(alertBox(err.message, 'error'));
        }
      }));
    }
    actions.append(group);
    row.append(actions);
    return row;
  });

  const recurringTable = table(['Mã thuê bao', 'Khách hàng', 'Chu kỳ lặp', 'Số tiền mỗi kỳ', 'Kỳ tiếp theo', 'Đã sinh', 'Trạng thái', 'Thao tác'], rows);
  const pagination = renderPagination({
    page,
    pageSize,
    total: Number(result.total || 0),
    onPageChange: (p) => updateUrlQuery({ page: p }),
    onPageSizeChange: (s) => updateUrlQuery({ page_size: s, page: 1 })
  });

  const panelContainer = panel('Danh sách kế hoạch thanh toán định kỳ', recurringTable);
  panelContainer.append(pagination);
  content.append(panelContainer);
}

async function renderRecurringForm(content) {
  const customers = await api('/customers?limit=100');
  content.append(pageHeading('Tạo hợp đồng thuê bao mới', 'Hóa đơn sẽ tự động phát sinh đúng ngày thanh toán định kỳ.', anchor('Quay lại', '#/recurring')));

  const form = node('form', 'panel stack');
  const grid = node('div', 'form-grid');

  const custField = makeField('Khách hàng', {
    name: 'customer_id',
    type: 'select',
    required: true,
    options: customers.items.map(c => ({ value: String(c.id), label: c.name }))
  });

  const cycleField = makeField('Chu kỳ thanh toán', {
    name: 'billing_cycle',
    type: 'select',
    options: [
      { value: 'MONTHLY', label: 'Hàng tháng (Monthly)' },
      { value: 'QUARTERLY', label: 'Hàng quý (Quarterly)' },
      { value: 'YEARLY', label: 'Hàng năm (Yearly)' }
    ]
  });

  const amountField = makeField('Số tiền mỗi kỳ (VND)', { name: 'amount', type: 'number', step: '0.01', required: true });
  const startField = makeField('Ngày bắt đầu chu kỳ', { name: 'start_date', type: 'date', value: new Date().toISOString().slice(0, 10), required: true });

  const autoSettleWrap = node('div', 'field');
  const autoSettleLabel = node('label', '', ' Cấn trừ tiền thừa tự động (Unapplied Cash)');
  const autoSettleCheck = node('input');
  autoSettleCheck.type = 'checkbox';
  autoSettleCheck.checked = true;
  autoSettleCheck.id = 'field-auto-settle';
  autoSettleLabel.prepend(autoSettleCheck);
  autoSettleWrap.append(autoSettleLabel);

  grid.append(custField.wrapper, cycleField.wrapper, amountField.wrapper, startField.wrapper, autoSettleWrap);

  const message = node('div');
  const actions = node('div', 'form-actions');
  const save = node('button', 'button button-primary', 'Lưu kế hoạch');
  save.type = 'submit';
  actions.append(save, anchor('Hủy', '#/recurring'));
  form.append(grid, actions, message);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.replaceChildren();
    try {
      await api('/recurring', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: custField.control.value,
          billing_cycle: cycleField.control.value,
          amount: amountField.control.value,
          start_date: startField.control.value,
          auto_settle_unapplied: autoSettleCheck.checked
        })
      });
      setHash('/recurring');
    } catch (err) {
      message.append(alertBox(err.message, 'error'));
    }
  });

  content.append(form);
}

// ---------------- RECONCILIATION ----------------
async function renderReconciliation(content) {
  const query = parseUrlQuery();
  const page = Math.max(1, Number(query.get('page') || 1));
  const pageSize = Number(query.get('page_size') || 20);
  const statusFilter = query.get('status') || '';
  const search = query.get('q') || '';
  const fromDate = query.get('from') || '';
  const toDate = query.get('to') || '';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (statusFilter) params.set('status', statusFilter);
  if (search) params.set('q', search);
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);

  const result = await api(`/reconciliation/transactions?${params.toString()}`);
  content.append(pageHeading('Đối soát giao dịch ngân hàng', 'Khớp nối sao kê biến động số dư ngân hàng với hóa đơn thực tế.'));

  const topBar = node('div', 'toolbar');
  const autoMatchBtn = actionButton('Chạy Tự động Đối soát (Auto Match)', 'button-primary', async () => {
    try {
      autoMatchBtn.disabled = true;
      const res = await api('/reconciliation/auto-match', { method: 'POST', body: JSON.stringify({}) });
      alert(`Đã đối soát thành công: ${res.matched_count} giao dịch tự động khớp!`);
      render();
    } catch (err) {
      content.prepend(alertBox(err.message, 'error'));
    } finally {
      autoMatchBtn.disabled = false;
    }
  });
  topBar.append(autoMatchBtn);
  content.append(topBar);

  const reconAnalytics = await api('/dashboard/reconciliation-analytics').catch(() => ({ statuses: [] }));
  if (reconAnalytics.statuses?.length > 0) {
    const reconColors = { MATCHED: '#4F8067', UNMATCHED: '#B6534B', PARTIALLY_MATCHED: '#C48A3A' };
    const reconLabels = { MATCHED: 'Đã khớp (MATCHED)', UNMATCHED: 'Chưa khớp (UNMATCHED)', PARTIALLY_MATCHED: 'Khớp một phần' };
    const rData = reconAnalytics.statuses.map(s => ({
      status: s.status,
      label: reconLabels[s.status] || s.status,
      value: Number(s.count || 0),
      color: reconColors[s.status] || '#71877A'
    }));
    const chartCard = createChartCard({
      title: 'Tỷ lệ đối soát giao dịch sao kê',
      subtitle: 'Mục đích: Bấm vào từng trạng thái để lọc nhanh danh sách giao dịch ngân hàng',
      periodBadge: 'Tổng hợp'
    });
    chartCard.body.append(renderDonutChart({
      data: rData,
      totalLabel: 'Giao dịch',
      onSliceClick: (item) => updateUrlQuery({ status: item.status, page: 1 })
    }));
    content.append(chartCard.card);
  }

  const filterWrap = node('div', 'tabs');
  const filterTabs = [
    ['', 'Tất cả trạng thái'],
    ['MATCHED', 'Đã khớp (MATCHED)'],
    ['UNMATCHED', 'Chưa khớp (UNMATCHED)']
  ];
  for (const [st, label] of filterTabs) {
    const btn = node('button', `tab-button ${statusFilter === st ? 'active' : ''}`, label);
    btn.addEventListener('click', () => {
      updateUrlQuery({ status: st, page: 1 });
    });
    filterWrap.append(btn);
  }
  content.append(filterWrap);

  const toolbar = renderTableToolbar({
    searchPlaceholder: 'Tìm mã GD, nội dung, ngân hàng, hóa đơn...',
    searchValue: search,
    onSearch: (val) => updateUrlQuery({ q: val, page: 1 }),
    filters: [
      { type: 'date', value: fromDate, placeholder: 'Từ ngày GD', onChange: (val) => updateUrlQuery({ from: val, page: 1 }) },
      { type: 'date', value: toDate, placeholder: 'Đến ngày GD', onChange: (val) => updateUrlQuery({ to: val, page: 1 }) }
    ],
    onClearFilters: () => updateUrlQuery({ q: '', status: '', from: '', to: '', page: 1 }),
    onExportCsv: () => {
      exportCsvFromServer('reconciliation', {
        q: search,
        status: statusFilter,
        from: fromDate,
        to: toDate
      }, `doi_soat_ngan_hang_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  });
  content.append(toolbar);

  const rows = (result.items || result.transactions || []).map((tx) => {
    const row = node('tr');
    row.append(
      node('td', '', dateText(tx.tx_date || tx.transaction_date)),
      node('td', '', tx.bank_name ? `${tx.bank_name} (${tx.bank_account})` : (tx.bank_account || 'Ngân hàng')),
      node('td', 'code-preview', tx.reference || tx.reference_code || '—'),
      node('td', '', tx.description),
      node('td', '', money(tx.amount)),
      node('td')
    );
    row.children[5].append(statusBadge(tx.status));

    const actions = node('td');
    const group = node('div', 'actions');
    if (tx.status === 'UNMATCHED') {
      group.append(actionButton('Khớp thủ công', 'button-secondary', async () => {
        const invNo = window.prompt(`Nhập số hóa đơn muốn khớp cho giao dịch ${tx.reference || tx.reference_code}:`);
        if (!invNo) return;
        try {
          const invs = await api('/invoices?limit=100');
          const matchedInv = invs.items.find(i => i.invoice_no === invNo.trim());
          if (!matchedInv) throw new Error('Không tìm thấy hóa đơn có số ' + invNo);
          await api('/reconciliation/manual-match', {
            method: 'POST',
            body: JSON.stringify({ transaction_id: tx.id, invoice_id: matchedInv.id })
          });
          render();
        } catch (err) {
          alert('Lỗi: ' + err.message);
        }
      }));
    }
    actions.append(group);
    row.append(actions);
    return row;
  });

  const txTable = table(['Ngày GD', 'Tài khoản ngân hàng', 'Mã GD (FT)', 'Nội dung chuyển khoản', 'Số tiền', 'Trạng thái khớp', 'Thao tác'], rows);
  const pagination = renderPagination({
    page,
    pageSize,
    total: Number(result.total || 0),
    onPageChange: (p) => updateUrlQuery({ page: p }),
    onPageSizeChange: (s) => updateUrlQuery({ page_size: s, page: 1 })
  });

  const panelContainer = panel('Giao dịch sao kê ngân hàng', txTable);
  panelContainer.append(pagination);
  content.append(panelContainer);
}

// ---------------- FINANCIAL REPORTS ----------------
async function renderReports(content) {
  content.append(pageHeading('Báo cáo & Phân tích tài chính', 'Ma trận tuổi nợ (Aging Matrix), chỉ số DSO, phân tích MRR và bảng kê thuế GTGT.'));

  const tabWrap = node('div', 'tabs');
  const currentTab = location.hash.split('?tab=')[1] || 'aging';

  const tabs = [
    ['aging', 'Ma trận tuổi nợ (Aging Matrix)'],
    ['collection', 'Chỉ số thu hồi (DSO / CEI)'],
    ['revenue', 'Doanh thu & MRR / ARR'],
    ['vat', 'Bảng kê thuế GTGT (Mẫu 01-1)']
  ];

  for (const [id, label] of tabs) {
    const btn = node('button', `tab-button ${currentTab === id ? 'active' : ''}`, label);
    btn.addEventListener('click', () => {
      setHash(`/reports?tab=${id}`);
      render();
    });
    tabWrap.append(btn);
  }
  content.append(tabWrap);

  if (currentTab === 'aging') {
    let data;
    try {
      data = await api('/reports/aging');
    } catch (err) {
      content.append(alertBox('Không thể tải báo cáo tuổi nợ: ' + err.message, 'error'));
      return;
    }

    const query = parseUrlQuery();
    const search = query.get('q') || '';
    const riskFilter = query.get('risk') || '';

    const customerList = data?.matrix || data?.customers || [];
    const summary = data?.summary || {
      total_current: '0',
      total_1_30: '0',
      total_31_60: '0',
      total_61_90: '0',
      total_90_plus: '0',
      total_receivables: '0'
    };

    let filtered = customerList;
    if (search) {
      const qLower = search.toLowerCase();
      filtered = filtered.filter(c => (c.customer_name || '').toLowerCase().includes(qLower) || (c.code || '').toLowerCase().includes(qLower) || (c.tax_code || '').includes(qLower));
    }
    if (riskFilter) {
      filtered = filtered.filter(c => c.risk_level === riskFilter);
    }

    const summarySection = node('div', 'summary-grid');
    summarySection.append(
      node('div', 'summary-item good', node('div', 'summary-label', 'Nợ hiện tại (Trong hạn)'), node('div', 'summary-value', money(summary.total_current || 0))),
      node('div', 'summary-item warn', node('div', 'summary-label', 'Quá hạn 1 - 60 ngày'), node('div', 'summary-value', money(Number(summary.total_1_30 || 0) + Number(summary.total_31_60 || 0)))),
      node('div', 'summary-item accent', node('div', 'summary-label', 'Nợ xấu (> 90 ngày)'), node('div', 'summary-value', money(summary.total_90_plus || 0))),
      node('div', 'summary-item info', node('div', 'summary-label', 'Tổng công nợ'), node('div', 'summary-value', money(summary.total_receivables || 0)))
    );
    content.append(summarySection);

    const agingCard = createChartCard({
      title: 'Biểu đồ phân bổ cơ cấu tuổi nợ (Aging Matrix)',
      subtitle: 'Mục đích: Bấm trực tiếp vào từng nhóm tuổi nợ để lọc danh sách khách hàng theo mức độ rủi ro'
    });
    agingCard.body.append(renderAgingBarChart({
      aging: summary,
      onBucketClick: (key) => {
        const mapped = key === 'current' ? 'LOW' : (key === 'over90' ? 'CRITICAL' : 'WARNING');
        updateUrlQuery({ risk: mapped });
      }
    }));
    content.append(agingCard.card);

    const toolbar = renderTableToolbar({
      searchPlaceholder: 'Tìm khách hàng theo tên, mã, MST...',
      searchValue: search,
      onSearch: (val) => updateUrlQuery({ q: val }),
      filters: [
        {
          type: 'select',
          value: riskFilter,
          options: [
            { value: '', label: 'Tất cả mức độ rủi ro' },
            { value: 'LOW', label: 'Thấp (LOW)' },
            { value: 'WARNING', label: 'Cảnh báo (WARNING)' },
            { value: 'CRITICAL', label: 'Nghiêm trọng (CRITICAL)' }
          ],
          onChange: (val) => updateUrlQuery({ risk: val })
        }
      ],
      onClearFilters: () => updateUrlQuery({ q: '', risk: '' }),
      onExportCsv: () => {
        exportCsvFromServer('reports/aging', {
          q: search,
          risk: riskFilter
        }, `bao_cao_tuoi_no_${new Date().toISOString().slice(0, 10)}.csv`);
      }
    });
    content.append(toolbar);

    const rows = filtered.map((c) => {
      const row = node('tr');
      row.append(
        node('td', '', c.customer_name || '—'),
        node('td', '', money(c.current || c.bucket_current || 0)),
        node('td', '', money(c.days_1_30 || c.bucket_1_30 || 0)),
        node('td', '', money(c.days_31_60 || c.bucket_31_60 || 0)),
        node('td', '', money(c.days_61_90 || c.bucket_61_90 || 0)),
        node('td', '', money(c.days_90_plus || c.bucket_90_plus || 0)),
        node('td', 'detail-value', money(c.total_outstanding || c.total || 0)),
        node('td')
      );
      row.children[7].append(riskBadge(c.risk_level || 'LOW'));
      return row;
    });

    content.append(panel('Chi tiết tuổi nợ theo từng khách hàng', table(['Khách hàng', 'Trong hạn (0-30)', 'Quá hạn 1-30d', 'Quá hạn 31-60d', 'Quá hạn 61-90d', 'Nợ xấu (>90d)', 'Tổng nợ', 'Đánh giá rủi ro'], rows)));

  } else if (currentTab === 'collection') {
    const data = await api('/reports/collection-metrics');
    const grid = node('div', 'summary-grid');
    grid.append(
      node('div', 'summary-item info', node('div', 'summary-label', 'DSO (Số ngày thu hồi nợ)'), node('div', 'summary-value', `${data.dso_days} ngày`)),
      node('div', 'summary-item good', node('div', 'summary-label', 'Chỉ số hiệu quả CEI'), node('div', 'summary-value', `${data.cei_percent}%`)),
      node('div', 'summary-item accent', node('div', 'summary-label', 'Tổng nợ quá hạn'), node('div', 'summary-value', money(data.overdue_receivables))),
      node('div', 'summary-item', node('div', 'summary-label', 'Tỷ lệ nợ quá hạn'), node('div', 'summary-value', `${data.overdue_ratio_percent}%`))
    );
    content.append(grid);

    const topBar = node('div', 'toolbar');
    const exportBtn = actionButton('↓ Xuất CSV Chỉ số Thu hồi Nợ', 'button-secondary', () => {
      const headers = ['Chỉ số', 'Giá trị', 'Đơn vị / Giải thích'];
      const csvRows = [
        ['DSO (Days Sales Outstanding)', data.dso_days, 'Số ngày trung bình thu hồi nợ'],
        ['CEI (Collection Effectiveness Index)', `${data.cei_percent}%`, 'Hiệu quả thu hồi nợ (chuẩn > 80%)'],
        ['Tổng nợ quá hạn', data.overdue_receivables, 'VND'],
        ['Tỷ lệ nợ quá hạn', `${data.overdue_ratio_percent}%`, '% trên tổng nợ phải thu']
      ];
      downloadCsv(`chi_so_thu_hoi_dso_${new Date().toISOString().slice(0, 10)}`, headers, csvRows);
    });
    topBar.append(exportBtn);
    content.append(topBar);

    const desc = node('div', 'panel stack');
    desc.append(
      node('h3', '', 'Ý nghĩa các chỉ số đo lường hiệu quả thu hồi nợ:'),
      node('p', '', `• Days Sales Outstanding (DSO = ${data.dso_days} ngày): Số ngày trung bình để doanh nghiệp thu hồi được tiền hàng sau khi xuất hóa đơn. Càng thấp càng tốt.`),
      node('p', '', `• Collection Effectiveness Index (CEI = ${data.cei_percent}%): Tỷ lệ hiệu quả thu hồi nợ trong kỳ so với tổng lượng nợ phải thu. Chuẩn mực doanh nghiệp tốt > 80%.`)
    );
    content.append(desc);

  } else if (currentTab === 'revenue') {
    const data = await api('/reports/revenue-analytics');
    const grid = node('div', 'summary-grid');
    grid.append(
      node('div', 'summary-item good', node('div', 'summary-label', 'Tổng doanh số xuất HĐ'), node('div', 'summary-value', money(data.total_invoiced))),
      node('div', 'summary-item info', node('div', 'summary-label', 'Doanh thu thực thu'), node('div', 'summary-value', money(data.total_collected))),
      node('div', 'summary-item accent', node('div', 'summary-label', 'MRR (Doanh thu định kỳ/tháng)'), node('div', 'summary-value', money(data.recurring_mrr))),
      node('div', 'summary-item warn', node('div', 'summary-label', 'ARR (Quy mô năm)'), node('div', 'summary-value', money(data.recurring_arr)))
    );
    content.append(grid);

    const topBar = node('div', 'toolbar');
    const exportBtn = actionButton('↓ Xuất CSV Báo cáo Doanh thu', 'button-secondary', () => {
      const headers = ['Khoản mục', 'Giá trị (VND)'];
      const csvRows = [
        ['Tổng doanh số xuất HĐ', data.total_invoiced],
        ['Doanh thu thực thu', data.total_collected],
        ['MRR (Doanh thu định kỳ tháng)', data.recurring_mrr],
        ['ARR (Quy mô năm)', data.recurring_arr],
        ['Số khách hàng hoạt động', data.active_customers]
      ];
      downloadCsv(`bao_cao_doanh_thu_${new Date().toISOString().slice(0, 10)}`, headers, csvRows);
    });
    topBar.append(exportBtn);
    content.append(topBar);

    const statsPanel = node('div', 'panel');
    statsPanel.append(node('p', '', `Tổng số khách hàng hoạt động có phát sinh doanh thu: ${data.active_customers} khách hàng.`));
    content.append(statsPanel);

  } else if (currentTab === 'vat') {
    const query = parseUrlQuery();
    const fromDate = query.get('from') || '';
    const toDate = query.get('to') || '';

    const vatParams = new URLSearchParams();
    if (fromDate) vatParams.set('from', fromDate);
    if (toDate) vatParams.set('to', toDate);

    const vatQs = vatParams.toString();
    const data = await api(`/reports/vat-declaration${vatQs ? `?${vatQs}` : ''}`);
    const totals = data?.totals || data?.summary || { subtotal: '0', vat_amount: '0', total: '0', invoice_count: 0 };
    const grid = node('div', 'summary-grid');
    grid.append(
      node('div', 'summary-item', node('div', 'summary-label', 'Tổng doanh thu chưa thuế'), node('div', 'summary-value', money(totals.subtotal || 0))),
      node('div', 'summary-item good', node('div', 'summary-label', 'Tổng thuế GTGT đầu ra'), node('div', 'summary-value', money(totals.vat_amount || 0))),
      node('div', 'summary-item accent', node('div', 'summary-label', 'Tổng tiền sau thuế'), node('div', 'summary-value', money(totals.total || 0))),
      node('div', 'summary-item info', node('div', 'summary-label', 'Số lượng HĐ hợp lệ'), node('div', 'summary-value', `${totals.invoice_count || 0} HĐ`))
    );
    content.append(grid);

    const toolbar = renderTableToolbar({
      searchPlaceholder: 'Tìm theo số HĐ, MST, người mua...',
      searchValue: query.get('q') || '',
      onSearch: (val) => updateUrlQuery({ q: val }),
      filters: [
        { type: 'date', value: fromDate, placeholder: 'Từ ngày lập HĐ', onChange: (val) => updateUrlQuery({ from: val }) },
        { type: 'date', value: toDate, placeholder: 'Đến ngày lập HĐ', onChange: (val) => updateUrlQuery({ to: val }) }
      ],
      onClearFilters: () => updateUrlQuery({ q: '', from: '', to: '' }),
      onExportCsv: () => {
        exportCsvFromServer('reports/vat', {
          q: query.get('q') || '',
          from: fromDate,
          to: toDate,
          year: query.get('year') || '',
          quarter: query.get('quarter') || ''
        }, `bang_ke_thue_gtgt_01_1_${new Date().toISOString().slice(0, 10)}.csv`);
      }
    });
    content.append(toolbar);

    const searchKeyword = (query.get('q') || '').toLowerCase();
    const invoicesList = (data.invoices || []).filter(inv => {
      if (!searchKeyword) return true;
      return (inv.invoice_no || '').toLowerCase().includes(searchKeyword) ||
             (inv.customer_name || '').toLowerCase().includes(searchKeyword) ||
             (inv.customer_tax_code || '').includes(searchKeyword);
    });

    const rows = invoicesList.map((inv) => {
      const row = node('tr');
      row.append(
        node('td', '', inv.invoice_no),
        node('td', '', dateText(inv.issue_date)),
        node('td', '', inv.customer_name),
        node('td', '', inv.customer_tax_code || '—'),
        node('td', '', `${Number(inv.tax_rate) * 100}%`),
        node('td', '', money(inv.subtotal)),
        node('td', '', money(inv.vat_amount)),
        node('td', '', money(inv.total))
      );
      return row;
    });

    content.append(panel('Bảng kê hóa đơn GTGT hàng hóa, dịch vụ bán ra (Mẫu số 01-1/GTGT)', table(['Số HĐ', 'Ngày lập', 'Tên người mua', 'Mã số thuế', 'Thuế suất', 'Doanh số chưa thuế', 'Thuế GTGT', 'Tổng thanh toán'], rows)));
  }
}

// ---------------- AUDIT LOGS ----------------
async function renderAuditLogs(content) {
  const query = parseUrlQuery();
  const page = Math.max(1, Number(query.get('page') || 1));
  const pageSize = Number(query.get('page_size') || 20);
  const severityFilter = query.get('severity') || '';
  const moduleFilter = query.get('module') || '';
  const search = query.get('q') || '';
  const fromDate = query.get('from') || '';
  const toDate = query.get('to') || '';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (severityFilter) params.set('severity', severityFilter);
  if (moduleFilter) params.set('module', moduleFilter);
  if (search) params.set('q', search);
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);

  const result = await api(`/audit?${params.toString()}`);
  content.append(pageHeading('Nhật ký kiểm toán hệ thống', 'Audit Trail ghi nhận bất biến mọi thay đổi trạng thái hóa đơn và dòng tiền.'));

  const topBar = node('div', 'toolbar');
  const verifyBtn = actionButton('Kiểm tra Tính toàn vẹn Chuỗi băm (SHA-256 Chain)', 'button-primary', async () => {
    try {
      verifyBtn.disabled = true;
      const res = await api('/audit/verify');
      if (res.valid) {
        alert(`Chuỗi nhật ký toàn vẹn 100%! Đã xác thực ${res.total_records} bản ghi hợp lệ.`);
      } else {
        alert(`Cảnh báo: Phát hiện sai lệch tại bản ghi ID ${res.tampered_record_id}!`);
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    } finally {
      verifyBtn.disabled = false;
    }
  });
  topBar.append(verifyBtn);
  content.append(topBar);

  const auditAnalytics = await api('/dashboard/admin-analytics').catch(() => ({}));
  if (auditAnalytics.system_activity?.length > 0) {
    const actCard = createChartCard({
      title: 'Tần suất sự kiện kiểm toán hệ thống theo ngày',
      subtitle: 'Mục đích: Theo dõi mật độ hoạt động và phát hiện các đột biến bất thường (Spikes)',
      periodBadge: '14 ngày gần nhất'
    });
    actCard.body.append(renderLineChart({
      points: auditAnalytics.system_activity,
      xKey: 'date',
      yKey: 'count',
      color: '#B86B3D'
    }));
    content.append(actCard.card);
  }

  const filterWrap = node('div', 'tabs');
  const filterTabs = [
    ['', 'Tất cả mức độ'],
    ['INFO', 'Thông tin (INFO)'],
    ['WARNING', 'Cảnh báo (WARNING)'],
    ['ERROR', 'Lỗi (ERROR)'],
    ['CRITICAL', 'Nghiêm trọng (CRITICAL)']
  ];
  for (const [st, label] of filterTabs) {
    const btn = node('button', `tab-button ${severityFilter === st ? 'active' : ''}`, label);
    btn.addEventListener('click', () => {
      updateUrlQuery({ severity: st, page: 1 });
    });
    filterWrap.append(btn);
  }
  content.append(filterWrap);

  const toolbar = renderTableToolbar({
    searchPlaceholder: 'Tìm hành động, người thực hiện, đối tượng...',
    searchValue: search,
    onSearch: (val) => updateUrlQuery({ q: val, page: 1 }),
    filters: [
      {
        type: 'select',
        value: moduleFilter,
        options: [
          { value: '', label: 'Tất cả phân hệ' },
          { value: 'invoices', label: 'Hóa đơn (invoices)' },
          { value: 'payments', label: 'Thanh toán (payments)' },
          { value: 'customers', label: 'Khách hàng (customers)' },
          { value: 'reconciliation', label: 'Đối soát (reconciliation)' },
          { value: 'adjustments', label: 'Điều chỉnh (adjustments)' },
          { value: 'recurring', label: 'Thuê bao (recurring)' },
          { value: 'auth', label: 'Xác thực & Bảo mật (auth)' }
        ],
        onChange: (val) => updateUrlQuery({ module: val, page: 1 })
      },
      { type: 'date', value: fromDate, placeholder: 'Từ ngày', onChange: (val) => updateUrlQuery({ from: val, page: 1 }) },
      { type: 'date', value: toDate, placeholder: 'Đến ngày', onChange: (val) => updateUrlQuery({ to: val, page: 1 }) }
    ],
    onClearFilters: () => updateUrlQuery({ q: '', severity: '', module: '', from: '', to: '', page: 1 }),
    onExportCsv: () => {
      exportCsvFromServer('audit', {
        q: search,
        severity: severityFilter,
        module: moduleFilter,
        from: fromDate,
        to: toDate
      }, `nhat_ky_kiem_toan_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  });
  content.append(toolbar);

  const rows = (result.items || []).map((log) => {
    const row = node('tr');
    row.append(
      node('td', '', new Date(log.created_at || log.timestamp).toLocaleString('vi-VN')),
      node('td', '', log.username || log.actor_name || `User #${log.user_id || log.actor_id}`),
      node('td', '', log.action),
      node('td', '', log.entity_type ? `${log.entity_type} #${log.entity_id}` : (log.entity_id || '—')),
      node('td', 'code-preview small', (log.hash || '').slice(0, 16) + '...'),
      node('td')
    );
    row.children[5].append(statusBadge(log.severity || 'INFO'));
    return row;
  });

  const auditTable = table(['Thời điểm', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Mã băm SHA-256', 'Mức độ'], rows);
  const pagination = renderPagination({
    page,
    pageSize,
    total: Number(result.total || 0),
    onPageChange: (p) => updateUrlQuery({ page: p }),
    onPageSizeChange: (s) => updateUrlQuery({ page_size: s, page: 1 })
  });

  const panelContainer = panel('Danh sách bản ghi kiểm toán', auditTable);
  panelContainer.append(pagination);
  content.append(panelContainer);
}

// ---------------- SETTINGS ----------------
async function renderSettings(content) {
  const settings = await api('/settings').catch(() => ({}));
  content.append(pageHeading('Cài đặt hệ thống', 'Cấu hình thông tin pháp nhân doanh nghiệp và chữ ký số điện tử HSM.'));

  const form = node('form', 'panel stack');
  const grid = node('div', 'form-grid');
  const fields = [
    makeField('Tên doanh nghiệp / Đơn vị bán lẻ', { name: 'company_name', value: settings.company_name || 'CÔNG TY TNHH HỆ THỐNG BILLING VIỆT NAM', required: true }),
    makeField('Mã số thuế', { name: 'tax_code', value: settings.tax_code || '0102030405', required: true }),
    makeField('Email doanh nghiệp', { name: 'email', type: 'email', value: settings.email || 'billing@company.vn' }),
    makeField('Số điện thoại', { name: 'phone', value: settings.phone || '024-3888-9999' }),
    makeField('Tên ngân hàng nhận thanh toán', { name: 'bank_name', value: settings.bank_name || 'Vietcombank' }),
    makeField('Số tài khoản ngân hàng', { name: 'bank_account_no', value: settings.bank_account_no || '0011004455667' }),
    makeField('Nhà cung cấp chữ ký số HSM', { name: 'hsm_provider', value: settings.hsm_provider || 'VNPT-CA' }),
    makeField('Số Serial chứng thư số HSM', { name: 'hsm_serial', value: settings.hsm_serial || '540100238914' }),
    makeField('Địa chỉ trụ sở', { name: 'address', type: 'textarea', value: settings.address || 'Tầng 12, Tòa nhà Billing, Cầu Giấy, Hà Nội' })
  ];

  for (const f of fields) grid.append(f.wrapper);
  const message = node('div');
  const actions = node('div', 'form-actions');
  const save = node('button', 'button button-primary', 'Lưu cấu hình doanh nghiệp');
  save.type = 'submit';
  actions.append(save);
  form.append(grid, actions, message);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.replaceChildren();
    const body = Object.fromEntries(fields.map(f => [f.control.name, f.control.value]));
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
      message.append(alertBox('Đã cập nhật thông tin doanh nghiệp thành công!', 'success'));
    } catch (err) {
      message.append(alertBox(err.message, 'error'));
    }
  });

  content.append(form);
}

// ---------------- USERS MANAGEMENT (ADMIN ONLY) ----------------
async function renderUsers(content) {
  content.append(pageHeading(
    'Quản lý Người dùng & Phân quyền',
    'Tạo tài khoản, phân cấp vai trò và quản lý trạng thái truy cập hệ thống theo mô hình ADMIN > DIRECTOR > STAFF',
    actionButton('+ Tạo tài khoản mới', 'button button-primary', () => openCreateUserModal())
  ));

  const query = parseUrlQuery();
  const page = Math.max(1, Number(query.get('page') || 1));
  const pageSize = Number(query.get('page_size') || 20);
  const search = query.get('q') || '';
  const roleFilter = query.get('role') || '';
  const statusFilter = query.get('status') || '';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (search) params.set('q', search);
  if (roleFilter) params.set('role', roleFilter);
  if (statusFilter) params.set('status', statusFilter);

  const filterWrap = node('div', 'tabs');
  const filterTabs = [
    ['', 'Tất cả trạng thái'],
    ['ACTIVE', 'Đang hoạt động (ACTIVE)'],
    ['LOCKED', 'Đã khóa (LOCKED)']
  ];
  for (const [st, label] of filterTabs) {
    const btn = node('button', `tab-button ${statusFilter === st ? 'active' : ''}`, label);
    btn.addEventListener('click', () => {
      updateUrlQuery({ status: st, page: 1 });
    });
    filterWrap.append(btn);
  }
  content.append(filterWrap);

  const usersRes = await api(`/users?${params.toString()}`).catch(() => ({ items: [], total: 0 }));
  const usersList = usersRes.items || usersRes.users || [];

  const toolbar = renderTableToolbar({
    searchPlaceholder: 'Tìm tên tài khoản, họ tên, email...',
    searchValue: search,
    onSearch: (val) => updateUrlQuery({ q: val, page: 1 }),
    filters: [
      {
        type: 'select',
        value: roleFilter,
        options: [
          { value: '', label: 'Tất cả vai trò' },
          { value: 'admin', label: 'ADMIN (Quản trị hệ thống)' },
          { value: 'director', label: 'DIRECTOR (Điều hành)' },
          { value: 'staff', label: 'STAFF (Vận hành)' }
        ],
        onChange: (val) => updateUrlQuery({ role: val, page: 1 })
      }
    ],
    onClearFilters: () => updateUrlQuery({ q: '', role: '', status: '', page: 1 }),
    onExportCsv: () => {
      exportCsvFromServer('users', {
        q: search,
        role: roleFilter,
        status: statusFilter
      }, `danh_sach_nguoi_dung_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  });
  content.append(toolbar);

  const rows = usersList.map(u => {
    const row = node('tr');

    const actionsCol = node('td');
    const actionsGroup = node('div', 'inline-actions');

    const editBtn = actionButton('Sửa', 'button-quiet small', () => openEditUserModal(u));
    actionsGroup.append(editBtn);

    if (u.username !== 'admin' && u.id !== currentUser.id) {
      const lockLabel = u.is_active ? 'Khóa' : 'Mở khóa';
      const lockClass = u.is_active ? 'button-quiet small' : 'button-unlock small';
      const toggleLockBtn = actionButton(lockLabel, lockClass, async () => {
        const confirmMsg = u.is_active
          ? `Bạn có chắc muốn KHÓA tài khoản ${u.username}? Người dùng sẽ không thể đăng nhập.`
          : `Bạn có muốn MỞ KHÓA tài khoản ${u.username}?`;
        if (!confirm(confirmMsg)) return;
        try {
          toggleLockBtn.disabled = true;
          await api(`/users/${u.id}/toggle-status`, { method: 'POST' });
          alert(`Đã ${u.is_active ? 'khóa' : 'mở khóa'} tài khoản ${u.username} thành công!`);
          render();
        } catch (err) {
          alert('Lỗi: ' + err.message);
          toggleLockBtn.disabled = false;
        }
      });
      actionsGroup.append(toggleLockBtn);
    }

    const resetPassBtn = actionButton('Reset MK', 'button-quiet small', () => openResetPasswordModal(u));
    actionsGroup.append(resetPassBtn);

    actionsCol.append(actionsGroup);

    row.append(
      node('td', 'code-preview bold', u.username),
      node('td', '', u.full_name || '—'),
      node('td', '', u.email || '—'),
      node('td', '', roleBadge(u.role)),
      node('td', '', u.is_active ? statusBadge('ACTIVE') : statusBadge('LOCKED')),
      node('td', 'small muted', u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : '—'),
      actionsCol
    );
    return row;
  });

  const usersTable = table(
    ['Tài khoản', 'Họ và tên', 'Email', 'Vai trò', 'Trạng thái', 'Ngày tạo', 'Thao tác'],
    rows
  );
  const pagination = renderPagination({
    page,
    pageSize,
    total: Number(usersRes.total || 0),
    onPageChange: (p) => updateUrlQuery({ page: p }),
    onPageSizeChange: (s) => updateUrlQuery({ page_size: s, page: 1 })
  });

  const panelContainer = panel('Danh sách Người dùng Hệ thống', usersTable);
  panelContainer.append(pagination);
  content.append(panelContainer);
}

function openCreateUserModal() {
  const backdrop = node('div', 'modal-backdrop');
  const win = node('div', 'modal-window');

  const header = node('div', 'modal-header');
  header.append(node('h2', '', 'Tạo Tài khoản Người dùng Mới'));
  const closeBtn = actionButton('✕', 'button-quiet small', () => backdrop.remove());
  header.append(closeBtn);

  const form = node('form', 'stack');
  const usernameField = makeField('Tên đăng nhập (Username)', { name: 'username', required: true, placeholder: 'vd: director1, staff2' });
  const fullNameField = makeField('Họ và tên đầy đủ', { name: 'full_name', placeholder: 'vd: Nguyễn Văn A' });
  const emailField = makeField('Email liên hệ', { name: 'email', type: 'email', placeholder: 'vd: director@company.com' });
  const passwordField = makeField('Mật khẩu khởi tạo (tối thiểu 6 ký tự)', { name: 'password', type: 'password', required: true });
  const roleField = makeField('Vai trò hệ thống', {
    name: 'role',
    type: 'select',
    value: 'staff',
    options: [
      { label: 'STAFF — Nghiệp vụ vận hành (Bán hàng, hóa đơn, thanh toán)', value: 'staff' },
      { label: 'DIRECTOR — Quản lý điều hành (Báo cáo, công nợ, duyệt biên bản)', value: 'director' },
      { label: 'ADMIN — Quản trị hệ thống (Toàn quyền quản trị)', value: 'admin' }
    ]
  });
  const statusField = makeField('Trạng thái kích hoạt', {
    name: 'status',
    type: 'select',
    value: 'ACTIVE',
    options: [
      { label: 'ACTIVE — Kích hoạt ngay', value: 'ACTIVE' },
      { label: 'INACTIVE — Tạm khóa', value: 'INACTIVE' }
    ]
  });

  const msgBox = node('div');
  const footer = node('div', 'modal-footer');
  const cancelBtn = actionButton('Hủy bỏ', 'button-secondary', () => backdrop.remove());
  const submitBtn = node('button', 'button button-primary', 'Tạo tài khoản');
  submitBtn.type = 'submit';
  footer.append(cancelBtn, submitBtn);

  form.append(usernameField.wrapper, fullNameField.wrapper, emailField.wrapper, passwordField.wrapper, roleField.wrapper, statusField.wrapper, msgBox, footer);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgBox.replaceChildren();
    submitBtn.disabled = true;
    try {
      const body = {
        username: usernameField.control.value.trim(),
        full_name: fullNameField.control.value.trim(),
        email: emailField.control.value.trim(),
        password: passwordField.control.value,
        role: roleField.control.value,
        status: statusField.control.value
      };
      await api('/users', { method: 'POST', body: JSON.stringify(body) });
      backdrop.remove();
      alert(`Đã tạo tài khoản ${body.username} thành công!`);
      render();
    } catch (err) {
      msgBox.append(alertBox(err.message, 'error'));
      submitBtn.disabled = false;
    }
  });

  win.append(header, form);
  backdrop.append(win);
  document.body.append(backdrop);
}

function openEditUserModal(user) {
  const backdrop = node('div', 'modal-backdrop');
  const win = node('div', 'modal-window');

  const header = node('div', 'modal-header');
  header.append(node('h2', '', `Chỉnh sửa: ${user.username}`));
  const closeBtn = actionButton('✕', 'button-quiet small', () => backdrop.remove());
  header.append(closeBtn);

  const form = node('form', 'stack');
  const fullNameField = makeField('Họ và tên đầy đủ', { name: 'full_name', value: user.full_name || '' });
  const emailField = makeField('Email liên hệ', { name: 'email', type: 'email', value: user.email || '' });
  
  const currentRoleVal = user.role.toLowerCase() === 'role_billing_manager' ? 'director' : user.role.toLowerCase();
  const roleField = makeField('Vai trò hệ thống', {
    name: 'role',
    type: 'select',
    value: currentRoleVal,
    options: [
      { label: 'STAFF — Nghiệp vụ vận hành', value: 'staff' },
      { label: 'DIRECTOR — Quản lý điều hành', value: 'director' },
      { label: 'ADMIN — Quản trị hệ thống', value: 'admin' }
    ]
  });
  if (user.username === 'admin') roleField.control.disabled = true;

  const statusField = makeField('Trạng thái', {
    name: 'status',
    type: 'select',
    value: user.is_active ? 'ACTIVE' : 'INACTIVE',
    options: [
      { label: 'ACTIVE — Kích hoạt', value: 'ACTIVE' },
      { label: 'INACTIVE — Khóa tài khoản', value: 'INACTIVE' }
    ]
  });
  if (user.username === 'admin') statusField.control.disabled = true;

  const msgBox = node('div');
  const footer = node('div', 'modal-footer');
  const cancelBtn = actionButton('Hủy bỏ', 'button-secondary', () => backdrop.remove());
  const submitBtn = node('button', 'button button-primary', 'Lưu thay đổi');
  submitBtn.type = 'submit';
  footer.append(cancelBtn, submitBtn);

  form.append(fullNameField.wrapper, emailField.wrapper, roleField.wrapper, statusField.wrapper, msgBox, footer);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgBox.replaceChildren();
    submitBtn.disabled = true;
    try {
      const body = {
        full_name: fullNameField.control.value.trim(),
        email: emailField.control.value.trim(),
        role: roleField.control.value,
        status: statusField.control.value
      };
      await api(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify(body) });
      backdrop.remove();
      alert(`Đã cập nhật thông tin tài khoản ${user.username} thành công!`);
      render();
    } catch (err) {
      msgBox.append(alertBox(err.message, 'error'));
      submitBtn.disabled = false;
    }
  });

  win.append(header, form);
  backdrop.append(win);
  document.body.append(backdrop);
}

function openResetPasswordModal(user) {
  const backdrop = node('div', 'modal-backdrop');
  const win = node('div', 'modal-window');

  const header = node('div', 'modal-header');
  header.append(node('h2', '', `Đặt lại mật khẩu cho: ${user.username}`));
  const closeBtn = actionButton('✕', 'button-quiet small', () => backdrop.remove());
  header.append(closeBtn);

  const form = node('form', 'stack');
  const passwordField = makeField('Mật khẩu mới (tối thiểu 6 ký tự)', { name: 'password', type: 'password', required: true });

  const msgBox = node('div');
  const footer = node('div', 'modal-footer');
  const cancelBtn = actionButton('Hủy bỏ', 'button-secondary', () => backdrop.remove());
  const submitBtn = node('button', 'button button-primary', 'Đặt lại mật khẩu');
  submitBtn.type = 'submit';
  footer.append(cancelBtn, submitBtn);

  form.append(passwordField.wrapper, msgBox, footer);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgBox.replaceChildren();
    submitBtn.disabled = true;
    try {
      const body = { password: passwordField.control.value };
      await api(`/users/${user.id}/reset-password`, { method: 'POST', body: JSON.stringify(body) });
      backdrop.remove();
      alert(`Đã đặt lại mật khẩu cho tài khoản ${user.username} thành công!`);
    } catch (err) {
      msgBox.append(alertBox(err.message, 'error'));
      submitBtn.disabled = false;
    }
  });

  win.append(header, form);
  backdrop.append(win);
  document.body.append(backdrop);
}

// ---------------- ROLES & PERMISSIONS (ADMIN ONLY) ----------------
async function renderRoles(content) {
  content.append(pageHeading(
    'Vai trò & Phân quyền',
    'Cấu hình quyền hạn truy cập nghiệp vụ chi tiết cho 3 cấp người dùng: ADMIN > DIRECTOR > STAFF'
  ));

  const roleCardsGrid = node('div', 'summary-grid');
  roleCardsGrid.append(
    node('section', 'summary-item accent',
      node('div', 'summary-label', 'Cấp 1: ADMIN'),
      node('div', 'summary-value', 'Quản trị hệ thống'),
      node('div', 'small muted', 'Toàn quyền (Wildcard *). Quản lý người dùng, vai trò, bảo mật, audit & cấu hình.')
    ),
    node('section', 'summary-item info',
      node('div', 'summary-label', 'Cấp 2: DIRECTOR'),
      node('div', 'summary-value', 'Điều hành nghiệp vụ'),
      node('div', 'small muted', 'Chỉ huy tài chính, doanh thu, công nợ, DSO/CEI, phê duyệt điều chỉnh & đối soát.')
    ),
    node('section', 'summary-item good',
      node('div', 'summary-label', 'Cấp 3: STAFF'),
      node('div', 'summary-value', 'Nghiệp vụ vận hành'),
      node('div', 'small muted', 'Lập hóa đơn, quản lý khách hàng, thu tiền, đối soát. Không thấy cấu hình & phân quyền.')
    ),
    node('section', 'summary-item',
      node('div', 'summary-label', 'Cơ chế phân quyền'),
      node('div', 'summary-value', 'Authoritative RBAC'),
      node('div', 'small muted', 'Kiểm soát từ API Backend với HTTP 403 Forbidden. Fail-closed an toàn tuyệt đối.')
    )
  );
  content.append(roleCardsGrid);

  const [rolesRes, permsRes] = await Promise.all([
    api('/rbac/roles'),
    api('/rbac/permissions')
  ]);

  const rolesList = rolesRes.items || [];
  const allPerms = permsRes.items || [];

  const tabContainer = node('div', 'tabs');
  const matrixContainer = node('div');

  let activeRoleCode = 'ROLE_BILLING_MANAGER';

  const roleTabMap = [
    { label: 'DIRECTOR (Quản lý điều hành)', code: 'ROLE_BILLING_MANAGER' },
    { label: 'STAFF (Vận hành tác nghiệp)', code: 'staff' },
    { label: 'ADMIN (Quản trị toàn quyền)', code: 'admin' }
  ];

  async function loadRolePermissions(targetCode) {
    activeRoleCode = targetCode;
    tabContainer.querySelectorAll('.tab-button').forEach(btn => {
      const isActive = btn.getAttribute('data-code') === targetCode;
      btn.className = `tab-button ${isActive ? 'active' : ''}`.trim();
    });

    matrixContainer.replaceChildren(node('div', 'empty-state', 'Đang tải phân quyền vai trò...'));

    const roleObj = rolesList.find(r => r.code === targetCode) || rolesList[0];
    let assignedPerms = [];
    if (targetCode === 'admin') {
      assignedPerms = allPerms.map(p => p.code);
    } else {
      const rolePermRes = await api(`/rbac/roles/${roleObj.id}/permissions`).catch(() => ({ permissions: [] }));
      assignedPerms = rolePermRes.permissions || [];
    }

    const assignedSet = new Set(assignedPerms);

    const form = node('form', 'stack');
    const notice = targetCode === 'admin'
      ? alertBox('ADMIN mặc định sở hữu toàn quyền hệ thống (Wildcard *). Không thể rút quyền của ADMIN.', 'info')
      : alertBox(`Đang cấu hình quyền hạn cho vai trò: ${roleObj.title || roleObj.code}. Chọn các quyền hạn cho phép bên dưới và nhấn Lưu.`, 'warning');
    form.append(notice);

    const moduleMap = new Map();
    for (const p of allPerms) {
      if (!moduleMap.has(p.module)) moduleMap.set(p.module, []);
      moduleMap.get(p.module).push(p);
    }

    const moduleTitles = {
      'invoices': 'Quản lý Hóa đơn & Phát hành (Invoices)',
      'customers': 'Quản lý Khách hàng & Tín dụng (Customers)',
      'payments': 'Quản lý Thanh toán & Dòng tiền (Payments)',
      'adjustments': 'Biên bản Điều chỉnh & Phê duyệt (Adjustments & Approvals)',
      'products': 'Danh mục Sản phẩm & Dịch vụ (Products)',
      'recurring': 'Thuê bao & Hợp đồng định kỳ (Subscriptions)',
      'reconciliation': 'Đối soát Giao dịch Ngân hàng (Reconciliation)',
      'reports': 'Báo cáo & Phân tích Tài chính (Reports)',
      'audit': 'Nhật ký Kiểm toán Hệ thống (Audit Trail)',
      'settings': 'Cấu hình Pháp nhân & Chữ ký số (Settings)'
    };

    const checkboxes = [];

    for (const [moduleName, perms] of moduleMap.entries()) {
      const card = node('div', 'perm-module-card');
      card.append(node('h3', '', moduleTitles[moduleName] || moduleName.toUpperCase()));
      const grid = node('div', 'perm-grid');

      for (const perm of perms) {
        const item = node('label', 'perm-checkbox-item');
        const cb = node('input');
        cb.type = 'checkbox';
        cb.value = perm.id;
        cb.setAttribute('data-code', perm.code);
        cb.checked = assignedSet.has(perm.code);
        if (targetCode === 'admin') cb.disabled = true;

        checkboxes.push(cb);

        const labelText = node('div');
        labelText.append(
          node('div', 'code-preview bold small', perm.code),
          node('div', 'muted small', perm.description || '—')
        );

        item.append(cb, labelText);
        grid.append(item);
      }

      card.append(grid);
      form.append(card);
    }

    if (targetCode !== 'admin') {
      const actions = node('div', 'form-actions');
      const saveBtn = node('button', 'button button-primary', `Lưu phân quyền vai trò ${roleObj.title || roleObj.code}`);
      saveBtn.type = 'submit';
      actions.append(saveBtn);
      form.append(actions);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        saveBtn.disabled = true;
        try {
          const selectedIds = checkboxes.filter(cb => cb.checked).map(cb => Number(cb.value));
          await api(`/rbac/roles/${roleObj.id}/permissions`, {
            method: 'PUT',
            body: JSON.stringify({ permission_ids: selectedIds })
          });
          alert(`Đã lưu thành công ${selectedIds.length} quyền cho vai trò ${roleObj.title || roleObj.code}!`);
          loadRolePermissions(targetCode);
        } catch (err) {
          alert('Lỗi: ' + err.message);
          saveBtn.disabled = false;
        }
      });
    }

    matrixContainer.replaceChildren(form);
  }

  for (const tab of roleTabMap) {
    const btn = node('button', `tab-button ${tab.code === activeRoleCode ? 'active' : ''}`, tab.label);
    btn.setAttribute('data-code', tab.code);
    btn.addEventListener('click', () => loadRolePermissions(tab.code));
    tabContainer.append(btn);
  }

  content.append(tabContainer, matrixContainer);
  await loadRolePermissions(activeRoleCode);
}

// ---------------- ROUTER ----------------
async function render() {
  const route = location.hash.slice(1) || '/';
  if (route === '/login') {
    renderLogin();
    return;
  }
  try {
    currentUser = await api('/auth/me');
  } catch (error) {
    if (error.status === 401) {
      renderLogin();
      return;
    }
    root.replaceChildren(alertBox(error.message, 'error'));
    return;
  }

  const effectiveRole = getEffectiveRole(currentUser);

  // Frontend route guards based on role
  if ((route.startsWith('/users') || route.startsWith('/roles') || route.startsWith('/permissions')) && effectiveRole !== 'ADMIN') {
    const content = renderShell(route.split('?')[0]);
    content.replaceChildren(alertBox('Truy cập bị từ chối: Quản trị Người dùng & Phân quyền chỉ dành riêng cho cấp ADMIN.', 'error'));
    return;
  }
  if (route.startsWith('/settings') && effectiveRole !== 'ADMIN') {
    const content = renderShell(route.split('?')[0]);
    content.replaceChildren(alertBox('Truy cập bị từ chối: Cấu hình hệ thống chỉ dành riêng cho cấp ADMIN.', 'error'));
    return;
  }
  if (route.startsWith('/audit') && effectiveRole !== 'ADMIN') {
    const content = renderShell(route.split('?')[0]);
    content.replaceChildren(alertBox('Truy cập bị từ chối: Nhật ký kiểm toán hệ thống chỉ dành riêng cho cấp ADMIN.', 'error'));
    return;
  }

  const content = renderShell(route.split('?')[0]);
  try {
    if (route.startsWith('/users')) await renderUsers(content);
    else if (route.startsWith('/roles')) await renderRoles(content);
    else if (route.startsWith('/customers')) await renderCustomers(content);
    else if (route.startsWith('/products')) await renderProducts(content);
    else if (route.startsWith('/payment-terms')) await renderPaymentTerms(content);
    else if (route.startsWith('/invoices')) await renderInvoices(content);
    else if (route.startsWith('/payments')) await renderPayments(content);
    else if (route.startsWith('/adjustments')) await renderAdjustments(content);
    else if (route.startsWith('/recurring')) await renderRecurring(content);
    else if (route.startsWith('/reconciliation')) await renderReconciliation(content);
    else if (route.startsWith('/reports')) await renderReports(content);
    else if (route.startsWith('/audit')) await renderAuditLogs(content);
    else if (route.startsWith('/settings')) await renderSettings(content);
    else await renderDashboard(content);
  } catch (error) {
    content.prepend(alertBox(error.message, 'error'));
  }
}

window.addEventListener('hashchange', render);
render();