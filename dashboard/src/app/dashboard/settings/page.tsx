"use client";
import { useEffect, useState } from "react";
import { Copy, Check, Key } from "lucide-react";
import { api, Project } from "@/lib/api";

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-xs text-green-300 overflow-auto">
        {code}
      </pre>
      <button
        onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="absolute top-2 right-2 flex items-center gap-1 text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;
    api.projects.list().then((ps) => {
      const p = ps.find((p) => p.id === projectId);
      if (p) setProject(p);
    });
  }, []);

  if (!project) return null;

  const installCode = `pip install llm-monitor-sdk`;

  const usageCode = `import openai
from llm_monitor import LLMMonitor, feature_tag

# Initialize once at app startup
monitor = LLMMonitor(
    api_key="${project.api_key}",
    endpoint="http://localhost:8000",  # your backend URL
)

# Wrap your OpenAI client (one line!)
client = monitor.wrap_openai(openai.OpenAI())

# Tag features for granular visibility
with feature_tag("summarize"):
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Summarize this..."}],
    )

# Or tag via header
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Classify this..."}],
    extra_headers={"X-Feature-Tag": "classify"},
)`;

  const manualCode = `# For providers not yet auto-wrapped
monitor.track(
    provider="cohere",
    model="command-r-plus",
    input_tokens=512,
    output_tokens=128,
    latency_ms=340.5,
    feature_tag="rag-search",
)`;

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400">SDK integration & project configuration</p>
      </div>

      {/* API Key */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Key size={14} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">Project API Key</h2>
        </div>
        <p className="text-xs text-gray-400">Use this key as your <code className="bg-gray-800 px-1 rounded text-gray-300">api_key</code> in the SDK.</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 truncate">
            {showKey ? project.api_key : "•".repeat(36)}
          </div>
          <button
            onClick={() => setShowKey(!showKey)}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg transition-colors"
          >
            {showKey ? "Hide" : "Reveal"}
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(project.api_key)}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg transition-colors"
          >
            <Copy size={12} />
          </button>
        </div>
      </section>

      {/* Install */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">1. Install the SDK</h2>
        <CodeBlock code={installCode} />
      </section>

      {/* Usage */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">2. Instrument your code</h2>
        <CodeBlock code={usageCode} language="python" />
      </section>

      {/* Manual tracking */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">3. Manual tracking (optional)</h2>
        <CodeBlock code={manualCode} language="python" />
      </section>

      {/* Project info */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2 text-sm">
        <h2 className="font-semibold text-white mb-3">Project Info</h2>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Name</span>
          <span className="text-white">{project.name}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Project ID</span>
          <span className="text-gray-300 font-mono">{project.id}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Created</span>
          <span className="text-gray-300">{new Date(project.created_at).toLocaleDateString()}</span>
        </div>
      </section>
    </div>
  );
}
