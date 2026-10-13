import { useRef, useState } from 'react';
import { validateFile, ALLOWED_EXTENSIONS } from '../../utils/fileValidation.js';
import './UploadDropzone.css';

function FileIcon({ ext }) {
  const colors = {
    json: '#f7931e',
    yaml: '#00bcd4',
    yml: '#00bcd4',
    csv: '#4caf50',
  };
  const color = colors[ext] || '#9ba3c0';
  return (
    <div className="file-icon" style={{ borderColor: color, color }}>
      {ext?.toUpperCase() || 'FILE'}
    </div>
  );
}

export default function UploadDropzone({ onFileSelect }) {
  const inputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [validationError, setValidationError] = useState(null);

  function getFileExt(name) {
    return name?.split('.').pop()?.toLowerCase();
  }

  function handleFile(file) {
    if (!file) return;

    const result = validateFile(file);

    if (!result.valid) {
      setValidationError(result.error);
      setSelectedFile(null);
      onFileSelect?.(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    // Valid file — clear any previous error
    setValidationError(null);
    setSelectedFile(file);
    onFileSelect?.(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleInputChange(e) {
    handleFile(e.target.files?.[0]);
  }

  function handleClearFile() {
    setSelectedFile(null);
    setValidationError(null);
    onFileSelect?.(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const ext = selectedFile ? getFileExt(selectedFile.name) : null;

  return (
    <div className="dropzone-wrapper">
      <div
        id="upload-dropzone"
        className={`dropzone ${isDragOver ? 'dropzone--drag-over' : ''} ${selectedFile ? 'dropzone--has-file' : ''} ${validationError ? 'dropzone--error' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !selectedFile && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && !selectedFile && inputRef.current?.click()}
        aria-label="Upload schema file"
        aria-describedby={validationError ? 'dropzone-error-msg' : undefined}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS.join(',')}
          onChange={handleInputChange}
          style={{ display: 'none' }}
          id="schema-file-input"
        />

        {selectedFile ? (
          /* ── Selected file state ── */
          <div className="dropzone-file-selected animate-fade-in">
            <FileIcon ext={ext} />
            <div className="dropzone-file-info">
              <p className="dropzone-file-name">{selectedFile.name}</p>
              <p className="dropzone-file-size">
                {(selectedFile.size / 1024).toFixed(1)} KB &bull; {ext?.toUpperCase()}
              </p>
            </div>
            <button
              className="dropzone-remove-btn"
              onClick={(e) => { e.stopPropagation(); handleClearFile(); }}
              title="Remove file"
              aria-label="Remove selected file"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ) : (
          /* ── Empty / drag state ── */
          <div className="dropzone-empty">
            <div className={`dropzone-icon-ring ${isDragOver ? 'dropzone-icon-ring--active' : ''} ${validationError ? 'dropzone-icon-ring--error' : ''}`}>
              {validationError ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
            </div>
            <div className="dropzone-text">
              <p className="dropzone-heading">
                {isDragOver ? 'Drop your file here' : 'Drag & drop your schema file'}
              </p>
              <p className="dropzone-sub">
                or{' '}
                <span className="dropzone-browse-link" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
                  browse to choose a file
                </span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Inline validation error message */}
      {validationError && (
        <div
          id="dropzone-error-msg"
          className="dropzone-validation-error animate-fade-in"
          role="alert"
          aria-live="assertive"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {validationError}
        </div>
      )}

      {/* Supported format chips */}
      <div className="dropzone-types">
        <span className="dropzone-types-label">Supported formats:</span>
        {ALLOWED_EXTENSIONS.map((t) => (
          <span key={t} className="dropzone-type-chip">{t}</span>
        ))}
      </div>
    </div>
  );
}
