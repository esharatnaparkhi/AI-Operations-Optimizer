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

const CHART_TOOLTIP = {
  contentStyle: {
    background: "#FFFFFF",
    border: "1px solid #E6E6E3",
    borderRadius: "12px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.07)",
    fontSize: 12,
  },
  labelStyle: { color: "#9A9A9A" },
  itemStyle:  { color: "#111111" },
};

function StatCard({
  label, value, sub, icon: Icon, trend, iconColor = "brand", tooltip,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; trend?: number; iconColor?: string; tooltip?: string;
}) {
  const iconStyles: Record<string, { box: string; icon: string }> = {
    brand:  { box: "bg-brand-50",  icon: "text-brand-600" },
    green:  { box: "bg-emerald-50",icon: "text-emerald-600" },
    yellow: { box: "bg-amber-50",  icon: "text-amber-600" },
    purple: { box: "bg-violet-50", icon: "text-violet-600" },
  };
  const s = iconStyles[iconColor] || iconStyles.brand;
  return (
    <div className="card card-hover p-5" title={tooltip}>
      <div className="flex items-start justify-between mb-4">
        <div className={`icon-box w-9 h-9 ${s.box}`}>
          <Icon size={15} className={s.icon} strokeWidth={1.6} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
            trend >= 0 ? "text-red-600 bg-red-50" : "text-emerald-700 bg-emerald-50"
          }`}>
            {trend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {trend >= 0 ? "+" : ""}{Math.abs(trend).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-ink-primary mb-0.5 tracking-tight">{value}</div>
      <div className="text-xs text-ink-body font-medium">{label}</div>
      {sub && <div className="text-xs text-ink-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function EfficiencyRing({ score }: { score: number }) {
  const r = 36, c = 2 * Math.PI * r;
  const fill  = c - (score / 100) * c;
  const color = score >= 75 ? "#39B26B" : score >= 50 ? "#d97706" : "#dc2626";
  const label = score >= 75
    ? "Good — latency is healthy"
    : score >= 50
    ? "Fair — check Suggestions for optimizations"
    : "Poor — high latency detected, review Cost Hotspots";
  return (
    <div className="card card-hover p-5 flex items-center gap-5">
      <svg width="88" height="88" viewBox="0 0 88 88" className="flex-shrink-0">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#F1F1ED" strokeWidth="8" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={c} strokeDashoffset={fill}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text x="44" y="49" textAnchor="middle" fill={color} fontSize="17" fontWeight="700">{Math.round(score)}</text>
      </svg>
      <div className="flex-1">
        <div className="text-sm font-semibold text-ink-primary mb-1">Efficiency Score</div>
        <div className="text-xs text-ink-body leading-relaxed mb-2">{label}</div>
        <div className="text-[10px] text-ink-muted">
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
      className="absolute top-2.5 right-2.5 flex items-center gap-1 text-xs px-2 py-1 bg-white/10 hover:bg-white/20 text-gray-300 rounded-lg transition-colors"
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
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-base-card transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="icon-box w-8 h-8 bg-brand-50">
            <Terminal size={13} className="text-brand-600" strokeWidth={1.6} />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-ink-primary">SDK Quick Start</div>
            <div className="text-xs text-ink-muted">Install, instrument, and start tracking in minutes</div>
          </div>
        </div>
        {open
          ? <ChevronUp size={14} className="text-ink-muted" strokeWidth={1.5} />
          : <ChevronDown size={14} className="text-ink-muted" strokeWidth={1.5} />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t border-base-border">
          {([
            { num: 1, icon: Terminal, label: "Install the SDK", sub: "Python 3.9+", code: installCode },
            { num: 2, icon: Code,     label: "Instrument your code", sub: "Wrap your LLM client — no other changes needed", code: usageCode },
            { num: 3, icon: Package,  label: "Manual tracking", sub: "Optional — for providers without auto-wrap", code: manualCode },
          ] as const).map(({ num, icon: StepIcon, label, sub, code }) => (
            <div key={num} className="pt-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600 text-[10px] font-bold flex-shrink-0">{num}</div>
                <StepIcon size={13} className="text-ink-muted" strokeWidth={1.5} />
                <span className="text-xs font-semibold text-ink-primary">{label}</span>
                <span className="text-xs text-ink-muted">{sub}</span>
              </div>
              <div className="relative ml-7">
                <pre className="bg-[#1A1A1A] border border-[#333] rounded-xl p-3.5 text-xs text-[#A3E4B5] overflow-auto leading-relaxed">{code}</pre>
                <CopyButton text={code} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [overview,    setOverview]   = useState<Overview | null>(null);
  const [timeseries,  setTimeseries] = useState<DailyMetric[]>([]);
  const [project,     setProject]    = useState<Project | null>(null);
  const [loading,     setLoading]    = useState(true);

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
        <div className="animate-spin w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const apiKey = project?.api_key ?? "YOUR_API_KEY";
  const noData = !overview || (overview.today_calls === 0 && timeseries.length === 0);

  if (noData) {
    return (
      <div className="p-8 max-w-2xl space-y-5">
        <div>
          <h1 className="text-xl font-bold text-ink-primary mb-1">Overview</h1>
          <p className="text-sm text-ink-muted">{today}</p>
        </div>
        <div className="card p-5 flex items-center gap-3">
          <div className="icon-box w-10 h-10 bg-brand-50">
            <Zap size={16} className="text-brand-600" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-primary">No data yet</p>
            <p className="text-xs text-ink-body">Follow the quick start below to start tracking your LLM usage.</p>
          </div>
        </div>
        <QuickStart apiKey={apiKey} />
      </div>
    );
  }

  const monthlyCostProjection = (overview.today_cost || 0) * 30;
  const costPerCall = overview.today_calls > 0 ? overview.today_cost / overview.today_calls : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink-primary">Overview</h1>
        <p className="text-sm text-ink-muted">{today} · LLM activity across your project</p>
      </div>

      {/* Primary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Cost today" value={fmtCost(overview.today_cost)} icon={DollarSign} trend={overview.cost_trend_pct} iconColor="brand" tooltip="Total estimated USD spend on LLM API calls today" />
        <StatCard label="Monthly projection" value={fmtCost(monthlyCostProjection)} sub="based on today's spend" icon={TrendingUp} iconColor="yellow" tooltip="Today's cost × 30 — rough monthly estimate" />
        <StatCard label="API calls today" value={overview.today_calls.toLocaleString()} sub={`${fmtCost(costPerCall)} / call avg`} icon={Activity} iconColor="green" tooltip="Number of LLM API calls made today" />
        <StatCard label="Avg latency" value={`${Math.round(overview.avg_latency_ms)}ms`} sub="average response time" icon={Clock} iconColor="purple" tooltip="Mean time from request to first token" />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Tokens used today"
          value={overview.today_tokens.toLocaleString()}
          sub={overview.today_calls > 0 ? `${Math.round(overview.today_tokens / overview.today_calls)} avg per call` : undefined}
          icon={Zap}
          iconColor="brand"
          tooltip="Total input + output tokens today"
        />
        <StatCard
          label="Cost per 1K tokens"
          value={overview.today_tokens > 0 ? fmtCost((overview.today_cost / overview.today_tokens) * 1000) : "—"}
          sub="blended input + output rate"
          icon={DollarSign}
          iconColor="green"
          tooltip="Average cost per 1,000 tokens"
        />
        <div className="col-span-2 lg:col-span-1">
          <EfficiencyRing score={overview.efficiency_score} />
        </div>
      </div>

      {/* Charts */}
      {timeseries.length > 0 && (
        <>
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink-primary mb-0.5">Daily Cost</h2>
            <p className="text-xs text-ink-muted mb-4">Last 14 days of estimated USD spend</p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={timeseries}>
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#39B26B" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#39B26B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F1ED" />
                <XAxis dataKey="date" tick={{ fill: "#9A9A9A", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#9A9A9A", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toFixed(4)}`} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [fmtCost(v), "Cost"]} />
                <Area type="monotone" dataKey="total_cost" stroke="#39B26B" fill="url(#costGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-ink-primary mb-0.5">Daily Token Usage</h2>
              <p className="text-xs text-ink-muted mb-4">Total tokens (input + output) per day</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={timeseries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F1ED" />
                  <XAxis dataKey="date" tick={{ fill: "#9A9A9A", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#9A9A9A", fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [v.toLocaleString(), "Tokens"]} />
                  <Line type="monotone" dataKey="total_tokens" stroke="#d97706" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-5">
              <h2 className="text-sm font-semibold text-ink-primary mb-0.5">Daily API Calls</h2>
              <p className="text-xs text-ink-muted mb-4">Number of LLM requests per day</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={timeseries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F1ED" />
                  <XAxis dataKey="date" tick={{ fill: "#9A9A9A", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#9A9A9A", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [v.toLocaleString(), "Calls"]} />
                  <Line type="monotone" dataKey="total_calls" stroke="#3ECF8E" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      <QuickStart apiKey={apiKey} />
    </div>
  );
}
