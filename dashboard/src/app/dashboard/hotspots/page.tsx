"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Info, Trash2 } from "lucide-react";
import { api, Hotspot } from "@/lib/api";

function LatencyBadge({ ms }: { ms: number }) {
  const color =
    ms > 5000 ? "text-red-400 bg-red-400/10" :
    ms > 2000 ? "text-yellow-400 bg-yellow-400/10" :
    "text-green-400 bg-green-400/10";
  return (
    <span className={`font-mono text-xs px-2 py-0.5 rounded-full ${color}`}>
      {Math.round(ms)}ms
    </span>
  );
}

const COST_COLORS = ["#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe", "#ddd6fe", "#ede9fe", "#f5f3ff", "#faf5ff"];

export default function HotspotsPage() {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<string | null>(null);

  useEffect(() => {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;
    setLoading(true);
    api.metrics.hotspots(projectId, days).then(setHotspots).finally(() => setLoading(false));
  }, [days]);

  async function handleDeleteTag(featureTag: string) {
    const projectId = localStorage.getItem("active_project");
    if (!projectId) return;
    await api.metrics.deleteFeatureTag(projectId, featureTag);
    setHotspots((prev) => prev.filter((h) => h.feature_tag !== featureTag));
    setConfirmDeleteTag(null);
  }

  const chartData = hotspots.slice(0, 8).map((h) => ({
    name: h.feature_tag === "__untagged__"
      ? "Untagged"
      : h.feature_tag.length > 16 ? h.feature_tag.slice(0, 16) + "…" : h.feature_tag,
    cost: h.total_cost,
  }));

  const totalCost = hotspots.reduce((sum, h) => sum + h.total_cost, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Cost Hotspots</h1>
          <p className="text-sm text-gray-400">Your features ranked by LLM spend — find where to optimise first</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none"
        >
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      {/* What are feature tags? */}
      <div className="flex items-start gap-2.5 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
        <Info size={14} className="text-brand-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-gray-400 leading-relaxed">
          Features are grouped by <span className="text-gray-200 font-medium">feature tags</span> set in the SDK
          (e.g. <code className="bg-gray-800 px-1 rounded text-gray-300">feature_tag("summarize")</code>).
          Untagged calls are grouped together as <span className="text-gray-200 font-medium">Untagged</span>.
          Tag your features to see precise per-feature costs.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : hotspots.length === 0 ? (
        <div className="text-center text-gray-500 py-16">No data for this period. Extend the time range or add more SDK calls.</div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">Total spend</div>
              <div className="text-lg font-bold text-white">${totalCost.toFixed(7)}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">Features tracked</div>
              <div className="text-lg font-bold text-white">{hotspots.length}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">Top feature share</div>
              <div className="text-lg font-bold text-white">
                {totalCost > 0 ? `${((hotspots[0].total_cost / totalCost) * 100).toFixed(0)}%` : "—"}
              </div>
            </div>
          </div>

          {/* Bar chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-1">Cost by Feature</h2>
            <p className="text-xs text-gray-500 mb-4">Top 8 features by total spend in this period</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `$${v.toFixed(4)}`} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#9ca3af", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                  itemStyle={{ color: "#ffffff" }}
                  formatter={(v: number) => [`$${v.toFixed(7)}`, "Total cost"]}
                />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={COST_COLORS[i % COST_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">All Features</h2>
              <p className="text-xs text-gray-500">Click any row to view suggestions for that feature</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs">
                  <th className="text-left px-4 py-3 font-medium">Feature tag</th>
                  <th className="text-right px-4 py-3 font-medium">Total cost</th>
                  <th className="text-right px-4 py-3 font-medium">% of spend</th>
                  <th className="text-right px-4 py-3 font-medium">Tokens</th>
                  <th className="text-right px-4 py-3 font-medium">Calls</th>
                  <th className="text-right px-4 py-3 font-medium">Avg latency</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {hotspots.map((h, i) => {
                  const sharePct = totalCost > 0 ? (h.total_cost / totalCost) * 100 : 0;
                  const displayTag = h.feature_tag === "__untagged__" ? "Untagged" : h.feature_tag;
                  const isConfirming = confirmDeleteTag === h.feature_tag;
                  return (
                    <tr key={h.feature_tag} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-600 w-4 flex-shrink-0">{i + 1}</span>
                          <span className={`font-medium ${h.feature_tag === "__untagged__" ? "text-gray-500 italic" : "text-white"}`}>
                            {displayTag}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-brand-400">
                        ${h.total_cost.toFixed(7)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full bg-brand-500 rounded-full"
                              style={{ width: `${Math.min(sharePct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-8 text-right">{sharePct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">
                        {h.total_tokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">
                        {h.total_calls.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <LatencyBadge ms={h.avg_latency_ms} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isConfirming ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleDeleteTag(h.feature_tag)}
                              className="text-[10px] px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setConfirmDeleteTag(null)}
                              className="text-[10px] px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteTag(h.feature_tag)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-red-400"
                            title="Delete all events for this feature tag"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
