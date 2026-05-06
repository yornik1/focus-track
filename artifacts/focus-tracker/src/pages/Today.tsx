import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTodayStats, pause, type TodayStats, type Category } from "@/api";

function scoreColor(score: number | null): string {
  if (score === null) return "#1e2535";
  if (score >= 7) return "#22c55e";
  if (score >= 4) return "#f59e0b";
  return "#ef4444";
}

function scoreTextColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

function categoryLabel(cat: Category): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

function categoryBadgeClass(cat: Category): string {
  switch (cat) {
    case "code": return "bg-blue-500/15 text-blue-300 border border-blue-500/20";
    case "video": return "bg-purple-500/15 text-purple-300 border border-purple-500/20";
    case "social": return "bg-amber-500/15 text-amber-300 border border-amber-500/20";
    case "idle": return "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20";
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function HourlyHeatmap({ data }: { data: TodayStats["hourly_heatmap"] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div>
      <div className="flex gap-1 items-end">
        {data.map(({ hour, avg_score }) => (
          <div key={hour} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <div
              className="relative group w-full rounded-sm transition-all"
              style={{
                height: 36,
                backgroundColor: avg_score !== null ? scoreColor(avg_score) : "#1e2535",
                opacity: avg_score !== null ? 0.85 + (avg_score / 10) * 0.15 : 1,
              }}
              onMouseEnter={() => setHovered(hour)}
              onMouseLeave={() => setHovered(null)}
            >
              {hovered === hour && avg_score !== null && (
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-popover border border-border rounded px-2 py-1 text-xs whitespace-nowrap z-10 shadow-lg">
                  <span className="font-medium">{String(hour).padStart(2, "0")}:00</span>
                  <span className="text-muted-foreground ml-1">— {avg_score.toFixed(1)}</span>
                </div>
              )}
            </div>
            {(hour % 4 === 0) && (
              <span className="text-[10px] text-muted-foreground">
                {hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-3 items-center">
        <span className="text-xs text-muted-foreground">Score</span>
        {[
          { label: "7–10", color: "#22c55e" },
          { label: "4–6", color: "#f59e0b" },
          { label: "0–3", color: "#ef4444" },
          { label: "No data", color: "#1e2535" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PauseDropdown({ onPause }: { onPause: (d: number | "evening") => void }) {
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);

  const options: { label: string; value: number | "evening" }[] = [
    { label: "15 minutes", value: 15 },
    { label: "30 minutes", value: 30 },
    { label: "60 minutes", value: 60 },
    { label: "Until evening", value: "evening" },
  ];

  const handleSelect = (value: number | "evening") => {
    onPause(value);
    setPaused(true);
    setOpen(false);
    setTimeout(() => setPaused(false), 3000);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
          paused
            ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
            : "bg-card border-border hover:bg-accent text-foreground"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
          <rect x="2" y="1.5" width="4" height="11" rx="1" fill="currentColor" />
          <rect x="8" y="1.5" width="4" height="11" rx="1" fill="currentColor" />
        </svg>
        {paused ? "Paused" : "Pause"}
        {!paused && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {open && (
        <div className="absolute top-full mt-1 right-0 bg-popover border border-border rounded-md shadow-lg py-1 w-44 z-50">
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => handleSelect(opt.value)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors text-foreground"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TodayPage() {
  const { data, isLoading, error } = useQuery<TodayStats>({
    queryKey: ["today"],
    queryFn: getTodayStats,
    refetchInterval: 30_000,
  });

  const mutation = useMutation({ mutationFn: pause });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 bg-primary rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-sm">Failed to load today's stats.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Today</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <PauseDropdown onPause={(d) => mutation.mutate(d)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1 bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current Status</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryBadgeClass(data.category)}`}>
              {categoryLabel(data.category)}
            </span>
          </div>

          <div className="flex items-end gap-3">
            <span className={`text-6xl font-bold tabular-nums leading-none ${scoreTextColor(data.focus_score)}`}>
              {data.focus_score.toFixed(1)}
            </span>
            <span className="text-lg text-muted-foreground mb-1">/10</span>
          </div>

          <div className="w-full bg-muted rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full transition-all"
              style={{
                width: `${(data.focus_score / 10) * 100}%`,
                backgroundColor: scoreColor(data.focus_score),
              }}
            />
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Last screenshot</span>
              <span className="text-foreground font-medium">{formatTime(data.last_screenshot)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Updated</span>
              <span className="text-foreground font-medium">
                {data.minutes_since_update === 0 ? "just now" : `${data.minutes_since_update}m ago`}
              </span>
            </div>
          </div>
        </div>

        <div className="md:col-span-2 grid grid-cols-3 gap-4">
          {[
            {
              label: "Focused Time",
              value: formatDuration(data.total_focused_minutes),
              sub: "score ≥ 6",
              color: "text-green-400",
            },
            {
              label: "Avg Score",
              value: data.avg_score.toFixed(1),
              sub: "all hours",
              color: scoreTextColor(data.avg_score),
            },
            {
              label: "Screenshots",
              value: String(data.total_screenshots),
              sub: "taken today",
              color: "text-blue-400",
            },
          ].map((stat) => (
            <div key={stat.label} className="bg-card border border-card-border rounded-xl p-5 flex flex-col justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</span>
              <div>
                <div className={`text-3xl font-bold tabular-nums ${stat.color}`}>{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{stat.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Hourly Heatmap</h2>
        <HourlyHeatmap data={data.hourly_heatmap} />
      </div>
    </div>
  );
}
