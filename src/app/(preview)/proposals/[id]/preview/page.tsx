import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireAppSession } from "@/lib/auth/require-app-session";
import { ProposalPresentationService } from "@/services/proposal-presentation.service";
import { buildPresentation } from "@/lib/presentation/build-presentation";
import { parseThemeParam } from "@/lib/presentation/theme-param";
import { PreviewShell } from "@/components/presentation/preview-shell";

export default async function ProposalPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ theme?: string | string[] }>;
}) {
  const session = await requireAppSession();
  const { id } = await params;
  const { theme } = await searchParams;

  const source = await ProposalPresentationService.loadPreviewSource(db, session.organizationId, id);
  if (!source) notFound();

  // "now" is decided here, on the server, so buildPresentation stays pure.
  const model = buildPresentation(source.snapshot, {
    creator: source.creator,
    client: { name: source.clientName },
    issuedAt: new Date(),
  });

  return (
    <PreviewShell
      proposalId={id}
      model={model}
      savedTheme={model.theme}
      status={source.status}
      initialTheme={parseThemeParam(theme) ?? model.theme}
    />
  );
}
