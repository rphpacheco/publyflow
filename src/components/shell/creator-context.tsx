"use client";

import * as React from "react";
import type { Creator } from "@/repositories/creators.repository";

const STORAGE_KEY = "publyflow:selected-creator-id";

interface CreatorContextValue {
  creators: Creator[];
  selectedCreatorId: string | null;
  selectCreator: (creatorId: string) => void;
}

const CreatorContext = React.createContext<CreatorContextValue | null>(null);

export function CreatorProvider({
  creators,
  children,
}: {
  creators: Creator[];
  children: React.ReactNode;
}) {
  const [selectedCreatorId, setSelectedCreatorId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const isStoredValid = creators.some((creator) => creator.id === stored);
    setSelectedCreatorId(isStoredValid ? stored : (creators[0]?.id ?? null));
  }, [creators]);

  const selectCreator = React.useCallback((creatorId: string) => {
    setSelectedCreatorId(creatorId);
    window.localStorage.setItem(STORAGE_KEY, creatorId);
  }, []);

  const value = React.useMemo(
    () => ({ creators, selectedCreatorId, selectCreator }),
    [creators, selectedCreatorId, selectCreator],
  );

  return <CreatorContext.Provider value={value}>{children}</CreatorContext.Provider>;
}

export function useCreatorContext(): CreatorContextValue {
  const ctx = React.useContext(CreatorContext);
  if (!ctx) {
    throw new Error("useCreatorContext must be used within a CreatorProvider");
  }
  return ctx;
}
