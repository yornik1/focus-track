import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  getWeeklyStats,
  type WeeklyStats,
  type WeeklyMetric,
  type WeeklyCategory,
  type CategoryKind,
} from "@/api";
import {
  deltaDir,
  formatDelta,
  groupThousands,
  shiftWeek,
  buildScatter,
  scatterInsight,
  type ScatterMode,
  type ScatterAxis,
} from "@/lib/week-format";

const GREEN = "#22c55e";
const RED = "#f87171";
const BLUE = "#60a5fa";
const MUTED_BAR = "#475569";

function kindColor(kind: CategoryKind): string {
  if (kind === "productive") return GREEN;
  if (kind === "neutral") return BLUE;
  return RED;
}

function categoryLabel(cat: string): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

function DeltaBadge({ pct, invert }: { pct: number | null; invert?: boolean }) {
  const dir = deltaDir(pct);
  // Для «залипания» рост = плохо: инвертируем цвет (стрелку оставляем по направлению).
  const good = invert ? dir === "down" : dir === "up";
  const cls =
    dir === "flat"
      ? "text-muted-foreground bg-muted/40"
      : good
        ? "text-green-400 bg-green-500/10"
        : "text-red-400 bg-red-500/10";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      <span className="text-[9px] leading-none">{arrow}</span>
      {formatDelta(pct)}
    </span>
  );
}

