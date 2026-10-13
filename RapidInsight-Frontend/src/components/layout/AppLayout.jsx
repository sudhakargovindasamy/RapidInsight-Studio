import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import Sidebar from './Sidebar.jsx';
import './AppLayout.css';

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_DEFAULT_WIDTH = 226;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_STORAGE_KEY = 'ris-project-sidebar-width';

function getProjectIdFromPath(pathname) {
  const match = pathname.match(/^\/projects\/([^/]+)/);

  return match?.[1] || null;
}

export default function AppLayout() {
  const location = useLocation();
  const { profile, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const savedValue = Number(
      window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    );

    if (!Number.isFinite(savedValue)) {
      return SIDEBAR_DEFAULT_WIDTH;
    }

    return Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.max(SIDEBAR_MIN_WIDTH, savedValue)
    );
  });

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      String(sidebarWidth)
    );
  }, [sidebarWidth]);

  function handleSidebarResizeStart(event) {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarWidth;

    document.body.classList.add('sidebar-is-resizing');

    function handlePointerMove(moveEvent) {
      const nextWidth =
        startWidth + moveEvent.clientX - startX;

      const constrainedWidth = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, nextWidth)
      );

      setSidebarWidth(constrainedWidth);
    }

    function handlePointerUp() {
      document.body.classList.remove(
        'sidebar-is-resizing'
      );

      window.removeEventListener(
        'pointermove',
        handlePointerMove
      );

      window.removeEventListener(
        'pointerup',
        handlePointerUp
      );
    }

    window.addEventListener(
      'pointermove',
      handlePointerMove
    );

    window.addEventListener(
      'pointerup',
      handlePointerUp
    );
  }

  function handleSidebarResizeReset() {
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  }

  function handleSidebarResizeKeyDown(event) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();

      setSidebarWidth((currentWidth) =>
        Math.max(
          SIDEBAR_MIN_WIDTH,
          currentWidth - 10
        )
      );
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();

      setSidebarWidth((currentWidth) =>
        Math.min(
          SIDEBAR_MAX_WIDTH,
          currentWidth + 10
        )
      );
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setSidebarWidth(SIDEBAR_MIN_WIDTH);
    }

    if (event.key === 'End') {
      event.preventDefault();
      setSidebarWidth(SIDEBAR_MAX_WIDTH);
    }

    if (
      event.key === 'Enter' ||
      event.key === '0'
    ) {
      event.preventDefault();
      setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    }
  }

  const isDashboard =
    location.pathname === '/dashboard';

  const isProjectsIndex =
    location.pathname === '/projects';

  const isStandalonePage =
    isDashboard || isProjectsIndex;

  const projectId = getProjectIdFromPath(
    location.pathname
  );

  const isProjectRoute = Boolean(projectId);

  const displayName =
    profile?.username ||
    profile?.email?.split('@')[0] ||
    'User';

  async function handleLogout() {
    logout();
    window.location.href = '/login';
  }

  return (
    <div
      className={[
        'app-layout',
        isStandalonePage
          ? (isDashboard ? 'app-layout--dashboard' : 'app-layout--projects')
          : 'app-layout--console',
      ].join(' ')}
      data-theme={theme}
    >
      <header className="app-header">
        <div
          className={[
            'app-header-inner',
            isDashboard
              ? 'app-header-inner--dashboard'
              : 'app-header-inner--console',
          ].join(' ')}
        >
          <div className="app-header-left">
            <NavLink
              to="/dashboard"
              className="app-brand"
            >
              <span className="app-brand-mark">
                ◆
              </span>

              <span className="app-brand-name">
                RapidInsight
              </span>

              <span className="app-brand-product">
                Studio
              </span>
            </NavLink>

            {!isDashboard && (
              <>
                <span className="app-header-divider" />

                <div className="app-breadcrumbs">
                  <NavLink to="/dashboard">
                    Home
                  </NavLink>

                  {projectId && (
                    <>
                      <span>/</span>

                      <NavLink
                        to={`/projects/${projectId}`}
                      >
                        Project workspace
                      </NavLink>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="app-header-actions">
            {isDashboard && (
              <NavLink
                to="/projects"
                className="app-header-nav-link"
              >
                Dashboard
              </NavLink>
            )}

            <button
              type="button"
              className="app-header-icon-btn"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {theme === 'light' ? '☾' : '☀'}
            </button>

            <div className="app-user-menu">
              <span className="app-user-avatar">
                {displayName.charAt(0).toUpperCase()}
              </span>

              <span className="app-user-name">
                {displayName}
              </span>
            </div>

            <button
              type="button"
              className="app-logout-btn"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {isStandalonePage ? (
        <main className={isDashboard ? 'dashboard-main' : 'projects-index-main'}>
          <Outlet />
        </main>
      ) : (
        <div className="console-shell">
          <Sidebar
            projectId={projectId}
            isProjectRoute={isProjectRoute}
            sidebarWidth={sidebarWidth}
            onResizeStart={handleSidebarResizeStart}
            onResizeReset={handleSidebarResizeReset}
            onResizeKeyDown={handleSidebarResizeKeyDown}
          />

          <main className="console-main">
            <Outlet />
          </main>
        </div>
      )}
    </div>
  );
}
