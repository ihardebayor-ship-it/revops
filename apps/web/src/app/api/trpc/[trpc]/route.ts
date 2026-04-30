import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext } from "@revops/trpc";

// Phase 0: workspace context comes from `x-workspace-id` / `x-sub-account-id`
// headers. Phase 1 M1 swaps to `[workspace]` URL routing, with these headers
// surviving as the API-key path.
const handler = (req: Request) => {
  const workspaceId = req.headers.get("x-workspace-id");
  const subAccountId = req.headers.get("x-sub-account-id");
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () =>
      createContext({
        headers: req.headers,
        workspaceId: workspaceId || null,
        subAccountId: subAccountId || null,
      }),
  });
};

export { handler as GET, handler as POST };
