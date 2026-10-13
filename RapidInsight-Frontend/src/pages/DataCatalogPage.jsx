import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  getCatalogSources,
  getCatalogAssets,
  getCatalogColumns,
  runProfileStat,
  getProfilingHistory
} from '../api/catalogApi.js';
import './DataCatalogPage.css';

const NUMERIC_TYPES = new Set([
  'number',
  'integer',
  'bigint',
  'smallint',
  'decimal',
  'numeric',
  'real',
  'double precision',
  'float',
  'int',
  'int2',
  'int4',
  'int8',
  'float4',
  'float8'
]);

function isNumericType(type) {
  const norm = String(type || '').trim().toLowerCase();
  return NUMERIC_TYPES.has(norm);
}

const STATISTIC_LABELS = {
  NULL_COUNT: 'Null Count',
  COUNT: 'Total Count',
  DISTINCT_COUNT: 'Distinct Count',
  MIN: 'Minimum (Numeric)',
  MAX: 'Maximum (Numeric)',
  AVG: 'Average (Numeric)'
};

function formatDateTime(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(d);
  } catch {
    return isoString;
  }
}


export default function DataCatalogPage() {
  const { projectId } = useParams();

  // Mode: 'empty' or 'builder'
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Data selections
  const [sources, setSources] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  
  const [assets, setAssets] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  
  const [columns, setColumns] = useState([]);
  const [selectedColumnId, setSelectedColumnId] = useState('');
  
  const [selectedStatistic, setSelectedStatistic] = useState('');

  // Loading & error states
  const [loadingSources, setLoadingSources] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [runningQuery, setRunningQuery] = useState(false);
  const [error, setError] = useState('');
  const [readinessWarning, setReadinessWarning] = useState('');

  // Results & History
  const [resultData, setResultData] = useState(null);
  const [profilingHistory, setProfilingHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // 1. Fetch sources and existing catalog data on mount or project switch
  const loadCatalogData = useCallback(async () => {
    if (!projectId) return;
    try {
      setInitialLoading(true);
      setLoadingSources(true);
      setError('');

      const res = await getCatalogSources(projectId);
      const items = res?.data || res || [];
      const sourcesList = Array.isArray(items) ? items : [];
      setSources(sourcesList);

      if (sourcesList.length > 0) {
        setIsBuilderOpen(true);

        // Check if there was a saved selection for this project in session
        let saved = null;
        try {
          const raw = sessionStorage.getItem(`rapidinsight_catalog_${projectId}`);
          if (raw) saved = JSON.parse(raw);
        } catch {
          saved = null;
        }

        const targetSourceId =
          saved?.sourceId && sourcesList.some((s) => s.source_id === saved.sourceId)
            ? saved.sourceId
            : '';

        setSelectedSourceId(targetSourceId);

        if (targetSourceId) {
          // Fetch assets for the selected source
          setLoadingAssets(true);
          const assetsRes = await getCatalogAssets(projectId, targetSourceId);
          const rawAssets = assetsRes?.data || assetsRes || [];
          const assetList = Array.isArray(rawAssets) ? rawAssets : [];
          setAssets(assetList);

          const targetAsset =
            saved?.assetId && assetList.find((a) => a.asset_id === saved.assetId)
              ? assetList.find((a) => a.asset_id === saved.assetId)
              : null;

          if (targetAsset) {
            setSelectedAssetId(targetAsset.asset_id);

            if (!targetAsset.is_populated) {
              setReadinessWarning(
                `Asset '${targetAsset.asset_name}' is not currently backed by a populated database table. Generate tables before profiling.`
              );
            } else {
              setReadinessWarning('');
            }

            // Fetch columns for the selected asset
            setLoadingColumns(true);
            const colsRes = await getCatalogColumns(projectId, targetAsset.asset_id);
            const rawCols = colsRes?.data || colsRes || [];
            const colList = Array.isArray(rawCols) ? rawCols : [];
            setColumns(colList);

            // Restore column and statistic if previously selected
            if (saved?.columnId && colList.some((c) => c.column_id === saved.columnId)) {
              setSelectedColumnId(saved.columnId);
              if (saved?.statistic) {
                setSelectedStatistic(saved.statistic);
              }
              if (saved?.resultData) {
                setResultData(saved.resultData);
              }
            }
          }
        }
      }
    } catch (err) {
      setError(err?.message || 'Failed to fetch catalog sources.');
    } finally {
      setLoadingSources(false);
      setLoadingAssets(false);
      setLoadingColumns(false);
      setInitialLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadCatalogData();
  }, [loadCatalogData]);

  // Sync state to sessionStorage
  useEffect(() => {
    if (!projectId || !selectedSourceId) return;
    try {
      sessionStorage.setItem(
        `rapidinsight_catalog_${projectId}`,
        JSON.stringify({
          sourceId: selectedSourceId,
          assetId: selectedAssetId,
          columnId: selectedColumnId,
          statistic: selectedStatistic,
          resultData
        })
      );
    } catch {
      // Ignore storage errors
    }
  }, [projectId, selectedSourceId, selectedAssetId, selectedColumnId, selectedStatistic, resultData]);

  // 2. Fetch assets when source changes
  const handleSourceChange = async (e) => {
    const sourceId = e.target.value;
    setSelectedSourceId(sourceId);
    
    // Reset downstream
    setSelectedAssetId('');
    setAssets([]);
    setSelectedColumnId('');
    setColumns([]);
    setSelectedStatistic('');
    setReadinessWarning('');
    setResultData(null);
    setError('');

    if (!sourceId) return;

    try {
      setLoadingAssets(true);
      const res = await getCatalogAssets(projectId, sourceId);
      const items = res?.data || res || [];
      setAssets(items);
    } catch (err) {
      setError(err?.message || 'Failed to fetch catalog assets.');
    } finally {
      setLoadingAssets(false);
    }
  };

  // 3. Fetch columns when asset changes
  const handleAssetChange = async (e) => {
    const assetId = e.target.value;
    setSelectedAssetId(assetId);

    // Reset downstream
    setSelectedColumnId('');
    setColumns([]);
    setSelectedStatistic('');
    setResultData(null);
    setError('');

    const currentAsset = assets.find((a) => a.asset_id === assetId);
    if (currentAsset && !currentAsset.is_populated) {
      setReadinessWarning(
        `Asset '${currentAsset.asset_name}' is not currently backed by a populated database table. Generate tables before profiling.`
      );
    } else {
      setReadinessWarning('');
    }

    if (!assetId) return;

    try {
      setLoadingColumns(true);
      const res = await getCatalogColumns(projectId, assetId);
      const items = res?.data || res || [];
      setColumns(items);
    } catch (err) {
      setError(err?.message || 'Failed to fetch catalog columns.');
    } finally {
      setLoadingColumns(false);
    }
  };

  // 4. Handle column change
  const handleColumnChange = (e) => {
    const colId = e.target.value;
    setSelectedColumnId(colId);
    setSelectedStatistic('');
    setResultData(null);
  };

  // 5. Compute available statistics based on column data type
  const selectedColumn = useMemo(() => {
    return columns.find((c) => c.column_id === selectedColumnId) || null;
  }, [columns, selectedColumnId]);

  const availableStatistics = useMemo(() => {
    const stats = ['NULL_COUNT', 'COUNT', 'DISTINCT_COUNT'];
    if (selectedColumn && isNumericType(selectedColumn.data_type)) {
      stats.push('MIN', 'MAX', 'AVG');
    }
    return stats;
  }, [selectedColumn]);

  // Selected asset metadata
  const selectedAsset = useMemo(() => {
    return assets.find((a) => a.asset_id === selectedAssetId) || null;
  }, [assets, selectedAssetId]);

  // Can run check
  const canRun = useMemo(() => {
    return (
      Boolean(selectedSourceId) &&
      Boolean(selectedAssetId) &&
      Boolean(selectedColumnId) &&
      Boolean(selectedStatistic) &&
      Boolean(selectedAsset?.is_populated) &&
      !runningQuery
    );
  }, [selectedSourceId, selectedAssetId, selectedColumnId, selectedStatistic, selectedAsset, runningQuery]);

  // Load profiling history from database
  const loadProfilingHistory = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoadingHistory(true);
      const res = await getProfilingHistory(projectId);
      const items = res?.data || res || [];
      setProfilingHistory(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error('Failed to load profiling history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadProfilingHistory();
  }, [loadProfilingHistory]);

  // 6. Run profiling
  const handleRunProfile = async () => {
    if (!canRun) return;
    try {
      setRunningQuery(true);
      setError('');
      setResultData(null);

      const res = await runProfileStat({
        projectId,
        columnId: selectedColumnId,
        statistic: selectedStatistic
      });

      const data = res?.data || res;
      setResultData(data);
      // Reload persisted history immediately so the new result is displayed
      await loadProfilingHistory();
    } catch (err) {
      setError(err?.message || 'Profiling execution failed.');
    } finally {
      setRunningQuery(false);
    }
  };

  const handleAddCatalog = () => {
    setIsBuilderOpen(true);
    setSelectedColumnId('');
    setSelectedStatistic('');
    setResultData(null);
    setError('');
  };

  const handleOpenBuilder = () => {
    setIsBuilderOpen(true);
    setResultData(null);
    setError('');
  };

  const handleResetBuilder = () => {
    setSelectedSourceId('');
    setSelectedAssetId('');
    setAssets([]);
    setSelectedColumnId('');
    setColumns([]);
    setSelectedStatistic('');
    setReadinessWarning('');
    setResultData(null);
    setError('');
    try {
      sessionStorage.removeItem(`rapidinsight_catalog_${projectId}`);
    } catch {
      // Ignore
    }
  };

  const handleRunAnother = () => {
    setSelectedColumnId('');
    setSelectedStatistic('');
    setResultData(null);
  };

  return (
    <div className="catalog-page">
      <div className="catalog-header-bar">
        <div className="catalog-header">
          <h1>Data Catalog</h1>
          <p>Inspect project catalog assets and run verified profiling statistics against populated database tables.</p>
        </div>
      </div>

      {error && (
        <div className="catalog-banner-error" role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Loading State on Mount */}
      {initialLoading && (
        <div className="catalog-loading-card">
          <div className="catalog-spinner" aria-hidden="true" />
          <span>Loading project catalog...</span>
        </div>
      )}

      {/* Initial Empty State (when project has no catalog entries) */}
      {!initialLoading && !isBuilderOpen && (
        <div className="catalog-empty-card">
          <div className="catalog-empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
              <path d="M6 6h10" />
              <path d="M6 10h10" />
              <path d="M6 14h6" />
            </svg>
          </div>
          <h2 className="catalog-empty-title">No Catalog Profiling Configured</h2>
          <p className="catalog-empty-desc">
            Connect an asset, choose a column, and configure statistical queries such as null count, distinct count, or averages.
          </p>
          <button
            type="button"
            className="catalog-btn-primary"
            onClick={handleAddCatalog}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>+ Add Catalog</span>
          </button>
        </div>
      )}

      {/* Query Configuration Form */}
      {!initialLoading && isBuilderOpen && (
        <div className="catalog-card">
          <div className="catalog-card-header">
            <h2>Query Configuration</h2>
            <button
              type="button"
              className="catalog-btn-ghost"
              onClick={handleResetBuilder}
            >
              Clear Selections
            </button>
          </div>

          <div className="catalog-form-grid">
            {/* 1. Source */}
            <div className="catalog-form-group">
              <label htmlFor="catalog-source-select" className="catalog-form-label">
                1. Project Source
              </label>
              <select
                id="catalog-source-select"
                className="catalog-select"
                value={selectedSourceId}
                onChange={handleSourceChange}
                disabled={loadingSources}
              >
                <option value="">
                  {loadingSources
                    ? 'Loading sources...'
                    : sources.length === 0
                    ? '-- No sources found (upload schemas in Overview first) --'
                    : '-- Select Source --'}
                </option>
                {sources.map((src) => (
                  <option key={src.source_id} value={src.source_id}>
                    {src.source_name} ({src.source_type})
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Asset — shown after Project Source is selected */}
            {selectedSourceId && (
              <div className="catalog-form-group">
                <label htmlFor="catalog-asset-select" className="catalog-form-label">
                  2. Asset / Table
                </label>
                <select
                  id="catalog-asset-select"
                  className="catalog-select"
                  value={selectedAssetId}
                  onChange={handleAssetChange}
                  disabled={loadingAssets}
                >
                  <option value="">
                    {loadingAssets ? 'Loading assets...' : '-- Select Asset --'}
                  </option>
                  {assets.map((ast) => (
                    <option key={ast.asset_id} value={ast.asset_id}>
                      {ast.asset_name} {ast.is_populated ? '(Populated)' : '(Unpopulated)'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 3. Column — shown after Asset / Table is selected */}
            {selectedAssetId && (
              <div className="catalog-form-group">
                <label htmlFor="catalog-column-select" className="catalog-form-label">
                  3. Asset Column
                </label>
                <select
                  id="catalog-column-select"
                  className="catalog-select"
                  value={selectedColumnId}
                  onChange={handleColumnChange}
                  disabled={loadingColumns}
                >
                  <option value="">
                    {loadingColumns ? 'Loading columns...' : '-- Select Column --'}
                  </option>
                  {columns.map((col) => (
                    <option key={col.column_id} value={col.column_id}>
                      {col.column_name} [{col.data_type.toUpperCase()}]
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 4. Statistic — shown after Asset Column is selected */}
            {selectedColumnId && (
              <div className="catalog-form-group">
                <label htmlFor="catalog-statistic-select" className="catalog-form-label">
                  4. Profiling Statistic
                </label>
                <select
                  id="catalog-statistic-select"
                  className="catalog-select"
                  value={selectedStatistic}
                  onChange={(e) => setSelectedStatistic(e.target.value)}
                >
                  <option value="">-- Select Statistic --</option>
                  {availableStatistics.map((stat) => (
                    <option key={stat} value={stat}>
                      {STATISTIC_LABELS[stat] || stat}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Empty Sources Notice */}
          {sources.length === 0 && !loadingSources && (
            <div className="catalog-banner-info">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>No schemas or database tables have been uploaded to this project yet. Upload schemas in the <strong>Overview</strong> section to populate assets.</span>
            </div>
          )}

          {/* Readiness Warning */}
          {readinessWarning && (
            <div className="catalog-banner-warning">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>{readinessWarning}</span>
            </div>
          )}

          {/* Action Row — shown after Profiling Statistic is selected */}
          {selectedStatistic && (
            <div className="catalog-action-row">
              <button
                type="button"
                className="catalog-btn-primary"
                disabled={!canRun}
                onClick={handleRunProfile}
              >
                {runningQuery ? (
                  <>
                    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                    </svg>
                    <span>Running Query...</span>
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span>Run Profiling</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Results Card */}
      {resultData && (
        <div className="catalog-results-card">
          <div className="catalog-card-header">
            <div>
              <h2>Profiling Result</h2>
              <span className="catalog-metric-subtext">
                Target: <strong>{resultData.assetName}</strong>.<strong>{resultData.columnName}</strong> ({resultData.dataType})
              </span>
            </div>
            <button
              type="button"
              className="catalog-btn-ghost"
              onClick={handleRunAnother}
            >
              + Run Another Profiling
            </button>
          </div>

          <div className="catalog-results-metrics">
            <div className="catalog-metric-box">
              <span className="catalog-metric-label">Statistic</span>
              <strong className="catalog-metric-value">
                {STATISTIC_LABELS[resultData.statistic] || resultData.statistic}
              </strong>
            </div>

            <div className="catalog-metric-box">
              <span className="catalog-metric-label">Result Value</span>
              <strong className="catalog-metric-value">
                {resultData.result !== null && resultData.result !== undefined
                  ? String(resultData.result)
                  : 'N/A'}
              </strong>
            </div>

            <div className="catalog-metric-box">
              <span className="catalog-metric-label">Sample Size</span>
              <strong className="catalog-metric-value">
                {resultData.sampleSize?.toLocaleString?.() ?? resultData.sampleSize}
              </strong>
              <span className="catalog-metric-subtext">Total active rows</span>
            </div>

            <div className="catalog-metric-box">
              <span className="catalog-metric-label">Execution Time</span>
              <strong className="catalog-metric-value">
                {resultData.executionDurationMs} ms
              </strong>
              <span className="catalog-metric-subtext">Server duration</span>
            </div>
          </div>
        </div>
      )}

      {/* Profiling History Table */}
      {!initialLoading && (
        <div className="catalog-history-card">
          <div className="catalog-card-header">
            <div className="catalog-history-header-title">
              <h2>Profiling History</h2>
              <span className="catalog-history-badge">
                {profilingHistory.length} {profilingHistory.length === 1 ? 'run' : 'runs'}
              </span>
            </div>
          </div>

          {loadingHistory && profilingHistory.length === 0 ? (
            <div className="catalog-history-loading">
              <div className="catalog-spinner" aria-hidden="true" />
              <span>Loading saved profiling history...</span>
            </div>
          ) : profilingHistory.length === 0 ? (
            <div className="catalog-history-empty">
              <p>No profiling runs recorded yet. Select options above and click <strong>Run Profiling</strong> to record your first run.</p>
            </div>
          ) : (
            <div className="catalog-history-table-container">
              <table className="catalog-history-table">
                <thead>
                  <tr>
                    <th>Run Time</th>
                    <th>Source</th>
                    <th>Asset / Table</th>
                    <th>Column</th>
                    <th>Data Type</th>
                    <th>Statistic</th>
                    <th>Result Value</th>
                    <th>Sample Size</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {profilingHistory.map((item) => (
                    <tr key={item.result_id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.created_at)}</td>
                      <td>{item.source_name || '-'}</td>
                      <td><strong>{item.asset_name}</strong></td>
                      <td><code>{item.column_name}</code></td>
                      <td><span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{item.data_type}</span></td>
                      <td>
                        <span className="catalog-history-stat-badge">
                          {STATISTIC_LABELS[item.statistic] || item.statistic}
                        </span>
                      </td>
                      <td className="catalog-history-result-cell">
                        {item.result_value !== null && item.result_value !== undefined
                          ? String(item.result_value)
                          : 'N/A'}
                      </td>
                      <td>{item.sample_size !== null && item.sample_size !== undefined ? Number(item.sample_size).toLocaleString() : '-'}</td>
                      <td>{item.execution_duration_ms != null ? `${item.execution_duration_ms} ms` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

