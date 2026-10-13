import './ConfirmDeleteModal.css';

function ConfirmDeleteModal({ open, title, message, confirming, onClose, onConfirm }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !confirming && onClose()}>
      <div className="modal-card confirm-delete-card">
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="cpm-close-btn"
            aria-label="Close"
            disabled={confirming}
          >
            ✕
          </button>
        </div>

        <p className="confirm-delete-message">{message}</p>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="secondary-btn" disabled={confirming}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="danger-btn" disabled={confirming}>
            {confirming ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDeleteModal;
