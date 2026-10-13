import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateProjectModal from '../components/CreateProjectModal.jsx';

import { createProject, getProjects } from '../api/projectApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import './DashboardPage.css';

function DashboardPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [projects, setProjects] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function loadDashboard() {
    try {
      setLoading(true);
      setError('');

      const projectsData = await getProjects();
      setProjects(projectsData.projects || projectsData.data || projectsData || []);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
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
        await loadDashboard();
      }
    } catch (err) {
      setError(err.message || 'Failed to create project.');
    } finally {
      setCreating(false);
    }
  }

  const orgName = 'Rapid Insight Studio';

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-eyebrow">
            Data workspace
          </span>

          <h1>
            Build data models.
            <span>
              Generate insights faster.
            </span>
          </h1>

          <p>
            Create isolated analytics projects,
            upload schemas, generate realistic data
            and explore generated tables from one
            workspace.
          </p>

          <div className="dashboard-hero-actions">
            <button
              type="button"
              className="dashboard-primary-btn"
              onClick={() => setModalOpen(true)}
            >
              Start a new project
            </button>

            <button
              type="button"
              className="dashboard-secondary-btn"
              onClick={() => navigate('/projects')}
            >
              Browse projects
            </button>
          </div>
        </div>

        <div className="dashboard-hero-summary">
          <p>
            Signed in as
          </p>

          <strong>
            {profile?.username ||
              profile?.email ||
              'RapidInsight user'}
          </strong>

          <dl>
            <div>
              <dt>Projects</dt>
              <dd>{projects.length}</dd>
            </div>

            <div>
              <dt>Environment</dt>
              <dd>Development</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="dashboard-feature-grid">
        <article className="dashboard-feature dashboard-feature--large">
          <span className="dashboard-feature-icon">
            ▣
          </span>

          <h2>Project workspaces</h2>

          <p>
            Keep customer schemas, generated tables,
            mock data and reports inside isolated
            projects.
          </p>

          <ul>
            <li>Project-level schema isolation</li>
            <li>Secure authenticated access</li>
            <li>Generated table tracking</li>
          </ul>
        </article>

        <article className="dashboard-feature">
          <span className="dashboard-feature-icon">
            ◫
          </span>

          <h2>Schema tools</h2>

          <p>
            Upload JSON, YAML or CSV schema definitions
            and inspect entities visually.
          </p>
        </article>

        <article className="dashboard-feature">
          <span className="dashboard-feature-icon">
            ◇
          </span>

          <h2>Data generation</h2>

          <p>
            Generate realistic test rows and populate
            physical PostgreSQL tables.
          </p>
        </article>
      </section>


      <CreateProjectModal
        open={modalOpen}
        creating={creating}
        error={error}
        initialOrgName={orgName}
        onClose={() => {
          setModalOpen(false);
          setError('');
        }}
        onCreate={handleCreateProject}
      />
    </div>
  );
}

export default DashboardPage;
