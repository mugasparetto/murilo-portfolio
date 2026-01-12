"use client";

import * as React from "react";
import type { Content } from "@prismicio/client";

type HeroPrimary = Content.HeroSlice["primary"];

const HeroPrimaryContext = React.createContext<HeroPrimary | null>(null);

export function HeroPrimaryProvider({
  primary,
  children,
}: {
  primary: HeroPrimary;
  children: React.ReactNode;
}) {
  return (
    <HeroPrimaryContext.Provider value={primary}>
      {children}
    </HeroPrimaryContext.Provider>
  );
}

export function useHeroPrimary() {
  const primary = React.useContext(HeroPrimaryContext);
  if (!primary)
    throw new Error(
      "useHeroPrimary must be used within <HeroPrimaryProvider />"
    );
  return primary;
}
