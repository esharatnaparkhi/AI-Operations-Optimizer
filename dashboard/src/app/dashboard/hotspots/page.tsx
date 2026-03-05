"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Info, Trash2 } from "lucide-react";
import { api, Hotspot } from "@/lib/api";

function LatencyBadge({ ms }: { ms: number }) {
  const style =
    ms > 5000 ? "text-red-600 bg-red-50 border-red-200" :
    ms > 2000 ? "text-amber-600 bg-amber-50 border-amber-200" :
    "text-emerald-700 bg-emerald-50 border-emerald-200";
  return (
    <span className={`font-mono text-xs px-2 py-0.5 rounded-full border ${style}`}>
      {Math.round(ms)}ms
    </span>
  );
}

const COST_COLORS = ["#39B26B", "#3ECF8E", "#2FAE70", "#4fd68a", "#5de899", "#72ecaa", "#88efbb", "#9df2cc"];

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

export default function HotspotsPage() {
  const [hotspots,          setHotspots]          = useState<Hotspot[]>([]);
  const [days,              setDays]              = useState(7);
  const [loading,           setLoading]           = useState(true);
  const [confirmDeleteTag,  setConfirmDeleteTag]  = useState<string | null>(null);

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
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-primary">Cost Hotspots</h1>
          <p className="text-sm text-ink-muted">Your features ranked by LLM spend — find where to optimise first</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-white border border-base-border text-sm text-ink-body rounded-xl px-3 py-2 focus:outline-none focus:border-brand-400 shadow-card cursor-pointer"
        >
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      {/* Info banner */}
      <div className="surface flex items-start gap-2.5 px-4 py-3">
        <Info size={14} className="text-brand-500 flex-shrink-0 mt-0.5" strokeWidth={1.6} />
        <p className="text-xs text-ink-body leading-relaxed">
          Features are grouped by <span className="text-ink-primary font-semibold">feature tags</span> set in the SDK
          (e.g. <code className="bg-base-card px-1 rounded text-ink-body border border-base-border2">feature_tag("summarize")</code>).
          Untagged calls appear as <span className="text-ink-primary font-semibold">Untagged</span>.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-14">
          <div className="animate-spin w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : hotspots.length === 0 ? (
        <div className="card p-16 text-center text-ink-muted text-sm">
          No data for this period. Extend the time range or add more SDK calls.
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card card-hover p-4">
              <div className="text-xs text-ink-muted mb-1.5 font-medium">Total spend</div>
              <div className="text-lg font-bold text-ink-primary tabular-nums">${totalCost.toFixed(7)}</div>
            </div>
            <div className="card card-hover p-4">
              <div className="text-xs text-ink-muted mb-1.5 font-medium">Features tracked</div>
              <div className="text-lg font-bold text-ink-primary">{hotspots.length}</div>
            </div>
            <div className="card card-hover p-4">
              <div className="text-xs text-ink-muted mb-1.5 font-medium">Top feature share</div>
              <div className="text-lg font-bold text-ink-primary">
                {totalCost > 0 ? `${((hotspots[0].total_cost / totalCost) * 100).toFixed(0)}%` : "—"}
              </div>
            </div>
          </div>

          {/* Bar chart */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink-primary mb-0.5">Cost by Feature</h2>
            <p className="text-xs text-ink-muted mb-4">Top 8 features by total spend in this period</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F1ED" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#9A9A9A", fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `$${v.toFixed(4)}`} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#6A6A6A", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  {...CHART_TOOLTIP}
                  formatter={(v: number) => [`$${v.toFixed(7)}`, "Total cost"]}
                />
                <Bar dataKey="cost" radius={[0, 6, 6, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={COST_COLORS[i % COST_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-base-border">
              <h2 className="text-sm font-semibold text-ink-primary">All Features</h2>
              <p className="text-xs text-ink-muted">Features sorted by total cost, highest first</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-border bg-base-card text-ink-muted text-xs">
                  <th className="text-left px-5 py-3 font-semibold">Feature tag</th>
                  <th className="text-right px-5 py-3 font-semibold">Total cost</th>
                  <th className="text-right px-5 py-3 font-semibold">% of spend</th>
                  <th className="text-right px-5 py-3 font-semibold">Tokens</th>
                  <th className="text-right px-5 py-3 font-semibold">Calls</th>
                  <th className="text-right px-5 py-3 font-semibold">Avg latency</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {hotspots.map((h, i) => {
                  const sharePct   = totalCost > 0 ? (h.total_cost / totalCost) * 100 : 0;
                  const displayTag = h.feature_tag === "__untagged__" ? "Untagged" : h.feature_tag;
                  const isConfirming = confirmDeleteTag === h.feature_tag;
                  return (
                    <tr
                      key={h.feature_tag}
                      className="border-b border-base-border/60 hover:bg-base-card transition-colors group"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs text-ink-muted w-4 flex-shrink-0 tabular-nums">{i + 1}</span>
                          <span className={`font-medium text-sm ${
                            h.feature_tag === "__untagged__" ? "text-ink-muted italic" : "text-ink-primary"
                          }`}>
                            {displayTag}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-brand-600 font-semibold text-xs tabular-nums">
                        ${h.total_cost.toFixed(7)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-base-card border border-base-border2 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full bg-brand-500 rounded-full"
                              style={{ width: `${Math.min(sharePct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-ink-muted w-8 text-right tabular-nums">{sharePct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right text-ink-muted text-xs tabular-nums">
                        {h.total_tokens.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right text-ink-muted text-xs tabular-nums">
                        {h.total_calls.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <LatencyBadge ms={h.avg_latency_ms} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        {isConfirming ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleDeleteTag(h.feature_tag)}
                              className="text-[10px] px-2 py-0.5 bg-red-500 hover:bg-red-400 text-white rounded-lg transition-colors font-medium"
                            >Delete</button>
                            <button
                              onClick={() => setConfirmDeleteTag(null)}
                              className="text-[10px] px-2 py-0.5 bg-base-card hover:bg-base-border text-ink-body rounded-lg transition-colors border border-base-border"
                            >Cancel</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteTag(h.feature_tag)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-muted hover:text-red-500"
                            title="Delete all events for this feature tag"
                          >
                            <Trash2 size={13} strokeWidth={1.5} />
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
