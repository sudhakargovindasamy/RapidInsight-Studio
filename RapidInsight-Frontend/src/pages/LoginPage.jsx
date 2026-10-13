import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { signupUser } from '../api/authApi.js';
import './LoginPage.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isAuthenticated, booting } = useAuth();
  const { setTheme } = useTheme();

  const [mode, setMode] = useState('login');
  
  // Form fields
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Login and the first authenticated page always start in light mode.
    setTheme('light');
  }, [setTheme]);

  useEffect(() => {
    setError('');
    setMessage('');
  }, [mode]);

  if (!booting && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSubmitting(true);
      setError('');
      setMessage('');

      if (mode === 'signup') {
        if (!username.trim() || !email.trim()) {
          setError('Username and email are required.');
          return;
        }
        
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }

        await signupUser({
          username: username.trim(),
          email: email.trim(),
          password,
          confirmPassword
        });

        setMessage('Account created! Please log in.');
        setMode('login');
        setPassword('');
        setConfirmPassword('');
        return;
      }

      await login({
        username: username.trim(),
        password
      });

      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-card-container">
        
        {/* ── Left Pane ── */}
        <div className="login-left-pane">
          {/* Decorative CSS shapes based on the provided design */}
          <div className="deco-circle top-left"></div>
          <div className="deco-circle top-left-inner"></div>
          <div className="deco-circle center-hollow"></div>
          <div className="deco-circle bottom-left"></div>
          <div className="deco-dots top-right"></div>
          <div className="deco-dots bottom-right"></div>
          
          <div className="login-left-content">
            <div className="login-text-logo">
              <span className="logo-primary">Rapid</span>
              <span className="logo-secondary">Insight Studio</span>
            </div>
            <h1 className="main-greeting">
              Schema-driven<br />
              <span className="highlight">Analytics</span>
            </h1>
          </div>
        </div>

        {/* ── Right Pane (Form) ── */}
        <div className="login-right-pane">
          <div className="login-form-wrapper">
            <h2 className="form-title">{mode === 'login' ? 'Login' : 'Sign Up'}</h2>
            
            <form onSubmit={handleSubmit} className="login-form">
              
              {error && <div className="login-error">{error}</div>}
              {message && <div className="login-success">{message}</div>}

              <label>
                <span>Username</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </label>

              {mode === 'signup' && (
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
              )}

              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </label>

              {mode === 'signup' && (
                <label>
                  <span>Confirm Password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </label>
              )}

              {mode === 'login' && (
                <div className="forgot-password">
                  <button type="button">forgot password?</button>
                </div>
              )}

              <button type="submit" className="login-submit-btn" disabled={submitting}>
                {submitting
                  ? 'Please wait...'
                  : mode === 'signup'
                    ? 'Sign Up'
                    : 'Login'}
              </button>

              <div className="login-footer">
                {mode === 'login' ? (
                  <p>Don't have any account? <button type="button" onClick={() => setMode('signup')}>Create an account</button></p>
                ) : (
                  <p>Already have an account? <button type="button" onClick={() => setMode('login')}>Login</button></p>
                )}
              </div>

            </form>
          </div>
        </div>

      </div>
    </main>
  );
}