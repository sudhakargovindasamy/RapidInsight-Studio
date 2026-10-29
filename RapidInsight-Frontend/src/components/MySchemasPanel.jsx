import { useProjectRefresh } from '../context/ProjectRefreshContext.jsx';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  getSchemasByProject,
  getProjectSeedStatus,
  retrySeedRows,
  deleteSchema
} from '../api/schemaApi.js';

import {
  generateProjectTables,
  retryProjectDataInsert,
  getProjectDataModel
} from '../api/tableApi.js';

import SchemaCard from './SchemaCard.jsx';
import GenerateTablesStatusCard from './schema/GenerateTablesStatusCard.jsx';
import DeleteSchemaModal from './schema/DeleteSchemaModal.jsx';
import '../pages/ProjectWorkspacePage.css';

const STEP_SEQUENCE = [
  'inferring_relationships',
  'relationships_done',
  // Custom-metric runs go through planning; automatic runs go through
  // blueprint_generation instead. Both appear here because the sequence is
  // only used to order progress, and only one path reports at a time.
  'planning_kpis',
  'building_dashboard',
  'blueprint_generation',
  'validating_blueprint',
  'creating_tables',
  'generating_data',
  'inserting_data',
  'done'
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFailureType(errorMessage = '') {
  const value = String(errorMessage).toLowerCase();

  if (
    value.includes('insert') ||
    value.includes('foreign key') ||
    value.includes('parent values') ||
    value.includes('datagen') ||
    value.includes('data generation')
  ) {
    return 'data_insert';
  }

  return 'restart';
}

function MySchemasPanel({
  projectId,
  refreshKey,
  compact = false,
  onTablesGenerated,
  onViewReport
}) {
  const { notifyProjectChanged } = useProjectRefresh(projectId);
  const navigate = useNavigate();

  const [schemas, setSchemas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generationStatus, setGenerationStatus] = useState({
    state: 'idle',
    step: 'idle',
    error: ''
  });

  const [customKpis, setCustomKpis] = useState([]);
  const [customKpiInput, setCustomKpiInput] = useState('');

  const handleAddKpi = () => {
    const trimmed = customKpiInput.trim();
    if (!trimmed) return;
    if (customKpis.includes(trimmed)) {
      setCustomKpiInput('');
      return;
    }
    setCustomKpis((prev) => [...prev, trimmed]);
    setCustomKpiInput('');
  };

  const handleRemoveKpi = (indexToRemove) => {
    setCustomKpis((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  /*
   * Seed readiness for the whole project.
   *
   * Seed rows are generated in the background after upload and SDV needs them
   * before it can train, so a schema existing is not the same as a schema being
   * usable. Starts as null - unknown - so the button stays disabled until the
   * first response rather than flickering enabled for one render.
   */
  const [seedStatus, setSeedStatus] = useState(null);

  // Bumped to force the seed-status poller to restart immediately, rather than
  // waiting out the current interval, after an action that changes the answer.
  const [seedPollKey, setSeedPollKey] = useState(0);
  const [retryingSeeds, setRetryingSeeds] = useState(false);

  const [schemaToDelete, setSchemaToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);


  async function fetchSchemas() {
    try {
      setLoading(true);
      setError('');

      const data = await getSchemasByProject(projectId);
      const list = data.schemas || data.data || data || [];

      setSchemas(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || 'Failed to load schemas.');
    } finally {
      setLoading(false);
    }
  }

  async function loadDataModelStatus() {
    if (!projectId) return;

    try {
      const response = await getProjectDataModel(projectId);
      const model = response?.data || null;

      if (!model) return;

      if (Array.isArray(model.custom_kpis) && model.custom_kpis.length > 0) {
        setCustomKpis((prev) => (prev.length === 0 ? model.custom_kpis : prev));
      }

      if (model.status === 'failed') {
        setGenerationStatus({
          state: 'failed',
          step: 'failed',
          error: model.error_message || 'Generate Tables failed.',
          failureType: getFailureType(model.error_message)
        });
        return;
      }

      if (model.status === 'data_inserted') {
        setGenerationStatus({
          state: 'done',
          step: 'done',
          error: ''
        });
      }
    } catch {
      // no saved model yet
    }
  }

  useEffect(() => {
    if (projectId) {
      fetchSchemas();
      loadDataModelStatus();
    }
  }, [projectId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Poll seed readiness while any schema is still generating.
   *
   * Generation is a background job with no push channel, so the only way the UI
   * learns it finished is to ask. The interval clears itself once nothing is
   * pending, so a settled project costs one request rather than one every three
   * seconds forever.
   */
  useEffect(() => {
    if (!projectId) return undefined;

    let cancelled = false;
    let timerId = null;

    async function pollSeedStatus() {
      try {
        const response = await getProjectSeedStatus(projectId);
        const data = response?.data || null;

        if (cancelled || !data) return;

        setSeedStatus(data);

        // Only a pending schema can still change on its own. Failed schemas need
        // a retry or a delete, both of which re-run this effect.
        if (data.pending > 0) {
          timerId = setTimeout(pollSeedStatus, 3000);
        }
      } catch {
        // Treat an unreachable status endpoint as unknown rather than blocking
        // the project forever; the next refresh retries.
        if (!cancelled) setSeedStatus(null);
      }
    }

    pollSeedStatus();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [projectId, refreshKey, schemas.length, seedPollKey]);

  /*
   * Re-run seed generation for every schema that failed.
   *
   * Retries are awaited by the server, so this can take a while for a slow
   * table. They run one after another rather than in parallel: the whole reason
   * a retry is needed is often a rate limit, and firing them together would
   * recreate it.
   */
  async function handleRetrySeeds() {
    const failedSchemas = (seedStatus?.schemas || []).filter(
      (schema) => schema.seed_status === 'failed'
    );

    if (!failedSchemas.length) return;

    setRetryingSeeds(true);
    setError('');

    const failures = [];

    for (const schema of failedSchemas) {
      try {
        await retrySeedRows(schema.id);
      } catch (err) {
        failures.push(
          `${schema.display_name || schema.original_file_name || 'schema'}: ${err.message}`
        );
      }
    }

    if (failures.length) {
      setError(`Retry failed for ${failures.join('; ')}`);
    }

    setRetryingSeeds(false);
    setSeedPollKey((key) => key + 1);
  }

  const filteredSchemas = schemas;

  async function animateProgressUntilDone(requestPromise) {
    setGenerationStatus({
      state: 'running',
      step: STEP_SEQUENCE[0],
      error: ''
    });

    let finished = false;
    let failedError = null;

    const progressPromise = (async () => {
      for (const step of STEP_SEQUENCE.slice(1, -1)) {
        if (finished || failedError) return;

        await wait(650);

        if (finished || failedError) return;

        setGenerationStatus({
          state: 'running',
          step,
          error: ''
        });
      }
    })();

    try {
      const result = await requestPromise;
      finished = true;
      await progressPromise;

      const reportWarning = result?.dashboardError || result?.data?.dashboardError || null;

      setGenerationStatus({
        state: 'done',
        step: reportWarning ? 'report_failed' : 'done',
        error: reportWarning,
        failureType: reportWarning ? 'report' : null
      });

      await fetchSchemas();

      return result;
    } catch (err) {
      failedError = err;

      setGenerationStatus({
        state: 'failed',
        step: 'failed',
        error: err.message || 'Generate Tables failed.',
        failureType: getFailureType(err.message)
      });

      throw err;
    }
  }

  /*
   * Why Generate Tables cannot run yet, or null when it can.
   *
   * A single source of truth for the disabled state and its explanation - an
   * unexplained greyed-out button reads as a broken app, especially here where
   * the blocking work is invisible and takes minutes.
   */
  const generateBlockedReason = useMemo(() => {
    if (loading) return 'Loading schemas…';
    if (generationStatus.state === 'running') return null;
    if (!schemas.length) return 'Upload at least one schema to continue.';
    if (retryingSeeds) return 'Retrying example rows…';

    if (!seedStatus) return 'Checking example-row status…';

    if (seedStatus.pending > 0) {
      const names = (seedStatus.schemas || [])
        .filter((schema) => ['pending', 'generating'].includes(schema.seed_status))
        .map((schema) => schema.display_name || schema.original_file_name)
        .filter(Boolean);

      const subject = names.length
        ? names.join(', ')
        : `${seedStatus.pending} schema${seedStatus.pending !== 1 ? 's' : ''}`;

      return `Preparing example rows for ${subject}. This runs once per upload and can take a minute per table.`;
    }

    if (seedStatus.failed > 0) {
      const names = (seedStatus.schemas || [])
        .filter((schema) => schema.seed_status === 'failed')
        .map((schema) => schema.display_name || schema.original_file_name)
        .filter(Boolean);

      const subject = names.length
        ? names.join(', ')
        : `${seedStatus.failed} schema${seedStatus.failed !== 1 ? 's' : ''}`;

      return `Example rows failed for ${subject}. Retry or remove them before generating tables.`;
    }

    return null;
  }, [loading, schemas.length, seedStatus, generationStatus.state, retryingSeeds]);

  const isGenerating = generationStatus.state === 'running';
  const canGenerateTables = !generateBlockedReason && !isGenerating;

  async function handleGenerateTables() {
    if (!schemas.length) {
      setError('Upload at least one schema before generating tables.');
      return;
    }

    setError('');

    try {
      const result = await animateProgressUntilDone(
        generateProjectTables(projectId, 100, customKpis)
      );

      if (onTablesGenerated) {
        onTablesGenerated(result);
      }
    } catch {
      // status card shows error
    }
  }

  async function handleRetryDataInsert() {
    setError('');

    try {
      await animateProgressUntilDone(retryProjectDataInsert(projectId, 100));
    } catch {
      // status card shows error
    }
  }

  function handleOpenPlayground() {
    navigate(`/projects/${projectId}/playground`);
  }

  function handleViewReport() {
    if (onViewReport) {
      onViewReport();
    } else {
      navigate(`/projects/${projectId}/reports`);
    }
  }

  async function handleConfirmDeleteSchema() {
    if (!schemaToDelete) return;

    const deletedSchemaId = schemaToDelete.id || schemaToDelete.schema_id;

    try {
      setDeleting(true);
      setError('');

      await deleteSchema(deletedSchemaId);

      setSchemas((prevSchemas) =>
        prevSchemas.filter((schema) => {
          const currentSchemaId = schema.id || schema.schema_id;
          return currentSchemaId !== deletedSchemaId;
        })
      );

      setSchemaToDelete(null);

      notifyProjectChanged(projectId);

      await fetchSchemas();

      setGenerationStatus({
        state: 'idle',
        step: 'idle',
        error: ''
      });
    } catch (err) {
      setError(err.message || 'Failed to delete schema.');
    } finally {
      setDeleting(false);
    }
  }
  return (
    <section className={`workspace-panel pws-schemas-panel${compact ? ' pws-schemas-panel--compact' : ''}`}>
      <div className="panel-header pws-schemas-panel-header">
        <div>
          <h2 className="panel-title">Uploaded schemas</h2>
          <p className="panel-description">
            {schemas.length} schema{schemas.length !== 1 ? 's' : ''} in this project.
          </p>
        </div>

        <div className="pws-schema-header-actions">
          <button
            type="button"
            onClick={fetchSchemas}
            className="refresh-btn"
            disabled={loading}
          >
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {generateBlockedReason && !isGenerating && (
        <div className="pws-seed-status-note" role="status">
          {(seedStatus?.pending > 0 || retryingSeeds) && (
            <span className="pws-seed-spinner" aria-hidden="true" />
          )}
          <span>
            {retryingSeeds
              ? 'Retrying example rows. This can take a minute per table…'
              : generateBlockedReason}
          </span>

          {seedStatus?.total > 0 && (
            <span className="pws-seed-count">
              {seedStatus.ready}/{seedStatus.total} ready
            </span>
          )}

          {seedStatus?.failed > 0 && !retryingSeeds && (
            <button
              type="button"
              className="pws-seed-retry-btn"
              onClick={handleRetrySeeds}
            >
              Retry {seedStatus.failed > 1 ? `${seedStatus.failed} schemas` : 'schema'}
            </button>
          )}
        </div>
      )}

      <div className="schema-card pws-kpi-card">
        <div className="schema-card-header">
          <div>
            <h3 className="schema-card-title">Target KPIs &amp; Metrics</h3>
            <span className="schema-badge">Custom Metrics</span>
          </div>
        </div>
        <p className="schema-card-desc">
          Define specific KPIs, conversion targets, or business metrics you want calculated from your schemas.
        </p>

        <div className="custom-kpi-input-row">
          <input
            type="text"
            className="schema-input custom-kpi-input"
            placeholder="e.g. Monthly Active Users, MRR Churn Rate, Average Deal Size..."
            value={customKpiInput}
            onChange={(e) => setCustomKpiInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddKpi();
              }
            }}
          />
          <button
            type="button"
            className="schema-btn schema-btn-ghost custom-kpi-add-btn"
            onClick={handleAddKpi}
            disabled={!customKpiInput.trim()}
          >
            + Add KPI
          </button>
        </div>

        {customKpis.length > 0 && (
          <div className="custom-kpi-tags">
            {customKpis.map((kpi, index) => (
              <span key={`${kpi}-${index}`} className="custom-kpi-tag">
                <span>{kpi}</span>
                <button
                  type="button"
                  className="custom-kpi-tag-remove"
                  onClick={() => handleRemoveKpi(index)}
                  aria-label={`Remove ${kpi}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="custom-kpi-generate-row" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="primary-btn"
            onClick={handleGenerateTables}
            disabled={!canGenerateTables}
            title={generateBlockedReason || undefined}
            style={{ padding: '10px 24px', fontSize: '14px', fontWeight: '600' }}
          >
            {isGenerating
              ? 'Generating Report…'
              : seedStatus?.pending > 0
                ? 'Preparing schemas…'
                : 'Generate Report'}
          </button>
        </div>
      </div>

      <GenerateTablesStatusCard
        status={generationStatus}
        onRetryDataInsert={handleRetryDataInsert}
        onRestartGenerateTables={handleGenerateTables}
        onOpenPlayground={handleOpenPlayground}
        onViewReport={handleViewReport}
      />

      {error && <div className="error-box">{error}</div>}

      {!loading && !error && schemas.length === 0 && (
        <div className="empty-state">
          No schemas uploaded yet. Use the upload panel above to add the first schema.
        </div>
      )}

      {!loading && !error && filteredSchemas.length > 0 && (
        <div className="schema-grid pws-compact-schema-grid">
          {filteredSchemas.map((schema) => (
            <SchemaCard
              key={schema.id}
              schema={schema}
              compact={compact}
              onRequestDelete={setSchemaToDelete}
            />
          ))}
        </div>
      )}

      <DeleteSchemaModal
        schema={schemaToDelete}
        isDeleting={deleting}
        onCancel={() => setSchemaToDelete(null)}
        onConfirm={handleConfirmDeleteSchema}
      />
    </section>
  );
}

export default MySchemasPanel;
