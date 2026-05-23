import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getTodayStats, getStreak, pause, type TodayStats, type StreakData, type Category } from "@/api";
import TimeCounters from "@/components/time-counters";

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

const CATEGORY_COLORS: Record<string, string> = {
  code: "bg-blue-500/15 text-blue-300 border border-blue-500/20",
  video: "bg-purple-500/15 text-purple-300 border border-purple-500/20",
  social: "bg-amber-500/15 text-amber-300 border border-amber-500/20",
  research: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20",
  communication: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/20",
  gaming: "bg-red-500/15 text-red-300 border border-red-500/20",
  news: "bg-orange-500/15 text-orange-300 border border-orange-500/20",
  design: "bg-pink-500/15 text-pink-300 border border-pink-500/20",
  writing: "bg-indigo-500/15 text-indigo-300 border border-indigo-500/20",
};

const PRODUCTIVE_BAR_COLORS: Record<string, string> = {
  code: "#3b82f6",
  research: "#10b981",
  design: "#ec4899",
  writing: "#6366f1",
  communication: "#06b6d4",
};
const DEFAULT_PRODUCTIVE_BAR = "#22c55e";

function categoryBadgeClass(cat: Category): string {
  return CATEGORY_COLORS[cat] ?? "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatMinutesOnly(minutes: number): string {
  return `${Math.round(minutes)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")}m`;
}

