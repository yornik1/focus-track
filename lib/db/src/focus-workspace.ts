import { randomUUID } from "node:crypto";
import { sqliteConnection } from "./connection";
import type { FocusDirection, FocusWorkSession } from "./schema";

export type DirectionInput = {
  label?: unknown;
  description?: unknown;
  weekly_target_minutes?: unknown;
};

export type StartFocusSessionInput = {
  request_id?: unknown;
  direction_id?: unknown;
  planned_minutes?: unknown;
  intention?: unknown;
};

export type ReflectionInput = {
  result_note?: unknown;
  self_rating?: unknown;
};

export type FocusObservationSummary = {
  sample_count: number;
  observed_score: number | null;
  by_direction: Array<{
    direction_id: string | null;
    label: string;
    sample_count: number;
  }>;
};

export type FocusSessionDetails = FocusWorkSession & {
  direction_label: string;
  observations: FocusObservationSummary;
};

export type WeeklyDirectionSummary = FocusDirection & {
  session_seconds: number;
  remaining_seconds: number | null;
  exceeded_seconds: number;
};

export class FocusWorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
    readonly current?: FocusWorkSession,
  ) {
    super(message);
    this.name = "FocusWorkspaceError";
  }
}

export function focusWorkspaceEnabled(): boolean {
  return process.env.FOCUS_TRACK_SESSIONS_ENABLED === "1";
}

function optionalTrimmedText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new FocusWorkspaceError(`${field} must be a string or null`, 400);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new FocusWorkspaceError(`${field} must be at most ${max} characters`, 400);
  return normalized;
}

function requiredLabel(value: unknown): string {
  const label = optionalTrimmedText(value, "label", 60);
  if (!label) throw new FocusWorkspaceError("label is required", 400);
  return label;
}

function optionalInteger(value: unknown, field: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new FocusWorkspaceError(`${field} must be an integer from ${min} to ${max}`, 400);
  }
  return value;
}

function requiredInteger(value: unknown, field: string, min: number, max: number): number {
  const parsed = optionalInteger(value, field, min, max);
  if (parsed === null) throw new FocusWorkspaceError(`${field} is required`, 400);
  return parsed;
}

function assertOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(input).some((key) => !allowedSet.has(key))) {
    throw new FocusWorkspaceError("request contains unsupported fields", 400);
  }
}

function makeDirectionId(label: string): string {
  const base = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "direction";
  let id = base;
  let suffix = 2;
  const exists = sqliteConnection.prepare("SELECT 1 FROM focus_directions WHERE id = ?");
  while (exists.get(id)) id = `${base}_${suffix++}`;
  return id;
}

function reconcileExpired(now: number): void {
  sqliteConnection.prepare(`
    UPDATE focus_work_sessions
    SET status = 'completed', ended_at = planned_end_at, completion_reason = 'deadline', updated_at = ?
    WHERE status = 'running' AND planned_end_at <= ?
  `).run(now, now);
}

function sessionById(id: string): FocusWorkSession | undefined {
  return sqliteConnection.prepare("SELECT * FROM focus_work_sessions WHERE id = ?").get(id) as
    | FocusWorkSession
    | undefined;
}

function directionById(id: string): FocusDirection | undefined {
  return sqliteConnection.prepare("SELECT * FROM focus_directions WHERE id = ?").get(id) as
    | FocusDirection
    | undefined;
}

export function listActiveDirectionCandidates(): Array<Pick<FocusDirection, "id" | "label" | "description">> {
  return sqliteConnection
    .prepare(`
      SELECT id, label, description
      FROM focus_directions
      WHERE archived_at IS NULL
      ORDER BY created_at, id
    `)
    .all() as Array<Pick<FocusDirection, "id" | "label" | "description">>;
}

export function getRunningSessionContext(now = Math.floor(Date.now() / 1000)): {
  direction_id: string;
  direction_label: string;
  intention: string | null;
} | null {
  return sqliteConnection.transaction(() => {
    reconcileExpired(now);
    return (sqliteConnection.prepare(`
      SELECT s.direction_id, d.label AS direction_label, s.intention
      FROM focus_work_sessions s
      JOIN focus_directions d ON d.id = s.direction_id
      WHERE s.status = 'running'
    `).get() as { direction_id: string; direction_label: string; intention: string | null } | undefined) ?? null;
  }).immediate();
}

