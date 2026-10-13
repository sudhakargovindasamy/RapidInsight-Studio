import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateProjectModal from '../components/CreateProjectModal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import { createProject, deleteProject, getProjects } from '../api/projectApi.js';
import './ProjectsPage.css';

function getProjectStatus(project) {
  return String(project?.status || 'active').toLowerCase();
}

function getProjectOrganisation(project) {
  return (
    project?.organisation?.name ||
    project?.organisation_name ||
    project?.customer_name ||
    'RapidInsight workspace'
  );
}

function formatProjectCreatedAt(value) {
  if (!value) {
    return 'Creation date unavailable';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Creation date unavailable';
  }

  return `Created ${new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)}`;
}

function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [view, setView] = useState('grid');
  const [deletingId, setDeletingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function loadProjects() {
    try {
      setLoading(true);
      setError('');
      const response = await getProjects();
      setProjects(response.projects || response.data || response || []);
    } catch (err) {
      setError(err.message || 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function handleCreateProject(payload) {
    try {
      setCreating(true);
      setError('');
      const response = await createProject(payload);
      setModalOpen(false);
      
      if (response && response.data && response.data.id) {
        navigate(`/projects/${response.data.id}`);
      } else {
        await loadProjects();
      }
    } catch (err) {
      setError(err.message || 'Failed to create project.');
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmDeleteProject() {
    if (!deleteTarget) return;

    try {
      setDeletingId(deleteTarget.id);
      setError('');
      await deleteProject(deleteTarget.id);
      setProjects((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err.message || 'Failed to delete project.');
    } finally {
      setDeletingId(null);
    }
  }

  const visibleProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const result = projects.filter((project) => {
      const matchesSearch =
        !normalizedSearch ||
        String(project?.name || '').toLowerCase().includes(normalizedSearch) ||
        getProjectOrganisation(project).toLowerCase().includes(normalizedSearch);

      const matchesStatus =
        status === 'all' || getProjectStatus(project) === status;

      return matchesSearch && matchesStatus;
    });

    return [...result].sort((first, second) => {
      if (sortOrder === 'newest') {
        return new Date(second.created_at || 0) - new Date(first.created_at || 0);
      }

      return String(first.name || '').localeCompare(String(second.name || ''));
    });
  }, [projects, search, status, sortOrder]);

  return (
    <div className="projects-index-page">
      <aside className="projects-icon-rail" aria-label="Projects workspace status">
        <div
          className="projects-rail-current"
          title="Projects"
          aria-label="Projects page"
        >
          ◇
        </div>

        <div className="projects-rail-flow" aria-hidden="true">
          <span className="projects-rail-line" />
          <span className="projects-rail-orbit projects-rail-orbit--one" />
          <span className="projects-rail-orbit projects-rail-orbit--two" />
          <span className="projects-rail-orbit projects-rail-orbit--three" />
        </div>

        <div className="projects-rail-live" title="Workspace online">
          <span />
        </div>
      </aside>

      <main className="projects-index-content">
        <div className="projects-index-heading">
          <div>
            <span className="projects-index-kicker">Workspace</span>
            <h1>Projects</h1>
            <p>Search, filter and open your RapidInsight Studio projects.</p>
          </div>
          <button type="button" className="projects-new-button projects-new-button--mobile" onClick={() => setModalOpen(true)}>
            + New project
          </button>
        </div>

        <div className="projects-toolbar">
          <label className="projects-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search for a project"
              aria-label="Search projects"
            />
          </label>

          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>

          <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} aria-label="Sort projects">
            <option value="newest">Newest first</option>
            <option value="name">Sorted by name</option>
          </select>

          <div className="projects-toolbar-spacer" />

          <div className="projects-view-toggle" aria-label="Project view">
            <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view">▦</button>
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view">☷</button>
          </div>

          <button type="button" className="projects-new-button projects-new-button--desktop" onClick={() => setModalOpen(true)}>
            + New project
          </button>
        </div>

        {loading && <div className="projects-state">Loading projects…</div>}
        {error && !loading && <div className="projects-state projects-state--error">{error}</div>}

        {!loading && !error && visibleProjects.length === 0 && (
          <div className="projects-state">
            <strong>No matching projects</strong>
            <span>Change the search or filter, or create a new project.</span>
          </div>
        )}

        {!loading && !error && visibleProjects.length > 0 && (
          <div className={`projects-browser projects-browser--${view}`}>
            {visibleProjects.map((project) => (
              <article
                key={project.id}
                className="projects-browser-card"
                tabIndex={0}
                role="button"
                onClick={() => navigate(`/projects/${project.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/projects/${project.id}`);
                  }
                }}
              >
                <div className="projects-card-top">
                  <span className="projects-card-icon">R</span>
                  <div className="projects-card-top-actions">
                    <span className={`projects-card-status projects-card-status--${getProjectStatus(project)}`}>
                      {getProjectStatus(project)}
                    </span>
                    <button
                      type="button"
                      className="projects-card-delete"
                      aria-label={`Delete project ${project.name}`}
                      disabled={deletingId === project.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(project);
                      }}
                    >
                      {deletingId === project.id ? (
                        '…'
                      ) : (
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                          <path
                            d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-7 0 .6 12.1a2 2 0 0 0 2 1.9h4.8a2 2 0 0 0 2-1.9L18 7"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <h2>{project.name}</h2>
                <p>{project.description || 'No description provided for this project.'}</p>

                <div className="projects-card-meta">
                  <span>{getProjectOrganisation(project)}</span>
                  <span>{project.schema_status || 'Workspace ready'}</span>
                </div>

                <div className="projects-card-created">
                  {formatProjectCreatedAt(project.created_at)}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <CreateProjectModal
        open={modalOpen}
        creating={creating}
        error={error}
        initialOrgName="Rapid Insight Studio"
        onClose={() => {
          setModalOpen(false);
          setError('');
        }}
        onCreate={handleCreateProject}
      />

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Delete Project"
        message={
          deleteTarget &&
          `This will permanently delete "${deleteTarget.name}" and all its data. This cannot be undone.`
        }
        confirming={Boolean(deleteTarget) && deletingId === deleteTarget.id}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDeleteProject}
      />
    </div>
  );
}

export default ProjectsPage;
