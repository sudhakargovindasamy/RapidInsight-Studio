import './TableViewerPage.css';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getTableRows } from '../api/tableApi';

export default function TableViewerPage() {
  const { projectId, generatedTableId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [rows, setRows] = useState([]);
  const [tableInfo, setTableInfo] = useState(null);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1
  });

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const columns = useMemo(() => {
    if (!rows.length) return [];

    return Object.keys(rows[0]).filter((column) => {
      return ![
        '__ris_id',
        '__ris_generated_table_id',
        '__ris_created_by',
        '__ris_created_at'
      ].includes(column);
    });
  }, [rows]);

  async function fetchRows(page = 1) {
    try {
      setLoading(true);
      setErrorMessage('');

      const response = await getTableRows(
        generatedTableId,
        page,
        pagination.pageSize
      );

      setRows(response.data || response.rows || []);
      if (response.generatedTable) {
        setTableInfo(response.generatedTable);
      }

      setPagination({
        page: response.pagination?.page || response.page || page,
        pageSize: response.pagination?.pageSize || response.pageSize || pagination.pageSize,
        total: response.pagination?.total || response.total || 0,
        totalPages: response.pagination?.totalPages || Math.ceil((response.total || 0) / (response.pageSize || pagination.pageSize)) || 1
      });
    } catch (error) {
      setErrorMessage(error.message || 'Failed to fetch table rows.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRows(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedTableId]);

  function renderPagination() {
    return (
      <div className="table-pagination">
        <button
          type="button"
          className="secondary-btn"
          disabled={pagination.page <= 1}
          onClick={() => fetchRows(pagination.page - 1)}
        >
          Previous
        </button>

        <span>
          Page {pagination.page} of {pagination.totalPages}
        </span>

        <button
          type="button"
          className="secondary-btn"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => fetchRows(pagination.page + 1)}
        >
          Next
        </button>
      </div>
    );
  }

  return (
    <main className="schema-page table-viewer-page">
      <div className="schema-container">
        <section className="hero-card">
          <span className="hero-kicker">Table Viewer</span>
          <h1>{tableInfo?.physical_table_name || 'Generated Table'}</h1>
          <p>
            {tableInfo ? (
              <>
                Schema ID: <strong>{tableInfo.schema_id}</strong> <br />
                Total Rows: <strong>{tableInfo.row_count}</strong> <br />
                Created At: {new Date(tableInfo.created_at).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </>
            ) : (
              'Browse mock data inserted into your dynamically generated PostgreSQL table.'
            )}
          </p>
        </section>

        <section className="panel">
          <div className="table-viewer-header">
            <div>
              <h2>Generated Table Rows</h2>
              <p>
                Table ID: <strong>{generatedTableId}</strong>
              </p>
            </div>

            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                if (location.state?.from) {
                  navigate(location.state.from);
                  return;
                }

                navigate(-1);
              }}
            >
              Back
            </button>
          </div>

          {errorMessage && (
            <div className="error-box">
              {errorMessage}
            </div>
          )}

          {loading ? (
            <div className="empty-state">
              Loading table rows...
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              No rows found. Populate data first.
            </div>
          ) : (
            <>
              {renderPagination()}

              <div className="table-scroll" style={{ marginTop: '16px', marginBottom: '16px' }}>
                <table className="data-grid">
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((row, rowIndex) => (
                      <tr key={row.__ris_id || row.id || rowIndex}>
                        {columns.map((column) => (
                          <td key={column}>
                            {formatCellValue(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {renderPagination()}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function formatCellValue(value) {
  if (value === null || value === undefined) return '—';

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
