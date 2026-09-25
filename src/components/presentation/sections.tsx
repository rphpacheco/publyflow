import * as React from "react";
import { cn } from "@/lib/utils";
import type { PresentationAction, PresentationItem, PresentationModel } from "@/lib/presentation/types";
import type { ThemeDefinition } from "./theme-types";

function creatorLine(model: PresentationModel): string {
  return [model.creator.name, model.creator.handle].filter(Boolean).join(" · ");
}

export function CoverSection({ model, theme }: { model: PresentationModel; theme: ThemeDefinition }) {
  const c = theme.classes;
  const ui = { fontFamily: theme.fonts.ui };
  const headline = (
    <h1 className={c.headline} style={{ fontFamily: theme.fonts.display }}>
      {model.headline}
    </h1>
  );

  switch (theme.cover) {
    case "centered":
      return (
        <header className="flex flex-col items-center text-center">
          <p className={c.eyebrow} style={ui}>
            {model.clientName ? `Proposta comercial · ${model.clientName}` : "Proposta comercial"}
          </p>
          {headline}
          <p className={c.byline}>por {creatorLine(model)}</p>
          <div className={c.rule} aria-hidden="true" />
        </header>
      );
    case "split-meta":
      return (
        <header>
          <div className={cn("flex flex-wrap justify-between gap-2", c.meta)} style={ui}>
            <span>{creatorLine(model)}</span>
            {model.clientName ? <span>Proposta para {model.clientName}</span> : null}
          </div>
          {headline}
          <p className={cn("mt-3", c.meta)} style={ui}>
            {model.issuedAtLabel}
          </p>
        </header>
      );
    case "masthead":
      return (
        <header>
          <div className={cn("flex flex-wrap justify-between gap-2", c.eyebrow)} style={ui}>
            <span>{model.creator.name}</span>
            <span>{model.issuedAtLabel}</span>
            {model.clientName ? <span>{model.clientName}</span> : null}
          </div>
          <div className={c.rule} aria-hidden="true" />
          {headline}
          {model.headline !== model.title ? <p className={c.byline}>{model.title}</p> : null}
        </header>
      );
    case "block":
      return (
        <header className={c.coverBox}>
          <p className={c.eyebrow} style={ui}>
            {model.clientName ? `${model.clientName} × ${model.creator.name}` : model.creator.name}
          </p>
          {headline}
          <p className={c.byline} style={ui}>
            Proposta · {model.issuedAtLabel}
          </p>
        </header>
      );
    case "card":
      return (
        <header className={c.coverBox}>
          {model.clientName ? (
            <p className={c.eyebrow} style={ui}>
              Proposta para {model.clientName}
            </p>
          ) : null}
          {headline}
          <p className={c.byline}>por {creatorLine(model)}</p>
        </header>
      );
    case "bar":
      return (
        <header className="flex flex-col gap-5">
          <div className={c.coverBox} style={ui}>
            <span>Proposta comercial</span>
            <span>{model.issuedAtLabel}</span>
          </div>
          <dl className={cn("grid grid-cols-2 gap-3 @xl:grid-cols-3", c.meta)} style={ui}>
            {model.clientName ? (
              <div>
                <dt>Cliente</dt>
                <dd className="font-semibold text-[#1B2433]">{model.clientName}</dd>
              </div>
            ) : null}
            <div>
              <dt>Creator</dt>
              <dd className="font-semibold text-[#1B2433]">{creatorLine(model)}</dd>
            </div>
            <div>
              <dt>Emitida em</dt>
              <dd className="font-semibold text-[#1B2433]">{model.issuedAtLabel}</dd>
            </div>
          </dl>
          {headline}
        </header>
      );
  }
}

export function TextSection({ body, theme }: { body: string; theme: ThemeDefinition }) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return (
    <section className={theme.classes.body}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </section>
  );
}

