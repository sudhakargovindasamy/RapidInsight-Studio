import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import UploadSchemaPanel from '../components/UploadSchemaPanel.jsx';
import { getProjectById } from '../api/projectApi.js';
import './RegistryAssetPage.css';

export default function RegistryAssetPage() {
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

  const organisation = project?.organisation?.name || project?.organisation_name || 'Your Organisation';

  return (
    <div className="schema-container registry-asset-page">
      <section className="hero-card pws-hero">
        <span className="hero-kicker">
          Project Workspace · {organisation}
        </span>
        <h1>{project?.name || 'Untitled Project'}</h1>
        <p>
          Register project schema files or connect external databases to register data assets.
        </p>
      </section>

      <header className="pws-section-heading">
        <div>
          <h2>Registry Assest</h2>
          <p>
            Upload schema files (JSON, YAML, YML, CSV) or connect to PostgreSQL / Supabase databases to discover and register assets.
          </p>
        </div>
      </header>

      <div className="registry-asset-upload-wrap">
        <UploadSchemaPanel
          projectId={projectId}
          onUploaded={() => {}}
        />
      </div>
    </div>
  );
}

