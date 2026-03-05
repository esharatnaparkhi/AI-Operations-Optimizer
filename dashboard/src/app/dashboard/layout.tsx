"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, Flame, Lightbulb, Settings, LogOut,
  ChevronDown, Plus, Activity, X, Check, Trash2
} from "lucide-react";
import { api, Project } from "@/lib/api";

const NAV = [
  { href: "/dashboard",             label: "Overview",      icon: LayoutDashboard, description: "Today's cost, tokens & latency" },
  { href: "/dashboard/hotspots",    label: "Cost Hotspots", icon: Flame,           description: "Which features spend the most" },
  { href: "/dashboard/suggestions", label: "Suggestions",   icon: Lightbulb,       description: "AI-backed savings recommendations" },
  { href: "/dashboard/settings",    label: "Settings & SDK",icon: Settings,        description: "API key & integration guide" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [projects,        setProjects]        = useState<Project[]>([]);
  const [activeProject,   setActiveProject]   = useState<Project | null>(null);
  const [showProjects,    setShowProjects]    = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName,  setNewProjectName]  = useState("");
  const [creating,        setCreating]        = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) { router.push("/"); return; }
    api.projects.list().then((ps) => {
      setProjects(ps);
      const saved = localStorage.getItem("active_project");
      const found = ps.find((p) => p.id === saved) || ps[0];
      if (found) { setActiveProject(found); localStorage.setItem("active_project", found.id); }
    }).catch(() => router.push("/"));
  }, [router]);

  useEffect(() => { if (creatingProject) inputRef.current?.focus(); }, [creatingProject]);

  function logout() { localStorage.clear(); router.push("/"); }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const p = await api.projects.create(name);
      setProjects((prev) => [...prev, p]);
      setActiveProject(p);
      localStorage.setItem("active_project", p.id);
      setNewProjectName(""); setCreatingProject(false); setShowProjects(false);
    } finally { setCreating(false); }
  }

  function cancelCreate() { setCreatingProject(false); setNewProjectName(""); }

  async function handleDeleteProject(projectId: string) {
    await api.projects.delete(projectId);
    const remaining = projects.filter((p) => p.id !== projectId);
    setProjects(remaining);
    setConfirmDeleteId(null);
    if (activeProject?.id === projectId) {
      const next = remaining[0] || null;
      setActiveProject(next);
      if (next) localStorage.setItem("active_project", next.id);
      else localStorage.removeItem("active_project");
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-base-bg">
      {/* ── Sidebar ── */}
      <aside className="sidebar w-64 flex-shrink-0 flex flex-col">

        {/* Logo */}
        <div className="px-5 py-5 border-b border-base-border">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #39B26B 0%, #2FAE70 100%)" }}
            >
              L
            </div>
            <div>
              <div className="font-semibold text-sm text-ink-primary leading-tight">LLM Monitor</div>
              <div className="text-[10px] text-ink-muted leading-tight">Efficiency Dashboard</div>
            </div>
          </div>
        </div>

        {/* Project switcher */}
        <div className="px-3 py-3 border-b border-base-border">
          <div className="text-[10px] uppercase tracking-wider text-ink-muted px-2 mb-1.5 font-medium">Project</div>
          <button
            onClick={() => { setShowProjects(!showProjects); setCreatingProject(false); }}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-base-card transition-colors text-sm"
          >
            <span className="text-ink-body truncate font-medium text-xs">
              {activeProject?.name || "Select project"}
            </span>
            <ChevronDown
              size={13}
              className={`text-ink-muted flex-shrink-0 transition-transform ${showProjects ? "rotate-180" : ""}`}
            />
          </button>

          {showProjects && (
            <div className="mt-1.5 bg-white border border-base-border rounded-xl overflow-hidden shadow-card-hover">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center group">
                  <button
                    onClick={() => {
                      setActiveProject(p);
                      localStorage.setItem("active_project", p.id);
                      setShowProjects(false);
                      setConfirmDeleteId(null);
                    }}
                    className={`flex-1 text-left px-3 py-2 text-xs hover:bg-base-card transition-colors flex items-center gap-2 min-w-0 ${
                      p.id === activeProject?.id ? "text-brand-600 font-semibold" : "text-ink-body"
                    }`}
                  >
                    {p.id === activeProject?.id && (
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
                    )}
                    <span className="truncate">{p.name}</span>
                  </button>
                  {confirmDeleteId === p.id ? (
                    <div className="flex items-center gap-1 pr-2 flex-shrink-0">
                      <button
                        onClick={() => handleDeleteProject(p.id)}
                        className="text-[10px] px-1.5 py-0.5 bg-red-500 hover:bg-red-400 text-white rounded-lg transition-colors"
                      >Delete</button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[10px] px-1.5 py-0.5 bg-base-card hover:bg-base-border text-ink-body rounded-lg transition-colors"
                      >Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(p.id); }}
                      className="pr-2 opacity-0 group-hover:opacity-100 transition-opacity text-ink-muted hover:text-red-500 flex-shrink-0"
                      title="Delete project"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}

              {creatingProject ? (
                <div className="px-3 py-2.5 border-t border-base-border space-y-2">
                  <input
                    ref={inputRef}
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateProject();
                      if (e.key === "Escape") cancelCreate();
                    }}
                    placeholder="Project name"
                    className="w-full bg-base-card border border-base-border rounded-lg px-2.5 py-1.5 text-xs text-ink-primary placeholder-ink-muted focus:outline-none focus:border-brand-400"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleCreateProject}
                      disabled={!newProjectName.trim() || creating}
                      className="flex items-center gap-1 px-2.5 py-1 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs rounded-lg transition-colors font-medium"
                    >
                      <Check size={10} /> {creating ? "Creating…" : "Create"}
                    </button>
                    <button
                      onClick={cancelCreate}
                      className="flex items-center gap-1 px-2.5 py-1 bg-base-card hover:bg-base-border text-ink-body text-xs rounded-lg transition-colors"
                    >
                      <X size={10} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCreatingProject(true)}
                  className="w-full text-left px-3 py-2 text-xs text-ink-muted hover:bg-base-card flex items-center gap-1.5 border-t border-base-border transition-colors"
                >
                  <Plus size={11} /> New project
                </button>
              )}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-ink-muted px-2 mb-2 font-medium">Navigation</div>
          {NAV.map(({ href, label, icon: Icon, description }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all group ${
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-body hover:text-ink-primary hover:bg-base-card"
                }`}
              >
                <Icon
                  size={15}
                  className={`flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                    active ? "text-brand-600" : "text-ink-icon"
                  }`}
                  strokeWidth={1.6}
                />
                <div className="min-w-0">
                  <div className={`font-semibold leading-tight text-sm ${active ? "" : ""}`}>{label}</div>
                  <div className={`text-[10px] leading-tight truncate ${active ? "text-brand-500" : "text-ink-muted"}`}>
                    {description}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-3 border-t border-base-border">
          <button
            onClick={logout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-ink-muted hover:text-ink-primary hover:bg-base-card w-full transition-colors"
          >
            <LogOut size={14} strokeWidth={1.6} />
            <span className="text-xs font-medium">Sign out</span>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-auto">
        {activeProject ? children : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm px-6">
              <div className="w-14 h-14 card card-hover rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Activity size={24} className="text-ink-muted" strokeWidth={1.5} />
              </div>
              <p className="text-ink-primary font-semibold mb-1.5">No projects yet</p>
              <p className="text-sm text-ink-body mb-6 leading-relaxed">
                Create a project to start monitoring your LLM API costs and latency.
              </p>
              <button
                onClick={() => { setShowProjects(true); setCreatingProject(true); }}
                className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
              >
                Create your first project
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
