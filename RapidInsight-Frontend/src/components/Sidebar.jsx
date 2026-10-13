import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
 
function Sidebar() {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
 
  async function handleLogout() {
    await signOut();
    navigate('/login', { replace: true });
  }
 
  return (
    <aside className="main-sidebar">
      <div>
        <div className="brand">Rapid Insight Studio</div>
        <nav className="sidebar-nav">
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>
      </div>
 
      <div className="sidebar-footer">
        <div className="sidebar-user">{user?.email}</div>
        <button type="button" onClick={handleLogout} className="secondary-btn">
          Logout
        </button>
      </div>
    </aside>
  );
}
 
export default Sidebar;
