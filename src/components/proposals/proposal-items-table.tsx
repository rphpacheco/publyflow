"use client";

import * as React from "react";
import { Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { formatCurrencyBRL } from "@/lib/format";
import { useRateCardItems, type RateCardItemWithService } from "@/hooks/use-rate-card-items";
import {
  useAddProposalItem,
  useUpdateProposalItem,
  useRemoveProposalItem,
  type ProposalItem,
} from "@/hooks/use-proposal-items";

export interface ProposalItemsTableProps {
  proposalId: string;
  items: ProposalItem[];
  creatorId: string | null;
  readOnly: boolean;
}

type CatalogOption = { type: "catalog"; item: RateCardItemWithService } | { type: "adhoc" };

function reaisToCents(value: string): number {
  // BR currency is displayed as "R$ 1.500,00" (`.` thousands separator, `,` decimal separator).
  // Only strip `.` as a thousands separator when the value actually contains a decimal comma —
  // otherwise a plain dotted-decimal string like "-200.00" or "1500.00" is used as-is.
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function centsToReaisInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function ProposalItemsTable({
  proposalId,
  items,
  creatorId,
  readOnly,
}: ProposalItemsTableProps) {
  const { data: catalogItems } = useRateCardItems(creatorId ?? "", {
    enabled: creatorId !== null,
  });
  const addItem = useAddProposalItem(proposalId);
  const updateItem = useUpdateProposalItem(proposalId);
  const removeItem = useRemoveProposalItem(proposalId);

  const [adHocOpen, setAdHocOpen] = React.useState(false);
  const [adHocDescription, setAdHocDescription] = React.useState("");
  const [adHocPrice, setAdHocPrice] = React.useState("");

  const serviceNameCounts = new Map<string, number>();
  for (const item of catalogItems ?? []) {
    serviceNameCounts.set(item.serviceName, (serviceNameCounts.get(item.serviceName) ?? 0) + 1);
  }

  const catalogOptions: CatalogOption[] = [
    ...(catalogItems ?? []).map((item) => ({ type: "catalog" as const, item })),
    { type: "adhoc" as const },
  ];

  function getLabel(option: CatalogOption): string {
    if (option.type === "adhoc") return "+ Item avulso";
    const base = `${option.item.serviceName} — ${formatCurrencyBRL(option.item.price)}`;
    const isDuplicate = (serviceNameCounts.get(option.item.serviceName) ?? 0) > 1;
    return isDuplicate ? `${base} · ${option.item.rateCardName}` : base;
  }

  function getValue(option: CatalogOption): string {
    return option.type === "adhoc" ? "__adhoc__" : option.item.id;
  }

  function handleSelect(option: CatalogOption) {
    if (option.type === "adhoc") {
      setAdHocOpen(true);
      return;
    }
    addItem.mutate({ rateCardItemId: option.item.id });
  }

  function handleAdHocConfirm() {
    if (!adHocDescription.trim()) return;
    addItem.mutate(
      { description: adHocDescription.trim(), unitPrice: reaisToCents(adHocPrice) },
      {
        onSuccess: () => {
          setAdHocOpen(false);
          setAdHocDescription("");
          setAdHocPrice("");
        },
      },
    );
  }

  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Itens</span>
        {!readOnly ? (
          <Combobox<CatalogOption>
            items={catalogOptions}
            getLabel={getLabel}
            getValue={getValue}
            value={null}
            onSelect={handleSelect}
            placeholder="Adicionar item..."
            aria-label="Adicionar item"
            className="w-64"
          />
        ) : null}
      </div>

      {!readOnly && adHocOpen ? (
        <div className="flex items-end gap-2 rounded-md border border-border p-3">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="adhoc-description">
              Descrição
            </label>
            <Input
              id="adhoc-description"
              aria-label="Descrição"
              value={adHocDescription}
              onChange={(event) => setAdHocDescription(event.target.value)}
              placeholder="Ex: Desconto negociado"
            />
          </div>
          <div className="flex w-32 flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="adhoc-price">
              Preço (R$)
            </label>
            <Input
              id="adhoc-price"
              aria-label="Preço (R$)"
              value={adHocPrice}
              onChange={(event) => setAdHocPrice(event.target.value)}
              placeholder="-200.00"
            />
          </div>
          <Button onClick={handleAdHocConfirm} disabled={!adHocDescription.trim()}>
            Adicionar
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nenhum item ainda"
          description="Adicione o primeiro item da proposta usando o campo acima."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Qtd.</TableHead>
              <TableHead>Preço unit.</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <ProposalItemRow
                key={item.id}
                item={item}
                readOnly={readOnly}
                onUpdate={(input) => updateItem.mutate({ itemId: item.id, ...input })}
                onRemove={() => removeItem.mutate(item.id)}
              />
            ))}
          </TableBody>
        </Table>
      )}

      {items.length > 0 ? (
        <div className="flex justify-end gap-2 border-t border-border pt-2 text-sm font-medium">
          <span>Total:</span>
          <span>{formatCurrencyBRL(total)}</span>
        </div>
      ) : null}
    </div>
  );
}

interface ProposalItemRowProps {
  item: ProposalItem;
  readOnly: boolean;
  onUpdate: (input: { quantity?: number; unitPrice?: number }) => void;
  onRemove: () => void;
}

function ProposalItemRow({ item, readOnly, onUpdate, onRemove }: ProposalItemRowProps) {
  const [quantity, setQuantity] = React.useState(String(item.quantity));
  const [price, setPrice] = React.useState(centsToReaisInput(item.unitPrice));

  React.useEffect(() => {
    setQuantity(String(item.quantity));
  }, [item.quantity]);

  React.useEffect(() => {
    setPrice(centsToReaisInput(item.unitPrice));
  }, [item.unitPrice]);

  function handleQuantityBlur() {
    const parsed = Number.parseInt(quantity, 10);
    if (!Number.isFinite(parsed) || parsed === item.quantity || parsed < 1) {
      setQuantity(String(item.quantity));
      return;
    }
    onUpdate({ quantity: parsed });
  }

  function handlePriceBlur() {
    const normalized = price.includes(",") ? price.replace(/\./g, "").replace(",", ".") : price;
    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed)) {
      setPrice(centsToReaisInput(item.unitPrice));
      return;
    }
    const cents = reaisToCents(price);
    if (cents === item.unitPrice) return;
    onUpdate({ unitPrice: cents });
  }

  return (
    <TableRow>
      <TableCell>{item.description}</TableCell>
      <TableCell>
        <Input
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          onBlur={handleQuantityBlur}
          disabled={readOnly}
          className="w-16"
          aria-label={`Quantidade de ${item.description}`}
        />
      </TableCell>
      <TableCell>
        <Input
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          onBlur={handlePriceBlur}
          disabled={readOnly}
          className="w-28"
          aria-label={`Preço unitário de ${item.description}`}
        />
      </TableCell>
      <TableCell>
        {!readOnly ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Remover ${item.description}`}>
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover este item?</AlertDialogTitle>
                <AlertDialogDescription>
                  &quot;{item.description}&quot; será removido da proposta. Essa ação não pode ser
                  desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancelar</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button onClick={onRemove}>Remover</Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
