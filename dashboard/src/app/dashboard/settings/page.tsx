"use client";
import { useEffect, useState } from "react";
import { Copy, Check, Key, Zap, Clock } from "lucide-react";
import { api, Project } from "@/lib/api";

const FIXED_MODES = [
  {
    value: "instant",
    label: "Instant",
    icon: Zap,
    description: "After every ingest batch",
    detail: "Suggestions fire immediately after each SDK event. Best for testing and active development.",
    activeClass: "border-amber-300 bg-amber-50",
    activeLabelClass: "text-amber-700",
    activeIconClass: "text-amber-600",
    activeSubClass: "text-amber-600/70",
    badgeClass: "bg-amber-100 text-amber-700",
  },
  {
    value: "24h",
    label: "Every 24h",
    icon: Clock,
    description: "Once per day",
    detail: "Suggestions run every 24 hours. Good balance between responsiveness and noise for production projects.",
    activeClass: "border-brand-300 bg-brand-50",
    activeLabelClass: "text-brand-700",
    activeIconClass: "text-brand-600",
    activeSubClass: "text-brand-500/70",
    badgeClass: "bg-brand-100 text-brand-700",
  },
] as const;

export default function SettingsPage() {
  const [project,     setProject]     = useState<Project | null>(null);
  const [showKey,     setShowKey]     = useState(false);
  const [keyCopied,   setKeyCopied]   = useState(false);
  const [savingMode,  setSavingMode]  = useState(false);
  const [modeSaved,   setModeSaved]   = useState(false);
  const [customHours, setCustomHours] = useState("");

  useEffect(() => {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;
    api.projects.list().then((ps) => {
      const p = ps.find((p) => p.id === projectId);
      if (p) setProject(p);
    });
  }, []);

  if (!project) return null;

  function copyKey() {
    navigator.clipboard.writeText(project!.api_key);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  }

  async function handleModeChange(mode: string) {
    if (!project || mode === project.suggestion_mode) return;
    setSavingMode(true);
    try {
      const updated = await api.projects.updateMode(project.id, mode);
      setProject(updated);
      setModeSaved(true);
      setTimeout(() => setModeSaved(false), 2000);
    } finally {
      setSavingMode(false);
    }
  }

  async function handleCustomApply() {
    const h = parseInt(customHours, 10);
    if (!h || h < 1 || h > 999) return;
    await handleModeChange(`${h}h`);
  }

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-ink-primary">Settings</h1>
        <p className="text-sm text-ink-muted">Manage your project API key and suggestion preferences</p>
      </div>

      {/* Suggestion Frequency */}
      <section className="space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-sm font-semibold text-ink-primary">Suggestion Frequency</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Controls when the agent runs and surfaces suggestions for this project
            </p>
          </div>
          {modeSaved && (
            <span className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
              <Check size={12} /> Saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {FIXED_MODES.map((m) => {
            const active = (project.suggestion_mode || "instant") === m.value;
            const Icon   = m.icon;
            return (
              <button
                key={m.value}
                onClick={() => handleModeChange(m.value)}
                disabled={savingMode}
                className={`w-full text-left p-4 rounded-2xl border transition-all card-hover disabled:opacity-60 ${
                  active
                    ? `${m.activeClass} ${m.activeLabelClass}`
                    : "card hover:border-base-border2"
                }`}
              >
                <div className="flex items-center gap-2.5 mb-1.5">
                  <Icon size={14} className={active ? m.activeIconClass : "text-ink-icon"} strokeWidth={1.6} />
                  <span className={`text-sm font-semibold ${active ? m.activeLabelClass : "text-ink-primary"}`}>
                    {m.label}
                  </span>
                  {active && (
                    <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${m.badgeClass}`}>
                      Active
                    </span>
                  )}
                </div>
                <div className={`text-xs font-semibold mb-1 ${active ? m.activeIconClass : "text-ink-body"}`}>
                  {m.description}
                </div>
                <div className={`text-xs leading-relaxed ${active ? m.activeSubClass : "text-ink-muted"}`}>
                  {m.detail}
                </div>
              </button>
            );
          })}
        </div>

        {/* Custom interval */}
        {(() => {
          const currentMode   = project.suggestion_mode || "instant";
          const isCustomActive =
            currentMode !== "instant" &&
            currentMode !== "24h" &&
            /^\d+h$/.test(currentMode);
          const activeHours = isCustomActive ? currentMode.replace("h", "") : null;

          return (
            <div
              className={`p-4 rounded-2xl border transition-all card-hover ${
                isCustomActive
                  ? "border-violet-300 bg-violet-50"
                  : "card"
              }`}
            >
              <div className="flex items-center gap-2.5 mb-3">
                <Clock size={14} className={isCustomActive ? "text-violet-600" : "text-ink-icon"} strokeWidth={1.6} />
                <span className={`text-sm font-semibold ${isCustomActive ? "text-violet-700" : "text-ink-primary"}`}>
                  Custom interval
                </span>
                {isCustomActive && (
                  <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                    Active — every {activeHours}h
                  </span>
                )}
              </div>
              <p className={`text-xs mb-3 leading-relaxed ${isCustomActive ? "text-violet-600/70" : "text-ink-muted"}`}>
                Run suggestions every N hours (1–999). The agent fires on ingest but respects the cooldown.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={999}
                  placeholder={activeHours ?? "e.g. 6"}
                  value={customHours}
                  onChange={(e) => setCustomHours(e.target.value)}
                  className="w-24 bg-base-card border border-base-border rounded-xl px-3 py-1.5 text-xs text-ink-primary placeholder-ink-muted focus:outline-none focus:border-violet-400"
                />
                <span className="text-xs text-ink-muted">hours</span>
                <button
                  onClick={handleCustomApply}
                  disabled={savingMode || !customHours}
                  className="ml-auto px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold rounded-xl transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          );
        })()}
      </section>

      {/* API Key */}
      <section className="card p-5 space-y-3.5">
        <div className="flex items-center gap-2">
          <div className="icon-box w-7 h-7 bg-brand-50">
            <Key size={12} className="text-brand-600" strokeWidth={1.6} />
          </div>
          <h2 className="text-sm font-semibold text-ink-primary">Project API Key</h2>
        </div>
        <p className="text-xs text-ink-body leading-relaxed">
          Pass this as <code className="bg-base-card border border-base-border px-1.5 py-0.5 rounded-lg text-ink-body font-mono">api_key</code> when
          initialising the SDK. Keep it secret — it authenticates all SDK calls to this project.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-base-card border border-base-border rounded-xl px-3 py-2 text-xs font-mono text-ink-body truncate">
            {showKey ? project.api_key : "•".repeat(36)}
          </div>
          <button
            onClick={() => setShowKey(!showKey)}
            className="px-3 py-2 bg-base-card hover:bg-base-border border border-base-border text-ink-body text-xs rounded-xl transition-colors whitespace-nowrap font-medium"
          >
            {showKey ? "Hide" : "Reveal"}
          </button>
          <button
            onClick={copyKey}
            className="flex items-center gap-1.5 px-3 py-2 bg-base-card hover:bg-base-border border border-base-border text-ink-body text-xs rounded-xl transition-colors font-medium"
          >
            {keyCopied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} strokeWidth={1.5} />}
            {keyCopied ? "Copied" : "Copy"}
          </button>
        </div>
      </section>

      {/* Project info */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink-primary mb-4">Project Info</h2>
        <div className="space-y-0">
          <div className="flex justify-between py-2.5 border-b border-base-border">
            <span className="text-xs text-ink-muted font-medium">Name</span>
            <span className="text-xs text-ink-primary font-semibold">{project.name}</span>
          </div>
          <div className="flex justify-between py-2.5 border-b border-base-border">
            <span className="text-xs text-ink-muted font-medium">Project ID</span>
            <span className="text-xs text-ink-body font-mono">{project.id}</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-xs text-ink-muted font-medium">Created</span>
            <span className="text-xs text-ink-body">
              {new Date(project.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
