import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateSessionRequest, type FinishSessionRequest } from "@shared/routes";

// List all sessions
export function useSessions() {
  return useQuery({
    queryKey: [api.sessions.list.path],
    queryFn: async () => {
      const res = await fetch(api.sessions.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sessions");
      return api.sessions.list.responses[200].parse(await res.json());
    },
  });
}

// Get single session
export function useSession(id: number) {
  return useQuery({
    queryKey: [api.sessions.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.sessions.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch session");
      return api.sessions.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

// Create new session
export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateSessionRequest) => {
      const res = await fetch(api.sessions.create.path, {
        method: api.sessions.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create session");
      return api.sessions.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.sessions.list.path] });
    },
  });
}

// Finish session
export function useFinishSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FinishSessionRequest }) => {
      const url = buildUrl(api.sessions.finish.path, { id });
      const res = await fetch(url, {
        method: api.sessions.finish.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to finish session");
      return api.sessions.finish.responses[200].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.sessions.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.sessions.get.path, variables.id] });
      queryClient.invalidateQueries({ queryKey: [api.progress.get.path] });
    },
  });
}

// Get progress stats
export function useProgress() {
  return useQuery({
    queryKey: [api.progress.get.path],
    queryFn: async () => {
      const res = await fetch(api.progress.get.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch progress");
      return api.progress.get.responses[200].parse(await res.json());
    },
  });
}
