import { createHmac, timingSafeEqual } from "node:crypto";

export type SignatureAlgo = "sha256" | "sha1";

export function verifyHmacSignature(opts: {
  payload: string | Buffer;
  signature: string;
  secret: string;
  algo?: SignatureAlgo;
  prefix?: string;
}): boolean {
  const algo = opts.algo ?? "sha256";
  const computed = createHmac(algo, opts.secret).update(opts.payload).digest("hex");
  const provided = opts.prefix ? opts.signature.replace(opts.prefix, "") : opts.signature;
  if (computed.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}
