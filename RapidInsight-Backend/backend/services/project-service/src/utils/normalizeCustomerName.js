function normalizeCustomerName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

module.exports = normalizeCustomerName;