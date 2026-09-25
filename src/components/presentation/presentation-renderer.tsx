import * as React from "react";
import { cn } from "@/lib/utils";
import type { ProposalTheme } from "@/lib/proposal-themes";
import type { PresentationAction, PresentationModel } from "@/lib/presentation/types";
import { THEMES } from "./themes";
import { ActionsSection, CoverSection, ItemsSection, TextSection, TotalSection } from "./sections";

export interface PresentationRendererProps {
  model: PresentationModel;
  /** Overrides model.theme (the preview compares themes without rebuilding the model). */
  theme?: ProposalTheme;
  /** Without a handler the action buttons are inert (preview). */
  onAction?: (action: PresentationAction) => void;
}

/**
 * Draws a proposal in a Presentation Theme. Pure presentation: no data
 * access, no font loader import, usable from Client and Server Components alike.
 * Responsive rules are container queries on this root, so a 390px frame
 * renders the phone layout even on a wide screen.
 */
export function PresentationRenderer({ model, theme, onAction }: PresentationRendererProps) {
  const definition = THEMES[theme ?? model.theme];

  return (
    <div
      data-theme={definition.id}
      className={cn("@container w-full", definition.classes.page)}
      style={{ fontFamily: definition.fonts.text }}
    >
      <article className={definition.classes.document}>
        <CoverSection model={model} theme={definition} />
        {model.body ? <TextSection body={model.body} theme={definition} /> : null}
        {model.items.length > 0 ? (
          <>
            <ItemsSection items={model.items} theme={definition} />
            <TotalSection model={model} theme={definition} />
          </>
        ) : null}
        <ActionsSection theme={definition} onAction={onAction} />
      </article>
    </div>
  );
}
