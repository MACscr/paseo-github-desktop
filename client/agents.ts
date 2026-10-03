import { usePaseo } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { reviewMessage, type ReviewComment, toAttachments } from "./review";

export interface WorkspaceAgent {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

/** The workspace's agents, most recently active first. Subagents are left out; reviews go to a top-level agent. */
export function useWorkspaceAgents(workspaceId: string) {
  const paseo = usePaseo();
  return useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: async (): Promise<WorkspaceAgent[]> => {
      const { entries } = await paseo.agents.list({
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 200 },
      });
      return entries
        .map((entry) => entry.agent)
        .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt && !agent.labels?.["paseo.parent-agent-id"])
        .map((agent) => ({
          id: agent.id,
          title: agent.title || `${agent.provider} agent`,
          status: agent.status,
          updatedAt: agent.updatedAt,
        }));
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

export function useSendReview() {
  const paseo = usePaseo();
  return useMutation({
    mutationFn: async ({
      agentId,
      cwd,
      comments,
      note,
    }: {
      agentId: string;
      cwd: string;
      comments: readonly ReviewComment[];
      note: string;
    }) => {
      // Steer rather than interrupt, so a review sent mid-turn joins the agent's current work.
      await paseo.agents.ref(agentId).send(reviewMessage(comments, note), {
        activeTurnBehavior: "steer",
        attachments: toAttachments(cwd, comments),
      });
    },
  });
}
