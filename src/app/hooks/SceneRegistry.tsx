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
  /**
   * A stable, human-readable handle for the group this entry is mounted into.
   *
   * `id` comes from `useId`, so it changes shape between builds and says
   * nothing about which section it is. Anything that has to find a section's
   * geometry in the scene graph — <Diagnostics />'s bisect toggles — needs a
   * name that survives both. Falls back to `id` when a caller doesn't set one.
   */
  name?: string;
};

type SceneRegistry = {
  entries: Record<string, SceneEntry>;
  register: (e: {
    id: string;
    node: React.ReactNode;
    priority?: number;
    active?: boolean;
    name?: string;
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
      name?: string;
    }) => {
      setEntries((prev) => {
        const prevEntry = prev[e.id];
        const nextEntry: SceneEntry = {
          id: e.id,
          node: e.node,
          priority: e.priority ?? prevEntry?.priority ?? 0,
          active: e.active ?? prevEntry?.active ?? false,
          name: e.name ?? prevEntry?.name,
        };

        // ✅ avoid pointless updates if nothing changed (helps a lot)
        if (
          prevEntry &&
          prevEntry.node === nextEntry.node &&
          prevEntry.priority === nextEntry.priority &&
          prevEntry.active === nextEntry.active &&
          prevEntry.name === nextEntry.name
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
