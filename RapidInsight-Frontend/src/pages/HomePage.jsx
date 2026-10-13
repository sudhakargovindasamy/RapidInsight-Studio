import { Link } from 'react-router-dom';
import './HomePage.css';

const stats = [
  { label: 'Services Running', value: '6', icon: '⚡', color: 'green' },
  { label: 'Schemas Uploaded', value: '0', icon: '📄', color: 'purple' },
  { label: 'Tables Created', value: '0', icon: '🗄️', color: 'purple' },
  { label: 'Reports Ready', value: '0', icon: '📊', color: 'yellow' },
];

const pipeline = [
  { step: '01', title: 'Upload Schema', desc: 'Upload a JSON, YAML, or CSV file that defines your table structure.', icon: '📤', done: false },
  { step: '02', title: 'Parse & Validate', desc: 'Schema Service reads and normalises the file into a common format.', icon: '🔍', done: false },
  { step: '03', title: 'Generate Data', desc: 'Datagen Service uses Faker.js to create realistic sample rows.', icon: '⚙️', done: false },
  { step: '04', title: 'Build Table', desc: 'Table Builder creates a PostgreSQL table and inserts all generated rows.', icon: '🗄️', done: false },
  { step: '05', title: 'Run Reports', desc: 'Report Engine runs aggregation queries and returns chart-ready JSON.', icon: '📊', done: false },
  { step: '06', title: 'View Dashboard', desc: 'React renders Chart.js bar charts from the report data.', icon: '📈', done: false },
];

export default function HomePage() {
  return (
    <div className="home-page animate-fade-in">
      {/* Hero */}
      <section className="home-hero">
        <div className="home-hero-text">
          {/* <div className="home-hero-eyebrow">
            <span className="badge badge-purple">POC Accelerator</span>
            <span className="home-hero-divider">·</span>
            <span className="home-hero-week">Week 1 — Schema Upload</span>
          </div> */}
          <h1 className="home-hero-title">
            Turn your data schema<br />
            into instant <span className="home-hero-accent">reports</span>.
          </h1>
          <p className="home-hero-desc">
            Upload a schema file — RapidInsight Studio automatically creates a PostgreSQL table,
            fills it with realistic sample data, and builds a working dashboard for you.
          </p>
          <div className="home-hero-actions">
            <Link to="/schema-upload" className="btn btn-primary" id="btn-get-started">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload Schema
            </Link>
            <a
              href="http://localhost:3000/health"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
              id="btn-check-api"
            >
              Check API Gateway
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="home-stats">
        {stats.map((s) => (
          <div key={s.label} className={`home-stat-card home-stat-card--${s.color}`}>
            <span className="home-stat-icon">{s.icon}</span>
            <div>
              <p className="home-stat-value">{s.value}</p>
              <p className="home-stat-label">{s.label}</p>
            </div>
          </div>
        ))}
      </section>

      <hr className="divider" />

      {/* Pipeline */}
      <section className="home-pipeline">
        <div className="home-section-header">
          <h2 className="home-section-title">How it works</h2>
          <p className="home-section-sub">6-step pipeline from schema file to live report</p>
        </div>

        <div className="pipeline-grid">
          {pipeline.map((item, idx) => (
            <div key={item.step} className="pipeline-card" style={{ animationDelay: `${idx * 60}ms` }}>
              <div className="pipeline-step">{item.step}</div>
              <div className="pipeline-icon">{item.icon}</div>
              <h3 className="pipeline-title">{item.title}</h3>
              <p className="pipeline-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
