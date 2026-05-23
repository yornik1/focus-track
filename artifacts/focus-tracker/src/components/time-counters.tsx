import { addDays, startOfDay } from "date-fns";
import { useAnimatedNow } from "@/hooks/use-animated-now";

const DAY_MS = 86_400_000;

const USER_BIRTH = new Date(1991, 6, 27);
const FATHER_DEATH_DAY = 15144;
const FATHER_AGE_TARGET = addDays(USER_BIRTH, FATHER_DEATH_DAY - 1);

function formatGrouped(value: number, minWidth: number): string {
  return Math.max(0, value)
    .toString()
    .padStart(minWidth, "0")
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function splitRemainingMs(remainingMs: number): { days: number; seconds: number } {
  const clamped = Math.max(0, remainingMs);
  return {
    days: Math.floor(clamped / DAY_MS),
    seconds: Math.floor((clamped % DAY_MS) / 1000),
  };
}

function splitYearsWeeks(days: number): { years: number; weeks: number } {
  const clamped = Math.max(0, days);
  const years = Math.floor(clamped / 365);
  const weeks = Math.floor((clamped % 365) / 7);
  return { years, weeks };
}

function FatherAgeCountdown({ nowMs }: { nowMs: number }) {
  const remainingMs = FATHER_AGE_TARGET.getTime() - nowMs;
  const { days, seconds } = splitRemainingMs(remainingMs);
  const { years, weeks } = splitYearsWeeks(days);

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Until day 15 144
      </span>
      <div className="flex items-baseline gap-3 font-mono text-base md:text-lg tracking-tight tabular-nums text-muted-foreground">
        <span>{years}</span>
        <span className="text-sm font-sans font-normal">{years === 1 ? "year" : "years"}</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{weeks}</span>
        <span className="text-sm font-sans font-normal">{weeks === 1 ? "week" : "weeks"}</span>
      </div>
      <div className="flex items-baseline gap-4 font-mono text-2xl md:text-3xl tracking-tight tabular-nums text-foreground">
        <span>{formatGrouped(days, 1)}</span>
        <span className="text-sm md:text-base text-muted-foreground font-sans font-normal">days</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{formatGrouped(seconds, 5)}</span>
        <span className="text-sm md:text-base text-muted-foreground font-sans font-normal">sec</span>
      </div>
    </div>
  );
}

function EndOfDayCountdown({ nowMs }: { nowMs: number }) {
  const remainingMs = startOfDay(addDays(new Date(nowMs), 1)).getTime() - nowMs;
  const clamped = Math.max(0, remainingMs);

  const totalSeconds = Math.floor(clamped / 1000);
  const ms = Math.floor(clamped % 1000);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const time = [
    hours.toString().padStart(2, "0"),
    minutes.toString().padStart(2, "0"),
    seconds.toString().padStart(2, "0"),
  ].join(":");

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        The day that won't return
      </span>
      <div className="font-mono text-2xl md:text-3xl tracking-tight tabular-nums text-foreground">
        {time}
        <span className="text-muted-foreground">.</span>
        {ms.toString().padStart(3, "0")}
      </div>
    </div>
  );
}

export default function TimeCounters() {
  const nowMs = useAnimatedNow();

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
        <FatherAgeCountdown nowMs={nowMs} />
        <div className="md:border-l md:border-border md:pl-8">
          <EndOfDayCountdown nowMs={nowMs} />
        </div>
      </div>
    </div>
  );
}
