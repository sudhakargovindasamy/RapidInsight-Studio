import './SchemaUploadPage.css';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function SchemaUploadPage() {
  const { getAccessToken } = useAuth();

  const [selectedFile, setSelectedFile] = useState(null);
  const [schemas, setSchemas] = useState([]);

  const [uploading, setUploading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  async function fetchMySchemas() {
    setFetching(true);
    setErrorMessage('');

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        throw new Error('You are not logged in.');
      }

      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/schema/my`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      const responseBody = await response.json();

      if (!response.ok) {
        throw new Error(
          responseBody.details ||
          responseBody.message ||
          responseBody.error ||
          'Failed to fetch schemas'
        );
      }

      setSchemas(responseBody.schemas || []);
    } catch (error) {
      setErrorMessage(error.message || 'Failed to fetch schemas');
    } finally {
      setFetching(false);
    }
  }

  async function handleUpload(event) {
    event.preventDefault();

    if (!selectedFile) {
      setErrorMessage('Please select a JSON, YAML, YML, or CSV file.');
      return;
    }

    setUploading(true);
    setResult(null);
    setErrorMessage('');

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        throw new Error('You are not logged in.');
      }

      const formData = new FormData();
      formData.append('schema', selectedFile);

      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/schema/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        body: formData
      });

      const responseBody = await response.json();

      if (!response.ok) {
        throw new Error(
          responseBody.details ||
          responseBody.error ||
          responseBody.message ||
          'Upload failed'
        );
      }

      setResult(responseBody);
      setSelectedFile(null);

      await fetchMySchemas();
    } catch (error) {
      setErrorMessage(error.message || 'Something went wrong');
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    fetchMySchemas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="schema-container" id="top">
      <section className="hero-card">
        <span className="hero-kicker">Secure schema management</span>

        <h1>Upload, validate and store your data schemas with confidence.</h1>

        <p>
          Upload JSON, YAML, YML or CSV schemas. Your files are normalized,
          stored privately in Supabase Storage and linked to your account.
        </p>
      </section>

      <section className="grid-layout">
        <div className="panel" id="upload">
          <div className="panel-header">
            <h3 className="panel-title">Upload Schema</h3>
            <p className="panel-description">
              Select a supported schema file. Maximum file size is 5 MB.
            </p>
          </div>

          <form onSubmit={handleUpload}>
            <div className="upload-zone">
              <div className="upload-icon">↑</div>

              <strong>Choose your schema file</strong>

              <p className="panel-description">
                Supported formats: JSON, YAML, YML and CSV
              </p>

              <input
                className="file-input"
                type="file"
                accept=".json,.yaml,.yml,.csv"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />

              {selectedFile && (
                <p className="selected-file">
                  Selected: <strong>{selectedFile.name}</strong>
                </p>
              )}
            </div>

            <button type="submit" disabled={uploading} className="upload-btn">
              {uploading ? 'Uploading Schema...' : 'Upload Schema'}
            </button>
          </form>

          {errorMessage && (
            <div className="error-box">
              Error: {errorMessage}
            </div>
          )}

          {result && (
            <div className="success-box">
              <h3>Upload Successful</h3>

              <div className="detail-row">
                <span className="detail-label">Schema ID</span>
                <span className="detail-value">{result.schema_id}</span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Name</span>
                <span className="detail-value">{result.name}</span>
              </div>

              <div className="detail-row">
                <span className="detail-label">File Type</span>
                <span className="detail-value">{result.source_format}</span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Fields</span>
                <span className="detail-value">{result.field_count ?? 'N/A'}</span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Storage</span>
                <span className="detail-value">{result.storage_path}</span>
              </div>
            </div>
          )}
        </div>

        <div className="panel" id="schemas">
          <div className="schemas-toolbar">
            <div>
              <h3 className="panel-title">My Uploaded Schemas</h3>
              <p className="panel-description">
                Schemas are filtered automatically for your account.
              </p>
            </div>

            <button
              type="button"
              onClick={fetchMySchemas}
              disabled={fetching}
              className="refresh-btn"
            >
              {fetching ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {schemas.length === 0 ? (
            <div className="empty-state">
              No schemas uploaded yet.
            </div>
          ) : (
            <ul className="schema-list">
              {schemas.map((schema) => (
                <li key={schema.id} className="schema-item">
                  <div className="schema-item-top">
                    <div className="schema-name">
                      {schema.name || schema.original_file_name}
                    </div>

                    <span className="type-badge">
                      {schema.file_type}
                    </span>
                  </div>

                  <div className="schema-meta">
                    <span>
                      <strong>Schema ID:</strong> {schema.id}
                    </span>

                    <span>
                      <strong>Field Count:</strong> {schema.field_count ?? 'N/A'}
                    </span>

                    <span>
                      <strong>Storage Path:</strong> {schema.storage_path}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
