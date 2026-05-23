import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWeekLogs, type LogEntry } from "@/api";
import { ALLOWED_CATEGORIES } from "@workspace/categories";
import {
  prepareDayLayout,
  type LayoutSegment,
  type Segment,
} from "@/lib/calendar-layout";

const HOUR_HEIGHT = 64;
const START_HOUR = 7;
const END_HOUR = 21;
const MIN_HEIGHT_SINGLE = 8;
const MIN_HEIGHT_MULTI = 4;
const COLUMN_GAP_PX = 2;

const CAT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  code:          { bg: "rgba(59,130,246,0.18)",  border: "#3b82f6", text: "#93c5fd" },
  video:         { bg: "rgba(168,85,247,0.18)",  border: "#a855f7", text: "#d8b4fe" },
  social:        { bg: "rgba(245,158,11,0.18)",  border: "#f59e0b", text: "#fcd34d" },
  research:      { bg: "rgba(16,185,129,0.18)",  border: "#10b981", text: "#6ee7b7" },
  communication: { bg: "rgba(6,182,212,0.18)",   border: "#06b6d4", text: "#67e8f9" },
  gaming:        { bg: "rgba(239,68,68,0.18)",   border: "#ef4444", text: "#fca5a5" },
  news:          { bg: "rgba(249,115,22,0.18)",  border: "#f97316", text: "#fdba74" },
  writing:       { bg: "rgba(99,102,241,0.18)",  border: "#6366f1", text: "#a5b4fc" },
  design:        { bg: "rgba(236,72,153,0.18)",  border: "#ec4899", text: "#f9a8d4" },
};
const DEFAULT_CAT_COLOR = { bg: "rgba(107,114,128,0.12)", border: "#6b7280", text: "#9ca3af" };

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function timeToY(date: Date): number {
  const h = date.getHours() + date.getMinutes() / 60;
  return (h - START_HOUR) * HOUR_HEIGHT;
}

function scoreColor(score: number): string {
  if (score >= 7) return "#22c55e";
  if (score >= 4) return "#f59e0b";
  return "#ef4444";
}

function formatRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatWeekLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const m = monday.toLocaleDateString([], opts);
  const s = sunday.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  return `${m} – ${s}`;
}

function formatCategoryFlow(categories: string[]): string {
  return categories
    .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
    .join(" → ");
}

function segmentDurationPx(seg: Segment): number {
  return ((seg.end.getTime() - seg.start.getTime()) / 3_600_000) * HOUR_HEIGHT;
}

