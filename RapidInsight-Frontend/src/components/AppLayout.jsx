import Sidebar from './Sidebar.jsx';
 
function AppLayout({ children, title, subtitle }) {
  return (
    <div className="app-shell">
      <Sidebar />
 
      <main className="app-main">
        {(title || subtitle) && (
          <header className="page-header">
            {title && <h1>{title}</h1>}
            {subtitle && <p>{subtitle}</p>}
          </header>
        )}
 
        {children}
      </main>
    </div>
  );
}
 
export default AppLayout;
