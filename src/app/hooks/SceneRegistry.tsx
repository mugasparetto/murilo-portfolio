"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type SceneEntry = {
  id: string;
  node: React.ReactNode;
  active: boolean;
  priority: number;
};

type SceneRegistry = {
  entries: Record<string, SceneEntry>;
  register: (e: {
    id: string;
    node: React.ReactNode;
    priority?: number;
    active?: boolean;
  }) => void;
  remove: (id: string) => void;
  setActive: (id: string, active: boolean) => void;
};

const SceneRegistryContext = createContext<SceneRegistry | null>(null);

export function useSceneRegistry() {
  const ctx = useContext(SceneRegistryContext);
  if (!ctx)
    throw new Error(
      "useSceneRegistry must be used within <SceneRegistryProvider />",
    );
  return ctx;
}

export function SceneRegistryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [entries, setEntries] = useState<Record<string, SceneEntry>>({});

  const register = useCallback(
    (e: {
      id: string;
      node: React.ReactNode;
      priority?: number;
      active?: boolean;
    }) => {
      setEntries((prev) => {
        const prevEntry = prev[e.id];
        const nextEntry: SceneEntry = {
          id: e.id,
          node: e.node,
          priority: e.priority ?? prevEntry?.priority ?? 0,
          active: e.active ?? prevEntry?.active ?? false,
        };

        // ✅ avoid pointless updates if nothing changed (helps a lot)
        if (
          prevEntry &&
          prevEntry.node === nextEntry.node &&
          prevEntry.priority === nextEntry.priority &&
          prevEntry.active === nextEntry.active
        ) {
          return prev;
        }

        return { ...prev, [e.id]: nextEntry };
      });
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setEntries((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const setActive = useCallback((id: string, active: boolean) => {
    setEntries((prev) => {
      const entry = prev[id];
      if (!entry || entry.active === active) return prev;
      return { ...prev, [id]: { ...entry, active } };
    });
  }, []);

  // ✅ api is stable; only `entries` value changes
  const api = useMemo<SceneRegistry>(
    () => ({ entries, register, remove, setActive }),
    [entries, register, remove, setActive],
  );

  return (
    <SceneRegistryContext.Provider value={api}>
      {children}
    </SceneRegistryContext.Provider>
  );
}
