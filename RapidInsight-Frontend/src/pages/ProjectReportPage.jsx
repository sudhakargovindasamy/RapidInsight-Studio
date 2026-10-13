import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getProjectById, getProjectDashboard } from '../api/projectApi.js';
import MySchemasPanel from '../components/MySchemasPanel.jsx';
import ReportChart from '../components/reports/ReportChart.jsx';
import ReportKpiCard from '../components/reports/ReportKpiCard.jsx';
import ReportStatePanel from '../components/reports/ReportStatePanel.jsx';
import './ProjectReportPage.css';

function extractDashboard(response) {
  return (
    response?.dashboard ||
    response?.data?.dashboard ||
    response?.data ||
    response ||
    null
  );
}

function extractProject(response) {
  return response?.project || response?.data?.project || response?.data || response || null;
}

function formatGeneratedAt(value) {
  if (!value) return 'Not generated yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not generated yet';

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export default function ProjectReportPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadReport = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError('');

      const [projectResponse, dashboardResponse] = await Promise.all([
        getProjectById(projectId),
        getProjectDashboard(projectId)
      ]);

      setProject(extractProject(projectResponse));
      setDashboard(extractDashboard(dashboardResponse));
    } catch (requestError) {
      setError(requestError.message || 'Failed to load the generated report.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) loadReport();
  }, [projectId, loadReport]);

  const config = dashboard?.config || {};
  const reportData = dashboard?.report_data || {};
  const status = String(dashboard?.report_status || 'pending').toLowerCase();
  const kpis = Array.isArray(reportData.kpis) ? reportData.kpis : [];
  const charts = Array.isArray(reportData.charts) ? reportData.charts : [];
  const insights = Array.isArray(reportData.insights)
    ? reportData.insights
    : Array.isArray(config.insights)
      ? config.insights
      : [];

  const reportIsEmpty = status === 'ready' && !kpis.length && !charts.length;

  const title = config.title || `${project?.name || 'Project'} Report`;
  const subtitle = config.subtitle || 'Generated analytics from your project data.';

  const metadata = useMemo(() => ([
    { label: 'Project', value: project?.name || projectId },
    { label: 'Status', value: status },
    { label: 'KPIs', value: kpis.length },
    { label: 'Charts', value: charts.length },
    { label: 'Last generated', value: formatGeneratedAt(dashboard?.generated_at || reportData.generated_at) }
  ]), [project?.name, projectId, status, kpis.length, charts.length, dashboard?.generated_at, reportData.generated_at]);

  if (loading) {
    return (
      <div className="project-report-page">
        <div className="project-report-loading" role="status">
          <span className="project-report-loading__spinner" />
          <p>Loading generated report…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="project-report-page">
      <section className="project-report-hero">
        <div className="project-report-hero__copy">
          <span className="project-report-eyebrow">Generated Report</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>

          <div className="project-report-hero__actions">
            <button
              type="button"
              className="primary-btn"
              onClick={() => loadReport({ quiet: true })}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh Report'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => navigate(`/projects/${projectId}/playground`)}
            >
              Open Schema Playground
            </button>
          </div>
        </div>

        <dl className="project-report-meta">
          {metadata.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd className={item.label === 'Status' ? `status-${status}` : ''}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Uploaded Schemas, Target KPIs, and Table Generation section */}
      <section className="project-report-schemas-section pws-page">
        <MySchemasPanel
          projectId={projectId}
          onTablesGenerated={() => loadReport({ quiet: true })}
          onViewReport={() => loadReport({ quiet: true })}
        />
      </section>

      {error ? (
        <section className="project-report-error" role="alert">
          <strong>Unable to load report</strong>
          <p>{error}</p>
          <button type="button" className="secondary-btn" onClick={() => loadReport()}>
            Try Again
          </button>
        </section>
      ) : null}

      {!error && status !== 'ready' ? (
        <ReportStatePanel
          status={status}
          errorMessage={dashboard?.error_message}
          onRefresh={() => loadReport({ quiet: true })}
          onOpenPlayground={() => navigate(`/projects/${projectId}/playground`)}
        />
      ) : null}

      {!error && reportIsEmpty ? (
        <ReportStatePanel
          status="empty"
          errorMessage={dashboard?.error_message}
          onRefresh={() => loadReport({ quiet: true })}
          onOpenPlayground={() => navigate(`/projects/${projectId}/playground`)}
        />
      ) : null}

      {!error && status === 'ready' && !reportIsEmpty ? (
        <>
          {kpis.length ? (
            <section className="project-report-section" aria-labelledby="report-kpis-title">
              <header className="project-report-section__heading">
                <div>
                  <span>At a glance</span>
                  <h2 id="report-kpis-title">Key performance indicators</h2>
                </div>
              </header>

              <div
                className="project-report-kpi-grid"
                style={{
                  '--report-kpi-columns': Math.min(
                    Number(config?.layout?.kpi_columns) || (kpis.length > 0 ? kpis.length : 4),
                    4
                  )
                }}
              >
                {kpis.map((item, index) => (
                  <ReportKpiCard key={item.id || `${item.title}-${index}`} item={item} index={index} />
                ))}
              </div>
            </section>
          ) : null}

          {charts.length ? (
            <section className="project-report-section" aria-labelledby="report-charts-title">
              <header className="project-report-section__heading">
                <div>
                  <span>Visual analysis</span>
                  <h2 id="report-charts-title">Report charts</h2>
                </div>
              </header>

              <div
                className="project-report-chart-grid"
                style={{
                  '--report-chart-columns': Math.min(
                    Number(config?.layout?.chart_columns) || (charts.length === 1 ? 1 : 2),
                    2
                  )
                }}
              >
                {charts.map((item, index) => (
                  <ReportChart key={item.id || `${item.title}-${index}`} item={item} />
                ))}
              </div>
            </section>
          ) : null}

          {insights.length ? (
            <section className="project-report-section" aria-labelledby="report-insights-title">
              <header className="project-report-section__heading">
                <div>
                  <span>What to explore</span>
                  <h2 id="report-insights-title">Suggested insights</h2>
                </div>
              </header>

              <div className="project-report-insight-grid">
                {insights.map((item, index) => (
                  <article className="project-report-insight" key={item.id || `${item.title}-${index}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
