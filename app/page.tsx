"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Plus, CheckCircle2, Clock, AlertTriangle, Search, Pencil, Trash2 } from "lucide-react";

// Firebase
import { db, initAnalytics } from "@/lib/firebase";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";

// ---- Types ----
export type TaskStatus = "todo" | "ongoing" | "done";

export interface Task {
  id: string;
  title: string;
  area?: string;
  status: TaskStatus;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  functionalAreas: string[];
  deadline: string;
  tasks: Task[];
  archived?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

// ---- Helpers ----
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr + (dateStr.length <= 10 ? "T00:00:00" : ""));
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function daysUntil(deadlineISO: string) {
  const now = new Date();
  const deadline = new Date(deadlineISO + (deadlineISO.length <= 10 ? "T00:00:00" : ""));
  const ms = deadline.setHours(23, 59, 59, 999) - now.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function projectProgress(p: Project) {
  if (!p.tasks?.length) return 0;
  const done = p.tasks.filter((t) => t.status === "done").length;
  return Math.round((done / p.tasks.length) * 100);
}

function countOngoingTasks(projects: Project[]) {
  return projects.reduce((acc, p) => acc + p.tasks.filter((t) => t.status === "ongoing").length, 0);
}

function countDueWithin(projects: Project[], daysRange: number) {
  return projects.filter(
    (p) => !p.archived && daysUntil(p.deadline) >= 0 && daysUntil(p.deadline) <= daysRange
  ).length;
}

function countOverdue(projects: Project[]) {
  return projects.filter((p) => daysUntil(p.deadline) < 0 && !p.archived).length;
}

function prettyDaysLeft(n: number) {
  if (n < 0) return `Lewat ${Math.abs(n)} hari`;
  if (n === 0) return "Tenggat: Hari ini";
  if (n === 1) return "Sisa 1 hari";
  return `Sisa ${n} hari`;
}

// ---- Component ----
export default function ProjectDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState<"all" | "ongoing" | "week" | "overdue">("all");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState<Partial<Project>>({
    name: "",
    description: "",
    functionalAreas: [],
    deadline: "",
    tasks: [],
  });

  // Analytics (opsional)
  useEffect(() => {
    initAnalytics();
  }, []);

  // Realtime load from Firestore (tanpa localStorage)
  useEffect(() => {
    const qRef = query(collection(db, "projects"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: data.id ?? d.id,
            name: data.name ?? "",
            description: data.description ?? "",
            functionalAreas: Array.isArray(data.functionalAreas) ? data.functionalAreas : [],
            deadline: data.deadline ?? "",
            tasks: Array.isArray(data.tasks) ? data.tasks : [],
            archived: !!data.archived,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          } as Project;
        });
        setProjects(rows);
        setLoaded(true);
      },
      () => setLoaded(true)
    );
    return () => unsub();
  }, []);

  // Derived
  const filtered = useMemo(() => {
    const normalized = projects.filter((p) => (showArchived ? true : !p.archived));
    const byTab = normalized.filter((p) => {
      if (tab === "all") return true;
      if (tab === "ongoing") return p.tasks.some((t) => t.status === "ongoing");
      if (tab === "overdue") return daysUntil(p.deadline) < 0;
      if (tab === "week") return daysUntil(p.deadline) >= 0 && daysUntil(p.deadline) <= 7;
      return true;
    });
    if (!q.trim()) return byTab;
    const lower = q.toLowerCase();
    return byTab.filter((p) =>
      [p.name, p.description, p.functionalAreas.join(", "), p.tasks.map((t) => t.title).join(", ")]
        .join(" ")
        .toLowerCase()
        .includes(lower)
    );
  }, [projects, q, showArchived, tab]);

  const stats = useMemo(() => {
    return {
      total: projects.filter((p) => !p.archived).length,
      ongoing: countOngoingTasks(projects),
      dueWeek: countDueWithin(projects, 7),
      overdue: countOverdue(projects),
    };
  }, [projects]);

  // Handlers
  function resetForm() {
    setForm({ name: "", description: "", functionalAreas: [], deadline: "", tasks: [] });
  }
  function openCreate() {
    resetForm();
    setEditing(null);
    setOpen(true);
  }
  function openEdit(p: Project) {
    setEditing(p);
    setForm({ ...p });
    setOpen(true);
  }

  async function removeProject(id: string) {
    if (!confirm("Yakin ingin menghapus proyek ini?")) return;
    try {
      await deleteDoc(doc(db, "projects", id));
    } catch (e) {
      console.error(e);
      alert("Gagal menghapus proyek.");
    }
  }

  async function toggleArchive(p: Project) {
    try {
      await setDoc(
        doc(db, "projects", p.id),
        { archived: !p.archived, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
    }
  }

  async function upsertProject() {
    const payload: Project = {
      id: editing?.id ?? generateId(),
      name: String(form.name || "Untitled"),
      description: String(form.description || ""),
      functionalAreas: Array.isArray(form.functionalAreas)
        ? form.functionalAreas
        : String(form.functionalAreas || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
      deadline: form.deadline || new Date().toISOString().slice(0, 10),
      tasks: (form.tasks || []).map((t) => ({ ...t, id: t.id || generateId() })),
      archived: form.archived || false,
    };

    try {
      await setDoc(
        doc(db, "projects", payload.id),
        {
          ...payload,
          updatedAt: serverTimestamp(),
          ...(editing ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true }
      );
      setOpen(false);
      setEditing(null);
      resetForm();
    } catch (e) {
      console.error(e);
      alert("Gagal menyimpan proyek.");
    }
  }

  async function setProjectTaskStatus(projectId: string, taskId: string, status: TaskStatus) {
    // Cari project saat ini
    const p = projects.find((x) => x.id === projectId);
    if (!p) return;
    const newTasks = p.tasks.map((t) => (t.id === taskId ? { ...t, status } : t));
    try {
      await setDoc(
        doc(db, "projects", projectId),
        { tasks: newTasks, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
    }
  }

  function addTaskRow() {
    setForm((f) => ({
      ...f,
      tasks: [...(f.tasks || []), { id: generateId(), title: "", status: "todo" as TaskStatus, area: "" }],
    }));
  }
  function updateTask(idx: number, patch: Partial<Task>) {
    setForm((f) => {
      const tasks = [...(f.tasks || [])];
      tasks[idx] = { ...tasks[idx], ...patch } as Task;
      return { ...f, tasks };
    });
  }
  function removeTask(idx: number) {
    setForm((f) => {
      const tasks = [...(f.tasks || [])];
      tasks.splice(idx, 1);
      return { ...f, tasks };
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-7xl p-6 md:p-10">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard Manajemen Proyek</h1>
            <p className="text-slate-600">Masukkan proyek, atur analisis fungsional, kelola tenggat & pantau progres.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-2 shadow-sm">
              <Search size={16} className="opacity-70" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari proyek / tugas / area..."
                className="h-8 border-0 outline-none bg-transparent"
              />
            </div>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 rounded-2xl bg-black text-white px-4 py-2 hover:bg-black/90"
            >
              <Plus size={16} /> Proyek Baru
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <StatCard title="Proyek Aktif" value={stats.total} icon={<CheckCircle2 className="h-5 w-5" />} />
          <StatCard title="Tugas On Going" value={stats.ongoing} icon={<Clock className="h-5 w-5" />} />
          <StatCard title="Jatuh Tempo (≤7 hari)" value={stats.dueWeek} icon={<AlertTriangle className="h-5 w-5" />} />
          <StatCard title="Terlambat" value={stats.overdue} icon={<AlertTriangle className="h-5 w-5" />} />
        </div>

        {/* Filters */}
        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-2 bg-slate-100 rounded-2xl p-1">
            {(["all", "ongoing", "week", "overdue"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  tab === t ? "bg-white shadow-sm" : "hover:bg-white/50"
                }`}
              >
                {t === "all" ? "Semua" : t === "ongoing" ? "Ada On Going" : t === "week" ? "Jatuh Tempo Minggu Ini" : "Terlambat"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="w-4 h-4"
            />
            Tampilkan arsip
          </label>
        </div>

        {/* Projects List */}
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <div key={p.id} className="rounded-2xl border bg-white shadow-sm p-4">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <p className="text-sm text-slate-500 line-clamp-2">{p.description}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(p)} className="p-2 hover:bg-slate-100 rounded-lg" title="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => toggleArchive(p)} className="p-2 hover:bg-slate-100 rounded-lg text-xs" title="Arsip">
                    {p.archived ? "📂" : "📁"}
                  </button>
                  <button onClick={() => removeProject(p.id)} className="p-2 hover:bg-slate-100 rounded-lg" title="Hapus">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {p.functionalAreas.map((fa) => (
                  <span key={fa} className="px-3 py-1 bg-slate-100 rounded-full text-xs">
                    {fa}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-slate-500">Tenggat</p>
                  <p className="text-sm font-medium">{p.deadline ? formatDate(p.deadline) : "-"}</p>
                  <span
                    className={`inline-block mt-2 px-2 py-1 rounded-full text-xs ${
                      daysUntil(p.deadline) < 0
                        ? "bg-red-500 text-white"
                        : daysUntil(p.deadline) <= 7
                        ? "bg-amber-500 text-white"
                        : "bg-emerald-500 text-white"
                    }`}
                  >
                    {prettyDaysLeft(daysUntil(p.deadline))}
                  </span>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-slate-500">Progres</p>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span>{projectProgress(p)}%</span>
                    <span className="text-slate-500">
                      {p.tasks.filter((t) => t.status === "done").length}/{p.tasks.length} selesai
                    </span>
                  </div>
                  <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${projectProgress(p)}%` }} />
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Tugas</p>
                <div className="space-y-2">
                  {p.tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between rounded-xl border p-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.title || "(tanpa judul)"}</p>
                        <p className="truncate text-xs text-slate-500">{t.area || "—"}</p>
                      </div>
                      <select
                        value={t.status}
                        onChange={(e) => setProjectTaskStatus(p.id, t.id, e.target.value as TaskStatus)}
                        className="ml-2 px-2 py-1 border rounded-lg text-sm"
                      >
                        <option value="todo">Belum Mulai</option>
                        <option value="ongoing">On Going</option>
                        <option value="done">Selesai</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {!loaded && (
          <div className="mt-24 text-center text-slate-500">Memuat data…</div>
        )}
        {loaded && filtered.length === 0 && (
          <div className="mt-24 text-center text-slate-500">
            Tidak ada proyek. Tambahkan proyek baru untuk memulai.
          </div>
        )}

        {/* Dialog */}
        {open && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
              <div className="p-6 border-b">
                <h2 className="text-xl font-semibold">{editing ? "Edit Proyek" : "Tambah Proyek"}</h2>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Nama Proyek</label>
                  <input
                    value={form.name || ""}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Deskripsi</label>
                  <textarea
                    rows={3}
                    value={form.description || ""}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Area Fungsional (pisahkan dengan koma)</label>
                    <input
                      placeholder="Auth, Pembayaran, Laporan..."
                      value={
                        Array.isArray(form.functionalAreas)
                          ? form.functionalAreas.join(", ")
                          : (form.functionalAreas as any) || ""
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          functionalAreas: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Tenggat Waktu</label>
                    <input
                      type="date"
                      value={form.deadline || ""}
                      onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Daftar Tugas</label>
                  <button
                    onClick={addTaskRow}
                    className="flex items-center gap-2 px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm"
                  >
                    <Plus size={14} /> Tambah Tugas
                  </button>
                </div>

                <div className="border rounded-2xl">
                  <div className="max-h-[300px] overflow-y-auto p-2">
                    {(form.tasks || []).length === 0 && (
                      <p className="p-4 text-sm text-slate-500">Belum ada tugas. Tambahkan minimal satu tugas.</p>
                    )}
                    <div className="space-y-3">
                      {(form.tasks || []).map((t, idx) => (
                        <div key={t.id} className="grid gap-2 rounded-xl border p-3 bg-white">
                          <input
                            placeholder="Nama tugas"
                            value={t.title}
                            onChange={(e) => updateTask(idx, { title: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg"
                          />
                          <div className="grid sm:grid-cols-2 gap-2">
                            <input
                              placeholder="Area (opsional)"
                              value={t.area || ""}
                              onChange={(e) => updateTask(idx, { area: e.target.value })}
                              className="w-full px-3 py-2 border rounded-lg"
                            />
                            <div className="flex gap-2">
                              <select
                                value={t.status}
                                onChange={(e) => updateTask(idx, { status: e.target.value as TaskStatus })}
                                className="flex-1 px-3 py-2 border rounded-lg"
                              >
                                <option value="todo">Belum Mulai</option>
                                <option value="ongoing">On Going</option>
                                <option value="done">Selesai</option>
                              </select>
                              <button onClick={() => removeTask(idx)} className="p-2 hover:bg-slate-100 rounded-lg">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t flex items-center justify-between">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.archived}
                    onChange={(e) => setForm({ ...form, archived: e.target.checked })}
                    className="w-4 h-4"
                  />
                </label>
                <div className="flex gap-2">
                  <button onClick={() => setOpen(false)} className="px-4 py-2 border rounded-2xl hover:bg-slate-50">
                    Batal
                  </button>
                  <button onClick={upsertProject} className="px-4 py-2 bg-black text-white rounded-2xl hover:bg-black/90">
                    {editing ? "Simpan Perubahan" : "Tambah"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-10 border-t pt-10 text-center text-sm text-slate-500">
          Data disimpan di <span className="font-mono">Firebase Firestore</span>.
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number | string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm text-slate-500">{title}</h3>
        <div className="opacity-60">{icon}</div>
      </div>
      <div className="text-3xl font-semibold">{value}</div>
    </div>
  );
}
