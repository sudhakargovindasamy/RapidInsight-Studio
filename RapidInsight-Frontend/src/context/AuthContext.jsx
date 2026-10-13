import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { clearSession, getSession } from '../api/apiClient.js';
import { getMe, loginUser } from '../api/authApi.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => getSession());
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);

  const isAuthenticated = Boolean(session?.access_token);

  async function refreshMe() {
    const currentSession = getSession();

    if (!currentSession?.access_token) {
      setBooting(false);
      return;
    }

    try {
      const response = await getMe();
      setProfile(response.profile);
      setSession(currentSession);
    } catch {
      clearSession();
      setSession(null);
      setProfile(null);
    } finally {
      setBooting(false);
    }
  }

  async function login(credentials) {
    const response = await loginUser(credentials);
    setSession(response.session);
    setProfile(response.profile);
    return response;
  }

  function logout() {
    clearSession();
    setSession(null);
    setProfile(null);
  }

  useEffect(() => {
    refreshMe();
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      booting,
      isAuthenticated,
      login,
      logout,
      refreshMe
    }),
    [session, profile, booting, isAuthenticated]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}