export function validateDirectionForInsert(candidateId: unknown, allowedIds: readonly string[]): string | null {
  if (typeof candidateId !== "string" || !candidateId || !allowedIds.includes(candidateId)) return null;
  const row = sqliteConnection
    .prepare("SELECT id FROM focus_directions WHERE id = ? AND archived_at IS NULL")
    .get(candidateId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function insertAnalyzedFocusLog(input: {
  datetime: string;
  timestamp: number;
  category: string;
  focus_score: number;
  summary: string;
  direction_id: unknown;
  allowed_direction_ids: readonly string[];
}): string | null {
  return sqliteConnection.transaction(() => {
    const directionId = validateDirectionForInsert(input.direction_id, input.allowed_direction_ids);
    sqliteConnection.prepare(`
      INSERT INTO focus_log (datetime, timestamp, category, focus_score, summary, direction_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.datetime, input.timestamp, input.category, input.focus_score, input.summary, directionId);
    return directionId;
  }).immediate();
}

export function createDirection(input: DirectionInput, now = Math.floor(Date.now() / 1000)): FocusDirection {
  assertOnlyKeys(input as Record<string, unknown>, ["label", "description", "weekly_target_minutes"]);
  const label = requiredLabel(input.label);
  const description = optionalTrimmedText(input.description, "description", 500);
  const weeklyTarget = optionalInteger(input.weekly_target_minutes, "weekly_target_minutes", 1, 10080);
  return sqliteConnection.transaction(() => {
    const id = makeDirectionId(label);
    sqliteConnection.prepare(`
      INSERT INTO focus_directions
        (id, label, description, weekly_target_minutes, archived_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(id, label, description, weeklyTarget, now, now);
    return directionById(id)!;
  }).immediate();
}

export function updateDirection(id: string, input: DirectionInput, now = Math.floor(Date.now() / 1000)): FocusDirection {
  assertOnlyKeys(input as Record<string, unknown>, ["label", "description", "weekly_target_minutes"]);
  const current = directionById(id);
  if (!current) throw new FocusWorkspaceError("direction not found", 404);
  if (Object.keys(input).length === 0) throw new FocusWorkspaceError("at least one field is required", 400);
  const label = input.label === undefined ? current.label : requiredLabel(input.label);
  const description = input.description === undefined
    ? current.description
    : optionalTrimmedText(input.description, "description", 500);
  const weeklyTarget = input.weekly_target_minutes === undefined
    ? current.weekly_target_minutes
    : optionalInteger(input.weekly_target_minutes, "weekly_target_minutes", 1, 10080);
  sqliteConnection.prepare(`
    UPDATE focus_directions
    SET label = ?, description = ?, weekly_target_minutes = ?, updated_at = ?
    WHERE id = ?
  `).run(label, description, weeklyTarget, now, id);
  return directionById(id)!;
}

export function archiveDirection(id: string, now = Math.floor(Date.now() / 1000)): FocusDirection {
  return sqliteConnection.transaction(() => {
    reconcileExpired(now);
    const current = directionById(id);
    if (!current) throw new FocusWorkspaceError("direction not found", 404);
    const running = sqliteConnection
      .prepare("SELECT 1 FROM focus_work_sessions WHERE direction_id = ? AND status = 'running'")
      .get(id);
    if (running) throw new FocusWorkspaceError("finish or cancel the running session first", 409);
    if (current.archived_at === null) {
      sqliteConnection.prepare("UPDATE focus_directions SET archived_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, id);
    }
    return directionById(id)!;
  }).immediate();
}

function sameStartPayload(session: FocusWorkSession, input: StartFocusSessionInput): boolean {
  const intention = optionalTrimmedText(input.intention, "intention", 200);
  return session.direction_id === input.direction_id
    && session.planned_minutes === input.planned_minutes
    && session.intention === intention;
}

export function startFocusWorkSession(
  input: StartFocusSessionInput,
  now = Math.floor(Date.now() / 1000),
): FocusWorkSession {
  assertOnlyKeys(input as Record<string, unknown>, ["request_id", "direction_id", "planned_minutes", "intention"]);
  if (typeof input.request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.request_id)) {
    throw new FocusWorkspaceError("request_id must be a UUID", 400);
  }
  if (typeof input.direction_id !== "string" || !input.direction_id) {
    throw new FocusWorkspaceError("direction_id is required", 400);
  }
  const directionId = input.direction_id;
  const plannedMinutes = requiredInteger(input.planned_minutes, "planned_minutes", 1, 180);
  const intention = optionalTrimmedText(input.intention, "intention", 200);

  return sqliteConnection.transaction(() => {
    reconcileExpired(now);
    const prior = sqliteConnection
      .prepare("SELECT * FROM focus_work_sessions WHERE request_id = ?")
      .get(input.request_id) as FocusWorkSession | undefined;
    if (prior) {
      if (!sameStartPayload(prior, { ...input, planned_minutes: plannedMinutes, intention })) {
        throw new FocusWorkspaceError("request_id was already used with different data", 409, prior);
      }
      return prior;
    }
    const direction = directionById(directionId);
    if (!direction) throw new FocusWorkspaceError("direction not found", 404);
    if (direction.archived_at !== null) throw new FocusWorkspaceError("direction is archived", 409);
    const running = sqliteConnection
      .prepare("SELECT * FROM focus_work_sessions WHERE status = 'running'")
      .get() as FocusWorkSession | undefined;
    if (running) throw new FocusWorkspaceError("a session is already running", 409, running);
    const id = randomUUID();
    sqliteConnection.prepare(`
      INSERT INTO focus_work_sessions (
        id, request_id, direction_id, intention, planned_minutes, started_at, planned_end_at,
        ended_at, status, completion_reason, result_note, self_rating, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'running', NULL, NULL, NULL, ?, ?)
    `).run(id, input.request_id, input.direction_id, intention, plannedMinutes, now, now + plannedMinutes * 60, now, now);
    return sessionById(id)!;
  }).immediate();
}

function transitionSession(id: string, action: "finish" | "cancel", now: number): FocusWorkSession {
  return sqliteConnection.transaction(() => {
    reconcileExpired(now);
    const session = sessionById(id);
    if (!session) throw new FocusWorkspaceError("session not found", 404);
    if (session.status !== "running") return session;
    const endedAt = Math.max(session.started_at, Math.min(now, session.planned_end_at));
    if (action === "finish") {
      sqliteConnection.prepare(`
        UPDATE focus_work_sessions
        SET status = 'completed', ended_at = ?, completion_reason = 'manual', updated_at = ?
        WHERE id = ? AND status = 'running'
      `).run(endedAt, now, id);
    } else {
      sqliteConnection.prepare(`
        UPDATE focus_work_sessions
        SET status = 'cancelled', ended_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `).run(endedAt, now, id);
    }
    return sessionById(id)!;
  }).immediate();
}

export function finishFocusWorkSession(id: string, now = Math.floor(Date.now() / 1000)): FocusWorkSession {
  return transitionSession(id, "finish", now);
}

export function cancelFocusWorkSession(id: string, now = Math.floor(Date.now() / 1000)): FocusWorkSession {
  return transitionSession(id, "cancel", now);
}

export function saveFocusReflection(
  id: string,
  input: ReflectionInput,
  now = Math.floor(Date.now() / 1000),
): FocusWorkSession {
  assertOnlyKeys(input as Record<string, unknown>, ["result_note", "self_rating"]);
  return sqliteConnection.transaction(() => {
    reconcileExpired(now);
    const session = sessionById(id);
    if (!session) throw new FocusWorkspaceError("session not found", 404);
    if (session.status !== "completed") throw new FocusWorkspaceError("reflection is available for completed sessions", 409);
    if (Object.keys(input).length === 0) throw new FocusWorkspaceError("at least one field is required", 400);
    const resultNote = input.result_note === undefined
      ? session.result_note
      : optionalTrimmedText(input.result_note, "result_note", 1000);
    const selfRating = input.self_rating === undefined
      ? session.self_rating
      : optionalInteger(input.self_rating, "self_rating", 1, 10);
    sqliteConnection.prepare(`
      UPDATE focus_work_sessions SET result_note = ?, self_rating = ?, updated_at = ? WHERE id = ?
    `).run(resultNote, selfRating, now, id);
    return sessionById(id)!;
  }).immediate();
}

function observationSummary(session: FocusWorkSession, now: number): FocusObservationSummary {
  const end = session.ended_at ?? Math.min(now, session.planned_end_at);
  const aggregate = sqliteConnection.prepare(`
    SELECT count(*) AS sample_count, avg(focus_score) AS observed_score
    FROM focus_log WHERE timestamp >= ? AND timestamp < ?
  `).get(session.started_at, end) as { sample_count: number; observed_score: number | null };
  const rows = sqliteConnection.prepare(`
    SELECT l.direction_id, coalesce(d.label, 'Not determined') AS label, count(*) AS sample_count
    FROM focus_log l
    LEFT JOIN focus_directions d ON d.id = l.direction_id
    WHERE l.timestamp >= ? AND l.timestamp < ?
    GROUP BY l.direction_id, d.label
    ORDER BY sample_count DESC, label
  `).all(session.started_at, end) as FocusObservationSummary["by_direction"];
  return {
    sample_count: aggregate.sample_count,
    observed_score: aggregate.observed_score === null ? null : Math.round(aggregate.observed_score * 10) / 10,
    by_direction: rows,
  };
}

export function getFocusSessionDetails(id: string, now = Math.floor(Date.now() / 1000)): FocusSessionDetails {
  return sqliteConnection.transaction(() => {
    reconcileExpired(now);
    const session = sessionById(id);
    if (!session) throw new FocusWorkspaceError("session not found", 404);
    const direction = directionById(session.direction_id)!;
    return { ...session, direction_label: direction.label, observations: observationSummary(session, now) };
  }).immediate();
}

function localDateParts(epochSeconds: number): { year: number; month: number; day: number; weekday: string } {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kiev", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(new Date(epochSeconds * 1000)).map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), weekday: values.weekday };
}

function zonedMidnight(year: number, month: number, day: number): number {
  const desired = Date.UTC(year, month - 1, day);
  let guess = desired;
  for (let index = 0; index < 3; index++) {
    const parts = localDateParts(Math.floor(guess / 1000));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day);
    guess += desired - represented;
    const hour = Number(new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Kiev", hour: "2-digit", hourCycle: "h23",
    }).format(new Date(guess)));
    guess -= hour * 3_600_000;
  }
  return Math.floor(guess / 1000);
}

export function currentKievWeekBounds(now: number): { start: number; end: number } {
  const parts = localDateParts(now);
  const weekdayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
  const monday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - weekdayIndex));
  const nextMonday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 7));
  return {
    start: zonedMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
    end: zonedMidnight(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate()),
  };
}

