import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface TeamMemberDto {
  id: string;
  fullName: string;
  email: string;
  role: "OWNER" | "MANAGER";
  status: "invited" | "active";
  isSelf: boolean;
}

export interface TeamAccessInstructionsDto {
  loginUrl: string;
  message: string;
}

export const teamQueryKey = ["team"] as const;

export function useTeam() {
  return useQuery({
    queryKey: teamQueryKey,
    queryFn: () => apiFetch<TeamMemberDto[]>("/api/team"),
  });
}

export function useInviteManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { fullName: string; email: string }) =>
      apiFetch<{ member: TeamMemberDto } & TeamAccessInstructionsDto>("/api/team/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: teamQueryKey }),
  });
}

export function useRemindManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId }: { memberId: string }) =>
      apiFetch<TeamAccessInstructionsDto>(`/api/team/members/${memberId}/remind`, { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: teamQueryKey }),
  });
}

export function useRemoveManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId }: { memberId: string }) =>
      apiFetch<void>(`/api/team/members/${memberId}`, { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: teamQueryKey }),
  });
}
