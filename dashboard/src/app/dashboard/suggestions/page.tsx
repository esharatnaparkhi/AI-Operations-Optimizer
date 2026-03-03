"use client";
import { useEffect, useState } from "react";
import { Lightbulb, Play, CheckCircle, X, AlertTriangle, TrendingDown, Code, ArrowRight, Info } from "lucide-react";
import { api, Project, Suggestion, SimulateResult, ApplyResult } from "@/lib/api";

function getModeHint(mode: string | undefined): { banner: string; emptyTitle: string; emptyDetail: string } {
  const m = mode || "instant";
  if (m === "instant") {
    return {
      banner: "New tips appear right away whenever we spot a savings opportunity.",
      emptyTitle: "No tips yet",
      emptyDetail: "Use your app as normal — tips will appear here as soon as we spot a way to save you money or speed things up.",
    };
  }
  if (/^\d+h$/.test(m)) {
    const n = m.replace("h", "");
    const label = m === "24h" ? "24 hours" : `${n} hours`;
    return {
      banner: `Tips refresh every ${label}.`,
      emptyTitle: "No tips yet",
      emptyDetail: `Tips refresh every ${label}. Keep using your app and check back soon.`,
    };
  }
  return {
    banner: "Tips are generated periodically.",
    emptyTitle: "No tips yet",
    emptyDetail: "Use your app as normal and tips will appear here.",
  };
}

const TYPE_LABELS: Record<string, string> = {
  model_downgrade: "Save money on AI costs",
  prompt_compress: "Shorten your prompts",
  latency_optimization: "Speed up AI responses",
  anomaly_alert: "Unusual spending detected",
};

const TYPE_ICONS: Record<string, string> = {
  model_downgrade: "💰",
  prompt_compress: "✂️",
  latency_optimization: "⚡",
  anomaly_alert: "🔔",
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  model_downgrade: "A less expensive AI model can handle this task just as well — no noticeable quality difference",
  prompt_compress: "Your messages to the AI are longer than needed. Trimming them saves money on every call",
  latency_optimization: "Your AI responses are taking longer than expected. These changes may help speed things up",
  anomaly_alert: "Your AI spending jumped unexpectedly — something may need attention",
};

const RISK_COLORS: Record<string, string> = {
  low: "text-green-400 bg-green-400/10 border-green-400/20",
  medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  high: "text-red-400 bg-red-400/10 border-red-400/20",
};

const RISK_LABELS: Record<string, string> = {
  low: "Safe to apply",
  medium: "Review before applying",
  high: "Test carefully first",
};

/** Convert a per-day cost to a human-friendly monthly estimate. */
function formatCost(perDay: number): string {
  const monthly = perDay * 30;
  if (monthly < 0.01) return "<$0.01/mo";
  if (monthly < 10) return `~$${monthly.toFixed(2)}/mo`;
  return `~$${monthly.toFixed(1)}/mo`;
}

function confidenceLabel(c: number): string {
  if (c >= 0.85) return "High confidence";
  if (c >= 0.65) return "Moderate confidence";
  return "Low confidence";
}

