import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import UploadSchemaPanel from '../components/UploadSchemaPanel.jsx';
import { getProjectById } from '../api/projectApi.js';
import { getCatalogAssets, getCatalogColumns } from '../api/catalogApi.js';
import './RegistryAssetPage.css';

function formatFileSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  } catch {
    return iso;
  }
}

export default function RegistryAssetPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Registered assets list state
  const [assets, setAssets] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');

  // Schema Columns Modal State
  const [selectedAssetForCols, setSelectedAssetForCols] = useState(null);
  const [assetColumns, setAssetColumns] = useState([]);
  const [loadingCols, setLoadingCols] = useState(false);
  const [colsError, setColsError] = useState('');

  // Load project details
  useEffect(() => {
    async function loadProject() {
      try {
        setLoading(true);
        setError('');
        const response = await getProjectById(projectId);
        setProject(response.project || response.data || response);
      } catch (err) {
        setError(err.message || 'Failed to load project.');
      } finally {
        setLoading(false);
      }
    }

    if (projectId) loadProject();
  }, [projectId]);

  // Load registered assets list
  const loadRegisteredAssets = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoadingAssets(true);
      const res = await getCatalogAssets(projectId);
      const list = res?.data || res || [];
      setAssets(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load registered assets:', err);
    } finally {
      setLoadingAssets(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadRegisteredAssets();
  }, [loadRegisteredAssets]);

  // Load columns for inspection modal
  async function handleInspectColumns(asset) {
    setSelectedAssetForCols(asset);
    setAssetColumns([]);
    setColsError('');
    try {
      setLoadingCols(true);
      const res = await getCatalogColumns(projectId, asset.asset_id);
      const cols = res?.data || res || [];
      setAssetColumns(Array.isArray(cols) ? cols : []);
    } catch (err) {
      setColsError(err.message || 'Failed to load column metadata.');
    } finally {
      setLoadingCols(false);
    }
  }

  if (loading) {
    return (
      <div className="schema-container">
        <div className="empty-state">Loading project…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="schema-container">
        <div className="error-box">{error}</div>
      </div>
    );
  }

  const organisation = project?.organisation?.name || project?.organisation_name || 'Your Organisation';

  const filteredAssets = assets.filter((a) => {
    if (!assetSearch) return true;
    const q = assetSearch.toLowerCase();
    const name = (a.asset_name || '').toLowerCase();
    const source = (a.source_name || a.fq_name || '').toLowerCase();
    return name.includes(q) || source.includes(q);
  });

  return (
    <div className="schema-container pws-page registry-asset-page">
      <section className="hero-card pws-hero">
        <span className="hero-kicker">
          Project Workspace · {organisation}
        </span>
        <h1>{project?.name || 'Untitled Project'}</h1>
        <p>
          Register project assets and schema structures. Only metadata and column definitions are extracted and stored.
        </p>
      </section>

      <header className="pws-section-heading">
        <div>
          <h2>Asset Registry</h2>
          <p>
            Upload files (CSV, XLSX, XLS, JSON, YAML) or connect databases to extract and register asset metadata without importing business rows.
          </p>
        </div>
      </header>

      {/* Upload Zone */}
      <div className="registry-asset-upload-wrap">
        <UploadSchemaPanel
          projectId={projectId}
          onUploaded={loadRegisteredAssets}
        />
      </div>

      {/* Registered Assets List Section */}
      <section className="registered-assets-section">
        <div className="registered-assets-header">
          <div>
            <h3>Registered Assets ({assets.length})</h3>
            <p>Saved asset metadata and schema specifications in this project</p>
          </div>
          <div className="registered-assets-actions">
            <input
              type="text"
              placeholder="Search assets..."
              className="registered-assets-search"
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
            />
            <button
              type="button"
              className="secondary-btn small-btn"
              onClick={loadRegisteredAssets}
              disabled={loadingAssets}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {loadingAssets ? (
          <div className="empty-state">Loading registered assets...</div>
        ) : filteredAssets.length === 0 ? (
          <div className="empty-state">
            <p>No registered assets found.</p>
            <span className="empty-subtext">
              {assets.length === 0
                ? 'Upload a file above to register its metadata into the Asset Registry.'
                : 'No assets match your search.'}
            </span>
          </div>
        ) : (
          <div className="registered-assets-table-wrap">
            <table className="registered-assets-table">
              <thead>
                <tr>
                  <th>Asset Name</th>
                  <th>Source File</th>
                  <th>Format</th>
                  <th>Columns</th>
                  <th>Size</th>
                  <th>Registered At</th>
                  <th>Data Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((asset) => {
                  const format = (asset.file_type || (asset.asset_type === 'FILE_SCHEMA' ? 'FILE' : 'TABLE')).toUpperCase();
                  return (
                    <tr key={asset.asset_id}>
                      <td>
                        <strong className="asset-name-cell">{asset.asset_name}</strong>
                      </td>
                      <td className="source-file-cell">
                        {asset.source_name || asset.fq_name || '—'}
                      </td>
                      <td>
                        <span className="type-badge">{format}</span>
                      </td>
                      <td>
                        <span className="col-count-badge">
                          {asset.column_count != null ? `${asset.column_count} cols` : '—'}
                        </span>
                      </td>
                      <td className="file-size-cell">{formatFileSize(asset.file_size)}</td>
                      <td className="date-cell">{formatDate(asset.created_at)}</td>
                      <td>
                        {asset.is_populated ? (
                          <span className="status-pill status-pill--uploaded" title="Data loaded via Data Ingestion">
                            <span className="status-dot" /> Data Populated
                          </span>
                        ) : (
                          <span className="status-pill status-pill--pending" title="Metadata registered only; business records not loaded">
                            <span className="status-dot" /> Metadata Only
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary-btn small-btn view-schema-btn"
                          onClick={() => handleInspectColumns(asset)}
                        >
                          View Schema
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Schema Columns Inspection Modal */}
      {selectedAssetForCols && (
        <div className="catalog-modal-backdrop" onClick={() => setSelectedAssetForCols(null)}>
          <div className="catalog-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="catalog-modal-header">
              <div>
                <h2>Schema Specification: {selectedAssetForCols.asset_name}</h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                  Source: {selectedAssetForCols.source_name || selectedAssetForCols.fq_name} · Format: {(selectedAssetForCols.file_type || 'FILE').toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setSelectedAssetForCols(null)}
              >
                &times;
              </button>
            </div>

            <div className="catalog-modal-body">
              {loadingCols ? (
                <div className="empty-state">Loading column metadata...</div>
              ) : colsError ? (
                <div className="error-box">{colsError}</div>
              ) : assetColumns.length === 0 ? (
                <div className="empty-state">No column metadata recorded for this asset.</div>
              ) : (
                <div className="columns-spec-table-wrap">
                  <table className="columns-spec-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Column Name</th>
                        <th>Data Type</th>
                        <th>Nullable</th>
                        <th>Primary Key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assetColumns.map((col, idx) => (
                        <tr key={col.column_id || idx}>
                          <td>{col.ordinal_position != null ? col.ordinal_position + 1 : idx + 1}</td>
                          <td>
                            <strong>{col.column_name}</strong>
                          </td>
                          <td>
                            <span className="type-badge">{(col.data_type || 'STRING').toUpperCase()}</span>
                          </td>
                          <td>{col.is_nullable ? 'Yes' : 'No'}</td>
                          <td>{col.is_pk ? '✓ PK' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setSelectedAssetForCols(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
