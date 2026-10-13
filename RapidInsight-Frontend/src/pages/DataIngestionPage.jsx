import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { getProjectById } from '../api/projectApi.js';
import {
  getSchemasByProject,
  uploadSchema,
  testDatabaseConnection,
  importTablesFromDatabase
} from '../api/schemaApi.js';
import {
  getTablesByProject,
  populateGeneratedTable,
  generateAndInsertData
} from '../api/tableApi.js';
import { useProjectRefresh } from '../context/ProjectRefreshContext.jsx';
import { validateSchemaFile } from '../utils/fileValidation.js';
import { detectDataFile, FILE_KIND } from '../utils/dataFileDetection.js';

import './DataIngestionPage.css';

export default function DataIngestionPage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const activeStep = searchParams.get('step'); // 'profile-source' | 'asset-list' | 'load-data'
  const { notifyProjectChanged, refreshKey } = useProjectRefresh(projectId);

  // Project state
  const [project, setProject] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // 1. Profile Source (Uploaded Files only)
  const [sources, setSources] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [loadingSources, setLoadingSources] = useState(false);

  // 2. Asset List (Destination Tables)
  const [tables, setTables] = useState([]);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [loadingTables, setLoadingTables] = useState(false);

  // 3. Ingestion State & Status
  const [ingesting, setIngesting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('Pending'); // 'Pending' | 'Uploaded' | 'Failed'

  // Action Menu dropdown state: null | 'upload' | 'mock' | 'database'
  const [activeModal, setActiveModal] = useState(null);

  // File Upload State inside Upload Modal
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  // Mock Data Modal State
  const [mockRowCount, setMockRowCount] = useState(100);
  const [generatingMock, setGeneratingMock] = useState(false);
  const [mockError, setMockError] = useState('');

  // Database Connection Modal State
  const [connectionMode, setConnectionMode] = useState('uri'); // 'uri' | 'fields'
  const [connectionString, setConnectionString] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('postgres');
  const [user, setUser] = useState('postgres');
  const [password, setPassword] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [discoveredTables, setDiscoveredTables] = useState([]);
  const [selectedDbTables, setSelectedDbTables] = useState([]);
  const [dbSearch, setDbSearch] = useState('');
  const [importingDb, setImportingDb] = useState(false);
  const [dbError, setDbError] = useState('');
  const [dbSuccess, setDbSuccess] = useState('');

  // Section references for anchor scrolling from sidebar
  const profileSourceRef = useRef(null);
  const assetListRef = useRef(null);
  const loadDataRef = useRef(null);

  // Fetch project details
  useEffect(() => {
    async function loadProject() {
      if (!projectId) return;
      try {
        const response = await getProjectById(projectId);
        setProject(response?.project || response?.data || response);
      } catch (err) {
        console.error('Failed to load project details:', err);
      }
    }
    loadProject();
  }, [projectId]);

  // Fetch uploaded source files
  const loadProfileSources = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoadingSources(true);
      const res = await getSchemasByProject(projectId);
      const rawList = res?.schemas || res?.data || (Array.isArray(res) ? res : []);

      // Filter only files actually uploaded by the user
      const userUploadedFiles = rawList.filter((s) => {
        const isSystem = s.is_system === true || s.data_source === 'system';
        const hasFileName = Boolean(s.original_file_name || s.name || s.file_type);
        return !isSystem && hasFileName;
      });

      setSources(userUploadedFiles);

      // Auto-select if single source or restore selection if valid
      setSelectedSourceId((prev) => {
        if (prev && userUploadedFiles.some((s) => s.id === prev)) {
          return prev;
        }
        return userUploadedFiles[0]?.id || '';
      });
    } catch (err) {
      console.error('Failed to fetch profile sources:', err);
    } finally {
      setLoadingSources(false);
    }
  }, [projectId]);

  // Fetch destination tables / catalog assets
  const loadDestinationTables = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoadingTables(true);
      const res = await getTablesByProject(projectId);
      const tableList = res?.data || res?.tables || (Array.isArray(res) ? res : []);
      setTables(tableList);

      setSelectedTableId((prev) => {
        if (prev && tableList.some((t) => t.id === prev)) {
          return prev;
        }
        return tableList[0]?.id || '';
      });
    } catch (err) {
      console.error('Failed to fetch destination tables:', err);
    } finally {
      setLoadingTables(false);
    }
  }, [projectId]);

  // Initial load and reload on refreshKey
  useEffect(() => {
    async function loadAll() {
      setInitialLoading(true);
      await Promise.all([loadProfileSources(), loadDestinationTables()]);
      setInitialLoading(false);
    }
    loadAll();
  }, [loadProfileSources, loadDestinationTables, refreshKey]);

  // Handle scrolling when sidebar subnav item is clicked
  useEffect(() => {
    if (!activeStep) return;
    const timer = setTimeout(() => {
      if (activeStep === 'profile-source' && profileSourceRef.current) {
        profileSourceRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (activeStep === 'asset-list' && assetListRef.current) {
        assetListRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (activeStep === 'load-data' && loadDataRef.current) {
        loadDataRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [activeStep]);

  // Selected entities
  const selectedSource = useMemo(() => {
    return sources.find((s) => s.id === selectedSourceId) || null;
  }, [sources, selectedSourceId]);

  const selectedTable = useMemo(() => {
    return tables.find((t) => t.id === selectedTableId) || null;
  }, [tables, selectedTableId]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const totalAssets = tables.length;
    // Uploaded assets: distinct assets with successful upload / row data
    const uploadedAssets = tables.filter((t) => {
      const rows = Number(t.row_count || 0);
      const status = (t.status || t.table_status || '').toUpperCase();
      return rows > 0 || status === 'POPULATED' || status === 'BUILT';
    }).length;

    return {
      totalAssets,
      uploadedAssets,
      selectedTableName: selectedTable
        ? selectedTable.sanitized_table_name || selectedTable.physical_table_name || 'Selected'
        : 'None selected',
      selectedSourceFileName: selectedSource
        ? selectedSource.original_file_name || selectedSource.name || 'Selected'
        : 'None selected',
      status: uploadStatus
    };
  }, [tables, selectedTable, selectedSource, uploadStatus]);

  // ─────────────────────────────────────────────────────────────
  // 4. ACTION MENU: UPLOAD FILES
  // ─────────────────────────────────────────────────────────────
  async function handleFileSelect(event) {
    const files = Array.from(event.target.files || []);
    setUploadError('');
    if (files.length === 0) return;

    for (const file of files) {
      const validation = validateSchemaFile(file);
      if (!validation.valid) {
        setUploadError(`${file.name}: ${validation.message || 'Invalid schema file.'}`);
        setUploadFiles([]);
        return;
      }
    }
    setUploadFiles(files);
  }

  async function handleExecuteFileUpload(e) {
    e.preventDefault();
    if (!uploadFiles.length) {
      setUploadError('Please select a file to upload.');
      return;
    }

    try {
      setUploadingFile(true);
      setUploadError('');

      let lastUploadedSchemaId = null;
      for (const file of uploadFiles) {
        const detection = await detectDataFile(file);
        const dataSource = detection?.kind === FILE_KIND.DATA ? 'uploaded' : 'faker';
        const res = await uploadSchema({
          projectId,
          file,
          dataSource
        });
        if (res?.data?.schema?.id) {
          lastUploadedSchemaId = res.data.schema.id;
        }
      }

      setSuccessBanner(`Successfully uploaded ${uploadFiles.length} file(s) into project.`);
      setActiveModal(null);
      setUploadFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Refresh sources and destination tables
      await Promise.all([loadProfileSources(), loadDestinationTables()]);
      if (lastUploadedSchemaId) {
        setSelectedSourceId(lastUploadedSchemaId);
      }
      notifyProjectChanged(projectId);
    } catch (err) {
      setUploadError(err.message || 'Failed to upload file.');
    } finally {
      setUploadingFile(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. ACTION MENU: GENERATE MOCK DATA
  // ─────────────────────────────────────────────────────────────
  async function handleExecuteMockData() {
    const targetSchemaId = selectedSource?.id || selectedTable?.schema_id;
    if (!targetSchemaId) {
      setMockError('Please select a source file or an asset backed by a schema first.');
      return;
    }

    const count = Number(mockRowCount);
    if (!Number.isFinite(count) || count <= 0) {
      setMockError('Please enter a valid row count (1 to 10,000).');
      return;
    }
    if (count > 10000) {
      setMockError('Maximum allowed rows is 10,000.');
      return;
    }

    try {
      setGeneratingMock(true);
      setMockError('');

      await generateAndInsertData(targetSchemaId, count);
      setSuccessBanner(`Generated and inserted ${count.toLocaleString()} mock rows successfully!`);
      setActiveModal(null);
      setUploadStatus('Uploaded');

      await loadDestinationTables();
      notifyProjectChanged(projectId);
    } catch (err) {
      setMockError(err.message || 'Failed to generate mock data.');
      setUploadStatus('Failed');
    } finally {
      setGeneratingMock(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. ACTION MENU: CONNECT TO DATABASE
  // ─────────────────────────────────────────────────────────────
  function getDbConnectionConfig() {
    if (connectionMode === 'uri') {
      return { connectionString: connectionString.trim() };
    }
    return {
      host: host.trim(),
      port: Number(port) || 5432,
      database: database.trim(),
      user: user.trim(),
      password
    };
  }

  async function handleTestDbConnection() {
    setDbError('');
    setDbSuccess('');
    setDiscoveredTables([]);
    setSelectedDbTables([]);

    const config = getDbConnectionConfig();
    if (connectionMode === 'uri' && !config.connectionString) {
      setDbError('Please enter a PostgreSQL or Supabase connection URI.');
      return;
    }
    if (connectionMode === 'fields' && (!config.host || !config.database || !config.user)) {
      setDbError('Host, database, and user fields are required.');
      return;
    }

    try {
      setTestingConnection(true);
      const res = await testDatabaseConnection(config);
      const tableList = res?.data?.tables || res?.tables || [];
      if (!tableList.length) {
        setDbError('Connected successfully, but no user tables found in public schema.');
      } else {
        setDiscoveredTables(tableList);
        setSelectedDbTables(tableList.map((t) => t.name || t.table_name || t.fullName));
        setDbSuccess(`Connected successfully! Discovered ${tableList.length} tables.`);
      }
    } catch (err) {
      setDbError(err.message || 'Failed to connect to database. Check credentials, host, and SSL.');
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleImportDbTables() {
    if (!selectedDbTables.length) {
      setDbError('Please select at least one table to import.');
      return;
    }

    try {
      setImportingDb(true);
      setDbError('');
      const config = getDbConnectionConfig();

      const result = await importTablesFromDatabase({
        projectId,
        connectionConfig: config,
        selectedTables: selectedDbTables
      });

      const count = result?.data?.importedCount || selectedDbTables.length;
      setSuccessBanner(`Successfully connected and imported ${count} table(s) from external database!`);
      setActiveModal(null);
      setDiscoveredTables([]);
      setSelectedDbTables([]);

      await Promise.all([loadProfileSources(), loadDestinationTables()]);
      notifyProjectChanged(projectId);
    } catch (err) {
      setDbError(err.message || 'Failed to import tables from database.');
    } finally {
      setImportingDb(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. INGESTION ACTION: LOAD DATA
  // ─────────────────────────────────────────────────────────────
  async function handleExecuteIngestion() {
    setErrorBanner('');
    setSuccessBanner('');

    if (!selectedSourceId) {
      setErrorBanner('Please select a Profile Source file before loading data.');
      return;
    }
    if (!selectedTableId) {
      setErrorBanner('Please select an Asset destination table before loading data.');
      return;
    }

    try {
      setIngesting(true);
      setUploadStatus('Pending');

      // Execute backend operation
      if (selectedTable?.id) {
        await populateGeneratedTable(selectedTable.id, 100);
      } else if (selectedSource?.id) {
        await generateAndInsertData(selectedSource.id, 100);
      }

      setUploadStatus('Uploaded');
      setSuccessBanner(
        `Successfully loaded data from source "${summaryMetrics.selectedSourceFileName}" into asset "${summaryMetrics.selectedTableName}".`
      );

      await loadDestinationTables();
      notifyProjectChanged(projectId);
    } catch (err) {
      setUploadStatus('Failed');
      setErrorBanner(
        err.message || 'Failed to complete data ingestion operation on the destination asset.'
      );
    } finally {
      setIngesting(false);
    }
  }

  const organisation = project?.organisation?.name || project?.organisation_name || 'Your Organisation';

  return (
    <div className="schema-container data-ingestion-page">
      {/* Hero Section */}
      <section className="hero-card pws-hero ingestion-hero">
        <div className="hero-kicker-row">
          <span className="hero-kicker">Project Workspace · {organisation}</span>
          <span className="ingestion-badge">Data Ingestion Hub</span>
        </div>
        <h1>Data Ingestion</h1>
        <p>
          Configure profile sources, select destination assets, and trigger data ingestion, synthetic data loads, or external database imports.
        </p>
      </section>

      {/* Global Alert Banners */}
      {errorBanner && (
        <div className="ingestion-alert ingestion-alert--error" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{errorBanner}</span>
          <button className="ingestion-alert-close" onClick={() => setErrorBanner('')}>&times;</button>
        </div>
      )}

      {successBanner && (
        <div className="ingestion-alert ingestion-alert--success" role="status">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{successBanner}</span>
          <button className="ingestion-alert-close" onClick={() => setSuccessBanner('')}>&times;</button>
        </div>
      )}

      {/* Main 3 Controls Grid */}
      <div className="ingestion-controls-grid">
        {/* CONTROL 1: PROFILE SOURCE */}
        <section
          ref={profileSourceRef}
          className={`ingestion-card ${activeStep === 'profile-source' ? 'ingestion-card--active' : ''}`}
        >
          <div className="ingestion-card-header">
            <div className="ingestion-step-number">1</div>
            <div>
              <h3>Profile Source</h3>
              <p>Select a previously uploaded user file</p>
            </div>
          </div>

          <div className="ingestion-card-body">
            <label className="ingestion-label" htmlFor="profile-source-select">
              Uploaded Source File
            </label>

            {loadingSources ? (
              <div className="ingestion-select-loading">Loading uploaded files...</div>
            ) : sources.length === 0 ? (
              <div className="ingestion-empty-box">
                <p>No uploaded files found in this project.</p>
                <button
                  type="button"
                  className="secondary-btn small-btn"
                  onClick={() => setActiveModal('upload')}
                >
                  + Upload File
                </button>
              </div>
            ) : (
              <div className="ingestion-select-wrapper">
                <select
                  id="profile-source-select"
                  className="ingestion-select"
                  value={selectedSourceId}
                  onChange={(e) => {
                    setSelectedSourceId(e.target.value);
                    setUploadStatus('Pending');
                  }}
                >
                  <option value="" disabled>-- Select source file --</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.original_file_name || s.sanitized_table_name || s.name || `File ${s.id.slice(0, 8)}`} ({s.file_type ? s.file_type.toUpperCase() : 'FILE'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedSource && (
              <div className="ingestion-meta-chip">
                <div className="meta-chip-row">
                  <span className="meta-title">File Name:</span>
                  <span className="meta-value">{selectedSource.original_file_name || selectedSource.sanitized_table_name}</span>
                </div>
                <div className="meta-chip-row">
                  <span className="meta-title">File Type:</span>
                  <span className="type-badge">
                    {(selectedSource.file_type || 'CSV').toUpperCase()}
                  </span>
                </div>
                {selectedSource.uploaded_row_count != null && (
                  <div className="meta-chip-row">
                    <span className="meta-title">Rows:</span>
                    <span className="meta-value">{Number(selectedSource.uploaded_row_count).toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* CONTROL 2: ASSET LIST */}
        <section
          ref={assetListRef}
          className={`ingestion-card ${activeStep === 'asset-list' ? 'ingestion-card--active' : ''}`}
        >
          <div className="ingestion-card-header">
            <div className="ingestion-step-number">2</div>
            <div>
              <h3>Asset List</h3>
              <p>Select target destination table</p>
            </div>
          </div>

          <div className="ingestion-card-body">
            <label className="ingestion-label" htmlFor="asset-list-select">
              Destination Table
            </label>

            {loadingTables ? (
              <div className="ingestion-select-loading">Loading destination assets...</div>
            ) : tables.length === 0 ? (
              <div className="ingestion-empty-box">
                <p>No destination tables found in catalog.</p>
                <span className="empty-subtext">Upload a file or connect a database to register tables.</span>
              </div>
            ) : (
              <div className="ingestion-select-wrapper">
                <select
                  id="asset-list-select"
                  className="ingestion-select"
                  value={selectedTableId}
                  onChange={(e) => {
                    setSelectedTableId(e.target.value);
                    setUploadStatus('Pending');
                  }}
                >
                  <option value="" disabled>-- Select destination table --</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.sanitized_table_name || t.physical_table_name} ({Number(t.row_count || 0).toLocaleString()} rows)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedTable && (
              <div className="ingestion-meta-chip">
                <div className="meta-chip-row">
                  <span className="meta-title">Table Name:</span>
                  <span className="meta-value">{selectedTable.sanitized_table_name || selectedTable.physical_table_name}</span>
                </div>
                <div className="meta-chip-row">
                  <span className="meta-title">Physical Table:</span>
                  <span className="meta-code">{selectedTable.physical_table_name || '—'}</span>
                </div>
                <div className="meta-chip-row">
                  <span className="meta-title">Current Rows:</span>
                  <span className="meta-value">{Number(selectedTable.row_count || 0).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* CONTROL 3: LOAD DATA ACTION MENU */}
        <section
          ref={loadDataRef}
          className={`ingestion-card ${activeStep === 'load-data' ? 'ingestion-card--active' : ''}`}
        >
          <div className="ingestion-card-header">
            <div className="ingestion-step-number">3</div>
            <div>
              <h3>Load Data</h3>
              <p>Action menu &amp; data sources</p>
            </div>
          </div>

          <div className="ingestion-card-body">
            <p className="ingestion-desc">
              Choose an ingestion workflow or load pipeline data:
            </p>

            <div className="ingestion-actions-menu">
              <button
                type="button"
                className="action-menu-btn"
                onClick={() => setActiveModal('upload')}
              >
                <div className="action-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="action-info">
                  <strong>Upload Files</strong>
                  <span>Upload new CSV, JSON, or YAML</span>
                </div>
              </button>

              <button
                type="button"
                className="action-menu-btn"
                onClick={() => {
                  setMockError('');
                  setActiveModal('mock');
                }}
              >
                <div className="action-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <div className="action-info">
                  <strong>Generate Mock Data</strong>
                  <span>Generate realistic synthetic rows</span>
                </div>
              </button>

              <button
                type="button"
                className="action-menu-btn"
                onClick={() => {
                  setDbError('');
                  setDbSuccess('');
                  setActiveModal('database');
                }}
              >
                <div className="action-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </div>
                <div className="action-info">
                  <strong>Connect to Database</strong>
                  <span>Import tables from PostgreSQL/Supabase</span>
                </div>
              </button>
            </div>

            {/* Ingestion Action Load Data Button */}
            <div className="ingestion-submit-section">
              <button
                type="button"
                className="primary-btn ingestion-load-btn"
                disabled={!selectedSourceId || !selectedTableId || ingesting}
                onClick={handleExecuteIngestion}
                title={
                  !selectedSourceId || !selectedTableId
                    ? 'Select both a source file and a destination table to load data'
                    : 'Execute Data Ingestion'
                }
              >
                {ingesting ? (
                  <>
                    <span className="spinner-inline" /> Ingesting Data...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Load Data
                  </>
                )}
              </button>
              {(!selectedSourceId || !selectedTableId) && (
                <span className="ingestion-validation-hint">
                  Select 1 source file and 1 destination table to enable.
                </span>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          6. BOTTOM SUMMARY PANEL DASHBOARD
         ───────────────────────────────────────────────────────────── */}
      <footer className="ingestion-summary-panel">
        <div className="summary-card">
          <span className="summary-label">Total Assets</span>
          <strong className="summary-value">{summaryMetrics.totalAssets}</strong>
          <span className="summary-sub">Distinct catalog tables</span>
        </div>

        <div className="summary-card">
          <span className="summary-label">Uploaded Assets</span>
          <strong className="summary-value">{summaryMetrics.uploadedAssets}</strong>
          <span className="summary-sub">Populated with data</span>
        </div>

        <div className="summary-card">
          <span className="summary-label">Selected Table</span>
          <strong className="summary-value summary-truncate" title={summaryMetrics.selectedTableName}>
            {summaryMetrics.selectedTableName}
          </strong>
          <span className="summary-sub">Destination asset</span>
        </div>

        <div className="summary-card">
          <span className="summary-label">Selected Source File</span>
          <strong className="summary-value summary-truncate" title={summaryMetrics.selectedSourceFileName}>
            {summaryMetrics.selectedSourceFileName}
          </strong>
          <span className="summary-sub">Profile source</span>
        </div>

        <div className="summary-card">
          <span className="summary-label">Upload Status</span>
          <div className="summary-status-wrap">
            <span className={`status-pill status-pill--${summaryMetrics.status.toLowerCase()}`}>
              <span className="status-dot" />
              {summaryMetrics.status}
            </span>
          </div>
          <span className="summary-sub">Pipeline readiness</span>
        </div>
      </footer>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 1: UPLOAD FILES
         ───────────────────────────────────────────────────────────── */}
      {activeModal === 'upload' && (
        <div className="catalog-modal-backdrop" onClick={() => !uploadingFile && setActiveModal(null)}>
          <div className="catalog-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>Upload Files</h2>
              <button
                type="button"
                className="close-btn"
                disabled={uploadingFile}
                onClick={() => setActiveModal(null)}
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleExecuteFileUpload} className="catalog-modal-body">
              <p className="modal-description">
                Upload schema or data files (CSV, JSON, YAML) to this project. Upon successful upload, Profile Source will automatically refresh and select your new file.
              </p>

              <div className="upload-dropzone" onClick={() => fileInputRef.current?.click()}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".json,.yaml,.yml,.csv"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <div className="dropzone-text">
                  <strong>Click to select file</strong> or drag &amp; drop
                </div>
                <span className="dropzone-hint">Supports CSV, JSON, YAML up to 5 MB</span>
              </div>

              {uploadFiles.length > 0 && (
                <div className="selected-files-list">
                  <strong>Selected File:</strong>
                  {uploadFiles.map((f, i) => (
                    <div key={i} className="selected-file-item">
                      <span>📄 {f.name}</span>
                      <span className="file-size">({(f.size / 1024).toFixed(1)} KB)</span>
                    </div>
                  ))}
                </div>
              )}

              {uploadError && <div className="error-box">{uploadError}</div>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={uploadingFile}
                  onClick={() => setActiveModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={uploadingFile || uploadFiles.length === 0}
                >
                  {uploadingFile ? 'Uploading…' : 'Upload File'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL 2: GENERATE MOCK DATA
         ───────────────────────────────────────────────────────────── */}
      {activeModal === 'mock' && (
        <div className="catalog-modal-backdrop" onClick={() => !generatingMock && setActiveModal(null)}>
          <div className="catalog-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>Generate Mock Data</h2>
              <button
                type="button"
                className="close-btn"
                disabled={generatingMock}
                onClick={() => setActiveModal(null)}
              >
                &times;
              </button>
            </div>
            <div className="catalog-modal-body">
              <p className="modal-description">
                Generate realistic synthetic data using Faker.js for the active schema.
              </p>

              <div className="modal-field-group">
                <label htmlFor="mock-target">Target Schema / Asset:</label>
                <div className="modal-readonly-input">
                  {selectedSource
                    ? selectedSource.original_file_name || selectedSource.sanitized_table_name
                    : selectedTable?.sanitized_table_name || 'No schema selected'}
                </div>
              </div>

              <div className="modal-field-group">
                <label htmlFor="mock-rows">Number of Rows:</label>
                <input
                  id="mock-rows"
                  type="number"
                  min="1"
                  max="10000"
                  className="modal-text-input"
                  value={mockRowCount}
                  onChange={(e) => setMockRowCount(e.target.value)}
                />
                <span className="input-helper">Allowed between 1 and 10,000 rows.</span>
              </div>

              {mockError && <div className="error-box">{mockError}</div>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={generatingMock}
                  onClick={() => setActiveModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={generatingMock || (!selectedSource?.id && !selectedTable?.schema_id)}
                  onClick={handleExecuteMockData}
                >
                  {generatingMock ? 'Generating Rows…' : 'Generate & Insert Data'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL 3: CONNECT TO DATABASE
         ───────────────────────────────────────────────────────────── */}
      {activeModal === 'database' && (
        <div className="catalog-modal-backdrop" onClick={() => !importingDb && setActiveModal(null)}>
          <div className="catalog-modal-content catalog-modal-content--large" onClick={(e) => e.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>Connect to Database</h2>
              <button
                type="button"
                className="close-btn"
                disabled={importingDb}
                onClick={() => setActiveModal(null)}
              >
                &times;
              </button>
            </div>
            <div className="catalog-modal-body">
              <p className="modal-description">
                Connect to an external PostgreSQL or Supabase instance to discover and register assets.
              </p>

              <div className="db-mode-toggle">
                <button
                  type="button"
                  className={`toggle-tab ${connectionMode === 'uri' ? 'toggle-tab--active' : ''}`}
                  onClick={() => setConnectionMode('uri')}
                >
                  Connection URI
                </button>
                <button
                  type="button"
                  className={`toggle-tab ${connectionMode === 'fields' ? 'toggle-tab--active' : ''}`}
                  onClick={() => setConnectionMode('fields')}
                >
                  Manual Parameters
                </button>
              </div>

              {connectionMode === 'uri' ? (
                <div className="modal-field-group">
                  <label htmlFor="db-uri">PostgreSQL / Supabase Connection URI:</label>
                  <input
                    id="db-uri"
                    type="password"
                    placeholder="postgresql://postgres:[password]@db.supabase.co:5432/postgres"
                    className="modal-text-input"
                    value={connectionString}
                    onChange={(e) => setConnectionString(e.target.value)}
                  />
                  <span className="input-helper">URI is transmitted securely and not persisted in plain text.</span>
                </div>
              ) : (
                <div className="db-fields-grid">
                  <div className="modal-field-group">
                    <label>Host:</label>
                    <input
                      type="text"
                      placeholder="db.example.com"
                      className="modal-text-input"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                    />
                  </div>
                  <div className="modal-field-group">
                    <label>Port:</label>
                    <input
                      type="text"
                      className="modal-text-input"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                    />
                  </div>
                  <div className="modal-field-group">
                    <label>Database:</label>
                    <input
                      type="text"
                      className="modal-text-input"
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                    />
                  </div>
                  <div className="modal-field-group">
                    <label>User:</label>
                    <input
                      type="text"
                      className="modal-text-input"
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                    />
                  </div>
                  <div className="modal-field-group full-width">
                    <label>Password:</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      className="modal-text-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="db-test-action">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={testingConnection}
                  onClick={handleTestDbConnection}
                >
                  {testingConnection ? 'Testing Connection…' : 'Test Connection & Discover Tables'}
                </button>
              </div>

              {dbSuccess && <div className="success-box">{dbSuccess}</div>}
              {dbError && <div className="error-box">{dbError}</div>}

              {discoveredTables.length > 0 && (
                <div className="db-tables-section">
                  <div className="db-tables-header">
                    <strong>Discovered Tables ({discoveredTables.length})</strong>
                    <input
                      type="text"
                      placeholder="Search tables..."
                      className="db-search-input"
                      value={dbSearch}
                      onChange={(e) => setDbSearch(e.target.value)}
                    />
                  </div>

                  <div className="db-tables-list">
                    {discoveredTables
                      .filter((t) => {
                        const name = t.name || t.table_name || t.fullName || '';
                        return !dbSearch || name.toLowerCase().includes(dbSearch.toLowerCase());
                      })
                      .map((t) => {
                        const name = t.name || t.table_name || t.fullName;
                        const isChecked = selectedDbTables.includes(name);
                        return (
                          <label key={name} className="db-table-item">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setSelectedDbTables((prev) =>
                                  isChecked ? prev.filter((item) => item !== name) : [...prev, name]
                                );
                              }}
                            />
                            <span>{name}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={importingDb}
                  onClick={() => setActiveModal(null)}
                >
                  Close
                </button>
                {discoveredTables.length > 0 && (
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={importingDb || selectedDbTables.length === 0}
                    onClick={handleImportDbTables}
                  >
                    {importingDb ? 'Importing…' : `Import ${selectedDbTables.length} Selected Table(s)`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

