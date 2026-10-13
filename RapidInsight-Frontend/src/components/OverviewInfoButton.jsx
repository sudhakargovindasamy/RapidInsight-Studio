import { useState } from "react";
import "./OverviewInfoButton.css";

export default function OverviewInfoButton() {
  const [open, setOpen] = useState(false);

  return (
    <div className="overview-info-wrap">
      <button
        type="button"
        className="overview-info-btn"
        onClick={() => setOpen((value) => !value)}
        aria-label="How to use Overview & Schema"
      >
        i
      </button>

      {open ? (
        <div className="overview-info-popover" role="dialog" aria-label="Overview & Schema instructions">
          <h3>Overview & Schema</h3>
          <ol>
            <li>Upload schema files one by one to view their attributes.</li>
            <li>Click <strong>Generate Table</strong> to build the table with mock data.</li>
            <li>Move to the <strong>Playground</strong> to view ER relation visualizations.</li>
            <li>Return here to view or delete your generated tables.</li>
          </ol>
        </div>
      ) : null}
    </div>
  );
}