function StatCard({
  label,
  metric,
  format,
  unit,
  garmin,
  emphasis,
  invert,
}: {
  label: string;
  metric: WeeklyMetric;
  format?: (v: number) => string;
  unit?: string;
  garmin?: boolean;
  emphasis?: boolean;
  invert?: boolean;
}) {
  const shown = format ? format(metric.value) : String(metric.value);
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-bold leading-none ${emphasis ? "text-4xl text-green-400" : "text-3xl text-foreground"}`}>
        {shown}
        {unit && <span className="text-base font-medium text-muted-foreground ml-1">{unit}</span>}
      </div>
      <div className="flex items-center gap-2">
        <DeltaBadge pct={metric.delta_pct} invert={invert} />
        {garmin && (
          <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-indigo-300">
            GARMIN
          </span>
        )}
      </div>
    </div>
  );
}

function EffortByWeek({ data }: { data: WeeklyStats["weekly_effort_history"] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        Effort · hours/day · by week
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="week_start" hide />
            <YAxis hide domain={[0, "dataMax"]} />
            <Bar dataKey="effort_h_per_day" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.week_start} fill={d.is_current ? GREEN : MUTED_BAR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ByDayTable({ rows }: { rows: WeeklyStats["by_day"] }) {
  const maxEffort = Math.max(0.1, ...rows.map((r) => r.effort_h));
  return (
    <div className="rounded-xl border border-border bg-card p-4 overflow-x-auto">
      <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">By day</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left font-normal pb-2">Day</th>
            <th className="text-left font-normal pb-2 w-40">Effort</th>
            <th className="text-right font-normal pb-2">Active</th>
            <th className="text-right font-normal pb-2">Focus</th>
            <th className="text-right font-normal pb-2">Anki</th>
            <th className="text-right font-normal pb-2">Steps</th>
            <th className="text-right font-normal pb-2">Sleep</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className="border-t border-border/60">
              <td className="py-2">
                <span className="text-foreground">{r.dow}</span>{" "}
                <span className="text-muted-foreground">{r.date.slice(5)}</span>
              </td>
              <td className="py-2">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-muted/40">
                    <div
                      className="h-1.5 rounded-full bg-green-500"
                      style={{ width: `${Math.min(100, (r.effort_h / maxEffort) * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 text-right tabular-nums text-foreground">{r.effort_h.toFixed(1)}</span>
                </div>
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">{r.active_h.toFixed(1)}</td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {r.focus_score === null ? "—" : r.focus_score.toFixed(1)}
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">{r.anki_reviews || "—"}</td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {r.steps === null ? "—" : groupThousands(r.steps)}
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {r.sleep_h === null ? "—" : r.sleep_h.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryBars({ categories }: { categories: WeeklyCategory[] }) {
  const max = Math.max(0.1, ...categories.map((c) => c.hours));
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        Categories · hours this week
      </div>
      {categories.length === 0 ? (
        <div className="text-sm text-muted-foreground">No category data.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {categories.map((c) => (
            <div key={c.category} className="flex items-center gap-3">
              <div className="w-24 shrink-0 text-sm text-muted-foreground">{categoryLabel(c.category)}</div>
              <div className="h-2.5 flex-1 rounded-full bg-muted/30">
                <div
                  className="h-2.5 rounded-full"
                  style={{ width: `${(c.hours / max) * 100}%`, backgroundColor: kindColor(c.kind) }}
                />
              </div>
              <div className="w-10 text-right text-sm tabular-nums text-foreground">{c.hours.toFixed(1)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Линейная регрессия для тренд-линии скаттера. */
function trendSegment(points: { sleep_h: number; effort_h: number }[]): [{ x: number; y: number }, { x: number; y: number }] | null {
  if (points.length < 2) return null;
  const n = points.length;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sx += p.sleep_h;
    sy += p.effort_h;
    sxy += p.sleep_h * p.effort_h;
    sxx += p.sleep_h * p.sleep_h;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const xs = points.map((p) => p.sleep_h);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return [
    { x: minX, y: intercept + slope * minX },
    { x: maxX, y: intercept + slope * maxX },
  ];
}

const MODE_LABEL: Record<ScatterMode, string> = {
  day: "same day",
  lag: "prev night → next day",
  week: "by week",
};
const AXIS_LABEL: Record<ScatterAxis, string> = { sleep: "Sleep (h)", anki: "Anki (reviews)" };

function Toggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
            value === o.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** «2026-08-26» → «Aug 26» (в UTC, чтобы дата не съезжала). offsetDays сдвигает дату. */
function shortDate(iso: string, offsetDays = 0): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d + offsetDays)),
  );
}

interface ScatterDatum {
  x: number;
  y: number;
  label: string;
}

function ScatterTooltip({
  active,
  payload,
  axis,
  mode,
}: {
  active?: boolean;
  payload?: { payload?: ScatterDatum }[];
  axis: ScatterAxis;
  mode: ScatterMode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  // В недельном режиме показываем весь диапазон (Пн–Вс), а не только понедельник.
  const when = mode === "week" ? `${shortDate(p.label)} – ${shortDate(p.label, 6)}` : shortDate(p.label);
  const xPart = axis === "anki" ? `Anki ${groupThousands(p.x)}` : `Sleep ${p.x}h`;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-medium text-foreground">{when}</div>
      <div className="text-muted-foreground">
        {xPart} · effort {p.y}h
      </div>
    </div>
  );
}

function InsightScatter({ series, week }: { series: WeeklyStats["daily_series"]; week: WeeklyStats["week"] }) {
  const [mode, setMode] = useState<ScatterMode>("day");
  const [axis, setAxis] = useState<ScatterAxis>("sleep");
  const result = buildScatter(series, mode, axis);
  const segment = trendSegment(result.points.map((p) => ({ sleep_h: p.x, effort_h: p.y })));

  // Точки просматриваемой недели подсвечиваем отдельным цветом.
  const inViewedWeek = (label: string): boolean =>
    mode === "week" ? label === week.start : label >= week.start && label <= week.end;
  const viewedPts = result.points.filter((p) => inViewedWeek(p.label));
  const otherPts = result.points.filter((p) => !inViewedWeek(p.label));

  const rShown = result.pearson_r === null ? "—" : (result.pearson_r > 0 ? "+" : "") + result.pearson_r.toFixed(2);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {AXIS_LABEL[axis]} ↔ Effort · {MODE_LABEL[mode]}
          </div>
          {viewedPts.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: GREEN }} /> this week
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle<ScatterAxis>
            value={axis}
            onChange={setAxis}
            options={[
              { id: "sleep", label: "Sleep" },
              { id: "anki", label: "Anki" },
            ]}
          />
          <Toggle<ScatterMode>
            value={mode}
            onChange={setMode}
            options={[
              { id: "day", label: "Day" },
              { id: "lag", label: "Lag" },
              { id: "week", label: "Week" },
            ]}
          />
        </div>
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="h-64 w-full sm:flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 16, bottom: 20, left: 0 }}>
              <XAxis
                type="number"
                dataKey="x"
                name={axis}
                stroke="#6b7280"
                fontSize={11}
                domain={["dataMin - 0.5", "dataMax + 0.5"]}
              />
              <YAxis type="number" dataKey="y" name="effort" unit="h" stroke="#6b7280" fontSize={11} />
              <ZAxis range={[45, 45]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={(props) => <ScatterTooltip {...props} axis={axis} mode={mode} />}
              />
              {segment && (
                <ReferenceLine segment={segment} stroke="#6b7280" strokeDasharray="4 4" ifOverflow="extendDomain" />
              )}
              <Scatter data={otherPts} fill={BLUE} fillOpacity={0.6} isAnimationActive={false} />
              <Scatter data={viewedPts} fill={GREEN} fillOpacity={0.95} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="sm:w-44">
          <div className="text-center">
            <div className="text-3xl font-bold text-foreground">{rShown}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">Pearson correlation</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              n = {result.n} {mode === "week" ? "weeks" : "days"}
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{scatterInsight(result.pearson_r, axis)}</p>
        </div>
      </div>
    </div>
  );
}

export default function WeekPage() {
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["weekly", weekStart ?? "current"],
    queryFn: () => getWeeklyStats(weekStart),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading weekly mirror…</div>;
  }
  if (isError || !data) {
    return (
      <div className="text-sm text-red-400">
        Failed to load: {error instanceof Error ? error.message : "unknown error"}
      </div>
    );
  }

  const c = data.cards;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
          <span className="text-lg font-semibold text-foreground">Mirror</span>
          <span className="text-lg font-medium text-muted-foreground">· week</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            aria-label="Previous week"
            onClick={() => setWeekStart(shiftWeek(data.week.start, -1))}
            className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent/50"
          >
            ‹
          </button>
          <div className="text-center">
            <div className="text-sm font-semibold text-foreground">{data.week.label}</div>
            {data.week.is_partial ? (
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                in progress · {data.week.elapsed_days}/7 days
              </div>
            ) : (
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {data.week.is_current ? "current" : "completed"}
              </div>
            )}
          </div>
          <button
            aria-label="Next week"
            disabled={data.week.is_current}
            onClick={() => setWeekStart(shiftWeek(data.week.start, 1))}
            className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ›
          </button>
        </div>
      </div>

      <EffortByWeek data={data.weekly_effort_history} />

      {data.week.is_partial && (
        <p className="-mt-1 text-xs text-muted-foreground">
          Deltas compare the elapsed days ({data.week.elapsed_days}/7) against the same days of last week — not a
          full week, so early-week numbers aren't a shortfall.
        </p>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Effort · h/day" metric={c.effort_h_per_day} format={(v) => v.toFixed(1)} emphasis />
        <StatCard label="Effort total" metric={c.effort_total_h} format={(v) => v.toFixed(1)} unit="h" />
        <StatCard label="Active at laptop" metric={c.active_h} format={(v) => v.toFixed(1)} unit="h" />
        <StatCard label="Focus leak" metric={c.focus_leak_h} format={(v) => v.toFixed(1)} unit="h" invert />
        <StatCard label="Focus" metric={c.focus_pct} format={(v) => String(Math.round(v))} unit="%" />
        <StatCard label="Focus-score" metric={c.focus_score} format={(v) => v.toFixed(1)} unit="/10" />
        <StatCard label="Anki reviews" metric={c.anki_reviews} format={(v) => groupThousands(v)} />
        <StatCard label="Anki minutes" metric={c.anki_minutes} format={(v) => String(Math.round(v))} unit="m" />
        <StatCard label="Steps · per day" metric={c.steps_per_day} format={(v) => groupThousands(v)} garmin />
        <StatCard label="Sleep · avg" metric={c.sleep_avg_h} format={(v) => v.toFixed(1)} unit="h" garmin />
      </div>

      <ByDayTable rows={data.by_day} />
      <CategoryBars categories={data.categories} />
      <InsightScatter series={data.daily_series} week={data.week} />

      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Data.</span> focus-track (screenshot sampling, only while
        the laptop is open) · Anki revlog · Garmin (steps/sleep). Effort = code + research + writing + design.
        Focus = effort ÷ active. Sleep and steps come from Garmin vault journals (~/me/journal/activity), imported
        into focus.db — no invented proxies. {data.coverage.days_with_data}/7 days with focus data this week.
      </p>
    </div>
  );
}
