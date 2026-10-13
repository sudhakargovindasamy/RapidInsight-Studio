function getPagination(query) {
  const page = Math.max(Number(query.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize || 50), 1), 100);
  const offset = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    offset
  };
}

module.exports = { getPagination };