import "./PlaygroundActionsBar.css";

export default function PlaygroundActionsBar({ layoutMode, onToggleLayout }) {
  return (
    <aside className="playground-actions-bar" aria-label="Playground layout actions">
      <button 
        type="button" 
        onClick={onToggleLayout}
        title="Toggle between default layout and Star Schema view"
      >
        {layoutMode === 'star' ? 'Default View' : 'Star Schema View'}
      </button>
      <button type="button" disabled title="Coming soon: generate analytics-ready reports">
        Run Analytics
      </button>
    </aside>
  );
}
