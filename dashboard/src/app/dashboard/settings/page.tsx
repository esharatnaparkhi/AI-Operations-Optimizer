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
    color: "text-yellow-400 border-yellow-400/40 bg-yellow-400/5",
  },
  {
    value: "24h",
    label: "Every 24h",
    icon: Clock,
    description: "Once per day",
    detail: "Suggestions run every 24 hours. Good balance between responsiveness and noise for production projects.",
    color: "text-brand-400 border-brand-400/40 bg-brand-400/5",
  },
] as const;

export default function SettingsPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [modeSaved, setModeSaved] = useState(false);
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
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400">Manage your project API key and suggestion preferences</p>
      </div>

      {/* Suggestion Frequency */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Suggestion Frequency</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Controls when the agent runs and surfaces suggestions for this project
            </p>
          </div>
          {modeSaved && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <Check size={12} /> Saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {FIXED_MODES.map((m) => {
            const active = (project.suggestion_mode || "instant") === m.value;
            const Icon = m.icon;
            return (
              <button
                key={m.value}
                onClick={() => handleModeChange(m.value)}
                disabled={savingMode}
                className={`w-full text-left p-4 rounded-xl border transition-all disabled:opacity-60 ${
                  active
                    ? m.color
                    : "border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-800/60"
                }`}
              >
                <div className="flex items-center gap-2.5 mb-1.5">
                  <Icon size={15} className={active ? "" : "text-gray-500"} />
                  <span className={`text-sm font-semibold ${active ? "" : "text-gray-300"}`}>
                    {m.label}
                  </span>
                  {active && (
                    <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-current/10 opacity-70">
                      Active
                    </span>
                  )}
                </div>
                <div className={`text-xs font-medium mb-1 ${active ? "" : "text-gray-400"}`}>
                  {m.description}
                </div>
                <div className={`text-xs leading-relaxed ${active ? "opacity-70" : "text-gray-600"}`}>
                  {m.detail}
                </div>
              </button>
            );
          })}
        </div>

        {/* Custom interval */}
        {(() => {
          const currentMode = project.suggestion_mode || "instant";
          const isCustomActive =
            currentMode !== "instant" &&
            currentMode !== "24h" &&
            /^\d+h$/.test(currentMode);
          const activeHours = isCustomActive ? currentMode.replace("h", "") : null;

          return (
            <div
              className={`p-4 rounded-xl border transition-all ${
                isCustomActive
                  ? "border-purple-400/40 bg-purple-400/5 text-purple-300"
                  : "border-gray-800 bg-gray-900"
              }`}
            >
              <div className="flex items-center gap-2.5 mb-3">
                <Clock size={15} className={isCustomActive ? "" : "text-gray-500"} />
                <span className={`text-sm font-semibold ${isCustomActive ? "" : "text-gray-300"}`}>
                  Custom interval
                </span>
                {isCustomActive && (
                  <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-current/10 opacity-70">
                    Active — every {activeHours}h
                  </span>
                )}
              </div>
              <p className={`text-xs mb-3 ${isCustomActive ? "opacity-70" : "text-gray-600"}`}>
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
                  className="w-24 bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
                />
                <span className="text-xs text-gray-500">hours</span>
                <button
                  onClick={handleCustomApply}
                  disabled={savingMode || !customHours}
                  className="ml-auto px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          );
        })()}
      </section>

      {/* API Key */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Key size={14} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">Project API Key</h2>
        </div>
        <p className="text-xs text-gray-400">
          Pass this as <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-200">api_key</code> when
          initialising the SDK. Keep it secret — it authenticates all SDK calls to this project.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 truncate">
            {showKey ? project.api_key : "•".repeat(36)}
          </div>
          <button
            onClick={() => setShowKey(!showKey)}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg transition-colors whitespace-nowrap"
          >
            {showKey ? "Hide" : "Reveal"}
          </button>
          <button
            onClick={copyKey}
            className="flex items-center gap-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg transition-colors"
          >
            {keyCopied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {keyCopied ? "Copied" : "Copy"}
          </button>
        </div>
      </section>

      {/* Project info */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2">
        <h2 className="text-sm font-semibold text-white mb-3">Project Info</h2>
        <div className="flex justify-between py-1.5 border-b border-gray-800/60">
          <span className="text-xs text-gray-500">Name</span>
          <span className="text-xs text-white font-medium">{project.name}</span>
        </div>
        <div className="flex justify-between py-1.5 border-b border-gray-800/60">
          <span className="text-xs text-gray-500">Project ID</span>
          <span className="text-xs text-gray-300 font-mono">{project.id}</span>
        </div>
        <div className="flex justify-between py-1.5">
          <span className="text-xs text-gray-500">Created</span>
          <span className="text-xs text-gray-300">
            {new Date(project.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </span>
        </div>
      </section>
    </div>
  );
}
