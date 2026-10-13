import { useState } from 'react';

import { uploadSchema, testDatabaseConnection, importTablesFromDatabase, registerAssetMetadata } from '../api/schemaApi.js';
import { useProjectRefresh } from '../context/ProjectRefreshContext.jsx';
import { validateSchemaFile } from '../utils/fileValidation.js';
import { extractAssetMetadata } from '../utils/fileMetadataExtractor.js';
import { detectDataFile, FILE_KIND } from '../utils/dataFileDetection.js';

const USE_MY_DATA = 'uploaded';
const USE_FAKER = 'faker';

function UploadSchemaPanel({ projectId, onUploaded }) {
  const { notifyProjectChanged } = useProjectRefresh(projectId);

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [detections, setDetections] = useState([]);
  const [dataSource, setDataSource] = useState(USE_FAKER);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Database Connection Modal State
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectionMode, setConnectionMode] = useState('uri'); // 'uri' | 'fields'
  const [connectionString, setConnectionString] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('postgres');
  const [user, setUser] = useState('postgres');
  const [password, setPassword] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [discoveredTables, setDiscoveredTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [tableSearch, setTableSearch] = useState('');
  const [importingTables, setImportingTables] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [connectSuccess, setConnectSuccess] = useState('');

  const [extractedMetadata, setExtractedMetadata] = useState([]);

  async function handleFileChange(event) {
    const files = Array.from(event.target.files || []);

    setError('');
    setSuccess('');
    setExtractedMetadata([]);

    if (files.length === 0) {
      setSelectedFiles([]);
      return;
    }

    for (const file of files) {
      const validation = validateSchemaFile(file);
      if (!validation.valid) {
        setError(`${file.name}: ${validation.message || 'Invalid schema file.'}`);
        setSelectedFiles([]);
        setFileInputKey((value) => value + 1);
        return;
      }
    }

    try {
      // Extract only structure, headers, column types and metadata (no data rows)
      const metaList = await Promise.all(files.map((f) => extractAssetMetadata(f)));
      setSelectedFiles(files);
      setExtractedMetadata(metaList);
    } catch (err) {
      setError(err.message || 'Failed to inspect file structure.');
      setSelectedFiles([]);
      setFileInputKey((value) => value + 1);
    }
  }

  async function handleUpload(event) {
    event.preventDefault();

    if (!projectId) {
      setError('Project is required before registering asset metadata.');
      return;
    }

    if (selectedFiles.length === 0) {
      setError('Please select an asset file.');
      return;
    }

    try {
      setUploading(true);
      setError('');
      setSuccess('');

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const metadata = extractedMetadata[i] || (await extractAssetMetadata(file));

        // Transmit ONLY the metadata payload across HTTP (zero business records)
        await registerAssetMetadata({
          projectId,
          ...metadata
        });
      }

      setSuccess(`Successfully registered ${selectedFiles.length} asset(s) metadata into Asset Registry! No business records were stored.`);
      setSelectedFiles([]);
      setExtractedMetadata([]);
      setFileInputKey((value) => value + 1);

      notifyProjectChanged(projectId);

      if (onUploaded) {
        onUploaded();
      }
    } catch (err) {
      setError(err.message || 'Failed to register asset metadata.');
    } finally {
      setUploading(false);
    }
  }

  // Database Connection Handlers
  function getConnectionConfig() {
    if (connectionMode === 'uri') {
      return { connectionString: connectionString.trim() };
    }
    return {
      type: 'postgres',
      host: host.trim(),
      port: Number(port) || 5432,
      database: database.trim(),
      user: user.trim(),
      password
    };
  }

  async function handleTestAndDiscover() {
    setConnectError('');
    setConnectSuccess('');
    setDiscoveredTables([]);
    setSelectedTables([]);

    const config = getConnectionConfig();
    if (connectionMode === 'uri' && !config.connectionString) {
      setConnectError('Please enter a PostgreSQL or Supabase connection URI.');
      return;
    }
    if (connectionMode === 'fields' && (!config.host || !config.database || !config.user)) {
      setConnectError('Host, database, and user fields are required.');
      return;
    }

    try {
      setTestingConnection(true);
      const res = await testDatabaseConnection(config);
      const tablesList = res?.data?.tables || res?.tables || [];
      if (!tablesList.length) {
        setConnectError('Connected successfully, but no user tables found in public schema.');
      } else {
        setDiscoveredTables(tablesList);
        setSelectedTables(tablesList.map(t => t.name || t.table_name || t.fullName));
        setConnectSuccess(`Connected successfully! Discovered ${tablesList.length} tables.`);
      }
    } catch (err) {
      setConnectError(err.message || 'Failed to connect to database. Check credentials, network, and SSL.');
    } finally {
      setTestingConnection(false);
    }
  }

  function toggleTableSelection(tableName) {
    setSelectedTables(prev =>
      prev.includes(tableName)
        ? prev.filter(t => t !== tableName)
        : [...prev, tableName]
    );
  }

  function handleSelectAllTables() {
    const filtered = discoveredTables
      .map(t => t.name || t.table_name || t.fullName)
      .filter(name => !tableSearch || name.toLowerCase().includes(tableSearch.toLowerCase()));
    setSelectedTables(filtered);
  }

  function handleDeselectAllTables() {
    setSelectedTables([]);
  }

  async function handleImportDatabaseTables() {
    if (!selectedTables.length) {
      setConnectError('Please select at least one table to import.');
      return;
    }

    try {
      setImportingTables(true);
      setConnectError('');
      const config = getConnectionConfig();

      const result = await importTablesFromDatabase({
        projectId,
        connectionConfig: config,
        selectedTables
      });

      const count = result?.data?.importedCount || selectedTables.length;
      setSuccess(`Successfully connected and imported ${count} table(s) from database into project!`);
      setShowConnectModal(false);
      setDiscoveredTables([]);
      setSelectedTables([]);
      notifyProjectChanged(projectId);
      if (onUploaded) {
        onUploaded();
      }
    } catch (err) {
      setConnectError(err.message || 'Failed to import tables from database.');
    } finally {
      setImportingTables(false);
    }
  }

  const filteredDiscoveredTables = discoveredTables.filter((t) => {
    const tableName = t.name || t.table_name || t.fullName || '';
    return !tableSearch || tableName.toLowerCase().includes(tableSearch.toLowerCase());
  });

  return (
    <section className="workspace-panel">
      <div className="panel-header">
        <h2 className="panel-title">Register Asset</h2>
        <p className="panel-description">
          Upload CSV, XLSX, XLS, JSON, or YAML files. Extracts and registers only asset metadata and column structure. No business data rows are stored.
        </p>
      </div>

      <form onSubmit={handleUpload}>
        <div className="upload-zone">
          <div className="upload-icon">↑</div>

          <strong>Choose your files</strong>

          <p className="panel-description" style={{ marginTop: 6 }}>
            Supported formats: CSV, XLSX, XLS, JSON, YAML, and YML (Metadata only)
          </p>

          <input
            key={fileInputKey}
            className="file-input"
            type="file"
            multiple
            accept=".json,.yaml,.yml,.csv,.xlsx,.xls"
            onChange={handleFileChange}
            disabled={uploading}
          />

          {selectedFiles.length > 0 && (
            <div className="selected-file" style={{ marginTop: 16 }}>
              Selected: <strong>{selectedFiles.length} file(s)</strong>
              <ul style={{ margin: '8px 0', paddingLeft: 20, textAlign: 'left', fontSize: 13, color: 'var(--text-muted)' }}>
                {selectedFiles.map((f, idx) => {
                  const meta = extractedMetadata[idx];
                  return (
                    <li key={f.name} style={{ marginBottom: 6 }}>
                      <strong>{f.name}</strong> ({(f.size / 1024).toFixed(1)} KB)
                      {meta && (
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                          ✓ {meta.columnCount} column(s) detected: {meta.columns.slice(0, 5).map(c => c.name).join(', ')}{meta.columns.length > 5 ? '…' : ''} {meta.sheetName ? `(Sheet: ${meta.sheetName})` : ''}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={uploading}
          className="upload-btn"
        >
          {uploading ? 'Registering Metadata...' : 'Upload Assets'}
        </button>
      </form>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', margin: '22px 0 16px', gap: '14px' }}>
        <div style={{ flex: 1, height: '1px', background: 'var(--border-color, #e2e8f0)' }} />
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted, #94a3b8)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Or Connect Database
        </span>
        <div style={{ flex: 1, height: '1px', background: 'var(--border-color, #e2e8f0)' }} />
      </div>

      {/* Connect to DB Button (Directly below Upload Schemas) */}
      <button
        type="button"
        id="btn-connect-database"
        className="secondary-btn"
        style={{
          width: '100%',
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          fontSize: '13.5px',
          fontWeight: 600,
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1.5px solid #3b82f6',
          color: '#1d4ed8',
          borderRadius: '10px',
          cursor: 'pointer',
          boxShadow: '0 1px 3px rgba(37, 99, 235, 0.1)',
          transition: 'all 0.2s ease'
        }}
        onClick={() => {
          setShowConnectModal(true);
          setConnectError('');
          setConnectSuccess('');
        }}
      >
        <span style={{ fontSize: '18px' }}>⚡</span>
        <span>Connect to Database (Supabase / PostgreSQL)</span>
      </button>

      {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}

      {success && (
        <div className="success-box" style={{ marginTop: 16 }}>
          {success}
        </div>
      )}

      {/* Connect to Database Modal */}
      {showConnectModal && (
        <div className="modal-backdrop" onClick={() => !importingTables && setShowConnectModal(false)}>
          <div
            className="modal-card"
            style={{ maxWidth: '640px', width: '92%', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Connect Database (Supabase / PostgreSQL)</h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted, #64748b)' }}>
                  Connect your live database instead of uploading files. We'll introspect and import your tables as project schemas.
                </p>
              </div>
              <button
                type="button"
                className="cpm-close-btn"
                onClick={() => setShowConnectModal(false)}
                disabled={importingTables}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '0 0 16px' }}>
              {/* Tab selector for URI vs manual fields */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '10px' }}>
                <button
                  type="button"
                  className={`catalog-filter-pill ${connectionMode === 'uri' ? 'catalog-filter-pill--active' : ''}`}
                  onClick={() => setConnectionMode('uri')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: connectionMode === 'uri' ? '#2563eb' : 'transparent',
                    color: connectionMode === 'uri' ? '#fff' : 'inherit',
                    border: '1px solid ' + (connectionMode === 'uri' ? '#2563eb' : 'var(--border-color, #e2e8f0)')
                  }}
                >
                  Connection URI (Recommended for Supabase)
                </button>
                <button
                  type="button"
                  className={`catalog-filter-pill ${connectionMode === 'fields' ? 'catalog-filter-pill--active' : ''}`}
                  onClick={() => setConnectionMode('fields')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: connectionMode === 'fields' ? '#2563eb' : 'transparent',
                    color: connectionMode === 'fields' ? '#fff' : 'inherit',
                    border: '1px solid ' + (connectionMode === 'fields' ? '#2563eb' : 'var(--border-color, #e2e8f0)')
                  }}
                >
                  Host / Port / Database Credentials
                </button>
              </div>

              {connectionMode === 'uri' ? (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    PostgreSQL / Supabase Connection URI
                  </label>
                  <input
                    type="password"
                    placeholder="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
                    value={connectionString}
                    onChange={(e) => setConnectionString(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      fontSize: '13px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      background: 'var(--input-bg, #fff)',
                      fontFamily: 'monospace'
                    }}
                  />
                  <small style={{ display: 'block', marginTop: '6px', color: 'var(--text-muted, #64748b)', fontSize: '12px' }}>
                    Tip: In Supabase, navigate to <strong>Project Settings → Database → Connection String</strong> and copy the URI.
                  </small>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Host / Endpoint</label>
                    <input
                      type="text"
                      placeholder="e.g. db.myproject.supabase.co or localhost"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Port</label>
                    <input
                      type="text"
                      placeholder="5432"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Database Name</label>
                    <input
                      type="text"
                      placeholder="postgres"
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Username</label>
                    <input
                      type="text"
                      placeholder="postgres"
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Password</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>
              )}

              {/* Discover / Test Connection button */}
              <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={handleTestAndDiscover}
                  disabled={testingConnection || importingTables}
                  style={{ padding: '8px 18px', fontSize: '13px' }}
                >
                  {testingConnection ? 'Testing Connection & Discovering Tables…' : '🔍 Discover & Test Tables'}
                </button>
              </div>

              {connectError && (
                <div style={{ marginTop: '14px', background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}>
                  {connectError}
                </div>
              )}

              {connectSuccess && (
                <div style={{ marginTop: '14px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}>
                  {connectSuccess}
                </div>
              )}

              {/* Discovered Tables List */}
              {discoveredTables.length > 0 && (
                <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color, #e2e8f0)', paddingTop: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                    <strong style={{ fontSize: '13.5px' }}>
                      Select Tables to Import ({selectedTables.length} / {discoveredTables.length} selected)
                    </strong>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={handleSelectAllTables}
                        style={{ fontSize: '12px', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Select All
                      </button>
                      <span style={{ color: '#cbd5e1' }}>|</span>
                      <button
                        type="button"
                        onClick={handleDeselectAllTables}
                        style={{ fontSize: '12px', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="Search discovered tables…"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '10px' }}
                  />

                  <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '8px' }}>
                    {filteredDiscoveredTables.map((tbl) => {
                      const tableName = tbl.name || tbl.table_name || tbl.fullName;
                      const colCount = tbl.columnCount ?? tbl.column_count ?? 0;
                      const isSelected = selectedTables.includes(tableName);
                      return (
                        <div
                          key={tableName}
                          onClick={() => toggleTableSelection(tableName)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--border-color, #f1f5f9)',
                            background: isSelected ? 'rgba(37, 99, 235, 0.05)' : 'transparent'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleTableSelection(tableName)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span style={{ fontWeight: 600, fontSize: '13px', fontFamily: 'monospace' }}>
                              {tableName}
                            </span>
                          </div>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>
                            {colCount} columns
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setShowConnectModal(false)}
                disabled={importingTables}
              >
                Cancel
              </button>

              <button
                type="button"
                className="primary-btn"
                onClick={handleImportDatabaseTables}
                disabled={importingTables || !selectedTables.length}
              >
                {importingTables
                  ? 'Importing Tables into Project…'
                  : `Import ${selectedTables.length} Selected Table(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default UploadSchemaPanel;