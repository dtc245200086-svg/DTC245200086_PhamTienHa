const root = document.querySelector('#app');
let currentUser = null;
let fieldSequence = 0;

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

function panel(title, content, extraClass = '') {
  const section = node('section', `panel ${extraClass}`.trim());
  const heading = node('div', 'panel-title');
  heading.append(node('h2', '', title));
  section.append(heading, content);
  return section;
}

function alertBox(message, kind = '') {
  return node('div', `alert ${kind ? `alert-${kind}` : ''}`.trim(), message);
}

function makeField(labelText, { name, type = 'text', value = '', required = false, placeholder = '', maxLength, options } = {}) {
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
  brandText.append(node('p', 'brand-name', 'Billing'), node('p', 'brand-caption', 'Quản lý hóa đơn'));
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
  brandText.append(node('p', 'brand-name', 'Billing'), node('p', 'brand-caption', 'Quản lý hóa đơn'));
  brand.append(brandText);
  const nav = node('nav', 'nav-list');
  const routes = [
    ['Tổng quan', '#/'],
    ['Khách hàng', '#/customers'],
    ['Hóa đơn', '#/invoices'],
    ['Thanh toán', '#/payments']
  ];
  for (const [label, href] of routes) {
    const link = anchor(label, href, 'nav-link');
    const expected = href.slice(1);
    const current = path === '/' ? '/' : `/${path.split('/')[1]}`;
    if (current === expected) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  sidebar.append(brand, nav, node('div', 'sidebar-footer', 'Đề 18 · YC2 / CP2'));

  const column = node('div', 'main-column');
  const topbar = node('header', 'topbar');
  topbar.append(node('span', 'topbar-user', `${currentUser.username} · ${currentUser.role}`));
  topbar.append(actionButton('Đăng xuất', 'button-quiet', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setHash('/login');
    }
  }));
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

async function renderDashboard(content) {
  content.append(pageHeading('Tổng quan', 'Tình hình hóa đơn và công nợ.'));
  const summary = await api('/dashboard/summary');
  const grid = node('div', 'summary-grid');
  const values = [
    ['Đã thu', money(summary.collected)],
    ['Công nợ còn lại', money(summary.outstanding)],
    ['Đang quá hạn', summary.overdue_count],
    ['Đã thanh toán', summary.by_status.PAID || '0']
  ];
  for (const [label, value] of values) {
    const item = node('section', 'summary-item');
    item.append(node('div', 'summary-label', label), node('div', 'summary-value', value));
    grid.append(item);
  }
  content.append(grid);
  const statuses = Object.entries(summary.by_status).map(([status, count]) => {
    const row = node('tr');
    row.append(node('td', '', status), node('td', '', count));
    return row;
  });
  content.append(panel('Hóa đơn theo trạng thái', table(['Trạng thái', 'Số lượng'], statuses)));
}

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
  const heading = pageHeading('Khách hàng', 'Thông tin liên hệ và mã số thuế.', anchor('Thêm khách hàng', '#/customers/new', 'button button-primary'));
  content.append(heading);

  const searchForm = node('form', 'inline-form');
  const searchField = makeField('Tìm kiếm', { name: 'q', value: search, placeholder: 'Tên, email, điện thoại hoặc mã số thuế' });
  const searchButton = node('button', 'button button-secondary', 'Tìm');
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
    name.append(node('strong', '', customer.name), node('div', 'small muted', customer.email || ''));
    const phone = node('td', '', customer.phone || '—');
    const tax = node('td', '', customer.tax_code || '—');
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
    row.append(name, phone, tax, actions);
    return row;
  });
  content.append(panel('Danh sách khách hàng', table(['Khách hàng', 'Điện thoại', 'Mã số thuế', 'Thao tác'], rows)));
}

