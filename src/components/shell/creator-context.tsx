"use client";

import * as React from "react";
import type { Creator } from "@/repositories/creators.repository";

// Namespaced by organizationId so each organization remembers its own
// selection independently once multi-org accounts exist (auth isn't
// implemented yet -- today this only ever sees the single dev
// organization from getDevOrganizationId(), but a flat key would collide
// across organizations the moment a user can belong to more than one).
function storageKey(organizationId: string): string {
  return `publyflow:${organizationId}:selected-creator-id`;
}

interface CreatorContextValue {
  creators: Creator[];
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
  creators: Creator[];
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
