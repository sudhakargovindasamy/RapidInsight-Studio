import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import './MySchemasPage.css';

export default function MySchemasPage() {
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();

  const [schemas, setSchemas] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({}); // schema.id → bool
  const [copied, setCopied] = useState(null);

  async function fetchSchemas() {
    setFetching(true);
    setError('');
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Not logged in.');

      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/schema/my`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.details || body.message || body.error || 'Failed');
      setSchemas(body.schemas || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => { fetchSchemas(); /* eslint-disable-line */ }, []);

  async function toggleExpand(id) {
    // If we're expanding and we don't have fields yet, fetch them
    if (!expanded[id]) {
      const schema = schemas.find(s => s.id === id);
      if (schema && !schema.fields) {
        try {
          const token = await getAccessToken();
          const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/schema/${id}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            setSchemas(prev => prev.map(s =>
              s.id === id ? { ...s, fields: data.fields } : s
            ));
          }
        } catch (e) {
          console.error('Failed to fetch fields for schema', id, e);
        }
      }
    }
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function copyId(id) {
    await navigator.clipboard.writeText(id);
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  }

  const filtered = schemas.filter(s => {
    const q = search.toLowerCase();
    return (
      (s.name || s.original_file_name || '').toLowerCase().includes(q) ||
      (s.file_type || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="schema-container">
      {/* ── Hero ──────────────────────────────────── */}
      <section className="hero-card ms-hero">
        <span className="hero-kicker">Schema Library</span>
        <h1>My Schemas</h1>
        <p>Browse, search, and manage all your uploaded data schemas.</p>
      </section>

      {/* ── Toolbar ───────────────────────────────── */}
      <div className="ms-toolbar">
        <div className="ms-toolbar-left">
          <h2 className="panel-title" style={{ fontSize: '18px' }}>
            {filtered.length} / {schemas.length} schema{schemas.length !== 1 ? 's' : ''}
          </h2>
        </div>
        <div className="ms-toolbar-right">
          <input
            className="ms-search"
            type="text"
            placeholder="Search by name or type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="refresh-btn" onClick={fetchSchemas} disabled={fetching}>
            {fetching ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Error ─────────────────────────────────── */}
      {error && <div className="error-box" style={{ margin: '0 0 20px' }}>Error: {error}</div>}

      {/* ── Empty ─────────────────────────────────── */}
      {!fetching && filtered.length === 0 && (
        <div className="empty-state">
          {schemas.length === 0
            ? <><p style={{ marginBottom: 16 }}>No schemas uploaded yet.</p>
              <button className="upload-btn" style={{ width: 'auto', padding: '0 28px' }}
                onClick={() => navigate('/schema-upload')}>Upload your first schema</button></>
            : <p>No schemas match your search.</p>
          }
        </div>
      )}

      {/* ── Schema cards ─────────────────────────── */}
      <ul className="ms-list">
        {filtered.map(schema => (
          <li key={schema.id} className="ms-card">
            {/* Top row */}
            <div className="ms-card-top">
              <div className="ms-card-name">
                {schema.name || schema.original_file_name}
              </div>
              <div className="ms-card-badges">
                <span className="type-badge">{schema.file_type}</span>
                {schema.field_count != null && (
                  <span className="ms-field-count">{schema.field_count} fields</span>
                )}
              </div>
            </div>

            {/* Meta row */}
            <div className="ms-card-meta">
              <span>
                <strong>ID: </strong>
                <code className="ms-id">{schema.id}</code>
                <button className="ms-copy-btn" onClick={() => copyId(schema.id)}>
                  {copied === schema.id ? '✓ Copied' : 'Copy'}
                </button>
              </span>
              <span>
                <strong>Storage: </strong>
                <span className="storage-path-pill" style={{ padding: '4px 10px', fontSize: '12px' }}>
                  {schema.storage_path}
                </span>
              </span>
            </div>

            {/* Actions */}
            <div className="ms-card-actions">
              <button
                className="refresh-btn"
                style={{ padding: '7px 14px', fontSize: '13px' }}
                onClick={() => toggleExpand(schema.id)}
              >
                {expanded[schema.id] ? '▲ Hide Fields' : '▼ Show Fields'}
              </button>
              <button
                className="refresh-btn"
                style={{ padding: '7px 14px', fontSize: '13px' }}
                onClick={() => navigate(`/workspace?schema_id=${schema.id}`)}
              >
                Open in Workspace →
              </button>
            </div>

            {/* Expanded field list */}
            {expanded[schema.id] && schema.fields && (
              <div className="ms-fields">
                {schema.fields.map(f => (
                  <div key={f.name} className="ms-field-row">
                    <span className="ms-field-name">{f.name}</span>
                    <span className="ms-field-type">{f.type}</span>
                    {f.required && <span className="ms-field-req">required</span>}
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
