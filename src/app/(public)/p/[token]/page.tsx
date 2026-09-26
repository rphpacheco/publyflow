import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { PublicProposalService } from "@/services/public-proposal.service";
import { buildPresentation } from "@/lib/presentation/build-presentation";
import { presentResponse } from "@/lib/presentation/present-response";
import { formatIssuedAt } from "@/lib/presentation/format";
import { PublicProposalView } from "@/components/presentation/public-proposal-view";

export const dynamic = "force-dynamic";

// One load per request, shared by generateMetadata and the page.
const load = cache((token: string) => PublicProposalService.loadByToken(db, token));

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const result = await load(token);
  return {
    title: result.state === "available" ? result.title : "PublyFlow",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await load(token);

  if (result.state === "not_found") notFound();
  if (result.state === "unavailable") {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">Esta proposta não está mais disponível.</p>
      </main>
    );
  }

  // The loader already normalized issuedAt to a Date: buildPresentation stays pure.
  const model = buildPresentation(result.snapshot, {
    creator: result.context.creator,
    client: { name: result.context.clientName },
    issuedAt: result.context.issuedAt,
  });

  return (
    <PublicProposalView
      token={token}
      model={model}
      publicationId={result.publicationId}
      versionNumber={result.versionNumber}
      publishedAtLabel={formatIssuedAt(result.publishedAt)}
      response={result.response ? presentResponse(result.response) : null}
    />
  );
}
