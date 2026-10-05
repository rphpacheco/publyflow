import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Bucket, Period } from "@/lib/dashboard/period";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export interface PeriodMetricsDto {
  inquiriesReceived: number; inquiriesConverted: number; conversionRate: number | null;
  opportunitiesCreated: number; wonCount: number; wonCents: number; lostCount: number;
  winRate: number | null; averageTicketCents: number | null; averageDaysToClose: number | null;
}
export interface DashboardMetricsDto {
  period: Period; previousPeriod: Period;
  current: PeriodMetricsDto; previous: PeriodMetricsDto;
  series: { bucket: Bucket; points: Array<{ start: string; wonCents: number; wonCount: number }> };
  openNow: { count: number; valueCents: number };
  funnel: Array<{ stage: OpportunityStage; count: number }>;
  creators: Array<{ creatorId: string; name: string; openOpportunities: number; proposalsSent: number; wonCount: number; wonCents: number; approvalRate: number | null }>;
}
export interface DashboardActionsDto {
  untriagedInquiries: number; clientChangesRequested: number; creatorChangesRequested: number;
  awaitingCreatorApproval: number; readyToSend: number; awaitingClient: number;
}

export const dashboardQueryKey = ["dashboard"] as const;

export function useDashboardMetrics(period: Period) {
  return useQuery({
    queryKey: [...dashboardQueryKey, "metrics", period.from, period.to],
    queryFn: () => apiFetch<DashboardMetricsDto>(`/api/dashboard/metrics?from=${period.from}&to=${period.to}`),
    placeholderData: keepPreviousData,
  });
}

export function useDashboardActions() {
  return useQuery({ queryKey: [...dashboardQueryKey, "actions"], queryFn: () => apiFetch<DashboardActionsDto>("/api/dashboard/actions") });
}
