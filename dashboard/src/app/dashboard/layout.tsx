"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, Flame, Lightbulb, Settings, LogOut,
  ChevronDown, Plus, Activity, X, Check
} from "lucide-react";
import { api, Project } from "@/lib/api";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, description: "Today's cost, tokens & latency" },
  { href: "/dashboard/hotspots", label: "Cost Hotspots", icon: Flame, description: "Which features spend the most" },
  { href: "/dashboard/suggestions", label: "Suggestions", icon: Lightbulb, description: "AI-backed savings recommendations" },
  { href: "/dashboard/settings", label: "Settings & SDK", icon: Settings, description: "API key & integration guide" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [showProjects, setShowProjects] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) { router.push("/"); return; }

    api.projects.list().then((ps) => {
      setProjects(ps);
      const saved = localStorage.getItem("active_project");
      const found = ps.find((p) => p.id === saved) || ps[0];
      if (found) {
        setActiveProject(found);
        localStorage.setItem("active_project", found.id);
      }
    }).catch(() => router.push("/"));
  }, [router]);

  useEffect(() => {
    if (creatingProject) inputRef.current?.focus();
  }, [creatingProject]);

  function logout() {
    localStorage.clear();
    router.push("/");
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const p = await api.projects.create(name);
      setProjects((prev) => [...prev, p]);
      setActiveProject(p);
      localStorage.setItem("active_project", p.id);
      setNewProjectName("");
      setCreatingProject(false);
      setShowProjects(false);
    } finally {
      setCreating(false);
    }
  }

  function cancelCreate() {
    setCreatingProject(false);
    setNewProjectName("");
  }

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-gray-800 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-500 rounded-md flex items-center justify-center text-white font-bold text-xs">L</div>
            <div>
              <div className="font-semibold text-white text-sm leading-tight">LLM Monitor</div>
              <div className="text-gray-500 text-[10px] leading-tight">Efficiency Dashboard</div>
            </div>
          </div>
        </div>

        {/* Project switcher */}
        <div className="px-3 py-3 border-b border-gray-800">
          <div className="text-[10px] uppercase tracking-wider text-gray-600 px-2 mb-1">Project</div>
          <button
            onClick={() => { setShowProjects(!showProjects); setCreatingProject(false); }}
            className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-gray-800 transition-colors text-sm"
          >
            <span className="text-gray-300 truncate">{activeProject?.name || "Select project"}</span>
            <ChevronDown size={14} className={`text-gray-500 flex-shrink-0 transition-transform ${showProjects ? "rotate-180" : ""}`} />
          </button>

          {showProjects && (
            <div className="mt-1 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setActiveProject(p);
                    localStorage.setItem("active_project", p.id);
                    setShowProjects(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-800 transition-colors flex items-center gap-2 ${
                    p.id === activeProject?.id ? "text-brand-400" : "text-gray-300"
                  }`}
                >
                  {p.id === activeProject?.id && <span className="w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0" />}
                  <span className="truncate">{p.name}</span>
                </button>
              ))}

              {creatingProject ? (
                <div className="px-3 py-2 border-t border-gray-800 space-y-2">
                  <input
                    ref={inputRef}
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateProject();
                      if (e.key === "Escape") cancelCreate();
                    }}
                    placeholder="Project name"
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleCreateProject}
                      disabled={!newProjectName.trim() || creating}
                      className="flex items-center gap-1 px-2 py-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs rounded transition-colors"
                    >
                      <Check size={10} /> {creating ? "Creating…" : "Create"}
                    </button>
                    <button
                      onClick={cancelCreate}
                      className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-colors"
                    >
                      <X size={10} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCreatingProject(true)}
                  className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-800 flex items-center gap-1.5 border-t border-gray-800 transition-colors"
                >
                  <Plus size={12} /> New project
                </button>
              )}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-600 px-2 mb-2">Navigation</div>
          {NAV.map(({ href, label, icon: Icon, description }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors group ${
                  active
                    ? "bg-brand-600/20 text-brand-400"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`}
              >
                <Icon size={15} className="flex-shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium leading-tight">{label}</div>
                  <div className={`text-[10px] leading-tight truncate ${active ? "text-brand-500/70" : "text-gray-600"}`}>
                    {description}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="px-3 py-3 border-t border-gray-800">
          <button
            onClick={logout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 w-full transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {activeProject
          ? children
          : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center max-w-sm">
                <div className="w-12 h-12 bg-gray-900 border border-gray-800 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Activity size={24} className="text-gray-700" />
                </div>
                <p className="text-white font-medium mb-1">No projects yet</p>
                <p className="text-sm text-gray-500 mb-5">Create a project to start monitoring your LLM API costs and latency.</p>
                <button
                  onClick={() => { setShowProjects(true); setCreatingProject(true); }}
                  className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 transition-colors"
                >
                  Create your first project
                </button>
              </div>
            </div>
          )
        }
      </main>
    </div>
  );
}
