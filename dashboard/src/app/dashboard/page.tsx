"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Zap, Clock,
  Activity, Copy, Check, ChevronDown, ChevronUp, Terminal, Code, Package
} from "lucide-react";
import { api, Overview, DailyMetric, Project } from "@/lib/api";

function fmtCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function StatCard({
  label, value, sub, icon: Icon, trend, color = "brand", tooltip,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; trend?: number; color?: string; tooltip?: string;
}) {
  const colorMap: Record<string, string> = {
    brand: "text-brand-400 bg-brand-400/10",
    green: "text-green-400 bg-green-400/10",
    yellow: "text-yellow-400 bg-yellow-400/10",
    purple: "text-purple-400 bg-purple-400/10",
  };
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5" title={tooltip}>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${colorMap[color]}`}>
          <Icon size={16} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
            trend >= 0 ? "text-red-400 bg-red-400/10" : "text-green-400 bg-green-400/10"
          }`}>
            {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {trend >= 0 ? "+" : ""}{Math.abs(trend).toFixed(1)}% vs yesterday
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
      <div className="text-xs text-gray-400">{label}</div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function EfficiencyRing({ score }: { score: number }) {
  const r = 36, c = 2 * Math.PI * r;
  const fill = c - (score / 100) * c;
  const color = score >= 75 ? "#4ade80" : score >= 50 ? "#facc15" : "#f87171";
  const label = score >= 75
    ? "Good — latency is healthy"
    : score >= 50
    ? "Fair — check Suggestions for optimizations"
    : "Poor — high latency detected, review Cost Hotspots";
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center gap-5">
      <svg width="88" height="88" viewBox="0 0 88 88" className="flex-shrink-0">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#1f2937" strokeWidth="8" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={c} strokeDashoffset={fill}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text x="44" y="49" textAnchor="middle" fill={color} fontSize="18" fontWeight="700">{Math.round(score)}</text>
      </svg>
      <div className="flex-1">
        <div className="text-sm font-semibold text-white mb-1">Efficiency Score</div>
        <div className="text-xs text-gray-400 leading-relaxed mb-2">{label}</div>
        <div className="text-[10px] text-gray-600">
          Scored 0–100 based on average response latency. 100 = sub-100ms average.
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="absolute top-2 right-2 flex items-center gap-1 text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function QuickStart({ apiKey }: { apiKey: string }) {
  const [open, setOpen] = useState(false);

  const installCode = `pip install llm-monitor-sdk`;
  const usageCode = `import openai
from llm_monitor import LLMMonitor, feature_tag

# 1. Initialize once at app startup
monitor = LLMMonitor(
    api_key="${apiKey}",
    endpoint="http://localhost:8000",
)

# 2. Wrap your OpenAI client — just one line
client = monitor.wrap_openai(openai.OpenAI())

# 3. Use the client exactly as before
with feature_tag("summarize"):
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Summarize this..."}],
    )`;
  const manualCode = `# For providers not yet auto-wrapped (Cohere, Mistral, etc.)
