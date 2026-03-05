/**
 * Typed API client for the backend.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return null as T;
  }
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────

export const api = {
  auth: {
    register: (email: string, password: string, name?: string) =>
      request("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      }),
    login: (email: string, password: string) =>
      request<{ access_token: string }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
  },

  projects: {
    list: () => request<Project[]>("/api/v1/projects"),
    create: (name: string) =>
      request<Project>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    updateMode: (projectId: string, suggestion_mode: string) =>
      request<Project>(`/api/v1/projects/${projectId}/mode`, {
        method: "PATCH",
        body: JSON.stringify({ suggestion_mode }),
      }),
    delete: (projectId: string) =>
      request(`/api/v1/projects/${projectId}`, { method: "DELETE" }),
  },

  metrics: {
    overview: (projectId: string) =>
      request<Overview>(`/api/v1/metrics/${projectId}/overview`),
    timeseries: (projectId: string, days = 30) =>
      request<DailyMetric[]>(`/api/v1/metrics/${projectId}/timeseries?days=${days}`),
    hotspots: (projectId: string, days = 7) =>
      request<Hotspot[]>(`/api/v1/metrics/${projectId}/hotspots?days=${days}`),
    deleteFeatureTag: (projectId: string, featureTag: string) =>
      request(`/api/v1/metrics/${projectId}/feature/${encodeURIComponent(featureTag)}`, {
        method: "DELETE",
      }),
  },

  suggestions: {
    list: (projectId: string) =>
      request<Suggestion[]>(`/api/v1/suggestions/${projectId}`),
    simulate: (suggestionId: string) =>
      request<SimulateResult>("/api/v1/suggestions/simulate", {
        method: "POST",
        body: JSON.stringify({ suggestion_id: suggestionId }),
      }),
    apply: (suggestionId: string, applyMode = "snippet") =>
      request<ApplyResult>("/api/v1/suggestions/apply", {
        method: "POST",
        body: JSON.stringify({ suggestion_id: suggestionId, apply_mode: applyMode }),
      }),
    dismiss: (suggestionId: string) =>
      request(`/api/v1/suggestions/${suggestionId}/dismiss`, { method: "POST" }),
  },
};

// ── Types ──────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  api_key: string;
  created_at: string;
  suggestion_mode: string;
}

export interface Overview {
  today_cost: number;
  today_tokens: number;
  today_calls: number;
  avg_latency_ms: number;
  efficiency_score: number;
  cost_trend_pct: number;
}

export interface DailyMetric {
  date: string;
  total_calls: number;
  total_tokens: number;
  total_cost: number;
  avg_latency_ms: number;
  error_count: number;
}

export interface Hotspot {
  feature_tag: string;
  total_cost: number;
  total_tokens: number;
  total_calls: number;
  avg_latency_ms: number;
}

export interface Suggestion {
  id: string;
  suggestion_type: string;
  feature_tag: string | null;
  title: string;
  description: string;
  current_cost_per_day: number | null;
  projected_cost_per_day: number | null;
  estimated_savings_pct: number | null;
  accuracy_risk: string | null;
  confidence: number | null;
  payload: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

export interface SimulateResult {
  suggestion_id: string;
  current_monthly_cost: number;
  projected_daily_cost: number;
  projected_monthly_cost: number;
  savings_usd_monthly: number;
  savings_pct: number;
  accuracy_risk: string;
  sample_size: number;
}

export interface ApplyResult {
  suggestion_id: string;
  mode: string;
  snippet: string | null;
  message: string;
}
