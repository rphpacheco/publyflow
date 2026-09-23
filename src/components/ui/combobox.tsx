"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";

export interface ComboboxProps<T> {
  items: T[];
  getLabel: (item: T) => string;
  getValue: (item: T) => string;
  value: string | null;
  onSelect: (item: T) => void;
  placeholder?: string;
  emptyText?: string;
  onCreateNew?: (name: string) => void;
  createLabel?: (name: string) => string;
  className?: string;
}

function Combobox<T>({
  items,
  getLabel,
  getValue,
  value,
  onSelect,
  placeholder = "Selecionar...",
  emptyText = "Nenhum resultado encontrado.",
  onCreateNew,
  createLabel = (name) => `Criar "${name}"`,
  className,
}: ComboboxProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = items.find((item) => getValue(item) === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? items.filter((item) => getLabel(item).toLowerCase().includes(normalizedQuery))
    : items;
  const hasExactMatch = items.some((item) => getLabel(item).toLowerCase() === normalizedQuery);
  const showCreateOption = Boolean(onCreateNew) && normalizedQuery.length > 0 && !hasExactMatch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-11 w-full justify-between font-normal md:h-9", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? getLabel(selected) : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar..." value={query} onValueChange={setQuery} />
          <CommandList>
            {filtered.length === 0 && !showCreateOption ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : null}
            <CommandGroup>
              {filtered.map((item) => (
                <CommandItem
                  key={getValue(item)}
                  onSelect={() => {
                    onSelect(item);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      getValue(item) === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {getLabel(item)}
                </CommandItem>
              ))}
              {showCreateOption ? (
                <CommandItem
                  onSelect={() => {
                    onCreateNew!(query.trim());
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {createLabel(query.trim())}
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
