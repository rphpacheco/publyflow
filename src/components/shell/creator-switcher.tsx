"use client";

import Link from "next/link";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCreatorContext } from "./creator-context";
import { useIsCreator } from "./session-role-context";

export function CreatorSwitcher() {
  const { creators, selectedCreatorId, selectCreator } = useCreatorContext();
  const isCreator = useIsCreator();
  const selected = creators.find((creator) => creator.id === selectedCreatorId);

  if (isCreator) {
    return <span className="text-sm font-medium">{creators[0]?.displayName ?? ""}</span>;
  }

  if (creators.length === 0) {
    return (
      <Link href="/creators" className="text-sm text-primary underline-offset-4 hover:underline">
        Cadastrar creator
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-11 min-w-0 justify-between gap-2 px-3 md:h-9">
          <span className="max-w-[10rem] truncate">
            {selected?.displayName ?? "Selecionar creator"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Creators</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {creators.map((creator) => (
          <DropdownMenuItem
            key={creator.id}
            onSelect={() => selectCreator(creator.id)}
            className="justify-between"
          >
            {creator.displayName}
            {creator.id === selectedCreatorId && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
