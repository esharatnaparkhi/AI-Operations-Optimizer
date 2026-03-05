"use client";
import { useEffect, useState } from "react";
import { Lightbulb, CheckCircle, X, TrendingDown, ArrowRight, Info, Copy, Check } from "lucide-react";
import { api, Project, Suggestion, SimulateResult, ApplyResult } from "@/lib/api";

// ── Lookup tables ──────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  model_downgrade:      "Reduce AI cost",
  prompt_compress:      "Shorten prompts",
  latency_optimization: "Speed up responses",
  anomaly_alert:        "Unusual spending detected",
};

const TYPE_ICONS: Record<string, string> = {
  model_downgrade:      "💰",
  prompt_compress:      "✂️",
  latency_optimization: "⚡",
  anomaly_alert:        "🔔",
};

const RISK_BADGE: Record<string, string> = {
  low:    "text-emerald-700 bg-emerald-50 border-emerald-200",
  medium: "text-amber-700 bg-amber-50 border-amber-200",
  high:   "text-red-600 bg-red-50 border-red-200",
};

const RISK_LABELS: Record<string, string> = {
  low:    "Low risk",
  medium: "Review first",
  high:   "Test carefully",
};

function formatMonthly(perDay: number): string {
  const m = perDay * 30;
  if (m < 0.001) return "<$0.001/mo";
  if (m < 10)    return `$${m.toFixed(3)}/mo`;
  return `$${m.toFixed(2)}/mo`;
}

// ── Suggestion card ────────────────────────────────────────────

