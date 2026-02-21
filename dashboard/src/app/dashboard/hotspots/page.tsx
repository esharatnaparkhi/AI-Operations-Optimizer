"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api, Hotspot } from "@/lib/api";

function Badge({ label }: { label: string }) {
  return <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-400 rounded-full">{label}</span>;
}

export default function HotspotsPage() {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;
    setLoading(true);
    api.metrics.hotspots(projectId, days).then(setHotspots).finally(() => setLoading(false));
  }, [days]);

  const chartData = hotspots.slice(0, 8).map((h) => ({
    name: h.feature_tag.length > 14 ? h.feature_tag.slice(0, 14) + "…" : h.feature_tag,
    cost: h.total_cost,
    tokens: h.total_tokens,
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Hot Endpoints</h1>
          <p className="text-sm text-gray-400">Features ranked by LLM cost</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none"
        >
          <option value={1}>Last 24h</option>
          <option value={7}>Last 7d</option>
          <option value={30}>Last 30d</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : hotspots.length === 0 ? (
        <div className="text-center text-gray-500 py-16">No data yet for this period.</div>
      ) : (
        <>
          {/* Bar chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Cost by Feature</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `$${v.toFixed(4)}`} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#9ca3af", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                  formatter={(v: number) => [`$${v.toFixed(6)}`, "Cost"]}
                />
                <Bar dataKey="cost" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-xs">
                  <th className="text-left px-4 py-3">Feature / Endpoint</th>
                  <th className="text-right px-4 py-3">Cost</th>
                  <th className="text-right px-4 py-3">Tokens</th>
                  <th className="text-right px-4 py-3">Calls</th>
                  <th className="text-right px-4 py-3">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {hotspots.map((h, i) => (
                  <tr key={h.feature_tag} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 text-white font-medium">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 w-4">{i + 1}</span>
                        {h.feature_tag}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-brand-400">
                      ${h.total_cost.toFixed(4)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {h.total_tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {h.total_calls.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono ${h.avg_latency_ms > 5000 ? "text-red-400" : h.avg_latency_ms > 2000 ? "text-yellow-400" : "text-green-400"}`}>
                        {Math.round(h.avg_latency_ms)}ms
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
