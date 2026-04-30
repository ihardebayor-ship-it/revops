import { serve } from "inngest/next";
import { inngest, functions } from "@revops/jobs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