function categoryMinutesBreakdown(segs: LayoutSegment[]): Array<{ category: string; minutes: number }> {
  const byCat = new Map<string, number>();
  for (const s of segs) {
    const mins = (s.end.getTime() - s.start.getTime()) / 60_000;
    byCat.set(s.category, (byCat.get(s.category) ?? 0) + mins);
  }
  return [...byCat.entries()]
    .map(([category, minutes]) => ({ category, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

function segmentLayoutStyle(seg: LayoutSegment): {
  top: number;
  height: number;
  left: string;
  width: string;
} {
  const top = timeToY(seg.start);
  const minH = seg.columns === 1 ? MIN_HEIGHT_SINGLE : MIN_HEIGHT_MULTI;
  const height = Math.max(segmentDurationPx(seg), minH);
  const clippedTop = Math.max(top, 0);
  const clippedHeight = Math.min(
    height - (clippedTop - top),
    (END_HOUR - START_HOUR) * HOUR_HEIGHT - clippedTop,
  );
  const colWidthPct = 100 / seg.columns;
  const leftPct = seg.column * colWidthPct;
  return {
    top: clippedTop,
    height: clippedHeight,
    left: `calc(${leftPct}% + ${COLUMN_GAP_PX / 2}px)`,
    width: `calc(${colWidthPct}% - ${COLUMN_GAP_PX}px)`,
  };
}

function CurrentTimeLine() {
  const now = new Date();
  const y = timeToY(now);
  if (now.getHours() < START_HOUR || now.getHours() >= END_HOUR) return null;
  return (
    <div
      className="absolute left-0 right-0 pointer-events-none z-20 flex items-center"
      style={{ top: y }}
    >
      <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 shrink-0" />
      <div className="flex-1 h-px bg-red-500 opacity-70" />
    </div>
  );
}

interface TooltipData {
  segment: LayoutSegment;
  x: number;
  y: number;
}

export default function CalendarPage() {
  const today = new Date();
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(today));
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const weekStartStr = isoDate(weekStart);

  const { data: entries = [], isLoading } = useQuery<LogEntry[]>({
    queryKey: ["week", weekStartStr],
    queryFn: () => getWeekLogs(weekStartStr),
  });

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  const segmentsByDay = new Map<string, LayoutSegment[]>();
  days.forEach((d) => {
    const dateStr = isoDate(d);
    const dayEntries = entries.filter((e) => isoDate(new Date(e.datetime)) === dateStr);
    segmentsByDay.set(dateStr, prepareDayLayout(dayEntries));
  });

  const prevWeek = () => setWeekStart((d) => addDays(d, -7));
  const nextWeek = () => setWeekStart((d) => addDays(d, 7));
  const goToday = () => setWeekStart(getMonday(today));

  const isThisWeek = isoDate(weekStart) === isoDate(getMonday(today));
  const todayStr = isoDate(today);

  useEffect(() => {
    const close = () => setTooltip(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    if (gridRef.current) {
      const scrollY = Math.max(0, (9 - START_HOUR) * HOUR_HEIGHT - 80);
      gridRef.current.scrollTop = scrollY;
    }
  }, []);

  return (
    <div className="flex flex-col h-full space-y-4" style={{ minHeight: 0 }}>
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">Calendar</h1>
          <span className="text-sm text-muted-foreground">{formatWeekLabel(weekStart)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={goToday}
            disabled={isThisWeek}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
          >
            Today
          </button>
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            <button
              onClick={prevWeek}
              className="px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-r border-border"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2.5L5 7L9 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={nextWeek}
              className="px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 2.5L9 7L5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 180px)" }}>
        <div className="flex shrink-0 border-b border-border">
          <div className="w-14 shrink-0" />
          {days.map((day, i) => {
            const dateStr = isoDate(day);
            const isToday = dateStr === todayStr;
            const segs = segmentsByDay.get(dateStr) ?? [];
            const byCategory = categoryMinutesBreakdown(segs);
            return (
              <div
                key={i}
                className="flex-1 py-3 px-1.5 text-center border-l border-border first:border-l-0"
              >
                <div className={`text-xs font-medium ${isToday ? "text-muted-foreground" : "text-muted-foreground"}`}>
                  {DAY_NAMES[i]}
                </div>
                <div
                  className={`text-xl font-semibold tabular-nums mt-0.5 w-9 h-9 flex items-center justify-center rounded-full mx-auto ${
                    isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {day.getDate()}
                </div>
                {byCategory.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {byCategory.map(({ category, minutes }) => {
                      const colors = CAT_COLORS[category] ?? DEFAULT_CAT_COLOR;
                      return (
                        <div
                          key={category}
                          className="flex items-center justify-center gap-1 text-[10px] leading-tight tabular-nums"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: colors.border }}
                          />
                          <span className="capitalize truncate" style={{ color: colors.text }}>
                            {category}
                          </span>
                          <span className="text-muted-foreground shrink-0">{Math.round(minutes)}m</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto relative" ref={gridRef}>
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-30">
              <div className="text-sm text-muted-foreground">Loading…</div>
            </div>
          )}

          <div className="flex" style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
            <div className="w-14 shrink-0 relative">
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute right-2 text-[10px] text-muted-foreground tabular-nums"
                  style={{ top: (h - START_HOUR) * HOUR_HEIGHT - 6 }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            {days.map((day, di) => {
              const dateStr = isoDate(day);
              const segs = segmentsByDay.get(dateStr) ?? [];
              const isToday = dateStr === todayStr;

              return (
                <div
                  key={di}
                  className="flex-1 border-l border-border relative"
                  style={{ minWidth: 0 }}
                >
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-border/30"
                      style={{ top: (h - START_HOUR) * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    />
                  ))}

                  {isToday && <CurrentTimeLine />}

                  {segs.map((seg, si) => {
                    const layout = segmentLayoutStyle(seg);
                    if (layout.height <= 0) return null;
                    const colors = CAT_COLORS[seg.category] ?? DEFAULT_CAT_COLOR;
                    const showLabel = layout.height > 18 && seg.columns === 1;
                    const showScore = layout.height > 28 && seg.columns === 1;
                    const showDenseBadge = seg.count > 3 && seg.columns >= 3 && !showLabel;
                    const faded = seg.columns > 3;

                    return (
                      <div
                        key={si}
                        className="absolute rounded overflow-hidden cursor-pointer transition-opacity hover:opacity-100 hover:z-20 z-10"
                        style={{
                          top: layout.top + 1,
                          height: Math.max(layout.height - 2, MIN_HEIGHT_MULTI),
                          left: layout.left,
                          width: layout.width,
                          backgroundColor: colors.bg,
                          borderLeft: `2px solid ${colors.border}`,
                          opacity: faded ? 0.85 : 1,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = (e.currentTarget as HTMLElement)
                            .closest(".flex-1")!
                            .getBoundingClientRect();
                          setTooltip({ segment: seg, x: rect.left, y: rect.top + layout.top });
                        }}
                      >
                        {showLabel && (
                          <div className="px-1.5 pt-0.5 leading-tight">
                            <div className="text-[10px] font-semibold truncate" style={{ color: colors.text }}>
                              {seg.category.charAt(0).toUpperCase() + seg.category.slice(1)}
                            </div>
                            {showScore && (
                              <div
                                className="text-[9px] font-bold tabular-nums"
                                style={{ color: scoreColor(seg.avg_score) }}
                              >
                                {seg.avg_score.toFixed(1)}
                              </div>
                            )}
                          </div>
                        )}
                        {showDenseBadge && (
                          <div
                            className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tabular-nums"
                            style={{ color: colors.text }}
                          >
                            +{seg.count}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {tooltip && (
        <div
          className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl p-3 w-64 pointer-events-none"
          style={{
            left: Math.min(tooltip.x + 8, window.innerWidth - 272),
            top: Math.min(tooltip.y - 8, window.innerHeight - 180),
          }}
        >
          <div className="flex items-center justify-between mb-2 gap-2">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded shrink-0"
              style={{
                backgroundColor: (CAT_COLORS[tooltip.segment.category] ?? DEFAULT_CAT_COLOR).bg,
                color: (CAT_COLORS[tooltip.segment.category] ?? DEFAULT_CAT_COLOR).text,
                border: `1px solid ${(CAT_COLORS[tooltip.segment.category] ?? DEFAULT_CAT_COLOR).border}`,
              }}
            >
              {tooltip.segment.category}
            </span>
            <span
              className="text-sm font-bold tabular-nums shrink-0"
              style={{ color: scoreColor(tooltip.segment.avg_score) }}
            >
              {tooltip.segment.avg_score.toFixed(1)} / 10
            </span>
          </div>
          {tooltip.segment.categories.length > 1 && (
            <div className="text-[10px] text-muted-foreground mb-1.5">
              {formatCategoryFlow(tooltip.segment.categories)}
            </div>
          )}
          <div className="text-xs text-muted-foreground mb-1">
            {formatRange(tooltip.segment.start, tooltip.segment.end)}
            <span className="ml-2">
              · {Math.round((tooltip.segment.end.getTime() - tooltip.segment.start.getTime()) / 60000)}m
            </span>
          </div>
          <div className="text-xs text-foreground/80 mt-1.5 leading-relaxed line-clamp-3">
            {tooltip.segment.summary}
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">
            {tooltip.segment.count} screenshot{tooltip.segment.count !== 1 ? "s" : ""}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 shrink-0 pt-1 flex-wrap">
        {ALLOWED_CATEGORIES.map((cat) => (
          <div key={cat} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: CAT_COLORS[cat].border }}
            />
            <span className="text-xs text-muted-foreground capitalize">{cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