function HourlyHeatmap({ data }: { data: TodayStats["hourly_heatmap"] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const hoveredCell = hovered !== null ? data.find((d) => d.hour === hovered) ?? null : null;

  return (
    <div>
      <div className="relative">
        <div className="flex gap-1">
          {data.map(({ hour, avg_score }) => (
            <div
              key={hour}
              className="flex-1 min-w-0 relative"
              onMouseEnter={() => setHovered(hour)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className="w-full rounded-sm transition-colors"
                style={{
                  height: 36,
                  backgroundColor: avg_score !== null ? scoreColor(avg_score) : "#1e2535",
                  opacity: hovered === hour ? 1 : avg_score !== null ? 0.82 + (avg_score / 10) * 0.18 : 1,
                  outline: hovered === hour && avg_score !== null ? `2px solid ${scoreColor(avg_score)}` : "none",
                  outlineOffset: 2,
                }}
              />

              {hovered === hour && hoveredCell && hoveredCell.avg_score !== null && (
                <div
                  className="absolute bottom-[calc(100%+8px)] z-30 w-64 bg-popover border border-border rounded-lg shadow-xl p-3 space-y-2 pointer-events-none"
                  style={{
                    left: "50%",
                    transform: `translateX(${
                      hour < 4 ? "0%" : hour > 19 ? "-100%" : "-50%"
                    })`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-semibold text-foreground tabular-nums shrink-0">
                        {String(hoveredCell.hour).padStart(2, "0")}:00–{String(hoveredCell.hour + 1).padStart(2, "0")}:00
                      </span>
                      {hoveredCell.category && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${categoryBadgeClass(hoveredCell.category)}`}>
                          {categoryLabel(hoveredCell.category)}
                        </span>
                      )}
                    </div>
                    <span className={`text-sm font-bold tabular-nums shrink-0 ${scoreTextColor(hoveredCell.avg_score)}`}>
                      {hoveredCell.avg_score.toFixed(1)}
                    </span>
                  </div>
                  {hoveredCell.summary && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {hoveredCell.summary}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-1 mt-1">
          {data.map(({ hour }) => (
            <div key={hour} className="flex-1 min-w-0 text-center">
              {hour % 6 === 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {String(hour).padStart(2, "0")}
                </span>
              )}
            </div>
          ))}
        </div>
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

function Sparkline({ days }: { days: StreakData["last7days"] }) {
  const W = 160;
  const H = 44;
  const PAD = 4;
  if (days.length === 0) {
    return <svg width={W} height={H} />;
  }
  const values = days.map((d) => d.productive_minutes ?? 0);
  const max = Math.max(...values, 1);
  const xStep = (W - PAD * 2) / Math.max(values.length - 1, 1);
  const toY = (v: number) => PAD + (1 - v / max) * (H - PAD * 2);

  const points = values.map((v, i) => [PAD + i * xStep, toY(v)] as [number, number]);
  const polyline = points.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPath = [
    `M ${points[0][0]} ${H}`,
    ...points.map(([x, y]) => `L ${x} ${y}`),
    `L ${points[points.length - 1][0]} ${H}`,
    "Z",
  ].join(" ");

  const lastValue = values[values.length - 1];
  const lineColor = lastValue >= 120 ? "#22c55e" : lastValue >= 30 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-fill)" />
      <polyline points={polyline} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map(([x, y], i) => {
        const v = values[i];
        const c = v >= 120 ? "#22c55e" : v >= 30 ? "#f59e0b" : "#ef4444";
        const isLast = i === points.length - 1;
        return (
          <circle
            key={i}
            cx={x} cy={y} r={isLast ? 3 : 2}
            fill={c}
            stroke={isLast ? "hsl(222 13% 11%)" : "none"}
            strokeWidth={isLast ? 1.5 : 0}
          />
        );
      })}
    </svg>
  );
}

function weekCategoryTotals(days: StreakData["last7days"]): Array<{ category: string; minutes: number }> {
  const totals = new Map<string, number>();
  for (const d of days) {
    for (const [cat, mins] of Object.entries(d.productive_by_category ?? {})) {
      totals.set(cat, (totals.get(cat) ?? 0) + mins);
    }
  }
  return [...totals.entries()]
    .map(([category, minutes]) => ({ category, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

function dominantCategory(byCategory: Record<string, number>): string | null {
  let best: string | null = null;
  let bestMins = 0;
  for (const [cat, mins] of Object.entries(byCategory)) {
    if (mins > bestMins) {
      bestMins = mins;
      best = cat;
    }
  }
  return best;
}

function StreakCard({ data }: { data: StreakData }) {
  const days = data.last7days;
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const apiHasProductiveStats = days.some((d) => d.productive_minutes != null);
  const weekTotal = days.reduce((acc, d) => acc + (d.productive_minutes ?? 0), 0);
  const maxDayMinutes = Math.max(...days.map((d) => d.productive_minutes ?? 0), 1);
  const weekCategories = weekCategoryTotals(days);
  const productiveDays = days.filter((d) => (d.productive_minutes ?? 0) >= 30 && !d.is_weekend).length;

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex flex-col gap-3">
      {!apiHasProductiveStats && (
        <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
          Статистика недели устарела — перезапустите <span className="font-mono">pnpm dev</span> и обновите страницу.
        </p>
      )}
      <div className="flex items-center gap-6">
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-xl">
          ⏱
        </div>
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold tabular-nums text-emerald-400">{formatMinutesOnly(weekTotal)}</span>
          </div>
          <div className="text-sm text-muted-foreground font-medium">productive this week</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Streak: <span className="text-foreground font-medium">{data.streak} weekdays</span>
            <span className="mx-1">·</span>
            best {data.best_streak}
          </div>
          <div className="text-[10px] text-muted-foreground/80 mt-0.5 max-w-[160px]">
            code, research, design, writing, communication — ≥30m/day
          </div>
        </div>
      </div>

      <div className="w-px h-10 bg-border shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-end justify-between gap-1 mb-1">
          {days.map((d, i) => {
            const mins = d.productive_minutes ?? 0;
            const topCat = dominantCategory(d.productive_by_category ?? {});
            const color =
              mins === 0
                ? "#1e2535"
                : topCat
                  ? (PRODUCTIVE_BAR_COLORS[topCat] ?? DEFAULT_PRODUCTIVE_BAR)
                  : DEFAULT_PRODUCTIVE_BAR;
            const isToday = i === days.length - 1;
            const dayOfWeek = new Date(d.date).getDay();
            return (
              <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <div
                  className="w-full rounded-sm transition-all"
                  style={{
                    height: mins > 0 ? 6 + (mins / maxDayMinutes) * 26 : 6,
                    backgroundColor: color,
                    opacity: mins > 0 ? 0.85 : 0.3,
                    outline: isToday ? `1.5px solid ${color}` : "none",
                    outlineOffset: 2,
                  }}
                  title={
                    mins > 0
                      ? `${d.date}: ${formatMinutesOnly(mins)} productive`
                      : d.date
                  }
                />
                <span className={`text-[10px] tabular-nums ${isToday ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                  {dayLabels[dayOfWeek]}
                </span>
                {mins > 0 && (
                  <span className="text-[9px] text-muted-foreground tabular-nums leading-none">
                    {formatMinutesOnly(mins)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="shrink-0">
        <Sparkline days={days} />
      </div>

      <div className="shrink-0 text-right min-w-[88px]">
        <div className="text-xs text-muted-foreground mb-1">By category</div>
        {weekCategories.length === 0 ? (
          <div className="text-xs text-muted-foreground">No data</div>
        ) : (
          <div className="space-y-0.5">
            {weekCategories.slice(0, 4).map(({ category, minutes }) => (
              <div key={category} className="flex items-center justify-end gap-1.5 text-[10px] tabular-nums">
                <span className="capitalize text-muted-foreground">{category}</span>
                <span className="text-foreground font-medium">{formatMinutesOnly(minutes)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-muted-foreground mt-1.5">
          {productiveDays} productive weekdays
        </div>
      </div>
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

  const { data: streak } = useQuery<StreakData>({
    queryKey: ["streak"],
    queryFn: getStreak,
  });

  const mutation = useMutation({ mutationFn: pause });

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

      <TimeCounters />

      {isLoading && (
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
      )}

      {!isLoading && (error || !data) && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">Failed to load today's stats.</p>
        </div>
      )}

      {!isLoading && data && (
      <>
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

      {streak && <StreakCard data={streak} />}

      <div className="bg-card border border-card-border rounded-xl p-5">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Hourly Heatmap</h2>
        <HourlyHeatmap data={data.hourly_heatmap} />
      </div>
      </>
      )}
    </div>
  );
}
