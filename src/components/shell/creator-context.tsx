"use client";

import * as React from "react";

type SwitcherCreator = { id: string; displayName: string };

// Namespaced by organizationId -- the id comes from the session's single
// organization (v1 has exactly one organization per session, no
// switching), so the namespacing just keeps the key scoped to that
// organization rather than being a flat, unscoped key.
function storageKey(organizationId: string): string {
  return `publyflow:${organizationId}:selected-creator-id`;
}

interface CreatorContextValue {
  creators: SwitcherCreator[];
  selectedCreatorId: string | null;
  selectCreator: (creatorId: string) => void;
}

const CreatorContext = React.createContext<CreatorContextValue | null>(null);

export function CreatorProvider({
  organizationId,
  creators,
  children,
}: {
  organizationId: string;
  creators: SwitcherCreator[];
  children: React.ReactNode;
}) {
  const [selectedCreatorId, setSelectedCreatorId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(storageKey(organizationId));
    const isStoredValid = creators.some((creator) => creator.id === stored);
    setSelectedCreatorId(isStoredValid ? stored : (creators[0]?.id ?? null));
  }, [organizationId, creators]);

  const selectCreator = React.useCallback(
    (creatorId: string) => {
      setSelectedCreatorId(creatorId);
      window.localStorage.setItem(storageKey(organizationId), creatorId);
    },
    [organizationId],
  );

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
