import React, { useState } from 'react';
import { generateAndInsertData } from '../../api/tableApi.js';

export default function GenerateDataModal({ schemaId, onClose, onSuccess }) {
  const [rowCount, setRowCount] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    try {
      setLoading(true);
      setError('');

      const count = Number(rowCount);

      if (!Number.isFinite(count) || count <= 0) {
        throw new Error('Please enter a valid row count.');
      }

      if (count > 10000) {
        throw new Error('Maximum allowed rows are 10,000.');
      }

      await generateAndInsertData(
        schemaId,
        count
      );

      onSuccess?.();
    } catch (err) {
      setError(err.message || 'Failed to generate data.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <h2>Generate Data</h2>
          <button className="secondary-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-form">
          <label>
            Number of Rows
            <input
              type="number"
              min="1"
              max="10000"
              value={rowCount}
              onChange={(event) => setRowCount(event.target.value)}
            />
          </label>

          {error && (
            <div className="error-box">
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button
              className="secondary-btn"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              className="primary-btn"
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? 'Generating...' : 'Generate & Insert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
