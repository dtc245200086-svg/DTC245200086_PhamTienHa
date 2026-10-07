const root = document.querySelector('#app');
let currentUser = null;
let fieldSequence = 0;

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

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
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
  else if (['OVERDUE', 'PARTIALLY_PAID', 'UNMATCHED'].includes(status)) kind = 'badge-open';
  else kind = 'badge-info';
  return node('span', `badge ${kind}`, status);
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

function renderShell(path) {
  const shell = node('div', 'app-shell');
  const sidebar = node('aside', 'sidebar');
  const brand = node('div', 'brand-mark');
  brand.append(node('div', 'brand-icon', 'B'));
  const brandText = node('div');
  brandText.append(node('p', 'brand-name', 'Billing Enterprise'), node('p', 'brand-caption', 'Tài chính & E-Invoice'));
  brand.append(brandText);
  sidebar.append(brand);

  const navSections = [
    {
      title: 'TỔNG QUAN',
      routes: [
        ['Tổng quan', '#/']
      ]
    },
    {
      title: 'KINH DOANH & BÁN HÀNG',
      routes: [
        ['Hóa đơn', '#/invoices'],
        ['Khách hàng', '#/customers'],
        ['Sản phẩm & Dịch vụ', '#/products'],
        ['Thuê bao định kỳ', '#/recurring']
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
      title: 'BÁO CÁO & HỆ THỐNG',
      routes: [
        ['Báo cáo tài chính', '#/reports'],
        ['Nhật ký kiểm toán', '#/audit'],
        ['Cài đặt', '#/settings']
      ]
    }
  ];

  for (const group of navSections) {
    const navGroup = node('div', 'nav-group');
    navGroup.append(node('div', 'nav-group-title', group.title));
    const navList = node('nav', 'nav-list');
    for (const [label, href] of group.routes) {
      const link = anchor(label, href, 'nav-link');
      const expected = href.slice(1);
      const current = path === '/' ? '/' : `/${path.split('/')[1]}`;
      if (current === expected) link.setAttribute('aria-current', 'page');
      navList.append(link);
    }
    navGroup.append(navList);
    sidebar.append(navGroup);
  }

  sidebar.append(node('div', 'sidebar-footer', 'Billing Enterprise v2.0 · Đề 18 · YC2/CP2'));

  const column = node('div', 'main-column');
  const topbar = node('header', 'topbar');
  const userRoleText = `${currentUser.username} (${currentUser.role.toUpperCase()})`;
  topbar.append(node('span', 'topbar-user', userRoleText));

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

// ---------------- DASHBOARD ----------------
async function renderDashboard(content) {
  content.append(pageHeading('Tổng quan', 'Tình hình doanh thu, công nợ và chỉ số dòng tiền'));
  const summary = await api('/dashboard/summary');
  const grid = node('div', 'summary-grid');
  const values = [
    ['Đã thu', money(summary.collected), 'good'],
    ['Công nợ còn lại', money(summary.outstanding), 'accent'],
    ['Hóa đơn quá hạn', `${summary.overdue_count} HĐ`, 'warn'],
    ['Đã thanh toán', `${summary.by_status.PAID || 0} HĐ`, 'info']
  ];
  for (const [label, value, kind] of values) {
    const item = node('section', `summary-item ${kind}`);
    item.append(node('div', 'summary-label', label), node('div', 'summary-value', value));
    grid.append(item);
  }
  content.append(grid);

  // Status breakdown & quick shortcuts
  const statuses = Object.entries(summary.by_status).map(([status, count]) => {
    const row = node('tr');
    row.append(node('td', '', status), node('td', '', count));
    return row;
  });

  const rowDiv = node('div', 'form-grid');
  rowDiv.append(panel('Hóa đơn theo trạng thái', table(['Trạng thái', 'Số lượng'], statuses)));

  const quickCard = node('div', 'stack');
  quickCard.append(
    node('p', 'muted', 'Truy cập nhanh các nghiệp vụ quản lý tài chính doanh nghiệp:'),
    anchor('+ Lập Hóa đơn mới', '#/invoices/new', 'button button-primary'),
    anchor('+ Khách hàng mới', '#/customers/new', 'button button-secondary'),
    anchor('+ Thuê bao định kỳ mới', '#/recurring/new', 'button button-secondary'),
    anchor('Đối soát ngân hàng tự động', '#/reconciliation', 'button button-secondary'),
    anchor('Xem Báo cáo Tuổi nợ & Thu hồi (DSO/CEI)', '#/reports', 'button button-secondary')
  );
  rowDiv.append(panel('Thao tác nhanh', quickCard));
  content.append(rowDiv);
}

// ---------------- CUSTOMERS ----------------
async function renderCustomers(content) {
  const match = location.hash.match(/^#\/customers\/(\d+)\/edit$/);
  if (location.hash === '#/customers/new' || match) {
    await renderCustomerForm(content, match?.[1]);
    return;
  }

  const queryString = location.hash.split('?')[1] || '';
  const query = new URLSearchParams(queryString);
  const search = query.get('q') || '';
  const result = await api(`/customers?limit=100&q=${encodeURIComponent(search)}`);
  const heading = pageHeading('Khách hàng', 'Quản lý thông tin đối tác, hạn mức tín dụng và phân khúc khách hàng.', anchor('Thêm khách hàng', '#/customers/new', 'button button-primary'));
  content.append(heading);

  const searchForm = node('form', 'inline-form');
  const searchField = makeField('Tìm kiếm', { name: 'q', value: search, placeholder: 'Tên, email, điện thoại hoặc MST...' });
  const searchButton = node('button', 'button button-secondary', 'Tìm kiếm');
  searchButton.type = 'submit';
  searchForm.append(searchField.wrapper, searchButton);
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    setHash(`/customers?q=${encodeURIComponent(searchField.control.value.trim())}`);
  });
  content.append(searchForm);

  const rows = result.items.map((customer) => {
    const row = node('tr');
    const name = node('td');
    name.append(node('strong', '', customer.name), node('div', 'small muted', customer.email || '—'));
    const phone = node('td', '', customer.phone || '—');
    const tax = node('td', '', customer.tax_code || '—');
    const segment = node('td', '', customer.segment || 'SME');
    const credit = node('td', '', money(customer.credit_limit || 0));
    const debt = node('td', '', money(customer.current_debt || 0));

    const actions = node('td');
    const group = node('div', 'actions');
    group.append(anchor('Sửa', `#/customers/${customer.id}/edit`));
    if (currentUser.role === 'admin') {
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
    row.append(name, phone, tax, segment, credit, debt, actions);
    return row;
  });
  content.append(panel('Danh sách khách hàng', table(['Khách hàng', 'Điện thoại', 'Mã số thuế', 'Phân khúc', 'Hạn mức tín dụng', 'Dư nợ hiện tại', 'Thao tác'], rows)));
}

async function renderCustomerForm(content, customerId) {
  const editing = Boolean(customerId);
  const existing = editing ? (await api(`/customers/${customerId}`)).customer : {};
  const termsResult = await api('/payment-terms');
  const termOptions = [{ value: '', label: '-- Mặc định --' }].concat(
    termsResult.items.map(t => ({ value: String(t.id), label: `${t.code} - ${t.name} (${t.net_days} ngày)` }))
  );

  content.append(pageHeading(editing ? 'Sửa khách hàng' : 'Thêm khách hàng', 'Thông tin định danh và chính sách tín dụng.', anchor('Quay lại', '#/customers')));
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

  const result = await api('/products?limit=100');
  content.append(pageHeading('Sản phẩm & Dịch vụ', 'Danh mục sản phẩm, đơn giá tiêu chuẩn và thuế suất GTGT.', anchor('+ Thêm sản phẩm', '#/products/new', 'button button-primary')));

  const rows = result.items.map((prod) => {
    const row = node('tr');
    row.append(
      node('td', 'code-preview', prod.sku),
      node('td', '', prod.name),
      node('td', '', prod.category || 'Dịch vụ'),
      node('td', '', prod.unit || 'gói'),
      node('td', '', money(prod.unit_price)),
      node('td', '', `${Number(prod.tax_rate) * 100}%`),
      node('td')
    );
    row.children[6].append(statusBadge(prod.is_active ? 'ACTIVE' : 'INACTIVE'));

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

  content.append(panel('Danh mục sản phẩm & dịch vụ', table(['Mã SKU', 'Tên sản phẩm / Dịch vụ', 'Phân loại', 'Đơn vị tính', 'Đơn giá niêm yết', 'Thuế suất', 'Trạng thái', 'Thao tác'], rows)));
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
      name: 'tax_rate',
      type: 'select',
      value: existing.tax_rate ?? '0.10',
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

  const result = await api('/invoices?limit=100');
  content.append(pageHeading('Hóa đơn điện tử', 'Quản lý hóa đơn bán hàng, mã tra cứu CQT và trạng thái thanh toán.', anchor('+ Tạo hóa đơn mới', '#/invoices/new', 'button button-primary')));

  const rows = result.items.map((invoice) => {
    const row = node('tr');
    const noCell = node('td');
    noCell.append(node('strong', '', invoice.invoice_no || `DRAFT-${invoice.id}`));
    const einvCode = invoice.e_invoice_code || invoice.einvoice_code;
    if (einvCode) {
      noCell.append(node('div', 'code-preview small', `Mô phỏng TT78: ${einvCode}`));
    }

    row.append(
      noCell,
      node('td', '', invoice.customer_name),
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

  content.append(panel('Danh sách hóa đơn', table(['Số HĐ / Mã CQT', 'Khách hàng', 'Ngày lập', 'Hạn thanh toán', 'Tổng cộng', 'Đã thanh toán', 'Trạng thái', 'Thao tác'], rows)));
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
  const adjustResult = await api(`/adjustments?invoice_id=${invoiceId}`).catch(() => ({ items: [] }));
  const einvCode = invoice.e_invoice_code || invoice.einvoice_code;

  content.append(pageHeading(
    invoice.invoice_no || `Bản nháp DRAFT-${invoice.id}`,
    `Khách hàng: ${invoice.customer_name} ${einvCode ? `· Mã mô phỏng nội bộ: ${einvCode}` : ''}`,
    anchor('In hóa đơn', `#/invoices/${invoice.id}/print`)
  ));

  const details = node('div', 'detail-grid');
  for (const [label, value] of [
    ['Trạng thái', invoice.status],
    ['Mã mô phỏng nội bộ TT78', einvCode || 'Chưa cấp'],
    ['Ngày lập', dateText(invoice.issue_date)],
    ['Hạn thanh toán', dateText(invoice.due_date)],
    ['Tiền hàng chưa thuế', money(invoice.subtotal)],
    ['Thuế GTGT', money(invoice.tax_amount)],
    ['Tổng thanh toán', money(invoice.total)],
    ['Đã thanh toán', money(invoice.paid_total)],
    ['Còn nợ', money(invoice.outstanding)]
  ]) {
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
  }
  if (['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)) {
    actions.append(actionButton('+ Ghi nhận thanh toán', 'button-primary', () => setHash(`#/invoices/${invoice.id}/payment`)));
    actions.append(anchor('+ Tạo biên bản điều chỉnh / C/N', `#/adjustments/new?invoice_id=${invoice.id}`, 'button button-secondary'));
  }
  if (currentUser.role === 'admin' && ['DRAFT', 'ISSUED'].includes(invoice.status) && isZero(invoice.paid_total)) {
    actions.append(actionButton('Hủy hóa đơn', 'button-danger', () => setHash(`#/invoices/${invoice.id}/cancel`)));
  }
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
      await api(`/invoices/${invoice.id}/payments`, {
        method: 'POST',
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

  content.append(pageHeading('Bản thể hiện Hóa đơn Điện tử', invoice.invoice_no || `DRAFT-${invoice.id}`, actionButton('In / Xuất PDF', 'button-primary', () => window.print())));

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
  const result = await api('/payments?limit=100');
  content.append(pageHeading('Lịch sử thanh toán & Phân bổ tiền (Payment Allocation V2)', 'Theo dõi mọi dòng tiền thu vào, quản lý phân bổ đa hóa đơn và tiền chưa phân bổ (Unapplied Cash).'));

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

  content.append(panel('Khoản thanh toán ghi nhận', table(['Ngày thanh toán', 'Khách hàng', 'Phương thức', 'Tổng tiền thu', 'Đã phân bổ', 'Chưa phân bổ (Unapplied)', 'Ngân hàng', 'Mã tham chiếu'], rows)));
}

// ---------------- ADJUSTMENTS & CREDIT NOTES ----------------
async function renderAdjustments(content) {
  if (location.hash.startsWith('#/adjustments/new')) {
    await renderAdjustmentForm(content);
    return;
  }

  const result = await api('/adjustments?limit=100');
  content.append(pageHeading('Biên bản điều chỉnh & Credit Notes', 'Quản lý điều chỉnh sai sót, giảm giá và hủy hóa đơn theo Thông tư 78.', anchor('+ Lập biên bản mới', '#/adjustments/new', 'button button-primary')));

  const rows = result.items.map((adj) => {
    const row = node('tr');
    row.append(
      node('td', 'code-preview', adj.adjustment_no),
      node('td', '', adj.target_invoice_no || `#${adj.invoice_id}`),
      node('td', '', adj.type),
      node('td', '', money(adj.amount)),
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
          setHash('/adjustments');
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
          setHash('/adjustments');
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

  content.append(panel('Danh sách biên bản điều chỉnh', table(['Mã biên bản', 'Hóa đơn gốc', 'Loại nghiệp vụ', 'Số tiền điều chỉnh', 'Lý do', 'Trạng thái', 'Thao tác'], rows)));
}

async function renderAdjustmentForm(content) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const invoiceIdParam = query.get('invoice_id') || '';

  const invoices = await api('/invoices?limit=100');
  const validInvoices = invoices.items.filter(inv => ['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status));

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

  const result = await api('/recurring?limit=100');
  content.append(pageHeading('Thuê bao & Hóa đơn định kỳ', 'Tự động phát hành hóa đơn theo chu kỳ hàng tháng, quý hoặc năm.', anchor('+ Thêm gói thuê bao', '#/recurring/new', 'button button-primary')));

  const rows = result.items.map((plan) => {
    const row = node('tr');
    row.append(
      node('td', 'code-preview', plan.plan_no),
      node('td', '', plan.customer_name),
      node('td', '', plan.billing_cycle),
      node('td', '', money(plan.amount)),
      node('td', '', dateText(plan.next_billing_date)),
      node('td', '', `${plan.invoices_generated || 0} HĐ`),
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

  content.append(panel('Danh sách kế hoạch thanh toán định kỳ', table(['Mã thuê bao', 'Khách hàng', 'Chu kỳ lặp', 'Số tiền mỗi kỳ', 'Kỳ tiếp theo', 'Đã sinh', 'Trạng thái', 'Thao tác'], rows)));
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

  grid.append(custField.wrapper, cycleField.wrapper, amountField.wrapper, startField.wrapper);

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
          start_date: startField.control.value
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
  const result = await api('/reconciliation/transactions?limit=100');
  content.append(pageHeading('Đối soát giao dịch ngân hàng', 'Khớp nối sao kê biến động số dư ngân hàng với hóa đơn thực tế.'));

  const toolbar = node('div', 'toolbar');
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
  toolbar.append(autoMatchBtn);
  content.append(toolbar);

  const rows = result.items.map((tx) => {
    const row = node('tr');
    row.append(
      node('td', '', dateText(tx.transaction_date)),
      node('td', '', tx.bank_name ? `${tx.bank_name} (${tx.bank_account})` : 'Ngân hàng'),
      node('td', 'code-preview', tx.reference_code || '—'),
      node('td', '', tx.description),
      node('td', '', money(tx.amount)),
      node('td')
    );
    row.children[5].append(statusBadge(tx.status));

    const actions = node('td');
    const group = node('div', 'actions');
    if (tx.status === 'UNMATCHED') {
      group.append(actionButton('Khớp thủ công', 'button-secondary', async () => {
        const invNo = window.prompt(`Nhập số hóa đơn muốn khớp cho giao dịch ${tx.reference_code}:`);
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

  content.append(panel('Giao dịch sao kê ngân hàng', table(['Ngày GD', 'Tài khoản ngân hàng', 'Mã GD (FT)', 'Nội dung chuyển khoản', 'Số tiền', 'Trạng thái khớp', 'Thao tác'], rows)));
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

    const customerList = data?.matrix || data?.customers || [];
    const summary = data?.summary || {
      total_current: '0',
      total_1_30: '0',
      total_31_60: '0',
      total_61_90: '0',
      total_90_plus: '0',
      total_receivables: '0'
    };

    const rows = customerList.map((c) => {
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

    const summarySection = node('div', 'summary-grid');
    summarySection.append(
      node('div', 'summary-item good', node('div', 'summary-label', 'Nợ hiện tại (Trong hạn)'), node('div', 'summary-value', money(summary.total_current || 0))),
      node('div', 'summary-item warn', node('div', 'summary-label', 'Quá hạn 1 - 60 ngày'), node('div', 'summary-value', money(Number(summary.total_1_30 || 0) + Number(summary.total_31_60 || 0)))),
      node('div', 'summary-item accent', node('div', 'summary-label', 'Nợ xấu (> 90 ngày)'), node('div', 'summary-value', money(summary.total_90_plus || 0))),
      node('div', 'summary-item info', node('div', 'summary-label', 'Tổng công nợ'), node('div', 'summary-value', money(summary.total_receivables || 0)))
    );

    content.append(summarySection);
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

    const statsPanel = node('div', 'panel');
    statsPanel.append(node('p', '', `Tổng số khách hàng hoạt động có phát sinh doanh thu: ${data.active_customers} khách hàng.`));
    content.append(statsPanel);

  } else if (currentTab === 'vat') {
    const data = await api('/reports/vat-declaration');
    const grid = node('div', 'summary-grid');
    grid.append(
      node('div', 'summary-item', node('div', 'summary-label', 'Tổng doanh thu chưa thuế'), node('div', 'summary-value', money(data.totals.subtotal))),
      node('div', 'summary-item good', node('div', 'summary-label', 'Tổng thuế GTGT đầu ra'), node('div', 'summary-value', money(data.totals.vat_amount))),
      node('div', 'summary-item accent', node('div', 'summary-label', 'Tổng tiền sau thuế'), node('div', 'summary-value', money(data.totals.total))),
      node('div', 'summary-item info', node('div', 'summary-label', 'Số lượng HĐ hợp lệ'), node('div', 'summary-value', `${data.totals.invoice_count} HĐ`))
    );
    content.append(grid);

    const rows = data.invoices.map((inv) => {
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
  const result = await api('/audit?limit=100');
  content.append(pageHeading('Nhật ký kiểm toán hệ thống', 'Audit Trail ghi nhận bất biến mọi thay đổi trạng thái hóa đơn và dòng tiền.'));

  const toolbar = node('div', 'toolbar');
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
  toolbar.append(verifyBtn);
  content.append(toolbar);

  const rows = result.items.map((log) => {
    const row = node('tr');
    row.append(
      node('td', '', new Date(log.created_at).toLocaleString('vi-VN')),
      node('td', '', log.username || `User #${log.user_id}`),
      node('td', '', log.action),
      node('td', '', `${log.entity_type} #${log.entity_id}`),
      node('td', 'code-preview small', (log.hash || '').slice(0, 16) + '...'),
      node('td')
    );
    row.children[5].append(statusBadge(log.severity || 'INFO'));
    return row;
  });

  content.append(panel('Danh sách bản ghi kiểm toán', table(['Thời điểm', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Mã băm SHA-256', 'Mức độ'], rows)));
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

  const content = renderShell(route.split('?')[0]);
  try {
    if (route.startsWith('/customers')) await renderCustomers(content);
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