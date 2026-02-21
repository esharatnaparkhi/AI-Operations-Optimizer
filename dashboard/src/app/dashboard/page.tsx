"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area
} from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Zap, Clock, Activity } from "lucide-react";
import { api, Overview, DailyMetric } from "@/lib/api";

function StatCard({
  label, value, sub, icon: Icon, trend, color = "brand",
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; trend?: number; color?: string;
}) {
  const colorMap: Record<string, string> = {
    brand: "text-brand-400 bg-brand-400/10",
    green: "text-green-400 bg-green-400/10",
    yellow: "text-yellow-400 bg-yellow-400/10",
    purple: "text-purple-400 bg-purple-400/10",
  };
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${colorMap[color]}`}>
          <Icon size={16} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-red-400" : "text-green-400"}`}>
            {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(trend).toFixed(1)}%
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
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center gap-5">
      <svg width="88" height="88" viewBox="0 0 88 88">
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
      <div>
        <div className="text-sm font-medium text-white mb-1">Efficiency Score</div>
        <div className="text-xs text-gray-400">
          {score >= 75 ? "Great! System is running efficiently." :
           score >= 50 ? "Room for improvement — check suggestions." :
           "High latency or errors detected."}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [timeseries, setTimeseries] = useState<DailyMetric[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (!overview) {
    return (
      <div className="p-8 text-gray-500 text-center">
        <p>No data yet. Install the SDK and make some LLM calls.</p>
        <pre className="mt-4 text-left bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs text-green-400 max-w-lg mx-auto">
{`pip install llm-monitor-sdk

from llm_monitor import LLMMonitor
monitor = LLMMonitor(api_key="YOUR_PROJECT_KEY")
client = monitor.wrap_openai(openai.OpenAI())`}
        </pre>
      </div>
    );
  }

  const fmtCost = (n: number) =>
    n < 0.01 ? `$${(n * 100).toFixed(3)}¢` : `$${n.toFixed(4)}`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <p className="text-sm text-gray-400">Today's LLM activity across your project</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Today's Cost" value={fmtCost(overview.today_cost)}
          icon={DollarSign} trend={overview.cost_trend_pct} color="brand"
          sub="vs yesterday"
        />
        <StatCard
          label="Tokens Used" value={overview.today_tokens.toLocaleString()}
          icon={Zap} color="yellow"
        />
        <StatCard
          label="API Calls" value={overview.today_calls.toLocaleString()}
          icon={Activity} color="green"
        />
        <StatCard
          label="Avg Latency" value={`${Math.round(overview.avg_latency_ms)}ms`}
          icon={Clock} color="purple"
        />
      </div>

      {/* Efficiency ring */}
      <EfficiencyRing score={overview.efficiency_score} />

      {/* Cost chart */}
      {timeseries.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Cost — Last 14 days</h2>
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
                itemStyle={{ color: "#a5b4fc" }}
                formatter={(v: number) => [`$${v.toFixed(4)}`, "Cost"]}
              />
              <Area type="monotone" dataKey="total_cost" stroke="#6366f1" fill="url(#costGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tokens chart */}
      {timeseries.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Tokens — Last 14 days</h2>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={timeseries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                formatter={(v: number) => [v.toLocaleString(), "Tokens"]}
              />
              <Line type="monotone" dataKey="total_tokens" stroke="#fbbf24" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
