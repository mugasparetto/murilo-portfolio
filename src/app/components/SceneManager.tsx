"use client";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";

export default function SceneHost() {
  const { entries } = useSceneRegistry();

  const ordered = Object.values(entries)
    .filter((e) => e.active)
    .sort((a, b) => a.priority - b.priority);

  return (
    <>
      {ordered.map((e) => (
        <group key={e.id}>{e.node}</group>
      ))}
    </>
  );
}
