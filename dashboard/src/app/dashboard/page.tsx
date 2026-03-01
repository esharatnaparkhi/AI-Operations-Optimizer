"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area
} from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Zap, Clock, Activity, ArrowRight } from "lucide-react";
import Link from "next/link";
import { api, Overview, DailyMetric } from "@/lib/api";

/** Always shows 7 decimal places for cost values */
function fmtCost(n: number): string {
  if (n === 0) return "$0.0000000";
  if (n >= 1) return `$${n.toFixed(7)}`;
  return `$${n.toFixed(7)}`;
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
    ? "Fair — check the Suggestions page for optimizations"
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

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [timeseries, setTimeseries] = useState<DailyMetric[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  useEffect(() => {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;

    Promise.all([
      api.metrics.overview(projectId),
      api.metrics.timeseries(projectId, 14),
    ]).then(([ov, ts]) => {
      setOverview(ov);
      setTimeseries(ts);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!overview || (overview.today_calls === 0 && timeseries.length === 0)) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-xl font-bold text-white mb-1">Overview</h1>
        <p className="text-sm text-gray-500 mb-8">{today}</p>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-600/20 rounded-lg flex items-center justify-center">
              <Zap size={16} className="text-brand-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">No data yet</p>
              <p className="text-xs text-gray-400">Install the SDK and make LLM calls to see metrics here.</p>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-4">
            <p className="text-xs text-gray-500 mb-3">Quick start (Python):</p>
            <pre className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-xs text-green-400 overflow-auto">
{`pip install llm-monitor-sdk

from llm_monitor import LLMMonitor
import openai

monitor = LLMMonitor(api_key="YOUR_PROJECT_KEY")
client = monitor.wrap_openai(openai.OpenAI())
# That's it — all calls are now tracked automatically`}
            </pre>
          </div>
          <Link
            href="/dashboard/settings"
            className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
          >
            Get your API key in Settings <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    );
  }

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
          label="Tokens used"
          value={overview.today_tokens.toLocaleString()}
          icon={Zap}
          color="yellow"
          tooltip="Total input + output tokens consumed today"
        />
        <StatCard
          label="API calls"
          value={overview.today_calls.toLocaleString()}
          icon={Activity}
          color="green"
          tooltip="Number of LLM API calls made today"
        />
        <StatCard
          label="Avg latency"
          value={`${Math.round(overview.avg_latency_ms)}ms`}
          icon={Clock}
          color="purple"
          sub="average response time"
          tooltip="Mean time from request to first response token"
        />
      </div>

      {/* Efficiency ring */}
      <EfficiencyRing score={overview.efficiency_score} />

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
                  tickFormatter={(v) => `$${v.toFixed(3)}`} />
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
    </div>
  );
}