function ItemsTable({ items, theme }: { items: PresentationItem[]; theme: ThemeDefinition }) {
  const c = theme.classes;
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <thead style={{ fontFamily: theme.fonts.ui }}>
        <tr className={c.itemDetail}>
          <th scope="col" className="px-2 py-2 font-semibold">Entrega</th>
          <th scope="col" className="w-12 whitespace-nowrap px-2 py-2 text-right font-semibold">Qtd</th>
          <th scope="col" className="hidden whitespace-nowrap px-2 py-2 text-right font-semibold @xl:table-cell @xl:w-32">Unitário</th>
          <th scope="col" className="w-32 whitespace-nowrap px-2 py-2 text-right font-semibold">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => (
          <tr key={index} className={c.item}>
            <td className={cn("px-2 py-2", c.itemName)}>
              <span>{item.description}</span>
            </td>
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{item.quantity}</td>
            <td className="hidden whitespace-nowrap px-2 py-2 text-right tabular-nums @xl:table-cell">{item.unitPriceLabel}</td>
            <td className={cn("whitespace-nowrap px-2 py-2 text-right tabular-nums", c.itemAmount)}>{item.subtotalLabel}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const LIST_LAYOUT: Record<Exclude<ThemeDefinition["items"], "table">, string> = {
  lines: "flex flex-col",
  numbered: "flex flex-col",
  grid: "grid grid-cols-1 gap-3 @xl:grid-cols-2",
  cards: "flex flex-col gap-2",
};

export function ItemsSection({ items, theme }: { items: PresentationItem[]; theme: ThemeDefinition }) {
  const c = theme.classes;
  const display = { fontFamily: theme.fonts.display };
  const ui = { fontFamily: theme.fonts.ui };

  return (
    <section className={c.itemsBox} aria-label="Entregas">
      <h2 className={c.sectionLabel} style={ui}>
        Entregas
      </h2>
      {theme.items === "table" ? (
        <ItemsTable items={items} theme={theme} />
      ) : (
        <ul className={LIST_LAYOUT[theme.items]}>
          {items.map((item, index) => (
            <li key={index} className={c.item}>
              <div className="min-w-0">
                <p className={c.itemName} style={display}>
                  {theme.items === "numbered" ? (
                    <span aria-hidden="true">{String(index + 1).padStart(2, "0")} — </span>
                  ) : null}
                  <span>{item.description}</span>
                </p>
                <p className={c.itemDetail} style={ui}>
                  {item.quantity} × {item.unitPriceLabel}
                </p>
              </div>
              <p className={cn("shrink-0 whitespace-nowrap tabular-nums", c.itemAmount)} style={display}>
                {item.subtotalLabel}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TotalSection({ model, theme }: { model: PresentationModel; theme: ThemeDefinition }) {
  const c = theme.classes;
  return (
    <section className={c.totalBox} aria-label="Total">
      <p className={c.totalLabel} style={{ fontFamily: theme.fonts.ui }}>
        Total
      </p>
      <p className={cn("whitespace-nowrap tabular-nums", c.totalAmount)} style={{ fontFamily: theme.fonts.display }}>
        {model.totalLabel}
      </p>
    </section>
  );
}

const ACTIONS: Array<{ id: PresentationAction; label: string }> = [
  { id: "accept", label: "Aceitar" },
  { id: "request_changes", label: "Pedir ajustes" },
  { id: "reject", label: "Recusar" },
];

export function ActionsSection({
  theme,
  onAction,
}: {
  theme: ThemeDefinition;
  onAction?: (action: PresentationAction) => void;
}) {
  return (
    <div className={theme.classes.actions} style={{ fontFamily: theme.fonts.ui }}>
      {ACTIONS.map((action, index) => (
        <button
          key={action.id}
          type="button"
          className={index === 0 ? theme.classes.ctaPrimary : theme.classes.ctaSecondary}
          aria-disabled={onAction ? undefined : true}
          onClick={onAction ? () => onAction(action.id) : undefined}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
