"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { resellerApi } from "./api";

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  // Initial fetch on mount
  useEffect(() => {
    async function load() {
      try {
        const data = await resellerApi.me();
        setUser(data?.user || null);
        setConfig(data?.config || null);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await resellerApi.me();
      setUser(data?.user || null);
      setConfig(data?.config || null);
    } catch {
      setUser(null);
    }
  }, []);

  return (
    <SessionContext.Provider value={{ user, config, loading, refresh, setUser, setConfig }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
