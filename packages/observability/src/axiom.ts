// Axiom — structured logging + APM. Phase 0: console fallback when no
// AXIOM_TOKEN is set. Phase 1+: ship logs via Axiom's transport.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogAttrs = Record<string, unknown>;

export interface AxiomLogger {
  log(level: LogLevel, message: string, attrs?: LogAttrs): void;
  debug(message: string, attrs?: LogAttrs): void;
  info(message: string, attrs?: LogAttrs): void;
  warn(message: string, attrs?: LogAttrs): void;
  error(message: string, attrs?: LogAttrs): void;
}

const consoleLogger: AxiomLogger = {
  log(level, message, attrs) {
    const fn =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : level === "debug"
            ? console.debug
            : console.info;
    if (attrs) fn(`[${level}] ${message}`, attrs);
    else fn(`[${level}] ${message}`);
  },
  debug(m, a) {
    this.log("debug", m, a);
  },
  info(m, a) {
    this.log("info", m, a);
  },
  warn(m, a) {
    this.log("warn", m, a);
  },
  error(m, a) {
    this.log("error", m, a);
  },
};

let cached: AxiomLogger | null = null;

export function initAxiom(): AxiomLogger {
  if (cached) return cached;
  cached = consoleLogger;
  return cached;
}

export const axiomLog = (level: LogLevel, message: string, attrs?: LogAttrs) =>
  initAxiom().log(level, message, attrs);
export const logger: AxiomLogger = {
  log: (level, message, attrs) => initAxiom().log(level, message, attrs),
  debug: (m, a) => initAxiom().debug(m, a),
  info: (m, a) => initAxiom().info(m, a),
  warn: (m, a) => initAxiom().warn(m, a),
  error: (m, a) => initAxiom().error(m, a),
};
