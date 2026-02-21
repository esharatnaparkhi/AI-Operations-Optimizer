"use client";
import { useEffect, useState } from "react";
import { Lightbulb, Play, CheckCircle, X, AlertTriangle, TrendingDown, Code } from "lucide-react";
import { api, Suggestion, SimulateResult, ApplyResult } from "@/lib/api";

const TYPE_LABELS: Record<string, string> = {
  model_downgrade: "Model Downgrade",
  prompt_compress: "Prompt Compression",
  latency_optimization: "Latency",
  anomaly_alert: "⚠ Anomaly",
};

const RISK_COLORS: Record<string, string> = {
  low: "text-green-400 bg-green-400/10",
  medium: "text-yellow-400 bg-yellow-400/10",
  high: "text-red-400 bg-red-400/10",
};

function SuggestionCard({
  sug,
  onSimulate,
  onApply,
  onDismiss,
}: {
  sug: Suggestion;
  onSimulate: (id: string) => void;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const savingsLabel = sug.estimated_savings_pct
    ? `~${sug.estimated_savings_pct.toFixed(0)}% savings`
    : null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-400 rounded-full">
              {TYPE_LABELS[sug.suggestion_type] || sug.suggestion_type}
            </span>
            {sug.feature_tag && (
              <span className="text-xs px-2 py-0.5 bg-brand-600/20 text-brand-400 rounded-full">
                {sug.feature_tag}
              </span>
            )}
            {sug.accuracy_risk && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RISK_COLORS[sug.accuracy_risk]}`}>
                {sug.accuracy_risk} risk
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-white">{sug.title}</h3>
        </div>
        <button onClick={() => onDismiss(sug.id)} className="text-gray-600 hover:text-gray-400 flex-shrink-0 mt-0.5">
          <X size={14} />
        </button>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">{sug.description}</p>

      {/* Savings row */}
      {(sug.current_cost_per_day || sug.estimated_savings_pct) && (
        <div className="flex items-center gap-4 text-xs">
          {sug.current_cost_per_day && (
            <div className="text-gray-400">
              Current: <span className="text-white font-medium">${sug.current_cost_per_day.toFixed(4)}/day</span>
            </div>
          )}
          {sug.projected_cost_per_day && (
            <div className="text-gray-400">
              Projected: <span className="text-green-400 font-medium">${sug.projected_cost_per_day.toFixed(4)}/day</span>
            </div>
          )}
          {savingsLabel && (
            <div className="flex items-center gap-1 text-green-400 font-semibold">
              <TrendingDown size={12} /> {savingsLabel}
            </div>
          )}
          {sug.confidence && (
            <div className="text-gray-500">
              Confidence: {(sug.confidence * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {sug.status === "pending" && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSimulate(sug.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
          >
            <Play size={11} /> Simulate
          </button>
          <button
            onClick={() => onApply(sug.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs rounded-lg transition-colors"
          >
            <Code size={11} /> Get Snippet
          </button>
        </div>
      )}
      {sug.status === "simulated" && (
        <div className="flex gap-2 pt-1">
          <span className="text-xs text-yellow-400 flex items-center gap-1"><AlertTriangle size={11} /> Simulated</span>
          <button
            onClick={() => onApply(sug.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs rounded-lg transition-colors"
          >
            <Code size={11} /> Get Snippet
          </button>
        </div>
      )}
      {sug.status === "applied" && (
        <div className="text-xs text-green-400 flex items-center gap-1 pt-1">
          <CheckCircle size={11} /> Applied
        </div>
      )}
    </div>
  );
}

// Modal for simulation results
function SimulateModal({ result, onClose }: { result: SimulateResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Simulation Result</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>
        <div className="space-y-3 text-sm">
          <Row label="Projected daily cost" value={`$${result.projected_daily_cost.toFixed(4)}`} />
          <Row label="Projected monthly cost" value={`$${result.projected_monthly_cost.toFixed(2)}`} highlight />
          <Row label="Monthly savings" value={`$${result.savings_usd_monthly.toFixed(2)} (${result.savings_pct.toFixed(0)}%)`} green />
          <Row label="Accuracy risk" value={result.accuracy_risk} />
          <Row label="Sample size" value={`${result.sample_size} calls`} />
        </div>
        <button onClick={onClose} className="mt-5 w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
          Close
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, highlight, green }: { label: string; value: string; highlight?: boolean; green?: boolean }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-800">
      <span className="text-gray-400">{label}</span>
      <span className={`font-medium ${green ? "text-green-400" : highlight ? "text-brand-400" : "text-white"}`}>{value}</span>
    </div>
  );
}

// Modal for apply snippet
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Code Snippet</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>
        <p className="text-xs text-gray-400 mb-3">{result.message}</p>
        {result.snippet && (
          <div className="relative">
            <pre className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-xs text-green-300 overflow-auto max-h-48">
              {result.snippet}
            </pre>
            <button
              onClick={copy}
              className="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        )}
        <button onClick={onClose} className="mt-4 w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
          Close
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

  useEffect(() => {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;
    api.suggestions.list(projectId).then(setSuggestions).finally(() => setLoading(false));
  }, []);

  async function handleSimulate(id: string) {
    const res = await api.suggestions.simulate(id);
    setSimResult(res);
    setSuggestions((prev) => prev.map((s) => s.id === id ? { ...s, status: "simulated" } : s));
  }

  async function handleApply(id: string) {
    const res = await api.suggestions.apply(id);
    setApplyResult(res);
    setSuggestions((prev) => prev.map((s) => s.id === id ? { ...s, status: "applied" } : s));
  }

  async function handleDismiss(id: string) {
    await api.suggestions.dismiss(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Optimization Suggestions</h1>
        <p className="text-sm text-gray-400">Evidence-backed, low-risk recommendations from your telemetry</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : suggestions.length === 0 ? (
        <div className="text-center text-gray-500 py-16">
          <Lightbulb size={36} className="mx-auto mb-3 text-gray-700" />
          <p>No suggestions yet. The heuristic agent runs hourly.</p>
          <p className="text-xs mt-1 text-gray-600">Make sure you have data from the SDK first.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              sug={s}
              onSimulate={handleSimulate}
              onApply={handleApply}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}

      {simResult && <SimulateModal result={simResult} onClose={() => setSimResult(null)} />}
      {applyResult && <SnippetModal result={applyResult} onClose={() => setApplyResult(null)} />}
    </div>
  );
}