function SuggestionCard({
  sug,
  onSimulate,
  onApply,
  onDismiss,
  simulating,
  applying,
}: {
  sug: Suggestion;
  onSimulate: (id: string) => void;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
  simulating: boolean;
  applying: boolean;
}) {
  const typeLabel = TYPE_LABELS[sug.suggestion_type] || sug.suggestion_type;
  const typeIcon = TYPE_ICONS[sug.suggestion_type] || "💡";
  const typeDesc = TYPE_DESCRIPTIONS[sug.suggestion_type];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      {/* Feature tag — shown prominently at the top */}
      {sug.feature_tag && sug.feature_tag !== "__untagged__" && (
        <div className="flex items-center gap-1.5 -mb-1">
          <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Feature</span>
          <span className="text-xs font-semibold text-brand-400 bg-brand-600/15 border border-brand-600/25 px-2 py-0.5 rounded-full">
            {sug.feature_tag}
          </span>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 text-gray-300 rounded-full font-medium">
              {typeIcon} {typeLabel}
            </span>
            {sug.accuracy_risk && (
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${RISK_COLORS[sug.accuracy_risk]}`}>
                {RISK_LABELS[sug.accuracy_risk] ?? sug.accuracy_risk}
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-white leading-snug">{sug.title}</h3>
          {typeDesc && <p className="text-xs text-gray-500 mt-0.5">{typeDesc}</p>}
        </div>
        <button
          onClick={() => onDismiss(sug.id)}
          className="text-gray-600 hover:text-gray-300 flex-shrink-0 mt-0.5 p-1 rounded hover:bg-gray-800 transition-colors"
          title="Dismiss this tip"
        >
          <X size={13} />
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-400 leading-relaxed">{sug.description}</p>

      {/* Savings row */}
      {(sug.current_cost_per_day || sug.estimated_savings_pct) && (
        <div className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1">
          {sug.current_cost_per_day && (
            <div className="text-xs">
              <span className="text-gray-500">Current cost</span>{" "}
              <span className="text-white font-medium">{formatCost(sug.current_cost_per_day)}</span>
            </div>
          )}
          {sug.projected_cost_per_day && (
            <>
              <ArrowRight size={12} className="text-gray-700 hidden sm:block" />
              <div className="text-xs">
                <span className="text-gray-500">After fix</span>{" "}
                <span className="text-green-400 font-medium">{formatCost(sug.projected_cost_per_day)}</span>
              </div>
            </>
          )}
          {sug.estimated_savings_pct && (
            <div className="flex items-center gap-1 text-green-400 font-semibold text-xs ml-auto">
              <TrendingDown size={12} />
              ~{sug.estimated_savings_pct.toFixed(0)}% cheaper
            </div>
          )}
          {sug.confidence && (
            <div className="text-gray-600 text-xs">
              {confidenceLabel(sug.confidence)}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="pt-1">
        {sug.status === "pending" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSimulate(sug.id)}
                disabled={simulating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-xs rounded-lg transition-colors border border-gray-700"
              >
                <Play size={11} />
                {simulating ? "Estimating…" : "Estimate my savings"}
              </button>
              <span className="text-gray-600 text-xs">then</span>
              <button
                onClick={() => onApply(sug.id)}
                disabled={applying}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
              >
                <Code size={11} />
                {applying ? "Getting code…" : "Get the code fix"}
              </button>
            </div>
            <p className="text-[10px] text-gray-600">
              <span className="font-medium text-gray-500">Estimate my savings</span> shows how much you could save based on your usage.{" "}
              <span className="font-medium text-gray-500">Get the code fix</span> gives you ready-to-paste code — no extra work needed.
            </p>
          </div>
        )}

        {sug.status === "simulated" && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-yellow-400 flex items-center gap-1 bg-yellow-400/10 border border-yellow-400/20 px-2.5 py-1 rounded-full">
              <AlertTriangle size={10} /> Savings estimated
            </span>
            <button
              onClick={() => onApply(sug.id)}
              disabled={applying}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
            >
              <Code size={11} />
              {applying ? "Getting code…" : "Get the code fix"}
            </button>
          </div>
        )}

        {sug.status === "applied" && (
          <div className="text-xs text-green-400 flex items-center gap-1.5 bg-green-400/10 border border-green-400/20 px-2.5 py-1.5 rounded-lg w-fit">
            <CheckCircle size={12} /> Fix applied
          </div>
        )}
      </div>
    </div>
  );
}

function SimulateModal({ result, onClose }: { result: SimulateResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-white">How much could you save?</h2>
            <p className="text-xs text-gray-500 mt-0.5">Based on your recent AI usage</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-800 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-1">
          <Row label="Your current monthly cost" value={`$${result.current_monthly_cost.toFixed(2)}`} />
          <Row label="Monthly cost after fix" value={`$${result.projected_monthly_cost.toFixed(2)}`} highlight />
          <Row label="You could save" value={`$${result.savings_usd_monthly.toFixed(2)} / month (${result.savings_pct.toFixed(0)}%)`} green />
          <Row label="Quality impact" value={RISK_LABELS[result.accuracy_risk] ?? result.accuracy_risk} />
          <Row label="Estimated from" value={`${result.sample_size} recent call${result.sample_size !== 1 ? "s" : ""}`} />
        </div>
        <p className="text-[10px] text-gray-600 mt-4 leading-relaxed">
          These are estimates based on your recent usage. Actual savings may vary depending on your call patterns.
        </p>
        <button
          onClick={onClose}
          className="mt-4 w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, highlight, green }: { label: string; value: string; highlight?: boolean; green?: boolean }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-gray-800/70">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-xs font-semibold ${green ? "text-green-400" : highlight ? "text-brand-400" : "text-white"}`}>{value}</span>
    </div>
  );
}

function SnippetModal({ result, onClose }: { result: ApplyResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    if (result.snippet) {
      navigator.clipboard.writeText(result.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-white">Your Code Fix</h2>
            <p className="text-xs text-gray-500 mt-0.5">Paste this into your code to start saving</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-800 transition-colors">
            <X size={16} />
          </button>
        </div>
        {result.snippet ? (
          <div className="relative">
            <pre className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-xs text-green-300 overflow-auto max-h-52">
              {result.snippet}
            </pre>
            <button
              onClick={copy}
              className="absolute top-2 right-2 text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-400">{result.message}</p>
        )}
        <button
          onClick={onClose}
          className="mt-4 w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export default function SuggestionsPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [simResult, setSimResult] = useState<SimulateResult | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [simulatingId, setSimulatingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;
    api.projects.list().then((ps) => {
      const p = ps.find((p) => p.id === projectId);
      if (p) setProject(p);
    });
    api.suggestions.list(projectId).then(setSuggestions).finally(() => setLoading(false));
  }, []);

  const modeHint = getModeHint(project?.suggestion_mode);

  async function handleSimulate(id: string) {
    setSimulatingId(id);
    try {
      const res = await api.suggestions.simulate(id);
      setSimResult(res);
      setSuggestions((prev) => prev.map((s) => s.id === id ? { ...s, status: "simulated" } : s));
    } finally {
      setSimulatingId(null);
    }
  }

  async function handleApply(id: string) {
    setApplyingId(id);
    try {
      const res = await api.suggestions.apply(id);
      setApplyResult(res);
      setSuggestions((prev) => prev.map((s) => s.id === id ? { ...s, status: "applied" } : s));
    } finally {
      setApplyingId(null);
    }
  }

  async function handleDismiss(id: string) {
    await api.suggestions.dismiss(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }

  const pending = suggestions.filter((s) => s.status === "pending");
  const simulated = suggestions.filter((s) => s.status === "simulated");
  const applied = suggestions.filter((s) => s.status === "applied");

  const totalDailySavings = suggestions.reduce((sum, s) => {
    if (s.current_cost_per_day && s.estimated_savings_pct) {
      return sum + (s.current_cost_per_day * s.estimated_savings_pct) / 100;
    }
    return sum;
  }, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Money-saving tips</h1>
          <p className="text-sm text-gray-400">
            Smart recommendations to cut your AI costs and speed up responses
          </p>
        </div>
        {suggestions.length > 0 && totalDailySavings > 0 && (
          <div className="bg-green-400/10 border border-green-400/20 rounded-xl px-4 py-2.5 text-right">
            <div className="text-xs text-green-500">Potential monthly savings</div>
            <div className="text-lg font-bold text-green-400">{formatCost(totalDailySavings)}</div>
          </div>
        )}
      </div>

      {/* How it works */}
      {suggestions.length > 0 && (
        <div className="flex items-start gap-2.5 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <Info size={14} className="text-brand-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400 leading-relaxed">
            <span className="text-gray-200 font-medium">How to use: </span>
            Click <span className="text-gray-200 font-medium">Estimate my savings</span> to see how much you could save,
            then <span className="text-gray-200 font-medium">Get the code fix</span> to get ready-to-paste code.{" "}
            {modeHint.banner}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : suggestions.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-12 h-12 bg-gray-900 border border-gray-800 rounded-xl flex items-center justify-center mx-auto">
            <Lightbulb size={22} className="text-gray-700" />
          </div>
          <p className="text-gray-400 font-medium">{modeHint.emptyTitle}</p>
          <p className="text-xs text-gray-600 max-w-xs mx-auto leading-relaxed">
            {modeHint.emptyDetail}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending */}
          {pending.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                New tips · {pending.length}
              </h2>
              <div className="space-y-4">
                {pending.map((s) => (
                  <SuggestionCard
                    key={s.id} sug={s}
                    onSimulate={handleSimulate}
                    onApply={handleApply}
                    onDismiss={handleDismiss}
                    simulating={simulatingId === s.id}
                    applying={applyingId === s.id}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Simulated */}
          {simulated.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Savings estimated · {simulated.length}
              </h2>
              <div className="space-y-4">
                {simulated.map((s) => (
                  <SuggestionCard
                    key={s.id} sug={s}
                    onSimulate={handleSimulate}
                    onApply={handleApply}
                    onDismiss={handleDismiss}
                    simulating={simulatingId === s.id}
                    applying={applyingId === s.id}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Applied */}
          {applied.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Changes applied · {applied.length}
              </h2>
              <div className="space-y-4">
                {applied.map((s) => (
                  <SuggestionCard
                    key={s.id} sug={s}
                    onSimulate={handleSimulate}
                    onApply={handleApply}
                    onDismiss={handleDismiss}
                    simulating={simulatingId === s.id}
                    applying={applyingId === s.id}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {simResult && <SimulateModal result={simResult} onClose={() => setSimResult(null)} />}
      {applyResult && <SnippetModal result={applyResult} onClose={() => setApplyResult(null)} />}
    </div>
  );
}
