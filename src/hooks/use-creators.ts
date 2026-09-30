import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface CreatorDto {
  id: string;
  displayName: string;
  instagramHandle: string | null;
  email: string;
  createdAt: string;
  userId: string;
  organizationId: string;
  access: "none" | "invited" | "active" | "team";
  lastLoginAt: string | null;
  emailEditable: boolean;
}

export interface AccessInstructionsDto {
  loginUrl: string;
  message: string;
}

export interface CreatorFormValues {
  fullName: string;
  displayName: string;
  instagramHandle: string;
  email: string;
}

export const creatorsQueryKey = ["creators"] as const;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function useCreators() {
  return useQuery({
    queryKey: creatorsQueryKey,
    queryFn: () => apiFetch<CreatorDto[]>("/api/creators"),
  });
}

export function useCreateCreator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreatorFormValues) => apiFetch<CreatorDto>("/api/creators", json("POST", values)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: creatorsQueryKey }),
  });
}

export function useUpdateCreator(creatorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { displayName: string; instagramHandle: string; email?: string }) =>
      apiFetch<CreatorDto>(`/api/creators/${creatorId}`, json("PATCH", values)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: creatorsQueryKey }),
  });
}

export function useInviteCreator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ creatorId }: { creatorId: string }) =>
      apiFetch<AccessInstructionsDto>(`/api/creators/${creatorId}/access`, { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: creatorsQueryKey }),
  });
}

export function useRevokeCreatorAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ creatorId }: { creatorId: string }) =>
      apiFetch<void>(`/api/creators/${creatorId}/access`, { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: creatorsQueryKey }),
  });
}

export function useRemindCreatorAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ creatorId }: { creatorId: string }) =>
      apiFetch<AccessInstructionsDto>(`/api/creators/${creatorId}/access/remind`, { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: creatorsQueryKey }),
  });
}
