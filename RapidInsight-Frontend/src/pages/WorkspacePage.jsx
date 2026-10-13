import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './WorkspacePage.css';

export default function WorkspacePage() {
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('schema_id');

  const [schemas, setSchemas]       = useState([]);
  const [tables,  setTables]        = useState([]);  // active PG table names
  const [fetching, setFetching]     = useState(false);
  const [error, setError]           = useState('');
  const [actionMsg, setActionMsg]   = useState('');

  async function fetchData() {
    setFetching(true);
    setError('');
    setActionMsg('');
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Not logged in.');

      // Schemas
      const schemasRes  = await fetch(`${import.meta.env.VITE_API_BASE_URL}/schema/my`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const schemasBody = await schemasRes.json();
      if (!schemasRes.ok) throw new Error(schemasBody.error || 'Failed to load schemas');
      setSchemas(schemasBody.schemas || []);

      // Active tables from PG via table-service
      const tablesRes  = await fetch(`${import.meta.env.VITE_API_BASE_URL}/tables/list`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const tablesBody = await tablesRes.json();
      if (!tablesRes.ok) throw new Error(tablesBody.error || 'Failed to load tables');
      setTables(tablesBody.tables || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => { fetchData(); /* eslint-disable-line */ }, []);

  async function handleBuild(schemaId) {
    setActionMsg('Building table…');
    setError('');
    try {
      const token = await getAccessToken();
      const res   = await fetch(`${import.meta.env.VITE_API_BASE_URL}/tables/build/${schemaId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ rows: [] })
      });
      const data  = await res.json();
      if (!res.ok) throw new Error(data.error || 'Build failed');
      setActionMsg(`✓ Table "${data.table}" built successfully.`);
      await fetchData();
    } catch (e) {
      setError(e.message);
      setActionMsg('');
    }
  }

  async function handleDrop(schemaId) {
    if (!confirm('Drop this table? All data will be lost.')) return;
    setActionMsg('Dropping table…');
    setError('');
    try {
      const token = await getAccessToken();
      const res   = await fetch(`${import.meta.env.VITE_API_BASE_URL}/tables/${schemaId}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data  = await res.json();
      if (!res.ok) throw new Error(data.error || 'Drop failed');
      setActionMsg(`✓ Table "${data.table}" dropped.`);
      await fetchData();
    } catch (e) {
      setError(e.message);
      setActionMsg('');
    }
  }

  const builtCount = schemas.filter(s => tables.includes(s.name)).length;

  return (
    <div className="schema-container">
      {/* ── Hero ──────────────────────────────────── */}
      <section className="hero-card wp-hero">
        <span className="hero-kicker">Data Warehouse</span>
        <h1>Workspace</h1>
        <p>Turn schemas into live PostgreSQL tables — build, inspect, export, and drop.</p>
      </section>

      {/* ── Summary pills ─────────────────────────── */}
      <div className="wp-summary-bar">
        <div className="wp-stat">
          <div className="wp-stat-value">{schemas.length}</div>
          <div className="wp-stat-label">Schemas</div>
        </div>
        <div className="wp-stat">
          <div className="wp-stat-value">{builtCount}</div>
          <div className="wp-stat-label">Active Tables</div>
        </div>
        <div className="wp-stat">
          <div className="wp-stat-value">{schemas.length - builtCount}</div>
          <div className="wp-stat-label">Not Built</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="refresh-btn" onClick={fetchData} disabled={fetching}>
          {fetching ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* ── Feedback ──────────────────────────────── */}
      {error     && <div className="error-box"   style={{ marginBottom: 20 }}>Error: {error}</div>}
      {actionMsg && <div className="success-box" style={{ marginBottom: 20, padding: '14px 20px' }}>{actionMsg}</div>}

      {/* ── Table ─────────────────────────────────── */}
      <div className="panel">
        {!fetching && schemas.length === 0 && (
          <div className="empty-state">
            <p style={{ marginBottom: 16 }}>No schemas found. Upload one first.</p>
            <button className="upload-btn" style={{ width: 'auto', padding: '0 28px' }}
              onClick={() => navigate('/schema-upload')}>Go to Upload</button>
          </div>
        )}

        {schemas.length > 0 && (
          <div className="wp-table-wrap">
            <table className="wp-table">
              <thead>
                <tr>
                  <th>Schema Name</th>
                  <th>Type</th>
                  <th>Fields</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {schemas.map(s => {
                  const isBuilt   = tables.includes(s.name);
                  const isHighlit = s.id === highlightId;
                  return (
                    <tr key={s.id} className={isHighlit ? 'wp-row-highlight' : ''}>
                      <td className="wp-schema-name">
                        {s.name || s.original_file_name}
                        {isHighlit && <span className="wp-highlight-pill">selected</span>}
                      </td>
                      <td><span className="type-badge" style={{ fontSize: 11 }}>{s.file_type}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{s.field_count ?? '—'}</td>
                      <td>
                        {isBuilt
                          ? <span className="wp-status wp-status--active">● Active</span>
                          : <span className="wp-status wp-status--idle">○ Not built</span>
                        }
                      </td>
                      <td>
                        <div className="wp-actions">
                          {isBuilt ? (
                            <>
                              <button className="theme-btn wp-btn" disabled title="Coming soon">
                                View Data
                              </button>
                              <button
                                className="logout-btn wp-btn"
                                style={{ boxShadow: 'none' }}
                                onClick={() => handleDrop(s.id)}
                              >
                                Drop Table
                              </button>
                            </>
                          ) : (
                            <button
                              className="upload-btn wp-btn"
                              onClick={() => handleBuild(s.id)}
                            >
                              Build Table
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
