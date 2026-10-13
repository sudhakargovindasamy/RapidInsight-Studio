import "./PlaygroundToolbar.css";

export default function PlaygroundToolbar({ searchTerm, onSearchChange, onRefresh, loading }) {
  return (
    <section className="playground-toolbar">
      <div className="playground-search-wrap">
        <span>⌕</span>
        <input
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search schema entities..."
        />
      </div>

      <button type="button" onClick={onRefresh} disabled={loading}>
        {loading ? "Refreshing..." : "Refresh"}
      </button>
    </section>
  );
}
