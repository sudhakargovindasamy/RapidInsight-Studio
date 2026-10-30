import { useEffect, useState } from 'react';
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
    percent: 40
  },
  validating_blueprint: {
    label: 'Validating tables, relationships and analytics',
    percent: 52
  },
  creating_tables: {
    label: 'Creating physical PostgreSQL tables',
    percent: 66
  },
  generating_data: {
    label: 'Generating relational Faker data',
    percent: 78
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

  // Smooth visual progress that starts at left and slightly increases from left to right while loading
  const [currentProgress, setCurrentProgress] = useState(0);

  useEffect(() => {
    if (isDone) {
      setCurrentProgress(100);
      return;
    }

    if (isFailed) {
      return;
    }

    if (!isRunning) {
      setCurrentProgress(0);
      return;
    }

    // While running, start from at least 10% and smoothly, slightly increase from left to right
    setCurrentProgress((prev) => Math.max(prev, details.percent, 10));

    const interval = setInterval(() => {
      setCurrentProgress((prev) => {
        if (prev < 35) return prev + 2.5;
        if (prev < 65) return prev + 1.8;
        if (prev < 88) return prev + 0.8;
        if (prev < 95) return prev + 0.3;
        return prev;
      });
    }, 350);

    return () => clearInterval(interval);
  }, [isRunning, isDone, isFailed, details.percent]);

  const displayPercent = isDone
    ? 100
    : isFailed
      ? 100
      : isRunning
        ? Math.round(currentProgress)
        : details.percent;

  const barWidth = isDone
    ? 100
    : isFailed
      ? 100
      : isRunning
        ? Math.min(Math.round(currentProgress), 95)
        : details.percent;

  return (
    <section className={`generate-status-card generate-status-card--${cardState}`}>
      <div className="generate-status-header">
        <div>
          <span className="generate-status-kicker">Generate Report</span>
          <h3>{details.label}</h3>
        </div>
        <strong>{displayPercent}%</strong>
      </div>

      <div
        className={`generate-progress-track ${isRunning ? 'generate-progress-track--running' : ''}`}
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={displayPercent}
      >
        <span
          className="generate-progress-fill"
          style={{ width: `${barWidth}%` }}
        />
        {isRunning && <span className="generate-progress-runner" />}
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
