import { useState } from "react";
import "./PlaygroundInfoButton.css";

export default function PlaygroundInfoButton() {
  const [open, setOpen] = useState(false);

  return (
    <div className="playground-info-wrap">
      <button
        type="button"
        className="playground-info-btn"
        onClick={() => setOpen((value) => !value)}
        aria-label="How to use Schema Playground"
      >
        i
      </button>

      {open ? (
        <div className="playground-info-popover" role="dialog" aria-label="Schema Playground instructions">
          <h3>How to use Playground</h3>
          <ol>
            <li>Drag schema entities anywhere on the canvas to arrange your ER visualization.</li>
            <li>Click the <strong>eye icon</strong> on an entity to view its generated table data.</li>
            <li><strong>Run Analytics</strong> is visible for future analytical workflows.</li>
          </ol>
        </div>
      ) : null}
    </div>
  );
}
