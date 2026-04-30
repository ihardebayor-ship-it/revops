export default function AgentEvalsPage() {
  return (
    <div className="space-y-2">
      <h2 className="text-2xl font-semibold tracking-tight">Agent evals</h2>
      <p className="text-zinc-400">
        Functional + refusal eval suite results land here. Phase 1 M5 wires the runner +
        dashboard. Until then, runs are accumulated into <code>agent_eval_runs</code>.
      </p>
    </div>
  );
}
