import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import OverviewInfoButton from '../components/OverviewInfoButton.jsx';
import { getProjectById } from '../api/projectApi.js';
import './ProjectWorkspacePage.css';

const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
  archived: 'Archived',
};

function StatusBadge({ status = 'active' }) {
  return (
    <span className={`pws-status-badge pws-status-badge--${status}`}>
      ● {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatCreatedAt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function ProjectDetails({ project }) {
  const organisation =
    project?.organisation?.name ||
    project?.organisation_name ||
    '—';

  return (
    <section className="workspace-panel pws-project-details">
      <div className="panel-header">
        <h2 className="panel-title">Project details</h2>
      </div>

      <div className="pws-detail-list">
        <div className="detail-row">
          <span className="detail-label">Name</span>
          <span className="detail-value">{project?.name || '—'}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Organisation</span>
          <span className="detail-value">{organisation}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Description</span>
          <span className="detail-value">
            {project?.description || 'No description provided.'}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Created</span>
          <span className="detail-value">
            {formatCreatedAt(project?.created_at)}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Project ID</span>
          <span className="detail-value pws-project-id">
            {project?.id || '—'}
          </span>
        </div>
      </div>
    </section>
  );
}

export default function ProjectWorkspacePage() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadProject() {
      try {
        setLoading(true);
        setError('');
        const response = await getProjectById(projectId);
        setProject(response.project || response.data || response);
      } catch (err) {
        setError(err.message || 'Failed to load project.');
      } finally {
        setLoading(false);
      }
    }

    if (projectId) loadProject();
  }, [projectId]);

  if (loading) {
    return (
      <div className="schema-container">
        <div className="empty-state">Loading project…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="schema-container">
        <div className="error-box">{error}</div>
      </div>
    );
  }

  const organisation = project?.organisation?.name || 'Your Organisation';

  return (
    <div className="schema-container pws-page">
      <section className="hero-card pws-hero">
        <span className="hero-kicker">
          Project Workspace · {organisation}
        </span>
        <h1>{project?.name || 'Untitled Project'}</h1>
        <p>
          Project details and information overview.
        </p>
        <StatusBadge status={project?.status || 'active'} />
      </section>

      <header className="pws-section-heading">
        <div>
          <h2>Overview &amp; Schema</h2>
          <p>
            Review project information and details.
          </p>
        </div>
        <OverviewInfoButton />
      </header>

      <div className="pws-overview-single-panel">
        <ProjectDetails project={project} />
      </div>
    </div>
  );
}
