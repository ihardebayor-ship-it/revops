// Inngest client. Used by every Inngest function in `./functions/`.
// See ARCHITECTURE.md §10 for the spine pattern.
import { Inngest } from "inngest";

export type AppEvents = {
  "agent.turn.requested": {
    data: {
      threadId: string;
      userId: string;
      workspaceId: string;
      turnId: string;
      message: string;
    };
  };
  "webhook.received": {
    data: {
      source: string;
      externalId: string;
      payload: Record<string, unknown>;
      receivedAt: string;
    };
  };
  "commission.recompute.requested": {
    data: {
      saleId: string;
      reason: string;
    };
  };
  "oauth.refresh.requested": {
    data: {
      connectionId: string;
      provider: string;
      reason: string;
    };
  };
  "ghl.webhook.received": {
    data: {
      inboundEventId: string;
    };
  };
  "aircall.webhook.received": {
    data: {
      inboundEventId: string;
    };
  };
  "fathom.webhook.received": {
    data: {
      inboundEventId: string;
    };
  };
  "ghl.backfill.requested": {
    data: {
      connectionId: string;
      sinceDays: number;
    };
  };
};

export const inngest = new Inngest({
  id: "revops-pro",
  schemas: {
    fromRecord<T>() {
      return {} as T;
    },
  } as never,
});
