const { AppError } = require('./errors');

const DECIMAL_2 = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const DECIMAL_3 = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAX_RATE = /^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/;

function requireObject(value, code = 'INVALID_BODY') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, code, 'A JSON object is required.');
  }
  return value;
}

function parseId(value, field = 'id') {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AppError(400, 'INVALID_ID', `${field} must be a positive integer.`);
  }
  return parsed;
}

function parsePage(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const rawLimit = query.page_size !== undefined ? query.page_size : (query.limit !== undefined ? query.limit : 20);
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError(400, 'INVALID_PAGINATION', 'page and limit must be positive integers; limit is at most 100.');
  }
  return { page, limit, page_size: limit, offset: (page - 1) * limit };
}

function requireText(value, field, maxLength, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw new AppError(400, 'VALIDATION_ERROR', `${field} is required.`);
  }
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} must be text.`);
  }
  const normalized = value.trim();
  if (!normalized && optional) return null;
  if (!normalized || normalized.length > maxLength) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} is required and must not exceed ${maxLength} characters.`);
  }
  return normalized;
}

function requireDecimal(value, field, pattern = DECIMAL_2) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} must be a non-negative decimal string.`);
  }
  return value;
}

function requireDate(value, field, { optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return null;
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} is not a valid date.`);
  }
  return value;
}

function validateItems(items) {
  if (!Array.isArray(items)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'items must be an array.');
  }
  return items.map((item, index) => {
    requireObject(item, 'INVALID_ITEM');
    const sku = requireText(item.sku, `items[${index}].sku`, 64, { optional: true });
    const unit = requireText(item.unit, `items[${index}].unit`, 32, { optional: true }) || 'Đơn vị';
    const discountRaw = item.discount_percent === undefined || item.discount_percent === null || item.discount_percent === '' ? '0' : String(item.discount_percent);
    const discount = requireDecimal(discountRaw, `items[${index}].discount_percent`);
    if (Number(discount) < 0 || Number(discount) > 100) {
      throw new AppError(400, 'VALIDATION_ERROR', `items[${index}].discount_percent must be between 0 and 100.`);
    }
    const vatRateRaw = item.vat_rate === undefined || item.vat_rate === null || item.vat_rate === '' ? null : String(item.vat_rate);
    let vatRate = null;
    if (vatRateRaw !== null) {
      vatRate = requireDecimal(vatRateRaw, `items[${index}].vat_rate`, TAX_RATE);
      const vatNum = Number(vatRate);
      if (vatNum < 0 || vatNum > 0.20) {
        throw new AppError(400, 'VALIDATION_ERROR', `items[${index}].vat_rate must be between 0 and 0.20.`);
      }
    }
    return {
      sku: sku || null,
      description: requireText(item.description, `items[${index}].description`, 500),
      unit,
      quantity: requireDecimal(item.quantity, `items[${index}].quantity`, DECIMAL_3),
      unit_price: requireDecimal(item.unit_price, `items[${index}].unit_price`),
      discount_percent: discount,
      vat_rate: vatRate
    };
  });
}

module.exports = {
  requireObject,
  parseId,
  parsePage,
  requireText,
  requireDecimal,
  requireDate,
  validateItems
};