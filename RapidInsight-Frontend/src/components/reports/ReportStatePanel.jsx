import './ReportStatePanel.css';

export default function ReportStatePanel({
  status,
  errorMessage,
  onRefresh,
  onOpenPlayground
}) {
  const normalizedStatus = String(status || 'pending').toLowerCase();

  const content = {
    pending: {
      icon: '◇',
      title: 'Report is not generated yet',
      message: 'Generate the project tables and data first. The report will then be calculated safely.'
    },
    generating: {
      icon: '◌',
      title: 'Generating your report',
      message: 'The backend is calculating KPI and chart values from the generated tables.'
    },
    failed: {
      icon: '!',
      title: 'Report generation failed',
      message: errorMessage || 'The tables and generated data are safe. Refresh after retrying report generation.'
    },
    empty: {
      icon: '!',
      title: 'No report metrics available',
      message: errorMessage || 'No KPI or chart values could be calculated for this report. Please regenerate tables and KPIs from the Schema Playground.'
    }
  }[normalizedStatus] || {
    icon: '◇',
    title: 'Report is not available',
    message: 'Refresh the report or return to the Schema Playground.'
  };

  return (
    <section className={`report-state-panel report-state-panel--${normalizedStatus}`}>
      <span className="report-state-panel__icon" aria-hidden="true">
        {content.icon}
      </span>
      <h2>{content.title}</h2>
      <p>{content.message}</p>

      <div className="report-state-panel__actions">
        <button type="button" className="primary-btn" onClick={onRefresh}>
          Refresh Report
        </button>
        <button type="button" className="secondary-btn" onClick={onOpenPlayground}>
          Open Schema Playground
        </button>
      </div>
    </section>
  );
}
