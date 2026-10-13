import './SchemaPreviewTable.css';

const TYPE_COLORS = {
  serial: 'badge-purple',
  string: 'badge-green',
  integer: 'badge-yellow',
  boolean: 'badge-yellow',
  timestamp: 'badge-purple',
  decimal: 'badge-green',
  text: 'badge-green',
  uuid: 'badge-purple',
  email: 'badge-green',
  number: 'badge-yellow',
  date: 'badge-purple',
  enum: 'badge-yellow',
};

/** Render a boolean column value as Yes / No / — */
function BoolCell({ value }) {
  if (value === true) {
    return <span className="preview-bool preview-bool--yes">Yes</span>;
  }
  if (value === false) {
    return <span className="preview-bool preview-bool--no">No</span>;
  }
  return <span className="preview-none">—</span>;
}

function SkeletonRow() {
  return (
    <tr className="skeleton-row">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i}>
          <div className="skeleton-cell" style={{ width: `${40 + i * 10}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function SchemaPreviewTable({ schema, isLoading }) {
  /* Loading skeleton */
  if (isLoading) {
    return (
      <div className="preview-table-wrapper">
        <div className="preview-table-header">
          <h3 className="preview-table-title">Schema Preview</h3>
          <span className="badge badge-yellow">Parsing…</span>
        </div>
        <div className="preview-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Column Name</th>
                <th>Type</th>
                <th>Primary Key</th>
                <th>Required</th>
                <th>Unique</th>
                <th>Faker</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* Empty / no file state */
  if (!schema) {
    return (
      <div className="preview-table-wrapper preview-table-wrapper--empty">
        <div className="preview-table-header">
          <h3 className="preview-table-title">Schema Preview</h3>
        </div>
        <div className="preview-empty-state">
          <div className="preview-empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <p className="preview-empty-heading">No schema loaded yet</p>
          <p className="preview-empty-sub">
            Upload a <code>.json</code>, <code>.yaml</code>, or <code>.csv</code> schema file above to see the field preview here.
          </p>
        </div>
      </div>
    );
  }

  /* Schema loaded */
  const columns = schema.columns || schema.fields || [];

  return (
    <div className="preview-table-wrapper animate-fade-in">
      <div className="preview-table-header">
        <div>
          <h3 className="preview-table-title">Schema Preview</h3>
          <p className="preview-table-subtitle">
            Table: <strong>{schema.tableName || schema.name || '—'}</strong>
          </p>
        </div>
        <span className="badge badge-green">{columns.length} fields</span>
      </div>

      <div className="preview-table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Column Name</th>
              <th>Type</th>
              <th>Primary Key</th>
              <th>Required</th>
              <th>Unique</th>
              <th>Faker</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, idx) => (
              <tr key={col.name || idx} className="preview-table-row">
                <td className="preview-col-index">{idx + 1}</td>
                <td className="preview-col-name">
                  <code>{col.name}</code>
                  {col.primaryKey && (
                    <span className="preview-pk-badge" title="Primary Key">🔑</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${TYPE_COLORS[col.type] || 'badge-purple'}`}>
                    {col.type}
                  </span>
                </td>
                <td className="preview-bool-cell">
                  <BoolCell value={col.primaryKey ?? undefined} />
                </td>
                <td className="preview-bool-cell">
                  <BoolCell value={col.notNull ?? undefined} />
                </td>
                <td className="preview-bool-cell">
                  <BoolCell value={col.unique ?? undefined} />
                </td>
                <td>
                  {col.faker
                    ? <code className="preview-faker">{col.faker}</code>
                    : <span className="preview-none">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
