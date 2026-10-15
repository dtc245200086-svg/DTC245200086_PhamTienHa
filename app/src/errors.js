class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    if (details) {
      this.details = details;
      if (details.customer_id !== undefined) this.customer_id = details.customer_id;
      if (details.customer_status !== undefined) this.customer_status = details.customer_status;
    }
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { AppError, asyncRoute };