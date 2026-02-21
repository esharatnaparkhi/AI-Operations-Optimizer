"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, Zap, Lightbulb, Settings, LogOut,
  ChevronDown, Plus, Activity
} from "lucide-react";
import { api, Project } from "@/lib/api";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/hotspots", label: "Hot Endpoints", icon: Activity },
  { href: "/dashboard/suggestions", label: "Suggestions", icon: Lightbulb },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [showProjects, setShowProjects] = useState(false);

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

  function logout() {
    localStorage.clear();
    router.push("/");
  }

  async function createProject() {
    const name = prompt("Project name:");
    if (!name) return;
    const p = await api.projects.create(name);
    setProjects((prev) => [...prev, p]);
    setActiveProject(p);
    localStorage.setItem("active_project", p.id);
  }

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r border-gray-800 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-500 rounded-md flex items-center justify-center text-white font-bold text-xs">L</div>
            <span className="font-semibold text-white text-sm">LLM Monitor</span>
          </div>
        </div>

        {/* Project switcher */}
        <div className="px-3 py-3 border-b border-gray-800">
          <button
            onClick={() => setShowProjects(!showProjects)}
            className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-gray-800 transition-colors text-sm"
          >
            <span className="text-gray-300 truncate">{activeProject?.name || "Select project"}</span>
            <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />
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
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-800 transition-colors ${
                    p.id === activeProject?.id ? "text-brand-400" : "text-gray-300"
                  }`}
                >
                  {p.name}
                </button>
              ))}
              <button
                onClick={createProject}
                className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-800 flex items-center gap-1.5 border-t border-gray-800"
              >
                <Plus size={12} /> New project
              </button>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-brand-600/20 text-brand-400"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`}
              >
                <Icon size={15} />
                {label}
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
              <div className="text-center">
                <Zap size={40} className="mx-auto mb-3 text-gray-700" />
                <p className="mb-4">No projects yet</p>
                <button onClick={createProject} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">
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
