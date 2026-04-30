import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "./server";

export const { GET, POST } = toNextJsHandler(getAuth());
