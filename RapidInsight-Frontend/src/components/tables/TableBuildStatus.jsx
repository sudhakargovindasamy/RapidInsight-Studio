import React from 'react';

export default function TableBuildStatus({ status, rowCount = 0 }) {
  const normalizedStatus = status || 'NOT_BUILT';

  return (
    <div className="tb-status-box">
      <div>
        <span className="tb-status-label">Table Status</span>
        <strong>{normalizedStatus}</strong>
      </div>

      <div>
        <span className="tb-status-label">Rows</span>
        <strong>{rowCount}</strong>
      </div>
    </div>
  );
}
