// Channel naming conventions. Centralized so the server emit and client
// subscribe sites can never drift.
//
// Naming pattern:
//   private-workspace-{wsId}-{topic}-{scope?}
//   presence-workspace-{wsId}-{topic}-{scope?}
// "private-" channels require Pusher auth (just verifies the user is in
// the workspace); "presence-" channels add member tracking and are used
// when we need to know who else is online (Phase 2+ collaboration).

export const channelNames = {
  /** Tasks events (created/completed/snoozed/assigned) for a specific user. */
  inboxFor: (workspaceId: string, userId: string) =>
    `private-workspace-${workspaceId}-inbox-${userId}`,

  /** Workspace-wide leaderboard ticker. (Phase 2+) */
  leaderboard: (workspaceId: string, period: string) =>
    `private-workspace-${workspaceId}-leaderboard-${period}`,

  /** Agent thread streaming. (Phase 1 M5) */
  agentThread: (threadId: string) => `private-agent-thread-${threadId}`,
} as const;

export type ChannelName = ReturnType<(typeof channelNames)[keyof typeof channelNames]>;

// Event names used over the wire. Keep these as a single enum so server +
// client agree on shape.
export const events = {
  taskCreated: "task.created",
  taskCompleted: "task.completed",
  taskSnoozed: "task.snoozed",
  taskAssigned: "task.assigned",
  commissionReleased: "commission.released",
  commissionClawedBack: "commission.clawed_back",
  agentTextDelta: "agent.text.delta",
  agentToolProposed: "agent.tool.proposed",
  agentTurnComplete: "agent.turn.complete",
} as const;

export type EventName = (typeof events)[keyof typeof events];