function weeklyDirectionSummaries(now: number): WeeklyDirectionSummary[] {
  const bounds = currentKievWeekBounds(now);
  const directions = sqliteConnection.prepare("SELECT * FROM focus_directions ORDER BY created_at, id").all() as FocusDirection[];
  const seconds = sqliteConnection.prepare(`
    SELECT direction_id,
      sum(max(0, min(ended_at, ?) - max(started_at, ?))) AS session_seconds
    FROM focus_work_sessions
    WHERE status = 'completed' AND ended_at > ? AND started_at < ?
    GROUP BY direction_id
  `).all(bounds.end, bounds.start, bounds.start, bounds.end) as Array<{ direction_id: string; session_seconds: number }>;
  const byId = new Map(seconds.map((row) => [row.direction_id, row.session_seconds]));
  return directions.map((direction) => {
    const sessionSeconds = byId.get(direction.id) ?? 0;
    const targetSeconds = direction.weekly_target_minutes === null ? null : direction.weekly_target_minutes * 60;
    return {
      ...direction,
      session_seconds: sessionSeconds,
      remaining_seconds: targetSeconds === null ? null : Math.max(0, targetSeconds - sessionSeconds),
      exceeded_seconds: targetSeconds === null ? 0 : Math.max(0, sessionSeconds - targetSeconds),
    };
  });
}

export function getFocusWorkspaceState(now = Math.floor(Date.now() / 1000)) {
  return sqliteConnection.transaction(() => {
    reconcileExpired(now);
    const running = (sqliteConnection.prepare("SELECT * FROM focus_work_sessions WHERE status = 'running'").get() as FocusWorkSession | undefined) ?? null;
    const sessions = sqliteConnection.prepare(`
      SELECT s.*, d.label AS direction_label
      FROM focus_work_sessions s JOIN focus_directions d ON d.id = s.direction_id
      ORDER BY s.started_at DESC, s.id DESC LIMIT 20
    `).all() as Array<FocusWorkSession & { direction_label: string }>;
    return {
      server_now: now,
      running_session: running,
      directions: sqliteConnection.prepare("SELECT * FROM focus_directions ORDER BY created_at, id").all() as FocusDirection[],
      weekly: weeklyDirectionSummaries(now),
      sessions,
    };
  }).immediate();
}
