import React from 'react';

const SYSTEM_COLUMNS = new Set([
  '__ris_id',
  '__ris_generated_table_id',
  '__ris_created_by',
  '__ris_created_at'
]);

export default function TableRowsViewer({ rows = [] }) {
  if (!rows.length) {
    return (
      <div className="empty-state">
        No rows found in this table.
      </div>
    );
  }

  const columns = Object.keys(rows[0]).filter(
    (column) => !SYSTEM_COLUMNS.has(column)
  );

  return (
    <div className="table-viewer-scroll">
      <table className="table-rows-viewer">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.__ris_id || rowIndex}>
              {columns.map((column) => (
                <td key={column}>
                  {row[column] === null || row[column] === undefined
                    ? ''
                    : String(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