monitor.track(
    provider="cohere",
    model="command-r-plus",
    input_tokens=512,
    output_tokens=128,
    latency_ms=340.5,
    feature_tag="rag-search",
)`;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-brand-600/20 flex items-center justify-center">
            <Terminal size={13} className="text-brand-400" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-white">SDK Quick Start</div>
            <div className="text-xs text-gray-500">Install, instrument, and start tracking in minutes</div>
          </div>
        </div>
        {open ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t border-gray-800">
          {/* Step 1 */}
          <div className="pt-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-brand-600/20 border border-brand-600/30 flex items-center justify-center text-brand-400 text-[10px] font-bold">1</div>
              <Terminal size={13} className="text-gray-500" />
              <div>
                <span className="text-xs font-semibold text-white">Install the SDK</span>
                <span className="text-xs text-gray-500 ml-2">Python 3.9+</span>
              </div>
            </div>
            <div className="relative ml-7">
              <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-green-300 overflow-auto">{installCode}</pre>
              <CopyButton text={installCode} />
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-brand-600/20 border border-brand-600/30 flex items-center justify-center text-brand-400 text-[10px] font-bold">2</div>
              <Code size={13} className="text-gray-500" />
              <div>
                <span className="text-xs font-semibold text-white">Instrument your code</span>
                <span className="text-xs text-gray-500 ml-2">Wrap your LLM client — no other changes needed</span>
              </div>
            </div>
            <div className="relative ml-7">
              <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-green-300 overflow-auto leading-relaxed">{usageCode}</pre>
              <CopyButton text={usageCode} />
            </div>
          </div>

          {/* Step 3 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-brand-600/20 border border-brand-600/30 flex items-center justify-center text-brand-400 text-[10px] font-bold">3</div>
              <Package size={13} className="text-gray-500" />
              <div>
                <span className="text-xs font-semibold text-white">Manual tracking</span>
                <span className="text-xs text-gray-500 ml-2">Optional — for providers without auto-wrap</span>
              </div>
            </div>
            <div className="relative ml-7">
              <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-green-300 overflow-auto">{manualCode}</pre>
              <CopyButton text={manualCode} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [timeseries, setTimeseries] = useState<DailyMetric[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  useEffect(() => {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;

    Promise.all([
      api.metrics.overview(projectId),
      api.metrics.timeseries(projectId, 14),
      api.projects.list(),
    ]).then(([ov, ts, ps]) => {
      setOverview(ov);
      setTimeseries(ts);
      setProject(ps.find((p) => p.id === projectId) || null);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const apiKey = project?.api_key ?? "YOUR_API_KEY";
  const noData = !overview || (overview.today_calls === 0 && timeseries.length === 0);

  if (noData) {
    return (
      <div className="p-8 max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white mb-1">Overview</h1>
          <p className="text-sm text-gray-500">{today}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-600/20 rounded-lg flex items-center justify-center">
              <Zap size={16} className="text-brand-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">No data yet</p>
              <p className="text-xs text-gray-400">Follow the quick start below to start tracking your LLM usage.</p>
            </div>
          </div>
        </div>
        <QuickStart apiKey={apiKey} />
      </div>
    );
  }

  const monthlyCostProjection = (overview.today_cost || 0) * 30;
  const costPerCall = overview.today_calls > 0
    ? overview.today_cost / overview.today_calls
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <p className="text-sm text-gray-400">{today} · LLM activity across your project</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Cost today"
          value={fmtCost(overview.today_cost)}
          icon={DollarSign}
          trend={overview.cost_trend_pct}
          color="brand"
          tooltip="Total estimated USD spend on LLM API calls today"
        />
        <StatCard
          label="Monthly projection"
          value={fmtCost(monthlyCostProjection)}
          sub="based on today's spend"
          icon={TrendingUp}
          color="yellow"
          tooltip="Today's cost × 30 — a rough monthly cost estimate"
        />
        <StatCard
          label="API calls today"
          value={overview.today_calls.toLocaleString()}
          sub={`${fmtCost(costPerCall)} / call avg`}
          icon={Activity}
          color="green"
          tooltip="Number of LLM API calls made today"
        />
        <StatCard
          label="Avg latency"
          value={`${Math.round(overview.avg_latency_ms)}ms`}
          sub="average response time"
          icon={Clock}
          color="purple"
          tooltip="Mean time from request to first response token"
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Tokens used today"
          value={overview.today_tokens.toLocaleString()}
          sub={overview.today_calls > 0 ? `${Math.round(overview.today_tokens / overview.today_calls)} avg per call` : undefined}
          icon={Zap}
          color="brand"
          tooltip="Total input + output tokens consumed today"
        />
        <StatCard
          label="Cost per 1K tokens"
          value={overview.today_tokens > 0 ? fmtCost((overview.today_cost / overview.today_tokens) * 1000) : "—"}
          sub="blended input + output rate"
          icon={DollarSign}
          color="green"
          tooltip="Average cost per 1,000 tokens across all models today"
        />
        <div className="col-span-2 lg:col-span-1">
          <EfficiencyRing score={overview.efficiency_score} />
        </div>
      </div>

      {/* Charts */}
      {timeseries.length > 0 && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Daily Cost</h2>
                <p className="text-xs text-gray-500">Last 14 days of estimated USD spend</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={timeseries}>
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `$${v.toFixed(4)}`} />
                <Tooltip
                  contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                  labelStyle={{ color: "#9ca3af" }}
                  itemStyle={{ color: "#ffffff" }}
                  formatter={(v: number) => [fmtCost(v), "Cost"]}
                />
                <Area type="monotone" dataKey="total_cost" stroke="#6366f1" fill="url(#costGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-1">Daily Token Usage</h2>
              <p className="text-xs text-gray-500 mb-4">Total tokens (input + output) per day</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={timeseries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                    formatter={(v: number) => [v.toLocaleString(), "Tokens"]}
                  />
                  <Line type="monotone" dataKey="total_tokens" stroke="#fbbf24" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-1">Daily API Calls</h2>
              <p className="text-xs text-gray-500 mb-4">Number of LLM requests per day</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={timeseries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                    formatter={(v: number) => [v.toLocaleString(), "Calls"]}
                  />
                  <Line type="monotone" dataKey="total_calls" stroke="#34d399" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* SDK Quick Start — always available at the bottom */}
      <QuickStart apiKey={apiKey} />
    </div>
  );
}