function SuggestionCard({
  sug, onGetFix, onDismiss, loading,
}: {
  sug: Suggestion;
  onGetFix: (id: string) => void;
  onDismiss: (id: string) => void;
  loading: boolean;
}) {
  const icon  = TYPE_ICONS[sug.suggestion_type]  || "💡";
  const label = TYPE_LABELS[sug.suggestion_type] || sug.suggestion_type;
  const hasCosts = sug.current_cost_per_day != null && sug.projected_cost_per_day != null;

  return (
    <div className="card card-hover p-5 space-y-3.5">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs px-2.5 py-0.5 bg-base-card border border-base-border2 text-ink-body rounded-full font-medium">
            {icon} {label}
          </span>
          {sug.feature_tag && sug.feature_tag !== "__untagged__" && (
            <span className="text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 px-2.5 py-0.5 rounded-full">
              {sug.feature_tag}
            </span>
          )}
          {sug.accuracy_risk && (
            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${RISK_BADGE[sug.accuracy_risk] ?? ""}`}>
              {RISK_LABELS[sug.accuracy_risk] ?? sug.accuracy_risk}
            </span>
          )}
        </div>
        <button
          onClick={() => onDismiss(sug.id)}
          className="text-ink-muted hover:text-ink-icon p-1 rounded-lg hover:bg-base-card transition-colors flex-shrink-0 mt-0.5"
          title="Dismiss"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </div>

      {/* Title + description */}
      <div>
        <h3 className="text-sm font-semibold text-ink-primary leading-snug">{sug.title}</h3>
        <p className="text-xs text-ink-body mt-1 leading-relaxed">{sug.description}</p>
      </div>

      {/* Cost strip */}
      {hasCosts && (
        <div className="inner-surface flex items-center gap-3 flex-wrap text-xs px-3 py-2.5">
          <span className="text-ink-muted">
            Current <span className="text-ink-primary font-semibold">{formatMonthly(sug.current_cost_per_day!)}</span>
          </span>
          <ArrowRight size={11} className="text-ink-muted hidden sm:block" strokeWidth={1.5} />
          <span className="text-ink-muted">
            After fix <span className="text-emerald-700 font-semibold">{formatMonthly(sug.projected_cost_per_day!)}</span>
          </span>
          {sug.estimated_savings_pct != null && sug.estimated_savings_pct > 0 && (
            <span className="ml-auto flex items-center gap-1 text-emerald-700 font-semibold">
              <TrendingDown size={11} strokeWidth={1.6} />
              ~{sug.estimated_savings_pct.toFixed(0)}% cheaper
            </span>
          )}
        </div>
      )}

      {/* Action */}
      <div>
        {sug.status === "applied" ? (
          <div className="text-xs text-emerald-700 flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl w-fit font-medium">
            <CheckCircle size={12} strokeWidth={1.6} /> Applied
          </div>
        ) : (
          <button
            onClick={() => onGetFix(sug.id)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs rounded-xl transition-colors font-semibold"
          >
            <Lightbulb size={12} strokeWidth={1.6} />
            {loading ? "Loading…" : "View fix steps"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Fix modal ─────────────────────────────────────────────────

function FixModal({
  result, sim, sug, onClose,
}: {
  result: ApplyResult;
  sim: SimulateResult | null;
  sug: Suggestion | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (result.snippet) {
      navigator.clipboard.writeText(result.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const icon  = sug ? (TYPE_ICONS[sug.suggestion_type]  || "💡") : "💡";
  const label = sug ? (TYPE_LABELS[sug.suggestion_type] || sug.suggestion_type) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/25">
      <div
        className="bg-white w-full max-w-2xl flex flex-col max-h-[90vh] shadow-card-hover"
        style={{ borderRadius: "20px", border: "1px solid #E6E6E3" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-base-border flex-shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-base">{icon}</span>
              <span className="text-xs text-ink-muted font-semibold uppercase tracking-wider">{label}</span>
              {sug?.feature_tag && sug.feature_tag !== "__untagged__" && (
                <span className="text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-full">
                  {sug.feature_tag}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-ink-primary">How to Fix This</h2>
            <p className="text-xs text-ink-muted mt-0.5">Step-by-step changes to make in your pipeline</p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink-icon p-1.5 rounded-xl hover:bg-base-card transition-colors flex-shrink-0 ml-4"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        {/* Savings summary */}
        {sim && (sim.savings_usd_monthly > 0 || sim.current_monthly_cost > 0) && (
          <div className="px-6 py-4 border-b border-base-border bg-base-card flex-shrink-0">
            <p className="text-xs text-ink-muted uppercase tracking-wider font-semibold mb-3">Estimated impact</p>
            <div className="flex flex-wrap gap-6 items-center">
              <div>
                <div className="text-xs text-ink-muted mb-0.5">Current monthly</div>
                <div className="text-base font-bold text-ink-primary tabular-nums">${sim.current_monthly_cost.toFixed(3)}</div>
              </div>
              <ArrowRight size={14} className="text-ink-muted" strokeWidth={1.5} />
              <div>
                <div className="text-xs text-ink-muted mb-0.5">After fix</div>
                <div className="text-base font-bold text-emerald-600 tabular-nums">${sim.projected_monthly_cost.toFixed(3)}</div>
              </div>
              {sim.savings_usd_monthly > 0 && (
                <div className="ml-auto text-right">
                  <div className="text-xs text-ink-muted mb-0.5">Monthly savings</div>
                  <div className="text-base font-bold text-emerald-600 flex items-center gap-1 tabular-nums">
                    <TrendingDown size={14} strokeWidth={1.6} />
                    ${sim.savings_usd_monthly.toFixed(3)} ({sim.savings_pct.toFixed(0)}%)
                  </div>
                </div>
              )}
            </div>
            <p className="text-[10px] text-ink-muted mt-2.5">
              Based on {sim.sample_size} recent call{sim.sample_size !== 1 ? "s" : ""}. Actual savings may vary.
            </p>
          </div>
        )}

        {/* Recommendation text */}
        <div className="px-6 py-5 flex-1 overflow-y-auto min-h-0">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-ink-muted uppercase tracking-wider font-semibold">What to do</p>
            {result.snippet && (
              <button
                onClick={copy}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-base-card hover:bg-base-border border border-base-border text-ink-body rounded-lg transition-colors"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          {result.snippet ? (
            <div className="surface p-5 text-sm text-ink-body leading-relaxed whitespace-pre-wrap min-h-48" style={{ borderRadius: "14px" }}>
              {result.snippet}
            </div>
          ) : (
            <p className="text-sm text-ink-body leading-relaxed">{result.message}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-base-card hover:bg-base-border border border-base-border text-ink-body rounded-xl text-sm font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function SuggestionsPage() {
  const [project,     setProject]     = useState<Project | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [fixModal,    setFixModal]    = useState<{
    result: ApplyResult;
    sim: SimulateResult | null;
    sug: Suggestion | null;
  } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;
    api.projects.list().then((ps) => {
      const p = ps.find((p) => p.id === projectId);
      if (p) setProject(p);
    });
    api.suggestions.list(projectId).then(setSuggestions).finally(() => setLoading(false));
  }, []);

  async function handleGetFix(id: string) {
    setLoadingId(id);
    try {
      const sug = suggestions.find((s) => s.id === id) ?? null;
      let sim: SimulateResult | null = null;
      if (sug?.status === "pending") {
        try {
          sim = await api.suggestions.simulate(id);
          setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, status: "simulated" } : s)));
        } catch { /* non-fatal */ }
      }
      const res = await api.suggestions.apply(id);
      setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, status: "applied" } : s)));
      setFixModal({ result: res, sim, sug });
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDismiss(id: string) {
    await api.suggestions.dismiss(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }

  const pending    = suggestions.filter((s) => s.status === "pending");
  const inProgress = suggestions.filter((s) => s.status === "simulated");
  const applied    = suggestions.filter((s) => s.status === "applied");

  const totalDailySavings = suggestions.reduce((sum, s) => {
    if (s.current_cost_per_day != null && s.estimated_savings_pct != null) {
      return sum + (s.current_cost_per_day * s.estimated_savings_pct) / 100;
    }
    return sum;
  }, 0);

  const modeLabel = (() => {
    const m = project?.suggestion_mode || "instant";
    if (m === "instant") return "Tips appear as soon as we spot a savings opportunity.";
    if (/^\d+h$/.test(m)) return `Tips refresh every ${m.replace("h", " hours")}.`;
    return "Tips are generated periodically.";
  })();

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-primary">Optimization tips</h1>
          <p className="text-sm text-ink-muted">Actionable fixes to cut AI costs and speed up responses</p>
        </div>
        {totalDailySavings > 0 && (
          <div className="card px-4 py-3 text-right border-brand-200" style={{ borderColor: "#bbf7d3" }}>
            <div className="text-xs text-emerald-600 font-medium">Potential monthly savings</div>
            <div className="text-lg font-bold text-emerald-700">{formatMonthly(totalDailySavings)}</div>
          </div>
        )}
      </div>

      {/* Info bar */}
      {suggestions.length > 0 && (
        <div className="surface flex items-start gap-2.5 px-4 py-3">
          <Info size={14} className="text-brand-500 flex-shrink-0 mt-0.5" strokeWidth={1.6} />
          <p className="text-xs text-ink-body leading-relaxed">
            Click <span className="text-ink-primary font-semibold">View fix steps</span> on any tip to see exactly what to change and how much you'll save.{" "}
            {modeLabel}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : suggestions.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-14 h-14 card card-hover rounded-2xl flex items-center justify-center mx-auto">
            <Lightbulb size={22} className="text-ink-muted" strokeWidth={1.5} />
          </div>
          <p className="text-ink-primary font-semibold">No tips yet</p>
          <p className="text-xs text-ink-muted max-w-xs mx-auto leading-relaxed">
            Use your app as normal — tips will appear here as soon as we spot a savings opportunity.
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          {pending.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-ink-muted uppercase tracking-widest mb-3">
                New · {pending.length}
              </h2>
              <div className="space-y-3">
                {pending.map((s) => (
                  <SuggestionCard key={s.id} sug={s} onGetFix={handleGetFix} onDismiss={handleDismiss} loading={loadingId === s.id} />
                ))}
              </div>
            </section>
          )}

          {inProgress.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-ink-muted uppercase tracking-widest mb-3">
                In progress · {inProgress.length}
              </h2>
              <div className="space-y-3">
                {inProgress.map((s) => (
                  <SuggestionCard key={s.id} sug={s} onGetFix={handleGetFix} onDismiss={handleDismiss} loading={loadingId === s.id} />
                ))}
              </div>
            </section>
          )}

          {applied.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-ink-muted uppercase tracking-widest mb-3">
                Applied · {applied.length}
              </h2>
              <div className="space-y-3">
                {applied.map((s) => (
                  <SuggestionCard key={s.id} sug={s} onGetFix={handleGetFix} onDismiss={handleDismiss} loading={loadingId === s.id} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {fixModal && (
        <FixModal
          result={fixModal.result}
          sim={fixModal.sim}
          sug={fixModal.sug}
          onClose={() => setFixModal(null)}
        />
      )}
    </div>
  );
}