async function renderCustomerForm(content, customerId) {
  const editing = Boolean(customerId);
  const existing = editing ? (await api(`/customers/${customerId}`)).customer : {};
  content.append(pageHeading(editing ? 'Sửa khách hàng' : 'Thêm khách hàng', 'Email có thể để trống; nếu nhập phải là duy nhất.', anchor('Quay lại', '#/customers')));
  const form = node('form', 'panel');
  const grid = node('div', 'form-grid');
  const fields = [
    makeField('Tên khách hàng', { name: 'name', value: existing.name, required: true, maxLength: 200 }),
    makeField('Email', { name: 'email', type: 'email', value: existing.email, maxLength: 320 }),
    makeField('Điện thoại', { name: 'phone', value: existing.phone, maxLength: 40 }),
    makeField('Mã số thuế', { name: 'tax_code', value: existing.tax_code, maxLength: 32 }),
    makeField('Địa chỉ', { name: 'address', type: 'textarea', value: existing.address })
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
    const body = Object.fromEntries(fields.map(({ control }) => [control.name, control.value]));
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

function statusBadge(status) {
  let kind = '';
  if (status === 'PAID') kind = 'badge-paid';
  else if (status === 'CANCELLED') kind = 'badge-cancelled';
  else if (status === 'DRAFT') kind = 'badge-draft';
  else kind = 'badge-open';
  return node('span', `badge ${kind}`, status);
}

async function renderInvoices(content) {
  const edit = location.hash.match(/^#\/invoices\/(\d+)\/edit$/);
  const detail = location.hash.match(/^#\/invoices\/(\d+)(?:\/(?:payment|cancel))?$/);
  const print = location.hash.match(/^#\/invoices\/(\d+)\/print$/);
  if (edit) return renderInvoiceForm(content, edit[1]);
  if (location.hash === '#/invoices/new') return renderInvoiceForm(content);
  if (detail) return renderInvoiceDetail(content, detail[1]);
  if (print) return renderInvoicePrint(content, print[1]);

  const result = await api('/invoices?limit=100');
  content.append(pageHeading('Hóa đơn', 'Bản nháp, hóa đơn đã phát hành và trạng thái thanh toán.', anchor('Tạo hóa đơn', '#/invoices/new', 'button button-primary')));
  const rows = result.items.map((invoice) => {
    const row = node('tr');
    row.append(
      node('td', '', invoice.invoice_no || `DRAFT-${invoice.id}`),
      node('td', '', invoice.customer_name),
      node('td', '', dateText(invoice.issue_date)),
      node('td', '', money(invoice.total)),
      node('td', '', money(invoice.paid_total)),
      node('td')
    );
    row.children[5].append(statusBadge(invoice.status));
    const actions = node('td');
    const group = node('div', 'actions');
    group.append(anchor('Mở', `#/invoices/${invoice.id}`));
    if (invoice.status === 'DRAFT') group.append(anchor('Sửa', `#/invoices/${invoice.id}/edit`));
    actions.append(group);
    row.replaceChild(actions, row.children[5]);
    return row;
  });
  content.append(panel('Danh sách hóa đơn', table(['Số hóa đơn', 'Khách hàng', 'Ngày phát hành', 'Tổng cộng', 'Đã thanh toán', 'Thao tác'], rows)));
}

async function renderInvoiceForm(content, invoiceId) {
  const editing = Boolean(invoiceId);
  const existing = editing ? (await api(`/invoices/${invoiceId}`)).invoice : null;
  const customers = await api('/customers?limit=100');
  content.append(pageHeading(editing ? 'Sửa hóa đơn nháp' : 'Tạo hóa đơn nháp', 'Số hóa đơn chỉ được cấp khi phát hành; tổng tiền do PostgreSQL tính.', anchor('Quay lại', editing ? `#/invoices/${invoiceId}` : '#/invoices')));

  const form = node('form', 'panel stack');
  const grid = node('div', 'form-grid');
  const customerField = makeField('Khách hàng', {
    name: 'customer_id',
    type: 'select',
    required: true,
    options: customers.items.map((customer) => ({ value: String(customer.id), label: customer.name }))
  });
  customerField.control.value = existing ? String(existing.customer_id) : (customers.items[0] ? String(customers.items[0].id) : '');
  const dueDate = makeField('Hạn thanh toán', { name: 'due_date', type: 'date', value: dateText(existing?.due_date) === '—' ? '' : dateText(existing?.due_date), required: true });
  const taxRate = makeField('Thuế suất', {
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
  taxRate.control.value = existing?.tax_rate || '0';
  grid.append(customerField.wrapper, dueDate.wrapper, taxRate.wrapper);

  const itemPanel = node('section', 'stack');
  const itemTitle = node('div', 'panel-title');
  itemTitle.append(node('h3', '', 'Dòng hàng'));
  const itemRows = node('div', 'item-list');
  const initialItems = existing?.items?.length ? existing.items : [{ description: '', quantity: '1', unit_price: '' }];
  const addItem = (item = {}) => {
    const row = node('div', 'invoice-item');
    const description = makeField('Mô tả', { name: 'description', value: item.description, required: true, maxLength: 500 });
    const quantity = makeField('Số lượng', { name: 'quantity', type: 'text', value: item.quantity || '1', required: true, placeholder: '1.000' });
    quantity.control.inputMode = 'decimal';
    const unitPrice = makeField('Đơn giá (VND)', { name: 'unit_price', type: 'text', value: item.unit_price, required: true, placeholder: '0.00' });
    unitPrice.control.inputMode = 'decimal';
    const remove = actionButton('Bỏ dòng', 'button-quiet remove-item', () => row.remove());
    row.append(description.wrapper, quantity.wrapper, unitPrice.wrapper, remove);
    itemRows.append(row);
  };
  for (const item of initialItems) addItem(item);
  itemTitle.append(actionButton('Thêm dòng', 'button-secondary', () => addItem()));
  itemPanel.append(itemTitle, itemRows);
  const message = node('div');
  const actions = node('div', 'form-actions');
  const save = node('button', 'button button-primary', 'Lưu bản nháp');
  save.type = 'submit';
  actions.append(save, anchor('Hủy', editing ? `#/invoices/${invoiceId}` : '#/invoices'));
  form.append(grid, itemPanel, actions, message);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.replaceChildren();
    const items = Array.from(itemRows.querySelectorAll('.invoice-item')).map((row) => ({
      description: row.querySelector('[name="description"]').value,
      quantity: row.querySelector('[name="quantity"]').value,
      unit_price: row.querySelector('[name="unit_price"]').value
    }));
    const body = {
      customer_id: customerField.control.value,
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
  content.append(pageHeading(
    invoice.invoice_no || `Bản nháp DRAFT-${invoice.id}`,
    `Khách hàng: ${invoice.customer_name}`,
    anchor('In hóa đơn', `#/invoices/${invoice.id}/print`)
  ));
  const details = node('div', 'detail-grid');
  for (const [label, value] of [
    ['Trạng thái', invoice.status],
    ['Ngày phát hành', dateText(invoice.issue_date)],
    ['Hạn thanh toán', dateText(invoice.due_date)],
    ['Tạm tính', money(invoice.subtotal)],
    ['Thuế', money(invoice.tax_amount)],
    ['Tổng cộng', money(invoice.total)],
    ['Đã thanh toán', money(invoice.paid_total)]
  ]) {
    const item = node('div', 'detail-item');
    item.append(node('div', 'detail-label', label), node('div', 'detail-value', value));
    details.append(item);
  }
  content.append(panel('Chi tiết hóa đơn', details));

  const itemRows = invoice.items.map((item) => {
    const row = node('tr');
    row.append(node('td', '', item.description), node('td', '', item.quantity), node('td', '', money(item.unit_price)), node('td', '', money(item.line_total)));
    return row;
  });
  content.append(panel('Dòng hàng', table(['Mô tả', 'Số lượng', 'Đơn giá', 'Thành tiền'], itemRows)));

  const paymentRows = invoice.payments.map((payment) => {
    const row = node('tr');
    row.append(node('td', '', dateText(payment.paid_at)), node('td', '', payment.method), node('td', '', money(payment.amount)), node('td', '', payment.reference || '—'));
    return row;
  });
  content.append(panel('Lịch sử thanh toán', table(['Ngày', 'Phương thức', 'Số tiền', 'Tham chiếu'], paymentRows)));

  const actions = node('div', 'form-actions no-print');
  if (invoice.status === 'DRAFT') {
    actions.append(anchor('Sửa bản nháp', `#/invoices/${invoice.id}/edit`));
    actions.append(actionButton('Phát hành', 'button-primary', async () => {
      try {
        await api(`/invoices/${invoice.id}/issue`, { method: 'POST', body: JSON.stringify({}) });
        setHash(`/invoices/${invoice.id}`);
      } catch (error) {
        content.prepend(alertBox(error.message, 'error'));
      }
    }));
  }
  if (['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)) {
    actions.append(actionButton('Ghi nhận thanh toán', 'button-primary', () => setHash(`#/invoices/${invoice.id}/payment`)));
  }
  if (currentUser.role === 'admin' && ['DRAFT', 'ISSUED'].includes(invoice.status) && isZero(invoice.paid_total)) {
    actions.append(actionButton('Hủy hóa đơn', 'button-danger', () => setHash(`#/invoices/${invoice.id}/cancel`)));
  }
  content.append(actions);

  if (location.hash === `#/invoices/${invoice.id}/payment`) await renderPaymentForm(content, invoice);
  if (location.hash === `#/invoices/${invoice.id}/cancel`) await renderCancelForm(content, invoice);
}

async function renderPaymentForm(content, invoice) {
  const form = node('form', 'panel no-print');
  form.append(node('h3', '', `Thanh toán · còn nợ ${money(invoice.outstanding)}`));
  const amount = makeField('Số tiền (VND)', { name: 'amount', type: 'text', required: true, placeholder: '0.00' });
  amount.control.inputMode = 'decimal';
  const method = makeField('Phương thức', {
    name: 'method',
    type: 'select',
    options: [
      { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
      { value: 'CASH', label: 'Tiền mặt' },
      { value: 'CARD', label: 'Thẻ' }
    ]
  });
  const paidAt = makeField('Ngày thanh toán', { name: 'paid_at', type: 'date', value: new Date().toISOString().slice(0, 10), required: true });
  const reference = makeField('Mã tham chiếu', { name: 'reference', maxLength: 120 });
  const grid = node('div', 'form-grid');
  grid.append(amount.wrapper, method.wrapper, paidAt.wrapper, reference.wrapper);
  const message = node('div');
  const submit = node('button', 'button button-primary', 'Lưu thanh toán');
  submit.type = 'submit';
  form.append(grid, submit, message);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/invoices/${invoice.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: amount.control.value, method: method.control.value, paid_at: paidAt.control.value, reference: reference.control.value })
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
  form.append(node('h3', '', `Hủy hóa đơn ${invoice.invoice_no || invoice.id}`));
  const reason = makeField('Lý do hủy', { name: 'reason', type: 'textarea', required: true, maxLength: 2000 });
  const message = node('div');
  const submit = node('button', 'button button-danger', 'Xác nhận hủy');
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
  content.append(pageHeading('Hóa đơn', invoice.invoice_no || `DRAFT-${invoice.id}`, actionButton('In', 'button-primary', () => window.print())));
  content.append(node('p', '', `Khách hàng: ${invoice.customer_name}`));
  content.append(table(['Mô tả', 'Số lượng', 'Đơn giá', 'Thành tiền'], invoice.items.map((item) => {
    const row = node('tr');
    row.append(node('td', '', item.description), node('td', '', item.quantity), node('td', '', money(item.unit_price)), node('td', '', money(item.line_total)));
    return row;
  })));
  content.append(node('p', 'detail-value', `Tổng cộng: ${money(invoice.total)}`));
}

async function renderPayments(content) {
  const result = await api('/payments?limit=100');
  content.append(pageHeading('Thanh toán', 'Lịch sử các khoản thanh toán đã ghi nhận.'));
  const rows = result.items.map((payment) => {
    const row = node('tr');
    row.append(
      node('td', '', dateText(payment.paid_at)),
      node('td', '', payment.invoice_no || `#${payment.invoice_id}`),
      node('td', '', payment.method),
      node('td', '', money(payment.amount)),
      node('td', '', payment.reference || '—')
    );
    return row;
  });
  content.append(panel('Khoản thanh toán', table(['Ngày', 'Hóa đơn', 'Phương thức', 'Số tiền', 'Tham chiếu'], rows)));
}

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
    else if (route.startsWith('/invoices')) await renderInvoices(content);
    else if (route.startsWith('/payments')) await renderPayments(content);
    else await renderDashboard(content);
  } catch (error) {
    content.prepend(alertBox(error.message, 'error'));
  }
}

window.addEventListener('hashchange', render);
render();