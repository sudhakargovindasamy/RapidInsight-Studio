import { useNavigate } from 'react-router-dom';
import './ProjectCard.css';

function ProjectCard({ project, orgName }) {
  const navigate = useNavigate();

  const status = project.status || 'active';
  const statusClass = status === 'active' ? 'pc-badge--active' : 'pc-badge--muted';

  const createdDate = project.created_at
    ? new Date(project.created_at).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      })
    : null;

  return (
    <article className="project-card pc-card">
      {/* Top row */}
      <div className="pc-top">
        <div className="pc-top-left">
          <div className="pc-icon">
            {project.name?.charAt(0)?.toUpperCase() || 'P'}
          </div>
          <span className="pc-org-name">{project.organisation?.name || orgName}</span>
        </div>
        <div className="pc-top-right">
          <span className={`pc-badge ${statusClass}`}>
            ● {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>
      </div>

      {/* Name + description */}
      <div className="pc-body">
        <h3 className="pc-name">{project.name}</h3>
        <p className="pc-desc">
          {project.description || 'No description provided for this project.'}
        </p>
      </div>

      {/* Meta */}
      {createdDate && (
        <div className="pc-meta">
          <span>Created {createdDate}</span>
        </div>
      )}

      {/* Action */}
      <button
        type="button"
        className="pc-open-btn"
        onClick={() => navigate(`/projects/${project.id}`)}
      >
        Open Project →
      </button>
    </article>
  );
}

export default ProjectCard;
