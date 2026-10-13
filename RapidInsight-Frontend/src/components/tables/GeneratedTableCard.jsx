import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import GenerateDataModal from './GenerateDataModal.jsx';
import TableBuildStatus from './TableBuildStatus.jsx';

export default function GeneratedTableCard({ table, onRefresh }) {
  const navigate = useNavigate();
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  if (!table) {
    return null;
  }

  const displayName =
    table.display_name ||
    table.physical_table_name ||
    'Generated Table';

  return (
    <div className="generated-table-card">
      <div className="generated-table-card-header">
        <div>
          <h3>{displayName}</h3>
          <p>{table.physical_table_name}</p>
        </div>

        <span className="type-badge">
          {table.status || 'CREATED'}
        </span>
      </div>

      <TableBuildStatus
        status={table.table_status || table.status}
        rowCount={table.row_count || 0}
      />

      <div className="generated-table-meta">
        <span>
          <strong>Schema:</strong> {table.schema_id}
        </span>
        <span>
          <strong>Project:</strong> {table.project_id}
        </span>
        <span>
          <strong>Created:</strong>{' '}
          {table.created_at
            ? new Date(table.created_at).toLocaleString()
            : 'N/A'}
        </span>
      </div>

      <div className="generated-table-actions">
        <button
          className="primary-btn"
          onClick={() => navigate(`/tables/${table.id}`)}
        >
          View Rows
        </button>

        <button
          className="secondary-btn"
          onClick={() => setShowGenerateModal(true)}
        >
          Generate Data
        </button>
      </div>

      {showGenerateModal && (
        <GenerateDataModal
          schemaId={table.schema_id}
          onClose={() => setShowGenerateModal(false)}
          onSuccess={() => {
            setShowGenerateModal(false);
            onRefresh?.();
          }}
        />
      )}
    </div>
  );
}
