import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "./api.js";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api("/auth/session");
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (username, password) => {
    const { user } = await api("/auth/login", { method: "POST", body: { username, password } });
    setUser(user);
    return user;
  };

  const register = async ({ username, email, password, referral, lang }) => {
    const { user } = await api("/auth/register", {
      method: "POST",
      body: { username, email, password, referral, lang },
    });
    setUser(user);
    return user;
  };

  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, setUser, loading, login, register, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
