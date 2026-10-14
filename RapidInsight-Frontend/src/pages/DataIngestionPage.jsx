import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import * as XLSX from 'xlsx';

import { getProjects, getProjectById } from '../api/projectApi.js';
import {
  getCatalogAssets,
  getCatalogColumns,
  ingestFileIntoAsset,
  ingestMockDataIntoAsset,
  ingestDatabaseIntoAsset
} from '../api/catalogApi.js';
import {
  testDatabaseConnection,
  getDatabaseTableColumns
} from '../api/schemaApi.js';
import { useProjectRefresh } from '../context/ProjectRefreshContext.jsx';

import './DataIngestionPage.css';

function isNumericType(type) {
  const norm = String(type || '').trim().toLowerCase();
  return ['number', 'integer', 'int', 'bigint', 'smallint', 'numeric', 'decimal', 'float', 'real', 'double precision', 'int2', 'int4', 'int8', 'float4', 'float8'].includes(norm);
}

function isBooleanType(type) {
  const norm = String(type || '').trim().toLowerCase();
  return ['boolean', 'bool'].includes(norm);
}

function isDateType(type) {
  const norm = String(type || '').trim().toLowerCase();
  return ['date', 'timestamp', 'timestamptz', 'time', 'datetime'].some(t => norm.includes(t));
}

function isUuidType(type) {
  const norm = String(type || '').trim().toLowerCase();
  return norm === 'uuid';
}

function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '—';
  const num = Number(bytes);
  if (isNaN(num)) return '—';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

function validateFileAgainstAssetSchema(headers = [], rows = [], registeredColumns = []) {
  if (!registeredColumns || registeredColumns.length === 0) {
    return {
      isValid: false,
      error: 'The selected asset has no registered column specifications.',
      matchedCount: 0,
      expectedCount: 0,
      uploadedCount: headers.length,
      missingColumns: [],
      unexpectedColumns: [],
      duplicateColumns: [],
      incompatibleTypes: []
    };
  }

  // 1. Detect duplicate column names in the uploaded file
  const seenHeaders = new Map();
  const duplicateColumns = [];
  headers.forEach(h => {
    const raw = String(h || '').trim();
    const norm = raw.toLowerCase();
    if (!norm) return;
    if (seenHeaders.has(norm)) {
      duplicateColumns.push(raw);
    } else {
      seenHeaders.set(norm, raw);
    }
  });

  if (duplicateColumns.length > 0) {
    const uniqueDups = [...new Set(duplicateColumns)];
    return {
      isValid: false,
      error: `Duplicate column names detected in uploaded file: ${uniqueDups.join(', ')}`,
      matchedCount: 0,
      expectedCount: registeredColumns.length,
      uploadedCount: headers.length,
      missingColumns: [],
      unexpectedColumns: [],
      duplicateColumns: uniqueDups,
      incompatibleTypes: []
    };
  }

  const uploadedCount = headers.length;
  const registeredCount = registeredColumns.length;

  const uploadedNormalized = new Set(headers.map(h => String(h || '').trim().toLowerCase()));
  const registeredNormalized = new Map(registeredColumns.map(c => [String(c.column_name || '').trim().toLowerCase(), c.column_name]));

  const matchedColumns = [];
  const missingColumns = [];
  for (const [normReg, originalRegName] of registeredNormalized.entries()) {
    if (uploadedNormalized.has(normReg)) {
      matchedColumns.push(originalRegName);
    } else {
      missingColumns.push(originalRegName);
    }
  }

  const unexpectedColumns = [];
  headers.forEach(h => {
    const norm = String(h || '').trim().toLowerCase();
    if (!registeredNormalized.has(norm)) {
      unexpectedColumns.push(String(h).trim());
    }
  });

  // 2. Strict Column Count Check
  if (uploadedCount !== registeredCount) {
    return {
      isValid: false,
      error: `Upload rejected: the selected asset expects ${registeredCount} columns, but the uploaded file contains ${uploadedCount}. Only ${matchedColumns.length} columns match. Please upload the correct file for this asset.`,
      matchedCount: matchedColumns.length,
      expectedCount: registeredCount,
      uploadedCount,
      missingColumns,
      unexpectedColumns,
      duplicateColumns: [],
      incompatibleTypes: []
    };
  }

  // 3. Strict Column Names Check
  if (missingColumns.length > 0 || unexpectedColumns.length > 0) {
    const reasons = [];
    if (missingColumns.length > 0) reasons.push(`missing registered columns: [${missingColumns.join(', ')}]`);
    if (unexpectedColumns.length > 0) reasons.push(`unexpected extra columns: [${unexpectedColumns.join(', ')}]`);
    return {
      isValid: false,
      error: `Upload rejected: file columns do not match registered schema (${reasons.join('; ')}).`,
      matchedCount: matchedColumns.length,
      expectedCount: registeredCount,
      uploadedCount,
      missingColumns,
      unexpectedColumns,
      duplicateColumns: [],
      incompatibleTypes: []
    };
  }

  // 4. Data Type Validation (inspect sample rows)
  const sampleLimit = Math.min(rows.length, 100);
  const incompatibleTypes = [];

  for (const col of registeredColumns) {
    const colName = col.column_name;
    const targetNorm = colName.trim().toLowerCase();
    const fileHeader = headers.find(h => String(h || '').trim().toLowerCase() === targetNorm);
    if (!fileHeader) continue;

    const dataType = col.data_type;
    const isPk = Boolean(col.is_pk);
    const isNullable = col.is_nullable !== false;

    for (let r = 0; r < sampleLimit; r++) {
      const row = rows[r];
      if (!row || typeof row !== 'object') continue;
      const rawVal = row[fileHeader];

      const strRaw = typeof rawVal === 'string' ? rawVal.trim() : '';
      const isNullOrEmpty = rawVal === null || rawVal === undefined || strRaw === '' ||
        (isNullable && ['-', 'nil', 'na', 'n/a', 'null', 'none', '.'].includes(strRaw.toLowerCase()));
      if (isNullOrEmpty) {
        if (!isNullable && !isPk) {
          incompatibleTypes.push(`Column "${colName}" is marked NOT NULL, but contains null or empty values (row ${r + 1}).`);
          break;
        }
        continue;
      }

      if (isNumericType(dataType)) {
        if (typeof rawVal === 'number' && !isNaN(rawVal)) {
          // valid number
        } else {
          const cleanStr = String(rawVal).trim().replace(/,/g, '');
          const numVal = Number(cleanStr);
          if (isNaN(numVal) || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleanStr)) {
            incompatibleTypes.push(`Column "${colName}" expects ${dataType}, but found incompatible value "${rawVal}" (row ${r + 1}).`);
            break;
          }
        }
      } else if (isBooleanType(dataType)) {
        const boolStr = String(rawVal).trim().toLowerCase();
        const validBools = ['true', 'false', '1', '0', 't', 'f', 'yes', 'no', 'y', 'n'];
        if (!validBools.includes(boolStr)) {
          incompatibleTypes.push(`Column "${colName}" expects boolean, but found incompatible value "${rawVal}" (row ${r + 1}).`);
          break;
        }
      } else if (isDateType(dataType)) {
        if (isNaN(Date.parse(String(rawVal).trim()))) {
          incompatibleTypes.push(`Column "${colName}" expects ${dataType}, but found incompatible value "${rawVal}" (row ${r + 1}).`);
          break;
        }
      } else if (isUuidType(dataType)) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(String(rawVal).trim())) {
          incompatibleTypes.push(`Column "${colName}" expects UUID format, but found incompatible value "${rawVal}" (row ${r + 1}).`);
          break;
        }
      }
    }
  }

  if (incompatibleTypes.length > 0) {
    return {
      isValid: false,
      error: `Upload rejected: data type validation failed. ${incompatibleTypes.slice(0, 3).join('; ')}`,
      matchedCount: matchedColumns.length,
      expectedCount: registeredCount,
      uploadedCount,
      missingColumns: [],
      unexpectedColumns: [],
      duplicateColumns: [],
      incompatibleTypes
    };
  }

  return {
    isValid: true,
    error: '',
    matchedCount: matchedColumns.length,
    expectedCount: registeredCount,
    uploadedCount,
    missingColumns: [],
    unexpectedColumns: [],
    duplicateColumns: [],
    incompatibleTypes: []
  };
}

