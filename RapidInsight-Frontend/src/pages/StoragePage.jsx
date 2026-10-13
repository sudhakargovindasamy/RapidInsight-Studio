import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import './StoragePage.css';

export default function StoragePage() {
  const { getAccessToken } = useAuth();

  const [files, setFiles]       = useState([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError]       = useState('');

  async function fetchStorageFiles() {
    setFetching(true);
    setError('');
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Not logged in.');

      // Get schemas to know user bucket paths
      const res  = await fetch(`${import.meta.env.VITE_API_BASE_URL}/schema/my`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.details || body.message || body.error || 'Failed');

      const schemas = body.schemas || [];

      // Generate signed download URLs for each file
      const enriched = await Promise.all(
        schemas.map(async (s) => {
          let signedUrl = null;
          if (s.storage_bucket && s.storage_path) {
            const { data } = await supabase.storage
              .from(s.storage_bucket)
              .createSignedUrl(s.storage_path, 3600);
            signedUrl = data?.signedUrl ?? null;
          }
          return { ...s, signedUrl };
        })
      );

      setFiles(enriched);
    } catch (e) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => { fetchStorageFiles(); /* eslint-disable-line */ }, []);

  const totalFiles  = files.length;

  return (
    <div className="schema-container">
      {/* ── Hero ──────────────────────────────────── */}
      <section className="hero-card sp-hero">
        <span className="hero-kicker">Supabase Storage</span>
        <h1>File Storage</h1>
        <p>Raw uploaded schema files stored in your private cloud bucket.</p>
      </section>

      {/* ── Summary + Table grid ──────────────────── */}
      <div className="sp-grid">

        {/* Summary card */}
        <aside className="panel sp-summary">
          <h3 className="panel-title" style={{ fontSize: '17px', marginBottom: 24 }}>
            Storage Overview
          </h3>

          <div className="sp-stat">
            <div className="sp-stat-value">{totalFiles}</div>
            <div className="sp-stat-label">Total Files</div>
          </div>

          <div className="sp-stat" style={{ marginTop: 20 }}>
            <div className="sp-stat-value" style={{ fontSize: 22 }}>schema-files</div>
            <div className="sp-stat-label">Active Bucket</div>
          </div>

          <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border-color)' }}>
            <div className="sp-stat-label" style={{ marginBottom: 8 }}>Status</div>
            <span style={{
              display: 'inline-block',
              padding: '6px 12px',
              borderRadius: 8,
              background: 'var(--schema-success-soft)',
              color: 'var(--schema-success)',
              fontSize: 13,
              fontWeight: 800
            }}>● Connected</span>
          </div>
        </aside>

        {/* File table */}
        <div className="panel sp-table-panel">
          <div className="schemas-toolbar" style={{ alignItems: 'center', marginBottom: 20 }}>
            <div>
              <h3 className="panel-title">Bucket Contents</h3>
              <p className="panel-description">Click Download to get a 1-hour signed URL.</p>
            </div>
            <button className="refresh-btn" onClick={fetchStorageFiles} disabled={fetching}>
              {fetching ? 'Loading…' : '↻ Refresh'}
            </button>
          </div>

          {error && <div className="error-box">Error: {error}</div>}

          {!fetching && files.length === 0 && !error && (
            <div className="empty-state">No files in storage yet.</div>
          )}

          {files.length > 0 && (
            <div className="sp-table-wrap">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>File Name</th>
                    <th>Type</th>
                    <th>Storage Path</th>
                    <th>Bucket</th>
                    <th>Download</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map(f => (
                    <tr key={f.id}>
                      <td className="sp-filename">{f.original_file_name || f.name}</td>
                      <td><span className="type-badge" style={{ fontSize: 11 }}>{f.file_type}</span></td>
                      <td className="sp-path">{f.storage_path}</td>
                      <td className="sp-path">{f.storage_bucket}</td>
                      <td>
                        {f.signedUrl ? (
                          <a
                            href={f.signedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="refresh-btn"
                            style={{ padding: '6px 12px', fontSize: 12, display: 'inline-block' }}
                          >
                            ↓ Download
                          </a>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Unavailable</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
