import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCalendar, getHourlyEntries, type CalendarDay, type HourlyEntry, type Category } from "@/api";

function scoreColor(score: number | null): string {
  if (score === null) return "transparent";
  if (score >= 7) return "#22c55e";
  if (score >= 4) return "#f59e0b";
  return "#ef4444";
}

function scoreTextColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

function categoryBadgeClass(cat: Category): string {
  switch (cat) {
    case "code": return "bg-blue-500/15 text-blue-300";
    case "video": return "bg-purple-500/15 text-purple-300";
    case "social": return "bg-amber-500/15 text-amber-300";
    case "idle": return "bg-zinc-500/15 text-zinc-400";
  }
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatMonthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function HourHeatmap({
  date,
  onSelectHour,
  selectedHour,
}: {
  date: string;
  onSelectHour: (h: number) => void;
  selectedHour: number | null;
}) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div className="mt-4 p-4 bg-card/50 border border-card-border rounded-xl">
      <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">
        Hourly breakdown — {date}
      </p>
      <div className="flex gap-1 items-end">
        {hours.map((h) => (
          <div
            key={h}
            onClick={() => onSelectHour(h)}
            className={`flex flex-col items-center gap-1 flex-1 min-w-0 cursor-pointer group`}
          >
            <div
              className={`w-full rounded-sm transition-all ${
                selectedHour === h ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "hover:opacity-90"
              }`}
              style={{ height: 32, backgroundColor: "#1e2535" }}
            />
            {h % 6 === 0 && (
              <span className="text-[10px] text-muted-foreground">
                {h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`}
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">Click an hour to see entries</p>
    </div>
  );
}

function HourEntries({ date, hour }: { date: string; hour: number }) {
  const { data, isLoading } = useQuery<HourlyEntry[]>({
    queryKey: ["hourly", date, hour],
    queryFn: () => getHourlyEntries(date, hour),
  });

  const label = `${String(hour).padStart(2, "0")}:00 — ${String(hour + 1).padStart(2, "0")}:00`;

  return (
    <div className="mt-3 p-4 bg-card/50 border border-card-border rounded-xl">
      <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">{label}</p>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : !data || data.length === 0 ? (
        <div className="text-xs text-muted-foreground">No entries for this hour.</div>
      ) : (
        <div className="space-y-2">
          {data.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground tabular-nums text-xs w-12 shrink-0">
                {new Date(entry.datetime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${categoryBadgeClass(entry.category)}`}>
                {entry.category}
              </span>
              <span className={`text-xs font-semibold tabular-nums shrink-0 ${scoreTextColor(entry.score)}`}>
                {entry.score.toFixed(1)}
              </span>
              <span className="text-muted-foreground text-xs truncate">{entry.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  const monthParam = formatMonthParam(year, month);

  const { data, isLoading } = useQuery({
    queryKey: ["calendar", monthParam],
    queryFn: () => getCalendar(monthParam),
  });

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
    setSelectedHour(null);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
    setSelectedHour(null);
  };

  const dayMap = new Map<string, CalendarDay>();
  data?.days.forEach((d) => dayMap.set(d.date, d));

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (CalendarDay | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      return dayMap.get(dateStr) ?? { date: dateStr, avg_score: null };
    }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Calendar</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L6 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <span className="text-sm font-medium text-foreground min-w-[120px] text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 3L10 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="grid grid-cols-7 mb-2">
          {DOW.map((d) => (
            <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">{d}</div>
          ))}
        </div>

        {isLoading ? (
          <div className="h-48 flex items-center justify-center">
            <div className="text-sm text-muted-foreground">Loading…</div>
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, idx) => {
              if (!cell) return <div key={`empty-${idx}`} />;
              const isSelected = selectedDate === cell.date;
              const isToday = cell.date === new Date().toISOString().slice(0, 10);
              return (
                <button
                  key={cell.date}
                  onClick={() => {
                    setSelectedDate(isSelected ? null : cell.date);
                    setSelectedHour(null);
                  }}
                  className={`relative aspect-square rounded-lg flex flex-col items-center justify-center transition-all p-1 ${
                    isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "hover:bg-accent/60"
                  }`}
                >
                  {cell.avg_score !== null && (
                    <div
                      className="absolute inset-1 rounded-md opacity-20"
                      style={{ backgroundColor: scoreColor(cell.avg_score) }}
                    />
                  )}
                  <span
                    className={`relative text-sm tabular-nums z-10 ${
                      isToday ? "font-bold text-primary" : "text-foreground"
                    }`}
                  >
                    {parseInt(cell.date.slice(-2))}
                  </span>
                  {cell.avg_score !== null && (
                    <span
                      className={`relative text-[9px] tabular-nums z-10 font-medium mt-0.5 ${
                        cell.avg_score >= 7 ? "text-green-400" : cell.avg_score >= 4 ? "text-amber-400" : "text-red-400"
                      }`}
                    >
                      {cell.avg_score.toFixed(1)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex gap-4 mt-4 pt-4 border-t border-border">
          {[
            { label: "7–10 Focused", color: "#22c55e" },
            { label: "4–6 Moderate", color: "#f59e0b" },
            { label: "0–3 Distracted", color: "#ef4444" },
            { label: "No data", color: "#1e2535", border: true },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: item.color, border: item.border ? "1px solid #374151" : undefined }}
              />
              <span className="text-xs text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {selectedDate && (
        <HourHeatmap
          date={selectedDate}
          selectedHour={selectedHour}
          onSelectHour={(h) => setSelectedHour(selectedHour === h ? null : h)}
        />
      )}

      {selectedDate && selectedHour !== null && (
        <HourEntries date={selectedDate} hour={selectedHour} />
      )}
    </div>
  );
}
