"use client";
import { useEffect, useState } from "react";
import { Lightbulb, Play, CheckCircle, X, AlertTriangle, TrendingDown, Code, ArrowRight, Info } from "lucide-react";
import { api, Suggestion, SimulateResult, ApplyResult } from "@/lib/api";

const TYPE_LABELS: Record<string, string> = {
  model_downgrade: "Cheaper model",
  prompt_compress: "Shorter prompts",
  latency_optimization: "Latency fix",
  anomaly_alert: "Anomaly detected",
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  model_downgrade: "Switch to a lower-cost model for this feature without meaningful accuracy loss",
  prompt_compress: "Reduce token usage by compressing or trimming prompts",
  latency_optimization: "Changes that reduce average response time",
  anomaly_alert: "Unusual spike in cost or latency detected",
};

const RISK_COLORS: Record<string, string> = {
  low: "text-green-400 bg-green-400/10 border-green-400/20",
  medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  high: "text-red-400 bg-red-400/10 border-red-400/20",
};

const RISK_LABELS: Record<string, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

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
  const typeDesc = TYPE_DESCRIPTIONS[sug.suggestion_type];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 text-gray-300 rounded-full font-medium">
              {typeLabel}
            </span>
            {sug.feature_tag && sug.feature_tag !== "__untagged__" && (
              <span className="text-xs px-2 py-0.5 bg-brand-600/20 border border-brand-600/30 text-brand-400 rounded-full">
                {sug.feature_tag}
              </span>
            )}
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
          title="Dismiss this suggestion"
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
              <span className="text-gray-500">Current</span>{" "}
              <span className="text-white font-medium">${sug.current_cost_per_day.toFixed(7)}/day</span>
            </div>
          )}
          {sug.projected_cost_per_day && (
            <>
              <ArrowRight size={12} className="text-gray-700 hidden sm:block" />
              <div className="text-xs">
                <span className="text-gray-500">Projected</span>{" "}
                <span className="text-green-400 font-medium">${sug.projected_cost_per_day.toFixed(7)}/day</span>
              </div>
            </>
          )}
          {sug.estimated_savings_pct && (
            <div className="flex items-center gap-1 text-green-400 font-semibold text-xs ml-auto">
              <TrendingDown size={12} />
              ~{sug.estimated_savings_pct.toFixed(0)}% savings
            </div>
          )}
          {sug.confidence && (
            <div className="text-gray-600 text-xs">
              {(sug.confidence * 100).toFixed(0)}% confidence
            </div>
          )}
        </div>
      )}

      {/* Actions — show workflow clearly */}
      <div className="pt-1">
        {sug.status === "pending" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {/* Step 1 */}
              <button
                onClick={() => onSimulate(sug.id)}
                disabled={simulating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-xs rounded-lg transition-colors border border-gray-700"
              >
                <Play size={11} />
                {simulating ? "Calculating…" : "Preview savings"}
              </button>
              <span className="text-gray-600 text-xs">then</span>
              {/* Step 2 */}
              <button
                onClick={() => onApply(sug.id)}
                disabled={applying}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
              >
                <Code size={11} />
                {applying ? "Generating…" : "Apply & get code"}
              </button>
            </div>
            <p className="text-[10px] text-gray-600">
              <span className="font-medium text-gray-500">Preview savings</span> runs a simulation to estimate cost reduction.
              <span className="font-medium text-gray-500 ml-1">Apply & get code</span> generates a drop-in code snippet.
            </p>
          </div>
        )}

        {sug.status === "simulated" && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-yellow-400 flex items-center gap-1 bg-yellow-400/10 border border-yellow-400/20 px-2.5 py-1 rounded-full">
              <AlertTriangle size={10} /> Savings previewed
            </span>
            <button
              onClick={() => onApply(sug.id)}
              disabled={applying}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
            >
              <Code size={11} />
              {applying ? "Generating…" : "Apply & get code"}
            </button>
          </div>
        )}

        {sug.status === "applied" && (
          <div className="text-xs text-green-400 flex items-center gap-1.5 bg-green-400/10 border border-green-400/20 px-2.5 py-1.5 rounded-lg w-fit">
            <CheckCircle size={12} /> Code snippet applied
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
            <h2 className="font-semibold text-white">Savings Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5">Projected impact based on your recent usage</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-800 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-1">
          <Row label="Projected daily cost" value={`$${result.projected_daily_cost.toFixed(7)}`} />
          <Row label="Projected monthly cost" value={`$${result.projected_monthly_cost.toFixed(2)}`} highlight />
          <Row label="Monthly savings" value={`$${result.savings_usd_monthly.toFixed(2)} (${result.savings_pct.toFixed(0)}%)`} green />
          <Row label="Accuracy risk" value={RISK_LABELS[result.accuracy_risk] ?? result.accuracy_risk} />
          <Row label="Based on" value={`${result.sample_size} recent calls`} />
        </div>
        <p className="text-[10px] text-gray-600 mt-4 leading-relaxed">
          This is a projection. Actual savings depend on your call patterns and prompt sizes.
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
            <h2 className="font-semibold text-white">Code Snippet</h2>
            <p className="text-xs text-gray-500 mt-0.5">Copy this into your codebase to apply the optimisation</p>
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [simResult, setSimResult] = useState<SimulateResult | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [simulatingId, setSimulatingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;
    api.suggestions.list(projectId).then(setSuggestions).finally(() => setLoading(false));
  }, []);

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

  const totalPotentialSavings = suggestions.reduce((sum, s) => {
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
          <h1 className="text-xl font-bold text-white">Suggestions</h1>
          <p className="text-sm text-gray-400">
            AI-generated recommendations based on your telemetry data
          </p>
        </div>
        {suggestions.length > 0 && totalPotentialSavings > 0 && (
          <div className="bg-green-400/10 border border-green-400/20 rounded-xl px-4 py-2.5 text-right">
            <div className="text-xs text-green-500">Potential daily savings</div>
            <div className="text-lg font-bold text-green-400">${totalPotentialSavings.toFixed(7)}</div>
          </div>
        )}
      </div>

      {/* How it works */}
      {suggestions.length > 0 && (
        <div className="flex items-start gap-2.5 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <Info size={14} className="text-brand-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400 leading-relaxed">
            <span className="text-gray-200 font-medium">How to use: </span>
            Click <span className="text-gray-200 font-medium">Preview savings</span> to see a cost projection,
            then <span className="text-gray-200 font-medium">Apply & get code</span> to receive a drop-in code snippet.
            Suggestions are generated hourly by the heuristic agent.
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
          <p className="text-gray-400 font-medium">No suggestions yet</p>
          <p className="text-xs text-gray-600 max-w-xs mx-auto leading-relaxed">
            The heuristic agent runs once an hour. Make sure you have several days of SDK data first — it needs enough history to spot patterns.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending */}
          {pending.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Action needed · {pending.length}
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
                Previewed · {simulated.length}
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
                Applied · {applied.length}
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
