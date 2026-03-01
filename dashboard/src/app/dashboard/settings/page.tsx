"use client";
import { useEffect, useState } from "react";
import { Copy, Check, Key, Terminal, Code, Package, Zap, BarChart2, Shield } from "lucide-react";
import { api, Project } from "@/lib/api";

type Mode = "instant" | "balanced" | "conservative";

const MODES: { value: Mode; label: string; icon: React.ElementType; description: string; detail: string; color: string }[] = [
  {
    value: "instant",
    label: "Instant",
    icon: Zap,
    description: "Suggestions after every call",
    detail: "Looks at the last 1 day. Fires on just 1 call with any spend. Best for testing or small projects that want immediate feedback.",
    color: "text-yellow-400 border-yellow-400/40 bg-yellow-400/5",
  },
  {
    value: "balanced",
    label: "Balanced",
    icon: BarChart2,
    description: "Suggestions after ~7 days of data",
    detail: "Looks at the last 7 days. Requires moderate cost ($0.01+) and 10+ slow calls. Reduces noise for production projects. Default.",
    color: "text-brand-400 border-brand-400/40 bg-brand-400/5",
  },
  {
    value: "conservative",
    label: "Conservative",
    icon: Shield,
    description: "High-confidence only, 30-day window",
    detail: "Looks at the last 30 days. Only surfaces suggestions with significant, sustained spend. Best for large, mature projects.",
    color: "text-green-400 border-green-400/40 bg-green-400/5",
  },
];

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-xs text-green-300 overflow-auto leading-relaxed">
        {code}
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="absolute top-2 right-2 flex items-center gap-1 text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Step({ number, icon: Icon, title, description, children }: {
  number: number;
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-brand-600/20 border border-brand-600/30 flex items-center justify-center text-brand-400 font-bold text-xs flex-shrink-0">
          {number}
        </div>
        <Icon size={14} className="text-gray-500" />
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
      </div>
      <div className="ml-10">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [modeSaved, setModeSaved] = useState(false);

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

  async function handleModeChange(mode: Mode) {
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

  const installCode = `pip install llm-monitor-sdk`;

  const usageCode = `import openai
from llm_monitor import LLMMonitor, feature_tag

# 1. Initialize once at app startup
monitor = LLMMonitor(
    api_key="${project.api_key}",
    endpoint="http://localhost:8000",  # your backend URL
)

# 2. Wrap your OpenAI client — just one line
client = monitor.wrap_openai(openai.OpenAI())

# 3. Use the client exactly as before — monitoring is automatic
with feature_tag("summarize"):          # optional: tag features for breakdown
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Summarize this..."}],
    )

# You can also pass the tag via a request header
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Classify this..."}],
    extra_headers={"X-Feature-Tag": "classify"},
)`;

  const manualCode = `# For providers not yet auto-wrapped (e.g. Cohere, Mistral)
monitor.track(
    provider="cohere",
    model="command-r-plus",
    input_tokens=512,
    output_tokens=128,
    latency_ms=340.5,
    feature_tag="rag-search",  # optional
)`;

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-white">Settings & SDK Setup</h1>
        <p className="text-sm text-gray-400">Connect the SDK to start tracking your LLM costs and latency</p>
      </div>

      {/* Suggestion Mode */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Suggestion Sensitivity</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Controls how much data the heuristic agent needs before surfacing a suggestion
            </p>
          </div>
          {modeSaved && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <Check size={12} /> Saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {MODES.map((m) => {
            const active = (project.suggestion_mode || "balanced") === m.value;
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
      </section>

      {/* API Key */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Key size={14} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">Your Project API Key</h2>
        </div>
        <p className="text-xs text-gray-400">
          Pass this as <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-200">api_key</code> when initialising the SDK.
          Keep it secret — it authenticates all SDK calls to this project.
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

      {/* Steps */}
      <Step number={1} icon={Terminal} title="Install the SDK" description="Supports Python 3.9+">
        <CodeBlock code={installCode} />
      </Step>

      <Step number={2} icon={Code} title="Instrument your code" description="Wrap your LLM client — no other changes needed">
        <CodeBlock code={usageCode} language="python" />
        <div className="mt-3 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5 space-y-1">
          <p className="text-xs text-gray-400 font-medium">What are feature tags?</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            Tags group calls by feature (e.g. "summarize", "classify") so you can see cost per feature in the
            Cost Hotspots page. They're optional but highly recommended.
          </p>
        </div>
      </Step>

      <Step number={3} icon={Package} title="Manual tracking (optional)" description="For providers without an auto-wrap (Cohere, Mistral, etc.)">
        <CodeBlock code={manualCode} language="python" />
      </Step>

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
          <span className="text-xs text-gray-300">{new Date(project.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
        </div>
      </section>
    </div>
  );
}
