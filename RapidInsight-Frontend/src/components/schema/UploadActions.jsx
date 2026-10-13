import './UploadActions.css';

export default function UploadActions({ onUpload, onClear, hasFile, isUploading }) {
  return (
    <div className="upload-actions">
      <div className="upload-actions-left">
        {hasFile && (
          <p className="upload-actions-hint animate-fade-in">
            Ready to upload — click <strong>Upload Schema</strong> to continue.
          </p>
        )}
        {!hasFile && (
          <p className="upload-actions-hint">
            Select a schema file above to get started.
          </p>
        )}
      </div>

      <div className="upload-actions-buttons">
        <button
          id="btn-clear"
          className="btn btn-ghost"
          onClick={onClear}
          disabled={!hasFile || isUploading}
          aria-label="Clear selected file"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-3.29" />
          </svg>
          Clear
        </button>

        <button
          id="btn-upload-schema"
          className="btn btn-primary"
          onClick={onUpload}
          disabled={!hasFile || isUploading}
          aria-label="Upload schema file"
        >
          {isUploading ? (
            <>
              <span className="upload-spinner" />
              Uploading…
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload Schema
            </>
          )}
        </button>
      </div>
    </div>
  );
}
