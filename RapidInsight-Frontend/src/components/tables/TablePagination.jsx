import React from 'react';

export default function TablePagination({
  page,
  pageSize,
  total,
  onPageChange
}) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="table-pagination">
      <button
        className="secondary-btn"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>

      <span>
        Page <strong>{page}</strong> of <strong>{totalPages}</strong>
      </span>

      <button
        className="secondary-btn"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
