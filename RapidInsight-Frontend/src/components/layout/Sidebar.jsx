import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import './Sidebar.css';

function NavigationIcon({ type }) {
  const commonProps = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  };

  const icons = {
    overview: (
      <svg {...commonProps}>
        <path d="M3 11 12 3l9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M9 14h6" />
      </svg>
    ),
    playground: (
      <svg {...commonProps}>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M8 6h8M7 8l4 8M17 8l-4 8" />
      </svg>
    ),
    reports: (
      <svg {...commonProps}>
        <path d="M5 20V10M12 20V4M19 20v-7" />
      </svg>
    ),
    catalog: (
      <svg {...commonProps}>
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
        <path d="M6 6h10" />
        <path d="M6 10h10" />
        <path d="M6 14h6" />
      </svg>
    ),
    export: (
      <svg {...commonProps}>
        <path d="M12 3v13" />
        <path d="m7 11 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
    ),
    registry: (
      <svg {...commonProps}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M7 8h10" />
        <path d="M7 12h10" />
        <path d="M7 16h6" />
      </svg>
    ),
    ingestion: (
      <svg {...commonProps}>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        <path d="M12 11v6" />
        <path d="m15 14-3-3-3 3" />
      </svg>
    ),
    settings: (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </svg>
    )
  };

  return icons[type] || icons.overview;
}

function ComingSoonItem({ label, icon }) {
  return (
    <div
      className="sidebar-nav-item sidebar-nav-item--disabled"
      aria-disabled="true"
      title={`${label} is coming soon`}
    >
      <span className="sidebar-nav-icon">
        <NavigationIcon type={icon} />
      </span>
      <span className="sidebar-nav-text">{label}</span>
      <span className="sidebar-soon">Soon</span>
    </div>
  );
}

function ProjectNavLink({ to, end = false, icon, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => [
        'sidebar-nav-item',
        isActive ? 'sidebar-nav-item--active' : ''
      ].filter(Boolean).join(' ')}
    >
      <span className="sidebar-nav-icon">
        <NavigationIcon type={icon} />
      </span>
      <span className="sidebar-nav-text">{children}</span>
    </NavLink>
  );
}

function ExpandableNavItem({ to, icon, label, items = [] }) {
  const location = useLocation();
  const isBaseActive = location.pathname.startsWith(to);
  const [isOpen, setIsOpen] = useState(isBaseActive);

  useEffect(() => {
    if (isBaseActive) {
      setIsOpen(true);
    }
  }, [isBaseActive]);

  const handleToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  return (
    <div className="sidebar-expandable-wrap">
      <div className="sidebar-expandable-header">
        <NavLink
          to={to}
          className={({ isActive }) => [
            'sidebar-nav-item',
            'sidebar-nav-item--expandable',
            (isActive || isBaseActive) ? 'sidebar-nav-item--active' : ''
          ].filter(Boolean).join(' ')}
        >
          <span className="sidebar-nav-icon">
            <NavigationIcon type={icon} />
          </span>
          <span className="sidebar-nav-text">{label}</span>
        </NavLink>
        <button
          type="button"
          className={`sidebar-expand-toggle ${isOpen ? 'sidebar-expand-toggle--open' : ''}`}
          onClick={handleToggle}
          aria-label={isOpen ? `Collapse ${label}` : `Expand ${label}`}
          title={isOpen ? `Collapse ${label}` : `Expand ${label}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {isOpen && items.length > 0 && (
        <div className="sidebar-subnav">
          {items.map((item) => {
            const isSubActive = location.pathname === to && location.search.includes(item.query);
            return (
              <NavLink
                key={item.label}
                to={item.to}
                className={`sidebar-subnav-item ${isSubActive ? 'sidebar-subnav-item--active' : ''}`}
              >
                <span className="sidebar-subnav-bullet" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  projectId,
  isProjectRoute,
  sidebarWidth,
  onResizeStart,
  onResizeReset,
  onResizeKeyDown
}) {
  const projectBase = projectId ? `/projects/${projectId}` : null;

  if (!isProjectRoute || !projectBase) {
    return null;
  }

  return (
    <aside
      className="sidebar sidebar--project-only"
      style={{ '--project-sidebar-width': `${sidebarWidth}px` }}
    >
      <div className="sidebar-project">
        <span className="sidebar-project-label">Current project</span>
        <strong className="sidebar-project-name">RapidInsight project</strong>
      </div>

      <nav className="sidebar-nav" aria-label="Project navigation">
        <p className="sidebar-nav-label">Project</p>

        <ProjectNavLink to={projectBase} end icon="overview">
          Overview &amp; Schema
        </ProjectNavLink>

        <ProjectNavLink to={`${projectBase}/registry-asset`} icon="registry">
          Registry Assest
        </ProjectNavLink>

        <ExpandableNavItem
          to={`${projectBase}/data-ingestion`}
          icon="ingestion"
          label="Data Ingestion"
          items={[
            { label: 'Profile Source', to: `${projectBase}/data-ingestion?step=profile-source`, query: 'step=profile-source' },
            { label: 'Asset List', to: `${projectBase}/data-ingestion?step=asset-list`, query: 'step=asset-list' },
            { label: 'Load Data', to: `${projectBase}/data-ingestion?step=load-data`, query: 'step=load-data' }
          ]}
        />

        <ProjectNavLink to={`${projectBase}/playground`} icon="playground">
          Schema Playground
        </ProjectNavLink>

        <ProjectNavLink to={`${projectBase}/reports`} icon="reports">
          Generated Report
        </ProjectNavLink>

        <ProjectNavLink to={`${projectBase}/catalog`} icon="catalog">
          Data Catalog
        </ProjectNavLink>

        <ComingSoonItem label="Export" icon="export" />
        <ComingSoonItem label="Project Settings" icon="settings" />
      </nav>

      <div className="sidebar-footer">
        <span className="sidebar-status-dot" />
        <div>
          <strong>Services operational</strong>
          <span>Development environment</span>
        </div>
      </div>

      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-label="Resize project navigation"
        aria-orientation="vertical"
        aria-valuemin={180}
        aria-valuemax={360}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onDoubleClick={onResizeReset}
        onKeyDown={onResizeKeyDown}
      />
    </aside>
  );
}