export default function DataIngestionPage() {
  const { projectId: routeProjectId } = useParams();
  const navigate = useNavigate();

  // ── Step 1: Project Selection State ─────────────────────────────
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(routeProjectId || '');
  const [currentProject, setCurrentProject] = useState(null);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // ── Step 2: Asset Selection State ───────────────────────────────
  const [assets, setAssets] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assetColumns, setAssetColumns] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);

  // ── Step 3: Loading Method State ('file' | 'mock' | 'database') ─
  const [activeMethod, setActiveMethod] = useState('file');

  // Method A: File Upload State
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreviewRows, setFilePreviewRows] = useState([]);
  const [filePreviewHeaders, setFilePreviewHeaders] = useState([]);
  const [fileMatchStats, setFileMatchStats] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [fileParsing, setFileParsing] = useState(false);
  const [fileUploadError, setFileUploadError] = useState('');
  const [ingestingFile, setIngestingFile] = useState(false);
  const fileInputRef = useRef(null);

  // Method B: Synthetic Data State
  const [mockRowCount, setMockRowCount] = useState(100);
  const [mockPreviewRows, setMockPreviewRows] = useState([]);
  const [ingestingMock, setIngestingMock] = useState(false);
  const [mockError, setMockError] = useState('');

  // Method C: Database Connection State
  const [connectionMode, setConnectionMode] = useState('uri'); // 'uri' | 'fields'
  const [connectionString, setConnectionString] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('postgres');
  const [user, setUser] = useState('postgres');
  const [password, setPassword] = useState('');
  const [sslMode, setSslMode] = useState('prefer');
  const [testingConnection, setTestingConnection] = useState(false);
  const [discoveredTables, setDiscoveredTables] = useState([]);
  const [selectedDbTable, setSelectedDbTable] = useState('');
  const [sourceDbColumns, setSourceDbColumns] = useState([]);
  const [loadingDbColumns, setLoadingDbColumns] = useState(false);
  const [columnMapping, setColumnMapping] = useState({});
  const [dbRowLimit, setDbRowLimit] = useState(500);
  const [dbError, setDbError] = useState('');
  const [ingestingDb, setIngestingDb] = useState(false);

  // Global Alerts
  const [errorBanner, setErrorBanner] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  const { notifyProjectChanged } = useProjectRefresh(selectedProjectId);

  // ── Load Current Active Project on Mount ────────────────────────
  useEffect(() => {
    if (!selectedProjectId) return;

    async function loadActiveProject() {
      try {
        setLoadingProjects(true);
        const res = await getProjectById(selectedProjectId);
        const proj = res?.project || res?.data || res;
        setCurrentProject(proj);
        setProjects(proj ? [proj] : []);
      } catch (err) {
        setErrorBanner(err.message || 'Failed to load project details.');
      } finally {
        setLoadingProjects(false);
      }
    }
    loadActiveProject();
  }, [selectedProjectId]);

  // Handle Project Switch
  function handleProjectChange(newProjectId) {
    if (newProjectId === selectedProjectId) return;
    setSelectedProjectId(newProjectId);
    setSelectedAssetId('');
    setSelectedAsset(null);
    setAssetColumns([]);
    resetMethodStates();
    setErrorBanner('');
    setSuccessBanner('');
    navigate(`/projects/${newProjectId}/data-ingestion`);
  }

  // Reset method forms and preview states
  function resetMethodStates(keepFile = false) {
    if (!keepFile) {
      setSelectedFile(null);
      setFilePreviewRows([]);
      setFilePreviewHeaders([]);
      setFileMatchStats(null);
      setValidationResult(null);
      setFileUploadError('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }

    setMockPreviewRows([]);
    setMockError('');

    setDiscoveredTables([]);
    setSelectedDbTable('');
    setSourceDbColumns([]);
    setColumnMapping({});
    setDbError('');
  }

  // ── Load Assets for Selected Project ────────────────────────────
  const loadAssetsForProject = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      setLoadingAssets(true);
      const res = await getCatalogAssets(selectedProjectId);
      const list = res?.data || (Array.isArray(res) ? res : []);
      setAssets(list);

      // If previous asset is still in the new list, update it
      if (selectedAssetId) {
        const refreshed = list.find(a => a.asset_id === selectedAssetId);
        if (refreshed) {
          setSelectedAsset(refreshed);
        } else {
          setSelectedAssetId('');
          setSelectedAsset(null);
          setAssetColumns([]);
        }
      }
    } catch (err) {
      setErrorBanner(err.message || 'Failed to load registered assets.');
    } finally {
      setLoadingAssets(false);
    }
  }, [selectedProjectId, selectedAssetId]);

  useEffect(() => {
    loadAssetsForProject();
  }, [selectedProjectId]);

  // ── Load Columns when Asset is Selected ─────────────────────────
  useEffect(() => {
    if (!selectedProjectId || !selectedAssetId) {
      setSelectedAsset(null);
      setAssetColumns([]);
      setValidationResult(null);
      return;
    }

    const current = assets.find(a => a.asset_id === selectedAssetId);
    setSelectedAsset(current || null);
    resetMethodStates(true); // Keep selected file if one is already selected

    async function loadCols() {
      try {
        setLoadingColumns(true);
        const res = await getCatalogColumns(selectedProjectId, selectedAssetId);
        const cols = res?.data || (Array.isArray(res) ? res : []);
        setAssetColumns(cols);

        // Re-run validation if a file is already loaded
        if (selectedFile && filePreviewHeaders.length > 0) {
          const vRes = validateFileAgainstAssetSchema(filePreviewHeaders, filePreviewRows, cols);
          setValidationResult(vRes);
          setFileMatchStats({
            matchedCount: vRes.matchedCount,
            totalRegistered: cols.length,
            missingRequired: vRes.missingColumns
          });
          if (!vRes.isValid) {
            setFileUploadError(vRes.error);
          } else {
            setFileUploadError('');
          }
        }
      } catch (err) {
        setErrorBanner(err.message || 'Failed to load asset column specifications.');
      } finally {
        setLoadingColumns(false);
      }
    }
    loadCols();
  }, [selectedAssetId, assets, selectedProjectId]);

  // ── Method A: File Parsing & Preview ────────────────────────────
  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setFileUploadError('');
    setFileParsing(true);
    setFilePreviewRows([]);
    setFilePreviewHeaders([]);
    setFileMatchStats(null);
    setValidationResult(null);

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    const validExts = ['.csv', '.xlsx', '.xls', '.json', '.yaml', '.yml'];
    if (!validExts.includes(ext)) {
      setFileUploadError(`Unsupported format "${ext}". Please upload a CSV, Excel (.xlsx, .xls), JSON, or YAML file.`);
      setFileParsing(false);
      return;
    }

    try {
      let headers = [];
      let sampleRows = [];

      if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
        const arrayBuf = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuf, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const firstSheet = workbook.Sheets[firstSheetName];
        const rawSheet = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        if (rawSheet.length > 0) {
          headers = (rawSheet[0] || []).map(h => String(h || '').trim());
          const dataRows = rawSheet.slice(1, 101);
          sampleRows = dataRows.map(r => {
            const row = {};
            headers.forEach((h, idx) => {
              row[h] = r[idx] !== undefined && r[idx] !== null ? r[idx] : '';
            });
            return row;
          });
        }
      } else if (ext === '.json') {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : (parsed.data || parsed.rows || []);
        if (Array.isArray(list) && list.length > 0) {
          headers = Object.keys(list[0]);
          sampleRows = list.slice(0, 100);
        }
      } else {
        // YAML preview
        headers = assetColumns.map(c => c.column_name);
        sampleRows = [{ Note: 'YAML structure detected. Backend will validate upon upload.' }];
      }

      setFilePreviewHeaders(headers);
      setFilePreviewRows(sampleRows);

      // Perform strict schema validation against registered asset columns
      if (assetColumns.length > 0) {
        const vRes = validateFileAgainstAssetSchema(headers, sampleRows, assetColumns);
        setValidationResult(vRes);
        setFileMatchStats({
          matchedCount: vRes.matchedCount,
          totalRegistered: assetColumns.length,
          missingRequired: vRes.missingColumns
        });

        if (!vRes.isValid) {
          setFileUploadError(vRes.error);
        } else {
          setFileUploadError('');
        }
      }
    } catch (err) {
      setFileUploadError(`File parsing failed: ${err.message}`);
    } finally {
      setFileParsing(false);
    }
  }

  async function handleIngestFile() {
    if (!selectedProjectId || !selectedAssetId || !selectedFile) return;
    try {
      setIngestingFile(true);
      setErrorBanner('');
      setSuccessBanner('');

      const res = await ingestFileIntoAsset({
        projectId: selectedProjectId,
        assetId: selectedAssetId,
        file: selectedFile
      });

      setSuccessBanner(res?.message || `Successfully ingested records into destination table for "${selectedAsset?.asset_name}".`);
      notifyProjectChanged();
      await loadAssetsForProject();
      resetMethodStates();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to ingest file records.';
      setErrorBanner(msg);
      setFileUploadError(msg);
    } finally {
      setIngestingFile(false);
    }
  }

  // ── Method B: Generate Mock Data Preview & Ingestion ─────────────
  function generateLocalMockPreview() {
    if (!assetColumns.length) return;
    const preview = [];
    const count = 5;

    for (let i = 0; i < count; i++) {
      const row = {};
      assetColumns.forEach(col => {
        const name = col.column_name.toLowerCase();
        const type = (col.data_type || 'string').toLowerCase();

        if (col.is_pk || name === 'id' || name.endsWith('_id')) {
          row[col.column_name] = type === 'uuid' ? `00000000-0000-4000-8000-00000000000${i+1}` : (1001 + i);
        } else if (type === 'boolean' || type === 'bool') {
          row[col.column_name] = i % 2 === 0;
        } else if (type.includes('date') || type.includes('time')) {
          row[col.column_name] = `2025-01-${String(10 + i).padStart(2, '0')}`;
        } else if (type.includes('int') || type.includes('number') || type.includes('numeric')) {
          if (name.includes('age')) row[col.column_name] = 25 + i * 5;
          else if (name.includes('price') || name.includes('amount')) row[col.column_name] = (99.50 + i * 25).toFixed(2);
          else row[col.column_name] = (i + 1) * 10;
        } else {
          if (name.includes('email')) row[col.column_name] = `sample.user${i+1}@example.com`;
          else if (name.includes('name')) row[col.column_name] = ['Alice Cooper', 'Bob Martin', 'Charlie Ross', 'Diana Prince', 'Ethan Hunt'][i];
          else if (name.includes('city')) row[col.column_name] = ['New York', 'London', 'Tokyo', 'San Francisco', 'Berlin'][i];
          else row[col.column_name] = `${col.column_name}_sample_${i+1}`;
        }
      });
      preview.push(row);
    }
    setMockPreviewRows(preview);
  }

  useEffect(() => {
    if (activeMethod === 'mock' && assetColumns.length > 0 && !mockPreviewRows.length) {
      generateLocalMockPreview();
    }
  }, [activeMethod, assetColumns]);

  async function handleIngestMock() {
    if (!selectedProjectId || !selectedAssetId) return;
    try {
      setIngestingMock(true);
      setErrorBanner('');
      setSuccessBanner('');

      const res = await ingestMockDataIntoAsset({
        projectId: selectedProjectId,
        assetId: selectedAssetId,
        rowCount: mockRowCount
      });

      setSuccessBanner(res?.message || `Successfully generated and loaded ${mockRowCount} synthetic rows.`);
      notifyProjectChanged();
      await loadAssetsForProject();
    } catch (err) {
      setErrorBanner(err.message || 'Failed to generate synthetic data.');
    } finally {
      setIngestingMock(false);
    }
  }

  // ── Method C: Database Discovery & Ingestion ─────────────────────
  async function handleTestDbConnection() {
    setTestingConnection(true);
    setDbError('');
    setDiscoveredTables([]);
    setSelectedDbTable('');
    setSourceDbColumns([]);
    setColumnMapping({});

    const config = connectionMode === 'uri'
      ? { connectionString: connectionString.trim() }
      : {
          host: host.trim(),
          port: Number(port) || 5432,
          database: database.trim(),
          user: user.trim(),
          password,
          sslMode
        };

    try {
      const res = await testDatabaseConnection(config);
      const tables = res?.tables || res?.data?.tables || [];
      setDiscoveredTables(tables);
      if (!tables.length) {
        setDbError('Connection succeeded, but no user tables were found in the database.');
      }
    } catch (err) {
      setDbError(err.message || 'Database connection test failed. Verify host, port, credentials, and TLS settings.');
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleDbTableSelect(tableName) {
    setSelectedDbTable(tableName);
    setDbError('');
    setSourceDbColumns([]);
    setColumnMapping({});

    const config = connectionMode === 'uri'
      ? { connectionString: connectionString.trim() }
      : {
          host: host.trim(),
          port: Number(port) || 5432,
          database: database.trim(),
          user: user.trim(),
          password,
          sslMode
        };

    try {
      setLoadingDbColumns(true);
      const res = await getDatabaseTableColumns({
        connectionConfig: config,
        schema: 'public',
        table: tableName
      });

      const cols = res?.columns || [];
      setSourceDbColumns(cols);

      // Auto-map target columns to matching source columns by name
      const initialMapping = {};
      assetColumns.forEach(targetCol => {
        const matchingSrc = cols.find(c => c.name.toLowerCase() === targetCol.column_name.toLowerCase());
        if (matchingSrc) {
          initialMapping[targetCol.column_name] = matchingSrc.name;
        }
      });
      setColumnMapping(initialMapping);
    } catch (err) {
      setDbError(`Failed to introspect columns for "${tableName}": ${err.message}`);
    } finally {
      setLoadingDbColumns(false);
    }
  }

  async function handleIngestDatabase() {
    if (!selectedProjectId || !selectedAssetId || !selectedDbTable) return;
    try {
      setIngestingDb(true);
      setErrorBanner('');
      setSuccessBanner('');

      const config = connectionMode === 'uri'
        ? { connectionString: connectionString.trim() }
        : {
            host: host.trim(),
            port: Number(port) || 5432,
            database: database.trim(),
            user: user.trim(),
            password,
            sslMode
          };

      const res = await ingestDatabaseIntoAsset({
        projectId: selectedProjectId,
        assetId: selectedAssetId,
        connectionConfig: config,
        sourceSchema: 'public',
        sourceTable: selectedDbTable,
        columnMapping,
        limit: dbRowLimit
      });

      setSuccessBanner(res?.message || `Successfully imported records from database table "${selectedDbTable}".`);
      notifyProjectChanged();
      await loadAssetsForProject();
    } catch (err) {
      setErrorBanner(err.message || 'Failed to import data from database.');
    } finally {
      setIngestingDb(false);
    }
  }

  return (
    <div className="data-ingestion-page">
      {/* ── Page Header ────────────────────────────────────────── */}
      <section className="ingestion-hero">
        <div className="hero-kicker-row">
          <span className="ingestion-badge">Data Ingestion Engine</span>
          <div className="hero-links">
            <Link to={`/projects/${selectedProjectId}/registry-asset`} className="secondary-button small-btn">
              Go to Asset Registry
            </Link>
            <Link to={`/projects/${selectedProjectId}/catalog`} className="secondary-button small-btn">
              Data Catalog
            </Link>
          </div>
        </div>
        <h1 className="dashboard-title">Data Ingestion</h1>
        <p className="dashboard-subtitle">
          Select a project and registered asset from the Asset Registry, then populate its physical destination table via file upload, synthetic mock generation, or database connection.
        </p>
      </section>

      {/* ── Global Alert Banners ───────────────────────────────── */}
      {errorBanner && (
        <div className="ingestion-alert ingestion-alert--error">
          <span>{errorBanner}</span>
          <button className="ingestion-alert-close" onClick={() => setErrorBanner('')}>×</button>
        </div>
      )}
      {successBanner && (
        <div className="ingestion-alert ingestion-alert--success">
          <span>{successBanner}</span>
          <button className="ingestion-alert-close" onClick={() => setSuccessBanner('')}>×</button>
        </div>
      )}

      {/* ── Workflow Grid: Steps 1 & 2 ─────────────────────────── */}
      <div className="ingestion-steps-grid">
        {/* ── STEP 1: Select Project ───────────────────────────── */}
        <div className="ingestion-card">
          <div className="ingestion-card-header">
            <span className="ingestion-step-number">1</span>
            <div>
              <h3>Active Project</h3>
              <p>Current workspace project</p>
            </div>
          </div>
          <div className="ingestion-card-body">
            <label className="ingestion-label" htmlFor="project-select">Active Project</label>
            <div className="ingestion-select-wrapper">
              {loadingProjects ? (
                <div className="ingestion-select-loading">Loading project details...</div>
              ) : (
                <select
                  id="project-select"
                  className="ingestion-select"
                  value={selectedProjectId}
                  disabled
                >
                  <option value={selectedProjectId}>
                    {currentProject?.name || currentProject?.project_name || 'Active Project'}
                  </option>
                </select>
              )}
            </div>

            {currentProject && (
              <div className="ingestion-meta-chip">
                <div className="meta-chip-row">
                  <span className="meta-title">Project Name:</span>
                  <strong className="meta-value">{currentProject.name || currentProject.project_name}</strong>
                </div>
                <div className="meta-chip-row">
                  <span className="meta-title">Physical Schema:</span>
                  <span className="meta-code">{currentProject.physical_schema_name || 'public'}</span>
                </div>
                <div className="meta-chip-row">
                  <span className="meta-title">Project ID:</span>
                  <span className="meta-value">{selectedProjectId}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── STEP 2: Select Asset ─────────────────────────────── */}
        <div className="ingestion-card">
          <div className="ingestion-card-header">
            <span className="ingestion-step-number">2</span>
            <div>
              <h3>Select Asset</h3>
              <p>Registered Asset from Catalog</p>
            </div>
          </div>
          <div className="ingestion-card-body">
            <label className="ingestion-label" htmlFor="asset-select">Registered Asset</label>
            <div className="ingestion-select-wrapper">
              {loadingAssets ? (
                <div className="ingestion-select-loading">Loading registered catalog assets...</div>
              ) : assets.length === 0 ? (
                <div className="ingestion-empty-box">
                  <p>No registered assets found for this project.</p>
                  <span className="empty-subtext">Register a schema definition in the Asset Registry first.</span>
                  <Link to={`/projects/${selectedProjectId}/registry-asset`} className="primary-button small-btn">
                    Register New Asset
                  </Link>
                </div>
              ) : (
                <select
                  id="asset-select"
                  className="ingestion-select"
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                >
                  <option value="">-- Choose Registered Asset --</option>
                  {assets.map((asset) => (
                    <option key={asset.asset_id} value={asset.asset_id}>
                      {asset.asset_name} ({asset.column_count || 0} cols) — {asset.is_populated ? `Populated (${asset.row_count} rows)` : 'Empty / Registered'}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedAsset && (
              <div className="ingestion-meta-chip">
                <div className="meta-chip-row">
                  <span className="meta-title">Asset Name:</span>
                  <strong className="meta-value">{selectedAsset.asset_name}</strong>
                </div>
                <div className="meta-chip-row">
                  <span className="meta-title">Source Type:</span>
                  <span className="meta-value">{selectedAsset.source_type || 'FILE_UPLOAD'}</span>
                </div>
                <div className="meta-chip-row">
                  <span className="meta-title">Data Status:</span>
                  <span className={`status-pill ${selectedAsset.is_populated ? 'status-pill--uploaded' : 'status-pill--pending'}`}>
                    <span className="status-dot"></span>
                    {selectedAsset.is_populated ? `Populated (${selectedAsset.row_count} rows)` : 'Metadata Only (Empty)'}
                  </span>
                </div>
                {selectedAsset.file_size != null && (
                  <div className="meta-chip-row">
                    <span className="meta-title">Original Size:</span>
                    <span className="meta-value">{formatBytes(selectedAsset.file_size)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Registered Column Specification Inspector ───────────── */}
      {selectedAsset && (
        <section className="asset-columns-inspector">
          <div className="inspector-header">
            <h4>Registered Target Columns ({(Array.isArray(assetColumns) ? assetColumns.length : 0)})</h4>
            <span className="inspector-desc">
              Data ingested via any method below will be loaded into these target fields.
            </span>
          </div>
          {loadingColumns ? (
            <div className="ingestion-select-loading">Loading column specifications...</div>
          ) : (
            <div className="columns-badges-wrap">
              {(Array.isArray(assetColumns) ? assetColumns : []).map((col) => (
                <div key={col.column_id || col.column_name} className="column-spec-pill">
                  <strong className="col-pill-name">{col.column_name}</strong>
                  <span className="col-pill-type">{col.data_type}</span>
                  {col.is_pk && <span className="col-pill-pk">PK</span>}
                  {!col.is_nullable && !col.is_pk && <span className="col-pill-req">REQ</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── STEP 3: Choose Data-Loading Method ─────────────────── */}
      {selectedAsset ? (
        <section className="ingestion-methods-section">
          <div className="methods-section-header">
            <span className="ingestion-step-number">3</span>
            <div>
              <h2>Choose Data-Loading Method</h2>
              <p>Select how you want to populate business records for <strong>{selectedAsset.asset_name}</strong></p>
            </div>
          </div>

          {/* Method Navigation Tabs */}
          <div className="method-tabs-nav">
            <button
              type="button"
              className={`method-tab-btn ${activeMethod === 'file' ? 'method-tab-btn--active' : ''}`}
              onClick={() => setActiveMethod('file')}
            >
              <span className="tab-icon">📁</span>
              <div>
                <strong>Method A — Upload a File</strong>
                <span>CSV, Excel, JSON, YAML</span>
              </div>
            </button>

            <button
              type="button"
              className={`method-tab-btn ${activeMethod === 'mock' ? 'method-tab-btn--active' : ''}`}
              onClick={() => setActiveMethod('mock')}
            >
              <span className="tab-icon">⚡</span>
              <div>
                <strong>Method B — Synthetic Data</strong>
                <span>Auto-generate mock records</span>
              </div>
            </button>

            <button
              type="button"
              className={`method-tab-btn ${activeMethod === 'database' ? 'method-tab-btn--active' : ''}`}
              onClick={() => setActiveMethod('database')}
            >
              <span className="tab-icon">🔌</span>
              <div>
                <strong>Method C — Connect to Database</strong>
                <span>Import from external DB table</span>
              </div>
            </button>
          </div>

          {/* ── Method Content Panes ──────────────────────────────── */}
          <div className="method-content-card">
            {/* ── METHOD A: Upload File ───────────────────────────── */}
            {activeMethod === 'file' && (
              <div className="method-panel">
                <div className="panel-kicker">
                  <h3>Method A: Upload a Business Data File</h3>
                  <p>Upload a data file matching the registered column schema. Formats supported: <strong>.csv, .xlsx, .xls, .json, .yaml</strong>.</p>
                </div>

                <div
                  className="upload-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,.json,.yaml,.yml"
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                  />
                  <div className="dropzone-icon">📥</div>
                  <div className="dropzone-text">
                    <strong>{selectedFile ? selectedFile.name : 'Click to select or drag and drop data file'}</strong>
                    <span className="dropzone-hint">
                      {selectedFile ? `${formatBytes(selectedFile.size)} • Click to replace` : 'CSV, Excel (.xlsx, .xls), JSON, or YAML'}
                    </span>
                  </div>
                </div>

                {fileParsing && (
                  <div className="ingestion-select-loading">Analyzing file schema and validating columns...</div>
                )}

                {fileUploadError && !validationResult && (
                  <div className="ingestion-alert ingestion-alert--error">
                    {fileUploadError}
                  </div>
                )}

                {/* ── Strict File-to-Asset Validation Card ── */}
                {validationResult && (
                  <div className={`validation-summary-card ${validationResult.isValid ? 'validation-summary--valid' : 'validation-summary--invalid'}`}>
                    <div className="validation-summary-head">
                      <div className="validation-badge-title">
                        <span className={`validation-status-icon ${validationResult.isValid ? 'icon-valid' : 'icon-invalid'}`}>
                          {validationResult.isValid ? '✓' : '✕'}
                        </span>
                        <h4>{validationResult.isValid ? 'Schema Validation Passed' : 'Schema Mismatch Detected'}</h4>
                      </div>
                      <div className="validation-count-chip">
                        {validationResult.uploadedCount} uploaded vs {validationResult.expectedCount} registered cols
                      </div>
                    </div>

                    {!validationResult.isValid && (
                      <div className="validation-summary-body">
                        <p className="validation-error-lead">{validationResult.error}</p>

                        {validationResult.duplicateColumns.length > 0 && (
                          <div className="validation-breakdown-row">
                            <span className="validation-breakdown-label">Duplicate Column Names:</span>
                            <div className="validation-tags-wrap">
                              {validationResult.duplicateColumns.map((col, idx) => (
                                <span key={idx} className="validation-tag tag--duplicate">{col}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {validationResult.missingColumns.length > 0 && (
                          <div className="validation-breakdown-row">
                            <span className="validation-breakdown-label">Missing Registered Columns:</span>
                            <div className="validation-tags-wrap">
                              {validationResult.missingColumns.map((col, idx) => (
                                <span key={idx} className="validation-tag tag--missing">{col}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {validationResult.unexpectedColumns.length > 0 && (
                          <div className="validation-breakdown-row">
                            <span className="validation-breakdown-label">Unexpected Extra Columns:</span>
                            <div className="validation-tags-wrap">
                              {validationResult.unexpectedColumns.map((col, idx) => (
                                <span key={idx} className="validation-tag tag--unexpected">{col}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {validationResult.incompatibleTypes.length > 0 && (
                          <div className="validation-breakdown-row">
                            <span className="validation-breakdown-label">Data Type Mismatches:</span>
                            <ul className="validation-types-list">
                              {validationResult.incompatibleTypes.map((err, idx) => (
                                <li key={idx}>{err}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Preview Table */}
                {filePreviewRows.length > 0 && (
                  <div className="preview-table-container">
                    <div className="preview-table-header">
                      <h5>Sample Records Preview (first 5 rows)</h5>
                      <span>Ready to load into destination table</span>
                    </div>
                    <div className="preview-table-scroll">
                      <table className="preview-table">
                        <thead>
                          <tr>
                            {filePreviewHeaders.map(h => (
                              <th key={h}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filePreviewRows.slice(0, 5).map((row, idx) => (
                            <tr key={idx}>
                              {filePreviewHeaders.map(h => (
                                <td key={h}>{row[h] !== undefined && row[h] !== null ? String(row[h]) : '—'}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="panel-actions-row">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!selectedFile || !validationResult?.isValid || Boolean(fileUploadError) || ingestingFile}
                    onClick={handleIngestFile}
                  >
                    {ingestingFile ? (
                      <>
                        <span className="spinner-inline"></span>
                        Ingesting File Data...
                      </>
                    ) : (
                      'Confirm & Ingest File Data'
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── METHOD B: Synthetic Mock Data ───────────────────── */}
            {activeMethod === 'mock' && (
              <div className="method-panel">
                <div className="panel-kicker">
                  <h3>Method B: Generate Synthetic Mock Data</h3>
                  <p>Automatically generate realistic mock records matching the exact data types, constraints, and primary keys of <strong>{selectedAsset.asset_name}</strong>.</p>
                </div>

                <div className="mock-config-row">
                  <div className="mock-input-wrap">
                    <label htmlFor="mock-row-count" className="ingestion-label">Number of Rows to Generate (10 – 1,000)</label>
                    <div className="mock-number-controls">
                      <input
                        id="mock-row-count"
                        type="number"
                        min="10"
                        max="1000"
                        step="10"
                        className="modal-text-input"
                        value={mockRowCount}
                        onChange={(e) => setMockRowCount(Number(e.target.value) || 100)}
                      />
                      <div className="quick-count-presets">
                        {[50, 100, 250, 500].map(cnt => (
                          <button
                            key={cnt}
                            type="button"
                            className={`preset-btn ${mockRowCount === cnt ? 'preset-btn--active' : ''}`}
                            onClick={() => setMockRowCount(cnt)}
                          >
                            {cnt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mock Preview Table */}
                {mockPreviewRows.length > 0 && (
                  <div className="preview-table-container">
                    <div className="preview-table-header">
                      <h5>Sample Synthetic Preview</h5>
                      <span className="badge-synthetic">Synthetic Mock Records</span>
                    </div>
                    <div className="preview-table-scroll">
                      <table className="preview-table">
                        <thead>
                          <tr>
                            {assetColumns.map(c => (
                              <th key={c.column_name}>
                                {c.column_name} <small>({c.data_type})</small>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {mockPreviewRows.map((row, idx) => (
                            <tr key={idx}>
                              {assetColumns.map(c => (
                                <td key={c.column_name}>{String(row[c.column_name] ?? '—')}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="panel-actions-row">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={ingestingMock || mockRowCount < 1}
                    onClick={handleIngestMock}
                  >
                    {ingestingMock ? (
                      <>
                        <span className="spinner-inline"></span>
                        Generating & Ingesting Records...
                      </>
                    ) : (
                      `Generate & Ingest ${mockRowCount} Mock Rows`
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── METHOD C: Connect to Database ───────────────────── */}
            {activeMethod === 'database' && (
              <div className="method-panel">
                <div className="panel-kicker">
                  <h3>Method C: Connect to External Database</h3>
                  <p>Discover source tables from a connected PostgreSQL database, map fields to <strong>{selectedAsset.asset_name}</strong>, and import records.</p>
                </div>

                {/* Mode Toggle */}
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
                    Individual Connection Fields
                  </button>
                </div>

                {connectionMode === 'uri' ? (
                  <div className="modal-field-group">
                    <label>Database Connection URI</label>
                    <input
                      type="text"
                      className="modal-text-input"
                      placeholder="postgresql://user:password@hostname:5432/database?sslmode=require"
                      value={connectionString}
                      onChange={(e) => setConnectionString(e.target.value)}
                    />
                    <span className="input-helper">Credentials are handled exclusively on the backend.</span>
                  </div>
                ) : (
                  <div className="db-fields-grid">
                    <div className="modal-field-group">
                      <label>Host</label>
                      <input
                        type="text"
                        className="modal-text-input"
                        placeholder="db.example.com or localhost"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                      />
                    </div>
                    <div className="modal-field-group">
                      <label>Port</label>
                      <input
                        type="number"
                        className="modal-text-input"
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                      />
                    </div>
                    <div className="modal-field-group">
                      <label>Database</label>
                      <input
                        type="text"
                        className="modal-text-input"
                        value={database}
                        onChange={(e) => setDatabase(e.target.value)}
                      />
                    </div>
                    <div className="modal-field-group">
                      <label>Username</label>
                      <input
                        type="text"
                        className="modal-text-input"
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                      />
                    </div>
                    <div className="modal-field-group">
                      <label>Password</label>
                      <input
                        type="password"
                        className="modal-text-input"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <div className="modal-field-group">
                      <label>TLS / SSL Mode</label>
                      <select
                        className="modal-text-input"
                        value={sslMode}
                        onChange={(e) => setSslMode(e.target.value)}
                      >
                        <option value="prefer">prefer</option>
                        <option value="require">require</option>
                        <option value="disable">disable (local only)</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="db-test-action">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={testingConnection || (connectionMode === 'uri' ? !connectionString : !host || !database || !user)}
                    onClick={handleTestDbConnection}
                  >
                    {testingConnection ? 'Testing Connection & Discovering Tables...' : 'Test Connection & Discover Tables'}
                  </button>
                </div>

                {dbError && (
                  <div className="ingestion-alert ingestion-alert--error">{dbError}</div>
                )}

                {/* Discovered Tables & Column Mapping */}
                {discoveredTables.length > 0 && (
                  <div className="db-discovered-container">
                    <div className="modal-field-group">
                      <label className="ingestion-label">Select Source Table to Import</label>
                      <select
                        className="ingestion-select"
                        value={selectedDbTable}
                        onChange={(e) => handleDbTableSelect(e.target.value)}
                      >
                        <option value="">-- Choose Discovered Table --</option>
                        {discoveredTables.map(t => {
                          const tName = typeof t === 'object' ? t.name : String(t);
                          const colCount = typeof t === 'object' ? t.columnCount : '';
                          return (
                            <option key={tName} value={tName}>
                              {tName} {colCount ? `(${colCount} columns)` : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {loadingDbColumns && (
                      <div className="ingestion-select-loading">Introspecting source table columns...</div>
                    )}

                    {sourceDbColumns.length > 0 && (
                      <div className="column-mapping-section">
                        <h4>Column Mapping</h4>
                        <p className="mapping-sub">Map source table columns to the registered target asset columns.</p>

                        <div className="mapping-grid">
                          {assetColumns.map(targetCol => (
                            <div key={targetCol.column_name} className="mapping-row">
                              <div className="target-col-label">
                                <strong>{targetCol.column_name}</strong>
                                <span className="col-pill-type">{targetCol.data_type}</span>
                                {targetCol.is_pk && <span className="col-pill-pk">PK</span>}
                              </div>
                              <span className="mapping-arrow">←</span>
                              <div className="source-col-select-wrap">
                                <select
                                  className="modal-text-input"
                                  value={columnMapping[targetCol.column_name] || ''}
                                  onChange={(e) => setColumnMapping({
                                    ...columnMapping,
                                    [targetCol.column_name]: e.target.value
                                  })}
                                >
                                  <option value="">-- Ignore / Null --</option>
                                  {sourceDbColumns.map(srcCol => (
                                    <option key={srcCol.name} value={srcCol.name}>
                                      {srcCol.name} ({srcCol.type})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="modal-field-group" style={{ maxWidth: '240px', marginTop: '16px' }}>
                          <label>Max Rows to Import</label>
                          <input
                            type="number"
                            min="10"
                            max="5000"
                            className="modal-text-input"
                            value={dbRowLimit}
                            onChange={(e) => setDbRowLimit(Number(e.target.value) || 500)}
                          />
                        </div>

                        <div className="panel-actions-row">
                          <button
                            type="button"
                            className="primary-button"
                            disabled={!selectedDbTable || ingestingDb}
                            onClick={handleIngestDatabase}
                          >
                            {ingestingDb ? (
                              <>
                                <span className="spinner-inline"></span>
                                Importing Database Rows...
                              </>
                            ) : (
                              `Import Data from "${selectedDbTable}"`
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="select-asset-cta-box">
          <span className="cta-icon">👆</span>
          <h3>Select a Registered Asset Above</h3>
          <p>Please select an asset from the project to configure its data ingestion method.</p>
        </div>
      )}

      {/* ── Summary & Status Dashboard Bar ──────────────────────── */}
      <footer className="ingestion-summary-panel">
        <div className="summary-card">
          <span className="summary-label">Project</span>
          <strong className="summary-value summary-truncate">
            {currentProject?.name || selectedProjectId || 'None selected'}
          </strong>
        </div>

        <div className="summary-card">
          <span className="summary-label">Target Asset</span>
          <strong className="summary-value summary-truncate">
            {selectedAsset ? selectedAsset.asset_name : 'None selected'}
          </strong>
        </div>

        <div className="summary-card">
          <span className="summary-label">Status</span>
          <div className="summary-status-wrap">
            <span className={`status-pill ${selectedAsset?.is_populated ? 'status-pill--uploaded' : 'status-pill--pending'}`}>
              <span className="status-dot"></span>
              {selectedAsset?.is_populated ? 'Populated' : 'Registered / Empty'}
            </span>
          </div>
        </div>

        <div className="summary-card">
          <span className="summary-label">Row Count</span>
          <strong className="summary-value">
            {selectedAsset?.row_count ?? 0}
          </strong>
        </div>

        <div className="summary-card">
          <span className="summary-label">Destination Table</span>
          {selectedAsset?.is_populated && selectedAsset?.generated_table_id ? (
            <Link to={`/projects/${selectedProjectId}/tables/${selectedAsset.generated_table_id}`} className="view-table-link">
              View Physical Table →
            </Link>
          ) : (
            <span className="summary-sub">Pending ingestion</span>
          )}
        </div>
      </footer>
    </div>
  );
}
