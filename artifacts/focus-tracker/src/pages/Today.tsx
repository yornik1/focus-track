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

function categoryBadgeClass(cat: Category): string {
  return CATEGORY_COLORS[cat] ?? "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDuration(minutes: number): string {
  const safe = Number.isFinite(minutes) ? minutes : 0;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
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

function weekCategoryTotals(days: StreakData["last7days"]): Array<{ category: string; minutes: number }> {
  const totals = new Map<string, number>();
  for (const d of days) {
    for (const [cat, mins] of Object.entries(d.by_category ?? {})) {
      totals.set(cat, (totals.get(cat) ?? 0) + mins);
    }
  }
  return [...totals.entries()]
    .map(([category, minutes]) => ({ category, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

// Кольцо прогресса: лучшая непрерывная сессия сегодня vs адаптивная цель
function ProgressRing({ value, target, met }: { value: number; target: number; met: boolean }) {
  const size = 112;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const color = met ? "#22c55e" : pct > 0 ? "#f59e0b" : "#3b3f4a";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e2535" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`}
          style={{
            transition: "stroke-dasharray 0.6s ease, stroke 0.3s ease",
            filter: met ? `drop-shadow(0 0 6px ${color}aa)` : "none",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold tabular-nums leading-none ${met ? "text-green-400" : "text-foreground"}`}>
          {value}
          <span className="text-sm text-muted-foreground font-medium">m</span>
        </span>
        <span className="text-[10px] text-muted-foreground mt-0.5">{met ? "goal ✓" : `of ${target}m`}</span>
      </div>
    </div>
  );
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function FocusHero({ data }: { data: StreakData }) {
  const value = data.today_best_session_min ?? 0;
  const target = data.target_minutes || 15;
  const floor = data.floor_minutes || 15;
  const streak = data.streak ?? 0;
  const bestStreak = data.best_streak ?? 0;
  const personalBest = data.personal_best_min ?? 0;
  const days = data.last7days ?? [];
  const weekCats = weekCategoryTotals(days);
  const maxBar = Math.max(...days.map((d) => d.best_session_min ?? 0), target, 1);
  const BAR_AREA = 60;

  let statusText: string;
  let statusTone: string;
  if (data.today_target_met) {
    statusText = "Personal-best zone — tomorrow's bar nudges up 🔥";
    statusTone = "text-green-400";
  } else if (data.today_floor_met) {
    statusText = `Streak safe ✓ — ${target - value}m more to hit today's ${target}m goal`;
    statusTone = "text-green-400";
  } else if (value > 0) {
    statusText = `${floor - value}m more for your first focus block`;
    statusTone = "text-amber-400";
  } else {
    statusText = `Do one ${floor}-min focus block to keep your streak`;
    statusTone = "text-muted-foreground";
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="flex items-center gap-6 flex-wrap">
        {/* Кольцо + стрик */}
        <div className="flex items-center gap-4 shrink-0">
          <ProgressRing value={value} target={target} met={data.today_target_met} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl leading-none">🔥</span>
              <span className="text-4xl font-bold tabular-nums text-foreground leading-none">{streak}</span>
              <span className="text-sm text-muted-foreground">day{streak === 1 ? "" : "s"}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1.5">
              best streak <span className="text-foreground font-medium">{bestStreak}</span>
              <span className="mx-1.5">·</span>
              record <span className="text-foreground font-medium">{personalBest}m block</span>
            </div>
            <div className={`text-xs mt-1.5 font-medium ${statusTone}`}>{statusText}</div>
          </div>
        </div>

        <div className="w-px self-stretch bg-border shrink-0 hidden md:block" />

        {/* Недельная полоса: лучший непрерывный блок по дням + линия цели */}
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Best focus block · 7 days</span>
            <span className="text-[10px] text-muted-foreground">goal {target}m</span>
          </div>
          <div className="relative" style={{ height: BAR_AREA }}>
            <div
              className="absolute left-0 right-0 border-t border-dashed border-amber-400/40 z-10"
              style={{ bottom: Math.min(BAR_AREA, (target / maxBar) * BAR_AREA) }}
            />
            <div className="absolute inset-0 flex items-end justify-between gap-1.5">
              {days.map((d, i) => {
                const mins = d.best_session_min ?? 0;
                const h = mins > 0 ? Math.max(4, (mins / maxBar) * BAR_AREA) : 3;
                const color = d.target_met ? "#22c55e" : d.floor_met ? "#f59e0b" : mins > 0 ? "#6b7280" : "#1e2535";
                const isToday = i === days.length - 1;
                return (
                  <div key={d.date} className="flex-1 min-w-0 flex items-end" style={{ height: BAR_AREA }}>
                    <div
                      className="w-full rounded-sm transition-all"
                      style={{
                        height: h,
                        backgroundColor: color,
                        opacity: mins > 0 ? 0.9 : 0.4,
                        outline: isToday ? `1.5px solid ${color}` : "none",
                        outlineOffset: 2,
                        boxShadow: d.target_met ? `0 0 6px ${color}80` : "none",
                      }}
                      title={`${d.date}: best block ${mins}m`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex items-end justify-between gap-1.5 mt-1">
            {days.map((d, i) => {
              const isToday = i === days.length - 1;
              const dow = new Date(d.date).getDay();
              return (
                <div key={d.date} className="flex-1 text-center min-w-0">
                  <span className={`text-[10px] tabular-nums ${isToday ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                    {WEEKDAY_LABELS[dow]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-px self-stretch bg-border shrink-0 hidden lg:block" />

        {/* Deep work by category за неделю */}
        <div className="shrink-0 min-w-[120px] hidden lg:block">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Deep work · 7d</div>
          {weekCats.length === 0 ? (
            <div className="text-xs text-muted-foreground">No focus yet</div>
          ) : (
            <div className="space-y-0.5">
              {weekCats.slice(0, 4).map(({ category, minutes }) => (
                <div key={category} className="flex items-center justify-between gap-3 text-[11px] tabular-nums">
                  <span className="capitalize text-muted-foreground">{category}</span>
                  <span className="text-foreground font-medium">{formatMinutesOnly(minutes)}</span>
                </div>
              ))}
            </div>
          )}
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
              label: "Deep Work",
              value: formatDuration(data.deep_work_minutes ?? 0),
              sub: `longest block ${data.longest_session_min ?? 0}m`,
              color: "text-green-400",
            },
            {
              label: "Avg Score",
              value: data.avg_score.toFixed(1),
              sub: "focus quality",
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

      {streak && <FocusHero data={streak} />}

      <div className="bg-card border border-card-border rounded-xl p-5">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Hourly Heatmap</h2>
        <HourlyHeatmap data={data.hourly_heatmap} />
      </div>
      </>
      )}
    </div>
  );
}
