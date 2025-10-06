"use client";
/* eslint react-hooks/exhaustive-deps:0 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Plus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ==== Types ====
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
  /** NEW: tanggal mulai proyek (ISO yyyy-mm-dd) */
  startDate?: string;
  /** Tenggat proyek (ISO yyyy-mm-dd) */
  deadline: string;
  tasks: Task[];
  archived?: boolean;
}

// ==== Firebase ====
import { db, initAnalytics } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";

// ---- Helpers (id, date, progress) ----
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function toDateAtStart(s: string) {
  return new Date(s + (s.length <= 10 ? "T00:00:00" : ""));
}
function toDateAtEnd(s: string) {
  const d = new Date(s + (s.length <= 10 ? "T00:00:00" : ""));
  d.setHours(23, 59, 59, 999);
  return d;
}
function daysUntil(deadlineISO: string) {
  const now = new Date();
  const ms = toDateAtEnd(deadlineISO).getTime() - now.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
function prettyDaysLeft(n: number) {
  if (n < 0) return `Lewat ${Math.abs(n)} hari`;
  if (n === 0) return "Tenggat: Hari ini";
  if (n === 1) return "Sisa 1 hari";
  return `Sisa ${n} hari`;
}
function projectProgress(p: Project) {
  if (!p.tasks?.length) return 0;
  const done = p.tasks.filter((t) => t.status === "done").length;
  return Math.round((done / p.tasks.length) * 100);
}
function formatDate(dateStr: string) {
  const date = toDateAtStart(dateStr);
  const m = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${date.getDate()} ${m[date.getMonth()]} ${date.getFullYear()}`;
}
function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
/** default start: 30 hari sebelum deadline */
function defaultStartFromDeadline(deadlineISO: string) {
  const d = toDateAtStart(deadlineISO);
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

// ---- Runtime guards to avoid any ----
function asStringArray(x: unknown): string[] {
  if (Array.isArray(x)) return x.map((v) => String(v)).filter(Boolean);
  return [];
}
function isTask(obj: unknown): obj is Task {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  const statusSet = new Set<TaskStatus>(["todo", "ongoing", "done"]);
  return typeof o.title === "string" && statusSet.has(o.status as TaskStatus);
}
function asTaskArray(x: unknown): Task[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter(isTask)
    .map((t) => ({
      id: typeof t.id === "string" && t.id ? t.id : generateId(),
      title: t.title,
      status: (t.status as TaskStatus) ?? "todo",
      area: typeof t.area === "string" ? t.area : undefined,
    }));
}

// ---- Firestore mappers (tanpa any) ----
type FirestoreProjectFields = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  functionalAreas?: unknown;
  startDate?: unknown;   // NEW
  deadline?: unknown;
  tasks?: unknown;
  archived?: unknown;
};

function mapDocToProject(d: QueryDocumentSnapshot<DocumentData>): Project {
  const data = d.data() as FirestoreProjectFields;
  const id = typeof data.id === "string" && data.id ? data.id : d.id;
  const name = typeof data.name === "string" ? data.name : "";
  const description = typeof data.description === "string" ? data.description : "";
  const functionalAreas = asStringArray(data.functionalAreas);
  const deadline =
    typeof data.deadline === "string" && data.deadline
      ? data.deadline
      : new Date().toISOString().slice(0, 10);
  const startDate =
    typeof data.startDate === "string" && data.startDate
      ? data.startDate
      : defaultStartFromDeadline(deadline);
  const tasks = asTaskArray(data.tasks);
  const archived = Boolean(data.archived);

  return { id, name, description, functionalAreas, startDate, deadline, tasks, archived };
}

async function loadProjectsCloud(): Promise<Project[]> {
  const snap = await getDocs(collection(db, "projects"));
  return snap.docs.map(mapDocToProject);
}

async function saveProjectsCloud(projects: Project[]) {
  await Promise.all(
    projects.map((p) =>
      setDoc(
        doc(db, "projects", p.id),
        { ...p, updatedAt: serverTimestamp() },
        { merge: true }
      )
    )
  );
}

/* === Compact CalendarCard + Progress & Timeline split === */

type CalendarCell = { date: Date; inMonth: boolean };
export type MonthCursor = { y: number; m0: number };

function buildMonthMatrix(year: number, month0: number): CalendarCell[][] {
  const first = new Date(year, month0, 1);
  const startDayMon0 = (first.getDay() + 6) % 7; // 0=Mon..6=Sun
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const prevMonthDays = new Date(year, month0, 0).getDate();
  const cells: CalendarCell[] = [];

  for (let i = startDayMon0 - 1; i >= 0; i--) cells.push({ date: new Date(year, month0 - 1, prevMonthDays - i), inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month0, d), inMonth: true });
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last); next.setDate(last.getDate() + 1);
    cells.push({ date: next, inMonth: false });
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last); next.setDate(last.getDate() + 1);
    cells.push({ date: next, inMonth: false });
  }

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function overlapsMonth(p: Project, year: number, month0: number) {
  const s = toDateAtStart(p.startDate ?? defaultStartFromDeadline(p.deadline));
  const e = toDateAtEnd(p.deadline);
  const mStart = new Date(year, month0, 1);
  const mEnd = new Date(year, month0 + 1, 0, 23, 59, 59, 999);
  return s <= mEnd && e >= mStart;
}

function CalendarCard({ projects, cursor, setCursor }: { projects: Project[]; cursor: MonthCursor; setCursor: React.Dispatch<React.SetStateAction<MonthCursor>>; }) {
  const weeks = useMemo(() => buildMonthMatrix(cursor.y, cursor.m0), [cursor]);

  const deadlinesMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) {
      const iso = (p.deadline || "").slice(0, 10);
      if (!iso) continue;
      m.set(iso, (m.get(iso) ?? 0) + 1);
    }
    return m;
  }, [projects]);

  const monthLabel = useMemo(() => {
    const months = [
      "Januari",
      "Februari",
      "Maret",
      "April",
      "Mei",
      "Juni",
      "Juli",
      "Agustus",
      "September",
      "Oktober",
      "November",
      "Desember",
    ];
    return `${months[cursor.m0]} ${cursor.y}`;
  }, [cursor]);

  function cellColor(iso: string): string | null {
    if (!deadlinesMap.has(iso)) return null;
    const diff = daysUntil(iso);
    if (diff < 0) return "bg-red-500 text-white";
    if (diff <= 7) return "bg-amber-500 text-white";
    return "bg-emerald-500 text-white";
  }

  return (
    <div className="rounded-xl border bg-white p-3 sm:p-4 w-full max-w-[260px] lg:w-[260px] xl:max-w-[280px] xl:w-[280px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1">
          <button
            aria-label="Prev"
            onClick={() =>
              setCursor((c) =>
                c.m0 - 1 < 0 ? { y: c.y - 1, m0: 11 } : { y: c.y, m0: c.m0 - 1 }
              )
            }
            className="p-1 rounded-md hover:bg-slate-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            aria-label="Next"
            onClick={() =>
              setCursor((c) =>
                c.m0 + 1 > 11 ? { y: c.y + 1, m0: 0 } : { y: c.y, m0: c.m0 + 1 }
              )
            }
            className="p-1 rounded-md hover:bg-slate-100"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-semibold ml-1">{monthLabel}</h3>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[10px]">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> &gt;7h
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> ≤7h
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Lewat
          </span>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-slate-500">
        {["Sen","Sel","Rab","Kam","Jum","Sab","Min"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map(({ date, inMonth }) => {
          const yyyy = date.getFullYear();
          const mm = pad2(date.getMonth() + 1);
          const dd = pad2(date.getDate());
          const iso = `${yyyy}-${mm}-${dd}`;
          const count = deadlinesMap.get(iso) ?? 0;
          const color = cellColor(iso);
          const isToday = date.toDateString() === new Date().toDateString();

          return (
            <div
              key={iso}
              title={count > 0 ? `${count} tenggat` : undefined}
              className={`h-8 sm:h-9 rounded-lg border flex flex-col items-center justify-center select-none ${
                inMonth ? "bg-white" : "bg-slate-50 text-slate-400"
              } ${isToday ? "ring-1 ring-blue-500" : ""}`}
            >
              <div className="text-[11px] leading-none">{date.getDate()}</div>
              {count > 0 && (
                <div
                  className={`mt-0.5 px-1 py-[1px] rounded-full text-[9px] leading-none ${
                    color ?? "bg-slate-200"
                  }`}
                >
                  {count}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProgressCard({ projects, cursor }: { projects: Project[]; cursor: MonthCursor }) {
  const monthProjects = useMemo(() => {
    return projects
      .filter((p) => {
        const d = toDateAtStart(p.deadline);
        return d.getFullYear() === cursor.y && d.getMonth() === cursor.m0;
      })
      .sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
  }, [projects, cursor]);

  const avgProgress = useMemo(() => {
    if (monthProjects.length === 0) return 0;
    const sum = monthProjects.reduce((acc, p) => acc + projectProgress(p), 0);
    return Math.round(sum / monthProjects.length);
  }, [monthProjects]);

  return (
    <div className="rounded-xl border bg-white p-3 sm:p-4 w-full">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-semibold">Progress Proyek</h4>
        <span className="text-[10px] text-slate-500">{monthProjects.length} proyek</span>
      </div>

      {/* Rata-rata */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-[11px] text-slate-600">
          <span>Rata-rata</span>
          <span>{avgProgress}%</span>
        </div>
        <div className="mt-1 h-2 w-full bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500" style={{ width: `${avgProgress}%` }} />
        </div>
      </div>

      {/* Per proyek (maks 6) */}
      {monthProjects.slice(0, 6).map((p) => {
        const pct = projectProgress(p);
        return (
          <div key={p.id} className="mb-2 last:mb-0">
            <div className="flex items-center justify-between text-[11px] text-slate-600">
              <span className="truncate" title={p.name}>
                {p.name}
              </span>
              <span>{pct}%</span>
            </div>
            <div className="mt-1 h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}

      {monthProjects.length === 0 && (
        <p className="text-[11px] text-slate-500">Tidak ada proyek di bulan ini.</p>
      )}
    </div>
  );
}

function YearTimelineCard({ projects, cursor }: { projects: Project[]; cursor: MonthCursor }) {
  const yearProjects = useMemo(() => {
    return projects.filter((p) => {
      const s = toDateAtStart(p.startDate ?? defaultStartFromDeadline(p.deadline));
      const e = toDateAtEnd(p.deadline);
      return !(e.getFullYear() < cursor.y || s.getFullYear() > cursor.y);
    });
  }, [projects, cursor.y]);

  return (
    <div className="rounded-xl border bg-white p-3 sm:p-4 w-full">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-semibold">Timeline {cursor.y}</h4>
        <span className="text-[10px] text-slate-500">{yearProjects.length} proyek</span>
      </div>

      {/* Header bulan */}
      <div className="grid grid-cols-12 text-[9px] text-slate-500 mb-1">
        {["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"].map((m) => (
          <div key={m} className="text-center">
            {m}
          </div>
        ))}
      </div>

      {/* Bar per proyek (maks 6 bar biar muat) */}
      <div className="space-y-1">
        {yearProjects.slice(0, 6).map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="truncate text-[11px] w-[120px]" title={p.name}>
              {p.name}
            </span>
            <div className="grid grid-cols-12 gap-[2px] flex-1">
              {Array.from({ length: 12 }).map((_, i) => {
                const active = overlapsMonth(p, cursor.y, i);
                return (
                  <div
                    key={i}
                    className={`h-2 rounded ${active ? "bg-blue-500" : "bg-slate-200"}`}
                    title={active ? "Dalam durasi proyek" : undefined}
                  />
                );
              })}
            </div>
          </div>
        ))}
        {yearProjects.length === 0 && (
          <p className="text-[11px] text-slate-500">Tidak ada durasi proyek di tahun ini.</p>
        )}
      </div>
    </div>
  );
}

/* =================== End Sidebar Cards =================== */

// ---- Component (Main) ----
export default function ProjectDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState<"all" | "ongoing" | "week" | "overdue">("all");

  const now = new Date();
  const [cursor, setCursor] = useState<MonthCursor>({ y: now.getFullYear(), m0: now.getMonth() });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState<{
    name: string;
    description: string;
    functionalAreas: string[];
    startDate: string;     // NEW
    deadline: string;
    tasks: Task[];
    archived: boolean;
  }>({
    name: "",
    description: "",
    functionalAreas: [],
    startDate: "",
    deadline: "",
    tasks: [],
    archived: false,
  });

  // teks mentah "Area Fungsional"
  const [faText, setFaText] = useState("");

  // analytics
  useEffect(() => {
    initAnalytics();
  }, []);

  // load once from cloud
  useEffect(() => {
    (async () => {
      const rows = await loadProjectsCloud();
      setProjects(rows);
      setLoaded(true);
    })();
  }, []);

  // persist to cloud
  useEffect(() => {
    if (!loaded) return;
    void saveProjectsCloud(projects);
  }, [projects, loaded]);

  // derived
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

  const stats = useMemo(
    () => ({
      total: projects.filter((p) => !p.archived).length,
      ongoing: projects.reduce((acc, p) => acc + p.tasks.filter((t) => t.status === "ongoing").length, 0),
      dueWeek: projects.filter((p) => !p.archived && daysUntil(p.deadline) >= 0 && daysUntil(p.deadline) <= 7).length,
      overdue: projects.filter((p) => daysUntil(p.deadline) < 0 && !p.archived).length,
    }),
    [projects]
  );

  // handlers
  function resetForm() {
    setForm({
      name: "",
      description: "",
      functionalAreas: [],
      startDate: "",
      deadline: "",
      tasks: [],
      archived: false,
    });
    setFaText("");
  }
  function openCreate() {
    resetForm();
    setEditing(null);
    setOpen(true);
  }
  function openEdit(p: Project) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      functionalAreas: p.functionalAreas ?? [],
      startDate: p.startDate ?? "",
      deadline: p.deadline,
      tasks: p.tasks ?? [],
      archived: Boolean(p.archived),
    });
    setFaText((p.functionalAreas ?? []).join(", "));
    setOpen(true);
  }
  async function removeProject(id: string) {
    if (!confirm("Yakin ingin menghapus proyek ini?")) return;
    setProjects((prev) => prev.filter((p) => p.id !== id));
    try {
      await deleteDoc(doc(db, "projects", id));
    } catch {}
  }
  function toggleArchive(p: Project) {
    setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, archived: !x.archived } : x)));
  }
  function upsertProject() {
    const normalizedAreas = faText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const start =
      form.startDate && form.startDate.trim()
        ? form.startDate
        : defaultStartFromDeadline(form.deadline || new Date().toISOString().slice(0, 10));

    const payload: Project = {
      id: editing?.id ?? generateId(),
      name: form.name || "Untitled",
      description: form.description || "",
      functionalAreas: normalizedAreas,
      startDate: start,
      deadline: form.deadline || new Date().toISOString().slice(0, 10),
      tasks: (form.tasks || []).map((t) => ({
        id: t.id || generateId(),
        title: t.title || "",
        status: t.status ?? "todo",
        area: t.area,
      })),
      archived: form.archived || false,
    };

    setProjects((prev) => {
      const exists = prev.some((p) => p.id === payload.id);
      return exists ? prev.map((p) => (p.id === payload.id ? payload : p)) : [payload, ...prev];
    });

    setOpen(false);
    setEditing(null);
    resetForm();
  }
  function addTaskRow() {
    setForm((f) => ({
      ...f,
      tasks: [...f.tasks, { id: generateId(), title: "", status: "todo", area: "" }],
    }));
  }
  function updateTask(idx: number, patch: Partial<Task>) {
    setForm((f) => {
      const tasks = [...f.tasks];
      tasks[idx] = { ...tasks[idx], ...patch };
      return { ...f, tasks };
    });
  }
  function removeTaskRow(idx: number) {
    setForm((f) => {
      const tasks = [...f.tasks];
      tasks.splice(idx, 1);
      return { ...f, tasks };
    });
  }
  function setProjectTaskStatus(projectId: string, taskId: string, status: TaskStatus) {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) }
          : p
      )
    );
  }

  // ---- UI ----
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-7xl p-6 md:p-10">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard Manajemen Proyek</h1>
            <p className="text-slate-600">
              Masukkan proyek, atur analisis fungsional, kelola tenggat & pantau progres.
            </p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-2 shadow-sm w-full md:w-80">
              <Search size={16} className="opacity-70" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari proyek / tugas / area..."
                className="h-8 border-0 outline-none bg-transparent w-full"
              />
            </div>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 rounded-2xl bg-black text-white px-4 py-2 hover:bg-black/90"
              type="button"
            >
              <Plus size={16} /> Proyek Baru
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Proyek Aktif" value={stats.total} icon={<CheckCircle2 className="h-5 w-5" />} />
          <StatCard title="Tugas On Going" value={stats.ongoing} icon={<Clock className="h-5 w-5" />} />
          <StatCard title="Jatuh Tempo (≤7 hari)" value={stats.dueWeek} icon={<AlertTriangle className="h-5 w-5" />} />
          <StatCard title="Terlambat" value={stats.overdue} icon={<AlertTriangle className="h-5 w-5" />} />
        </div>

        {/* Sidebar (Calendar) + Main (Filters + List) */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
          {/* Sidebar: Calendar + (Progress & Timeline) */}
          <aside className="order-2 lg:order-1 lg:sticky top-6">
            <CalendarCard projects={projects} cursor={cursor} setCursor={setCursor} />
          </aside>

          {/* Main: Filters + List */}
          <main className="order-1 lg:order-2">
            {/* Filters */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-2 bg-slate-100 rounded-2xl p-1">
                {(["all", "ongoing", "week", "overdue"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                      tab === t ? "bg-white shadow-sm" : "hover:bg-white/50"
                    }`}
                    type="button"
                  >
                    {t === "all"
                      ? "Semua"
                      : t === "ongoing"
                      ? "Ada On Going"
                      : t === "week"
                      ? "Jatuh Tempo Minggu Ini"
                      : "Terlambat"}
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

            {/* List */}
            <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
              {filtered.map((p) => (
                <div key={p.id} className="rounded-2xl border bg-white shadow-sm p-4 h-full">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <h3 className="text-base sm:text-lg font-semibold break-words">{p.name}</h3>
                      <p className="text-xs sm:text-sm text-slate-500 line-clamp-2 break-words">
                        {p.description}
                      </p>
                    </div>
                    <div className="flex gap-1 sm:gap-2">
                      <button
                        onClick={() => openEdit(p)}
                        className="p-2 hover:bg-slate-100 rounded-lg"
                        title="Edit"
                        type="button"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => toggleArchive(p)}
                        className="p-2 hover:bg-slate-100 rounded-lg text-xs"
                        title="Arsip"
                        type="button"
                      >
                        {p.archived ? "📂" : "📁"}
                      </button>
                      <button
                        onClick={() => removeProject(p.id)}
                        className="p-2 hover:bg-slate-100 rounded-lg"
                        title="Hapus"
                        type="button"
                      >
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl border p-3">
                      <p className="text-xs text-slate-500">Tenggat</p>
                      <p className="text-sm font-medium">
                        {p.deadline ? formatDate(p.deadline) : "-"}
                      </p>
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
                        <div
                          key={t.id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border p-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {t.title || "(tanpa judul)"}
                            </p>
                            <p className="truncate text-xs text-slate-500">{t.area || "—"}</p>
                          </div>
                          <select
                            value={t.status}
                            onChange={(e) =>
                              setProjectTaskStatus(p.id, t.id, e.target.value as TaskStatus)
                            }
                            className="ml-0 sm:ml-2 px-2 py-1 border rounded-lg text-sm w-full sm:w-36"
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

            {/* Progress + Timeline section BELOW calendar, full width */}
            <section className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
              <ProgressCard projects={projects} cursor={cursor} />
              <YearTimelineCard projects={projects} cursor={cursor} />
            </section>
          </main>
        </div>

        {/* === Dialog: Tambah / Edit Proyek === */}
        {open && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
              <div className="p-6 border-b">
                <h2 className="text-xl font-semibold">
                  {editing ? "Edit Proyek" : "Tambah Proyek"}
                </h2>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Nama Proyek</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Deskripsi</label>
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Area Fungsional (pisahkan dengan koma)
                    </label>
                    <input
                      placeholder="Auth, Pembayaran, Laporan..."
                      value={faText}
                      onChange={(e) => setFaText(e.target.value)}
                      onBlur={() =>
                        setForm((f) => ({
                          ...f,
                          functionalAreas: faText
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }))
                      }
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>

                  {/* Start + Deadline */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-sm font-medium mb-2">Tanggal Mulai</label>
                      <input
                        type="date"
                        value={form.startDate}
                        onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Tenggat Waktu</label>
                      <input
                        type="date"
                        value={form.deadline}
                        onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Daftar Tugas</label>
                  <button
                    onClick={addTaskRow}
                    className="flex items-center gap-2 px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm"
                    type="button"
                  >
                    <Plus size={14} /> Tambah Tugas
                  </button>
                </div>

                <div className="border rounded-2xl">
                  <div className="max-h-[300px] overflow-y-auto p-2">
                    {form.tasks.length === 0 && (
                      <p className="p-4 text-sm text-slate-500">
                        Belum ada tugas. Tambahkan minimal satu tugas.
                      </p>
                    )}
                    <div className="space-y-3">
                      {form.tasks.map((t, idx) => (
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
                              value={t.area ?? ""}
                              onChange={(e) => updateTask(idx, { area: e.target.value })}
                              className="w-full px-3 py-2 border rounded-lg"
                            />
                            <div className="flex gap-2">
                              <select
                                value={t.status}
                                onChange={(e) =>
                                  updateTask(idx, { status: (e.target.value as TaskStatus) })
                                }
                                className="flex-1 px-3 py-2 border rounded-lg"
                              >
                                <option value="todo">Belum Mulai</option>
                                <option value="ongoing">On Going</option>
                                <option value="done">Selesai</option>
                              </select>
                              <button
                                onClick={() => removeTaskRow(idx)}
                                className="p-2 hover:bg-slate-100 rounded-lg"
                                type="button"
                              >
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
                    checked={form.archived}
                    onChange={(e) => setForm({ ...form, archived: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Arsipkan proyek ini</span>
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 border rounded-2xl hover:bg-slate-50"
                    type="button"
                  >
                    Batal
                  </button>
                  <button
                    onClick={upsertProject}
                    className="px-4 py-2 bg-black text-white rounded-2xl hover:bg-black/90"
                    type="button"
                  >
                    {editing ? "Simpan Perubahan" : "Tambah"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-10 border-t pt-10 text-center text-sm text-slate-500">
          Project Management.
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
    <div className="rounded-2xl border bg-white p-4 h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm text-slate-500">{title}</h3>
        <div className="opacity-60">{icon}</div>
      </div>
      <div className="text-2xl sm:text-3xl font-semibold">{value}</div>
    </div>
  );
}
