import './GenerateTablesStatusCard.css';

const STEP_DETAILS = {
  idle: {
    label: 'Ready to generate',
    percent: 0
  },
  inferring_relationships: {
    label: 'Finding keys and relationships between your tables',
    percent: 12
  },
  relationships_done: {
    label: 'Relationships ready, you can open the Schema Playground',
    percent: 20
  },
  planning_kpis: {
    label: 'Working out how to answer your metrics',
    percent: 28
  },
  building_dashboard: {
    label: 'Building the dashboard plan',
    percent: 36
  },
  blueprint_generation: {
    label: 'Designing the data model and report plan',
    percent: 30
  },
  validating_blueprint: {
    label: 'Validating tables, relationships and analytics',
    percent: 45
  },
  creating_tables: {
    label: 'Creating physical PostgreSQL tables',
    percent: 60
  },
  generating_data: {
    label: 'Generating relational Faker data',
    percent: 76
  },
  inserting_data: {
    label: 'Inserting generated rows',
    percent: 90
  },
  report_failed: {
    label: 'Tables are ready, but report generation failed',
    percent: 100
  },
  done: {
    label: 'Tables, data and report are ready',
    percent: 100
  },
  failed: {
    label: 'Generation failed',
    percent: 100
  }
};

export default function GenerateTablesStatusCard({
  status,
  onRetryDataInsert,
  onRestartGenerateTables,
  onOpenPlayground,
  onViewReport
}) {
  const state = status?.state || 'idle';
  const step = status?.step || state;
  const details = STEP_DETAILS[step] || STEP_DETAILS[state] || STEP_DETAILS.idle;
  const isRunning = state === 'running';
  const isDone = state === 'done' || step === 'done' || step === 'report_failed';
  const isFailed = state === 'failed';
  const cardState = isFailed ? 'failed' : isDone ? 'done' : isRunning ? 'running' : 'idle';

  return (
    <section className={`generate-status-card generate-status-card--${cardState}`}>
      <div className="generate-status-header">
        <div>
          <span className="generate-status-kicker">Generate Report</span>
          <h3>{details.label}</h3>
        </div>
        <strong>{details.percent}%</strong>
      </div>

      <div
        className="generate-progress-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={details.percent}
      >
        <span
          className="generate-progress-fill"
          style={{ width: `${details.percent}%` }}
        />
      </div>

      {status?.error ? (
        <div className="generate-status-error" role="alert">
          {status.error}
        </div>
      ) : null}

      {isFailed ? (
        <div className="generate-status-actions">
          {status?.failureType === 'data_insert' ? (
            <button type="button" className="primary-btn" onClick={onRetryDataInsert}>
              Retry Data Insert
            </button>
          ) : null}

          <button
            type="button"
            className="secondary-btn"
            onClick={onRestartGenerateTables}
          >
            Restart Generate Report
          </button>
        </div>
      ) : null}

      {isDone ? (
        <div className="generate-status-actions">
          <button type="button" className="secondary-btn" onClick={onOpenPlayground}>
            Open Schema Playground
          </button>
          <button type="button" className="primary-btn" onClick={onViewReport}>
            View Report
          </button>
        </div>
      ) : null}
    </section>
  );
}
