import { useState, useEffect } from 'react';
import './CreateProjectModal.css';

function CreateProjectModal({ open, creating, error, onClose, onCreate, initialOrgName = '' }) {
  const [name, setName] = useState('');
  const [organisationName, setOrganisationName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) {
      if (initialOrgName && !organisationName) setOrganisationName(initialOrgName);
    } else {
      // reset fields when closing
      setName('');
      setOrganisationName('');
      setDescription('');
    }
  }, [open, initialOrgName]);

  if (!open) return null;

  async function handleSubmit(event) {
    event.preventDefault();

    if (!name.trim() || !organisationName.trim()) return;

    await onCreate({
      name: name.trim(),
      organisationName: organisationName.trim(),
      description: description.trim()
    });

    setName('');
    setOrganisationName('');
    setDescription('');
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        {/* Header */}
        <div className="modal-header">
          <h2>Create New Project</h2>
          <button
            type="button"
            onClick={onClose}
            className="cpm-close-btn"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="error-box" style={{ marginBottom: '1rem' }}>{error}</div>}
          <label>
            <span>Project Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer Analytics Project"
              required
              autoFocus
            />
          </label>

          <label>
            <span>Organisation Name</span>
            <input
              value={organisationName}
              onChange={(e) => setOrganisationName(e.target.value)}
              placeholder="Acme Corp"
              required
            />
          </label>

          <label>
            <span>Description <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>(optional)</span></span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this project is for…"
              rows={4}
            />
          </label>

          {/* Actions */}
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="secondary-btn">
              Cancel
            </button>
            <button type="submit" disabled={creating} className="primary-btn">
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateProjectModal;
