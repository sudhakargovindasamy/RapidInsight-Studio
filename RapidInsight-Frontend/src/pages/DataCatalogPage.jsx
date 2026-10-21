import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

import {
  getProjectById
} from '../api/projectApi.js';
import {
  getCatalogSources,
  getCatalogAssets,
  getCatalogColumns,
  runProfileStat,
  getProfilingHistory,
  getProfilingHistoryItem
} from '../api/catalogApi.js';
import './DataCatalogPage.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

function CatalogChartCard({ chart }) {
  const isLine = chart.type === 'line';
  const initialLabels = chart.data?.labels || [];
  const initialDatasets = chart.data?.datasets || [];
  const totalCategories = initialLabels.length;

  // Horizontal layout is much cleaner whenever there are more than 6 categories or if full width
  const [orientation, setOrientation] = useState(() => {
    if (isLine) return 'x';
    return totalCategories > 6 || chart.isFullWidth ? 'y' : 'x';
  });

  // Category view limit: Top 10, Top 25, or All
  const [itemLimit, setItemLimit] = useState(() => {
    if (totalCategories > 30) return 25;
    return 'all';
  });

  const isHorizontal = orientation === 'y';

  // Compute filtered labels and values
  const { displayedLabels, displayedDatasets } = useMemo(() => {
    if (itemLimit === 'all' || isLine || totalCategories <= 10) {
      return { displayedLabels: initialLabels, displayedDatasets: initialDatasets };
    }
    const limitNum = Number(itemLimit);
    const slicedLabels = initialLabels.slice(0, limitNum);
    const slicedDatasets = initialDatasets.map((ds) => ({
      ...ds,
      data: Array.isArray(ds.data) ? ds.data.slice(0, limitNum) : ds.data,
      backgroundColor: Array.isArray(ds.backgroundColor) ? ds.backgroundColor.slice(0, limitNum) : ds.backgroundColor
    }));
    return { displayedLabels: slicedLabels, displayedDatasets: slicedDatasets };
  }, [initialLabels, initialDatasets, itemLimit, isLine, totalCategories]);

  // Dynamic canvas height when horizontal so each bar has comfortable breathing room
  const canvasHeight = useMemo(() => {
    if (isLine) return 280;
    if (isHorizontal) {
      return Math.max(260, displayedLabels.length * 30);
    }
    return 320;
  }, [isLine, isHorizontal, displayedLabels.length]);

  // Enhanced dataset with rounded corners, maxBarThickness, and sleek colors
  const finalData = useMemo(() => {
    return {
      labels: displayedLabels,
      datasets: displayedDatasets.map((ds, idx) => ({
        ...ds,
        borderRadius: isHorizontal
          ? { topRight: 6, bottomRight: 6, topLeft: 0, bottomLeft: 0 }
          : { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
        maxBarThickness: isHorizontal ? 22 : 36,
        barPercentage: 0.85,
        categoryPercentage: 0.85,
        backgroundColor: ds.backgroundColor || (idx === 0 ? '#6366f1' : '#a855f7'),
        hoverBackgroundColor: '#4f46e5'
      }))
    };
  }, [displayedLabels, displayedDatasets, isHorizontal]);

  // Options customized for the chosen orientation and theme
  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: orientation,
      animation: {
        duration: 350
      },
      plugins: {
        legend: {
          display: initialDatasets.length > 1,
          position: 'top',
          align: 'end',
          labels: {
            color: '#94a3b8',
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            font: { size: 11, weight: '600' }
          }
        },
        tooltip: {
          backgroundColor: '#0f172a',
          borderColor: 'rgba(148, 163, 184, 0.25)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          titleFont: { size: 12, weight: '700' },
          bodyFont: { size: 12 },
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          callbacks: {
            title: (items) => {
              return items?.[0]?.label || '';
            },
            label: (item) => {
              const val = isHorizontal ? item.parsed?.x : item.parsed?.y;
              const formattedVal = Number(val).toLocaleString();
              return ` ${item.dataset.label || 'Count'}: ${formattedVal}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: isHorizontal ? 'rgba(148, 163, 184, 0.08)' : 'transparent',
            drawBorder: false
          },
          border: {
            color: 'rgba(148, 163, 184, 0.15)'
          },
          ticks: {
            color: '#94a3b8',
            font: { size: 10 },
            maxRotation: isHorizontal ? 0 : 35,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: isHorizontal ? 8 : 20
          }
        },
        y: {
          grid: {
            color: isHorizontal ? 'transparent' : 'rgba(148, 163, 184, 0.08)',
            drawBorder: false
          },
          border: {
            color: 'rgba(148, 163, 184, 0.15)'
          },
          ticks: {
            color: '#94a3b8',
            font: { size: 10.5, weight: isHorizontal ? '500' : '400' },
            autoSkip: !isHorizontal,
            callback: function (val) {
              if (isHorizontal) {
                const label = this.getLabelForValue(val);
                return label.length > 22 ? label.slice(0, 20) + '…' : label;
              }
              return Number(val).toLocaleString();
            }
          }
        }
      }
    };
  }, [orientation, isHorizontal, initialDatasets.length]);

  return (
    <div className={`catalog-chart-card ${chart.isFullWidth ? 'catalog-chart-card--full-width' : ''}`}>
      <div className="catalog-chart-card-header">
        <div className="catalog-chart-title-area">
          <div className="catalog-chart-title-row">
            <h4>{chart.title}</h4>
            <span className="catalog-chart-count-pill">{totalCategories} items</span>
          </div>
          {chart.description && <p>{chart.description}</p>}
        </div>

        <div className="catalog-chart-controls">
          {!isLine && totalCategories > 10 && (
            <div className="catalog-chart-pill-group">
              <button
                type="button"
                className={`catalog-pill-btn ${itemLimit === 10 ? 'active' : ''}`}
                onClick={() => setItemLimit(10)}
              >
                Top 10
              </button>
              {totalCategories > 25 && (
                <button
                  type="button"
                  className={`catalog-pill-btn ${itemLimit === 25 ? 'active' : ''}`}
                  onClick={() => setItemLimit(25)}
                >
                  Top 25
                </button>
              )}
              <button
                type="button"
                className={`catalog-pill-btn ${itemLimit === 'all' ? 'active' : ''}`}
                onClick={() => setItemLimit('all')}
              >
                All ({totalCategories})
              </button>
            </div>
          )}

          {!isLine && (
            <button
              type="button"
              className="catalog-pill-btn catalog-orient-btn"
              onClick={() => setOrientation((o) => (o === 'x' ? 'y' : 'x'))}
              title={`Switch to ${isHorizontal ? 'Vertical' : 'Horizontal'} layout`}
            >
              {isHorizontal ? '↕ Vertical' : '⇄ Horizontal'}
            </button>
          )}
        </div>
      </div>

      <div
        className="catalog-chart-scroll-box"
        style={{
          maxHeight: isHorizontal && displayedLabels.length > 10 ? '420px' : 'auto',
          overflowY: isHorizontal && displayedLabels.length > 10 ? 'auto' : 'visible'
        }}
      >
        <div style={{ height: `${canvasHeight}px`, position: 'relative', width: '100%' }}>
          {isLine ? (
            <Line data={finalData} options={chartOptions} />
          ) : (
            <Bar data={finalData} options={chartOptions} />
          )}
        </div>
      </div>
    </div>
  );
}

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

function ProfilingResultView({ resultData, onRunAnother, onBack, isHistorical = false }) {
  const profile = resultData?.assetProfile || (resultData?.summary ? resultData : null);

  return (
    <div className="catalog-result-container">
      {/* Unpopulated Asset Notice */}
      {resultData && resultData.isPopulated === false && (
        <div className="catalog-unpopulated-banner">
          <div className="catalog-unpopulated-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="catalog-unpopulated-content">
            <h3>No Data Loaded for This Asset</h3>
            <p>{resultData.message || 'The selected asset is not backed by loaded business rows in the database. Ingest data first to enable SQL profiling.'}</p>
          </div>
        </div>
      )}

      {/* Single Statistic Results Card (if specific statistic was run) */}
      {resultData && resultData.statistic && (
        <div className="catalog-results-card">
          <div className="catalog-card-header">
            <div>
              <h2>{isHistorical ? 'Historical Profiling Run' : 'Profiling Result'}</h2>
              <span className="catalog-metric-subtext">
                Target: <strong>{resultData.assetName}</strong>.<strong>{resultData.columnName}</strong> ({resultData.dataType})
              </span>
            </div>
            {onRunAnother && (
              <button
                type="button"
                className="catalog-btn-ghost"
                onClick={onRunAnother}
              >
                + Run Another Profiling
              </button>
            )}
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

      {/* SQL Analytical Insights & Visualizations Section */}
      {profile && profile.isPopulated !== false && (
        <div className="catalog-insights-section">
          <div className="catalog-card-header">
            <div>
              <h2>SQL-Based Automatic Insights & Profiling</h2>
              <span className="catalog-metric-subtext">
                Generated via deterministic SQL execution against physical table{' '}
                <code>{profile.physicalSchema || profile.physicalSchemaName}.{profile.physicalTable || profile.physicalTableName}</code>{' '}
                ({(profile.summary?.totalRows || resultData?.totalRows || profile.totalRows || 0).toLocaleString()} rows) in {profile.executionDurationMs || resultData?.executionDurationMs || 0} ms.
              </span>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="catalog-kpi-grid">
            <div className="catalog-kpi-card">
              <span className="catalog-kpi-label">Populated Rows</span>
              <strong className="catalog-kpi-val">{(profile.summary?.totalRows ?? resultData?.totalRows ?? profile.totalRows ?? 0).toLocaleString()}</strong>
              <span className="catalog-kpi-sub">Actual records in database</span>
            </div>
            <div className="catalog-kpi-card">
              <span className="catalog-kpi-label">Analyzed Columns</span>
              <strong className="catalog-kpi-val">{profile.summary?.totalColumns ?? profile.totalColumns ?? resultData?.totalColumns ?? 1}</strong>
              <span className="catalog-kpi-sub">
                {profile.summary?.numericColumnsCount || 0} numeric, {profile.summary?.textColumnsCount || 0} text, {profile.summary?.dateColumnsCount || 0} date
              </span>
            </div>
            <div className="catalog-kpi-card">
              <span className="catalog-kpi-label">Overall Completeness</span>
              <strong className="catalog-kpi-val">{profile.summary?.overallCompletenessPct ?? profile.tableQuality?.overallCompleteness ?? 100}%</strong>
              <span className="catalog-kpi-sub">
                {(profile.summary?.missingCells || 0).toLocaleString()} missing cells across table
              </span>
            </div>
            <div className="catalog-kpi-card">
              <span className="catalog-kpi-label">Analysis Speed</span>
              <strong className="catalog-kpi-val">{profile.executionDurationMs || resultData?.executionDurationMs || 0} ms</strong>
              <span className="catalog-kpi-sub">Bounded SQL aggregates</span>
            </div>
          </div>

          {/* Rule-Based Insights */}
          {profile.insights && profile.insights.length > 0 && (
            <div className="catalog-insights-block">
              <h3 className="catalog-block-title">Deterministic Analytical Insights</h3>
              <div className="catalog-insights-grid">
                {profile.insights.map((ins) => (
                  <div key={ins.id} className={`catalog-insight-item insight-${ins.type || 'info'}`}>
                    <div className="insight-badge-row">
                      <span className="insight-category-badge">{ins.category}</span>
                      <span className={`insight-type-badge type-${ins.type}`}>
                        {ins.type === 'positive' ? 'Healthy' : ins.type === 'warning' ? 'Notice' : 'Info'}
                      </span>
                    </div>
                    <h4 className="insight-title">{ins.title}</h4>
                    <p className="insight-description">{ins.description || ins.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Visualizations Grid */}
          {(() => {
            let displayCharts = profile.charts || [];
            if (resultData?.columnName) {
              const colNorm = resultData.columnName.toLowerCase();
              const matched = displayCharts.filter(
                (c) =>
                  c.id?.toLowerCase().includes(colNorm) ||
                  c.title?.toLowerCase().includes(colNorm)
              );
              if (matched.length > 0) {
                displayCharts = matched;
              }
            }

            if (!displayCharts.length) return null;

            return (
              <div className="catalog-charts-block">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 className="catalog-block-title" style={{ margin: 0 }}>
                    SQL-Generated Analytical Visualizations
                  </h3>
                  {resultData?.columnName && (
                    <span className="catalog-history-stat-badge" style={{ fontSize: '0.82rem', padding: '4px 10px', background: 'rgba(92, 124, 250, 0.15)', color: '#818cf8', border: '1px solid rgba(92, 124, 250, 0.3)' }}>
                      Target: {resultData.columnName} {resultData.statistic ? `• ${STATISTIC_LABELS[resultData.statistic] || resultData.statistic}` : ''}
                    </span>
                  )}
                </div>
                <div className="catalog-charts-grid">
                  {displayCharts.map((chart) => (
                    <CatalogChartCard key={chart.id} chart={chart} />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Detailed Column Profiles Breakdown */}
          {profile.columnProfiles && profile.columnProfiles.length > 0 && (
            <div className="catalog-columns-block">
              <h3 className="catalog-block-title">Verified Column Profiles</h3>
              <div className="catalog-history-table-container">
                <table className="catalog-history-table">
                  <thead>
                    <tr>
                      <th>Column Name</th>
                      <th>Data Type</th>
                      <th>Completeness</th>
                      <th>Nulls</th>
                      <th>Distinct Values</th>
                      <th>Statistical Highlights</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.columnProfiles.map((cp) => (
                      <tr key={cp.columnName}>
                        <td><strong>{cp.columnName}</strong></td>
                        <td>
                          <span className="catalog-history-stat-badge">
                            {(cp.dataType || '').toUpperCase()}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: '60px',
                              height: '6px',
                              background: 'rgba(255,255,255,0.1)',
                              borderRadius: '3px',
                              overflow: 'hidden'
                            }}>
                              <div style={{
                                width: `${cp.completenessPct}%`,
                                height: '100%',
                                background: cp.completenessPct === 100 ? '#10b981' : cp.completenessPct > 80 ? '#3b82f6' : '#f59e0b'
                              }} />
                            </div>
                            <span>{cp.completenessPct}%</span>
                          </div>
                        </td>
                        <td>{cp.nullCount}</td>
                        <td>{cp.distinctCount}</td>
                        <td style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                          {cp.numericStats ? (
                            <span>
                              Min: <strong>{cp.numericStats.min}</strong> | Max: <strong>{cp.numericStats.max}</strong> | Avg: <strong>{cp.numericStats.avg}</strong> | Med: <strong>{cp.numericStats.median}</strong>
                              {cp.numericStats.outlierCount > 0 && ` | Outliers: ${cp.numericStats.outlierCount}`}
                            </span>
                          ) : cp.categoryStats?.topValues?.length > 0 ? (
                            <span>
                              Top: {cp.categoryStats.topValues.slice(0, 3).map(v => `${v.value || '(blank)'} (${v.percentage}%)`).join(', ')}
                            </span>
                          ) : cp.dateStats?.minDate ? (
                            <span>
                              Span: {cp.dateStats.minDate} to {cp.dateStats.maxDate}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {isHistorical && onBack && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', flexWrap: 'wrap', gap: '12px' }}>
              <button type="button" className="catalog-back-btn" onClick={onBack}>
                ← Back to Profiling History
              </button>
              {onRunAnother && (
                <button type="button" className="catalog-history-view-btn" onClick={onRunAnother}>
                  <span>+ Run New Profiling</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export default function DataCatalogPage() {
  const { projectId, historyId: routeHistoryId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeHistoryId = routeHistoryId || searchParams.get('historyId');

  // Mode: 'empty' or 'builder'
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Data selections
  const [project, setProject] = useState(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || '');
  const [validationError, setValidationError] = useState('');
  
  const [assets, setAssets] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  
  const [columns, setColumns] = useState([]);
  const [selectedColumnId, setSelectedColumnId] = useState('');
  
  const [selectedStatistic, setSelectedStatistic] = useState('');

  // Loading & error states
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [runningQuery, setRunningQuery] = useState(false);
  const [error, setError] = useState('');
  const [readinessWarning, setReadinessWarning] = useState('');

  // Results & History
  const [resultData, setResultData] = useState(null);
  const [profilingHistory, setProfilingHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Dedicated history item inspection state
  const [historyResultData, setHistoryResultData] = useState(null);
  const [loadingHistoryItem, setLoadingHistoryItem] = useState(false);
  const [historyItemError, setHistoryItemError] = useState('');

  // Load specific historical profiling run when activeHistoryId is set
  useEffect(() => {
    if (!activeHistoryId || !projectId) {
      setHistoryResultData(null);
      setHistoryItemError('');
      return;
    }

    let isMounted = true;
    const fetchHistoryDetail = async () => {
      try {
        setLoadingHistoryItem(true);
        setHistoryItemError('');
        const res = await getProfilingHistoryItem(projectId, activeHistoryId);
        const item = res?.data || res;
        if (isMounted) {
          setHistoryResultData(item);
        }
      } catch (err) {
        if (isMounted) {
          setHistoryItemError(err?.message || 'Failed to load historical profiling result.');
        }
      } finally {
        if (isMounted) {
          setLoadingHistoryItem(false);
        }
      }
    };

    fetchHistoryDetail();
    return () => {
      isMounted = false;
    };
  }, [projectId, activeHistoryId]);

  const handleViewHistoryItem = (resultId) => {
    if (!resultId) return;
    setSearchParams({ historyId: resultId });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToHistory = () => {
    if (routeHistoryId) {
      navigate(`/projects/${projectId}/catalog`);
    } else {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('historyId');
      setSearchParams(nextParams);
    }
    setHistoryResultData(null);
    setHistoryItemError('');
  };

  // Sync selectedProjectId when route projectId changes
  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
    }
  }, [projectId]);

  // 1. Fetch active project details and catalog assets on mount or project switch
  const loadCatalogData = useCallback(async () => {
    if (!projectId) return;
    try {
      setInitialLoading(true);
      setLoadingProject(true);
      setLoadingAssets(true);
      setError('');
      setValidationError('');

      // Fetch active project and catalog assets in parallel
      const [projRes, assetsRes] = await Promise.allSettled([
        getProjectById(projectId),
        getCatalogAssets(projectId)
      ]);

      if (projRes.status === 'fulfilled') {
        const pData = projRes.value?.project || projRes.value?.data || projRes.value;
        setProject(pData);
      }

      let assetList = [];
      if (assetsRes.status === 'fulfilled') {
        const rawAssets = assetsRes.value?.data || assetsRes.value || [];
        const populatedList = (Array.isArray(rawAssets) ? rawAssets : []).filter((a) => a.is_populated);
        assetList = populatedList.length ? populatedList : (Array.isArray(rawAssets) ? rawAssets : []);
        setAssets(assetList);
      }

      setIsBuilderOpen(true);

      // Check if there was a saved selection for this project in session
      let saved = null;
      try {
        const raw = sessionStorage.getItem(`rapidinsight_catalog_${projectId}`);
        if (raw) saved = JSON.parse(raw);
      } catch {
        saved = null;
      }

      const targetAsset =
        saved?.assetId && assetList.find((a) => a.asset_id === saved.assetId)
          ? assetList.find((a) => a.asset_id === saved.assetId)
          : assetList.length === 1
          ? assetList[0]
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
    } catch (err) {
      setError(err?.message || 'Failed to fetch catalog assets.');
    } finally {
      setLoadingProject(false);
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
    if (!projectId) return;
    try {
      sessionStorage.setItem(
        `rapidinsight_catalog_${projectId}`,
        JSON.stringify({
          projectId,
          assetId: selectedAssetId,
          columnId: selectedColumnId,
          statistic: selectedStatistic,
          resultData
        })
      );
    } catch {
      // Ignore storage errors
    }
  }, [projectId, selectedAssetId, selectedColumnId, selectedStatistic, resultData]);

  // 2. Fetch columns when asset changes
  const handleAssetChange = async (e) => {
    const assetId = e.target.value;
    setSelectedAssetId(assetId);

    // Reset downstream
    setSelectedColumnId('');
    setColumns([]);
    setSelectedStatistic('');
    setResultData(null);
    setError('');
    setValidationError('');

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

  // 3. Handle column change
  const handleColumnChange = (e) => {
    const colId = e.target.value;
    setSelectedColumnId(colId);
    setSelectedStatistic('');
    setValidationError('');
    setResultData(null);
  };

  // 4. Compute available statistics based on column data type
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
      Boolean(projectId) &&
      Boolean(selectedAssetId) &&
      !runningQuery
    );
  }, [projectId, selectedAssetId, runningQuery]);

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

  // 5. Run profiling with mandatory statistics validation
  const handleRunProfile = async () => {
    if (!selectedAssetId) {
      setValidationError('Please select an asset / table first.');
      setError('Please select an asset / table first.');
      return;
    }
    if (!selectedColumnId) {
      setValidationError('Please select an asset column first.');
      setError('Please select an asset column first.');
      return;
    }
    if (!selectedStatistic) {
      setValidationError('You need to select a profiling statistic.');
      setError('You need to select a profiling statistic.');
      return;
    }

    try {
      setRunningQuery(true);
      setError('');
      setValidationError('');
      setResultData(null);

      const payload = {
        projectId,
        assetId: selectedAssetId,
        columnId: selectedColumnId,
        statistic: selectedStatistic
      };

      const res = await runProfileStat(payload);

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
    setValidationError('');
    setResultData(null);
    setError('');
  };

  const handleOpenBuilder = () => {
    setIsBuilderOpen(true);
    setValidationError('');
    setResultData(null);
    setError('');
  };

  const handleResetBuilder = () => {
    setSelectedProjectId(projectId || '');
    setSelectedAssetId('');
    setSelectedColumnId('');
    setColumns([]);
    setSelectedStatistic('');
    setReadinessWarning('');
    setResultData(null);
    setError('');
    setValidationError('');
    try {
      sessionStorage.removeItem(`rapidinsight_catalog_${projectId}`);
    } catch {
      // Ignore
    }
  };

  const handleRunAnother = () => {
    setSelectedColumnId('');
    setSelectedStatistic('');
    setValidationError('');
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
      {!activeHistoryId && !initialLoading && !isBuilderOpen && (
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
      {!activeHistoryId && !initialLoading && isBuilderOpen && (
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
            {/* 1. Active Project */}
            <div className="catalog-form-group">
              <label htmlFor="catalog-project-select" className="catalog-form-label">
                1. Project Source (Active Project)
              </label>
              <select
                id="catalog-project-select"
                className="catalog-select"
                value={selectedProjectId || projectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                disabled={loadingProject}
              >
                <option value={projectId}>
                  {loadingProject
                    ? 'Loading active project...'
                    : project?.name
                    ? `${project.name} (Active Project)`
                    : 'Active Project'}
                </option>
              </select>
            </div>

            {/* 2. Asset / Table */}
            {(selectedProjectId || projectId) && (
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
                    {loadingAssets
                      ? 'Loading assets...'
                      : assets.length === 0
                      ? '-- No assets found in active project --'
                      : '-- Select Asset --'}
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
                  className={`catalog-select ${validationError && !selectedStatistic ? 'catalog-select--invalid' : ''}`}
                  value={selectedStatistic}
                  onChange={(e) => {
                    setSelectedStatistic(e.target.value);
                    if (e.target.value) {
                      setValidationError('');
                      setError('');
                    }
                  }}
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

          {/* Empty Assets Notice */}
          {assets.length === 0 && !loadingAssets && !loadingProject && (
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

          {/* Action Row — shown after Asset is selected */}
          {selectedAssetId && (
            <div className="catalog-action-row">
              {validationError && (
                <div className="catalog-validation-msg" role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{validationError}</span>
                </div>
              )}
              <button
                type="button"
                className="catalog-btn-primary"
                disabled={runningQuery}
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

      {/* Dedicated Historical Profiling Result View ("The New Page") */}
      {activeHistoryId && (
        <div className="catalog-history-detail-view">
          <div className="catalog-historical-header-card">
            <div className="catalog-historical-nav-row">
              <button
                type="button"
                className="catalog-back-btn"
                onClick={handleBackToHistory}
              >
                ← Back to Profiling History
              </button>
              <div className="catalog-historical-badge-group">
                <span className="catalog-historical-run-badge">
                  ⏱ Historical Run {historyResultData?.createdAt ? `• ${formatDateTime(historyResultData.createdAt)}` : ''}
                </span>
                {historyResultData?.assetName && (
                  <span className="catalog-history-stat-badge">
                    Asset: <strong>{historyResultData.assetName}</strong>
                  </span>
                )}
                {historyResultData?.columnName && (
                  <span className="catalog-history-stat-badge">
                    Column: <code>{historyResultData.columnName}</code>
                  </span>
                )}
                {historyResultData?.statistic && (
                  <span className="catalog-history-stat-badge">
                    Statistic: <strong>{STATISTIC_LABELS[historyResultData.statistic] || historyResultData.statistic}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>

          {loadingHistoryItem ? (
            <div className="catalog-history-loading">
              <div className="catalog-spinner" aria-hidden="true" />
              <span>Loading historical profiling report & analytical visualizations...</span>
            </div>
          ) : historyItemError ? (
            <div className="catalog-error-banner" style={{ margin: '2rem 0' }}>
              <p>{historyItemError}</p>
              <button type="button" className="catalog-back-btn" onClick={handleBackToHistory} style={{ marginTop: '1rem' }}>
                ← Return to Profiling History
              </button>
            </div>
          ) : historyResultData ? (
            <ProfilingResultView
              resultData={historyResultData}
              onRunAnother={() => {
                handleBackToHistory();
                handleOpenBuilder();
              }}
              isHistorical={true}
              onBack={handleBackToHistory}
            />
          ) : null}
        </div>
      )}

      {/* Live Result View (when not inspecting historical record) */}
      {!activeHistoryId && resultData && (
        <ProfilingResultView
          resultData={resultData}
          onRunAnother={handleRunAnother}
          isHistorical={false}
        />
      )}

      {/* Profiling History Table (shown when not viewing historical record) */}
      {!activeHistoryId && !initialLoading && (
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
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {profilingHistory.map((item) => (
                    <tr
                      key={item.result_id}
                      className="catalog-history-row-clickable"
                      onClick={() => handleViewHistoryItem(item.result_id)}
                      title="Click to view full SQL insights, visualizations, and column profiles"
                    >
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
                      <td>
                        <button
                          type="button"
                          className="catalog-history-view-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewHistoryItem(item.result_id);
                          }}
                          title="View insights, visualizations, and verified column profiles"
                        >
                          <span>View Result</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                          </svg>
                        </button>
                      </td>
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

