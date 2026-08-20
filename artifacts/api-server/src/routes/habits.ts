import { Router, type Request, type Response } from "express";
import { asc, desc, and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, habitDefinitionsTable, habitEventsTable, habitsTable } from "@workspace/db";

type HabitSource = "auto" | "manual";

export type HabitCell = {
  date: string;
  habit: string;
  done: boolean;
  source: HabitSource;
  updated_at: string;
};

export type HabitDefinition = {
  id: string;
  label: string;
  auto_fill: boolean;
  category: string | null;
  current_streak: number;
};

export type HabitDefinitionRecord = typeof habitDefinitionsTable.$inferSelect;

export type HabitEvent = {
  id: number;
  date: string;
  habit: string;
  old_done: boolean | null;
  new_done: boolean;
  old_source: HabitSource | null;
  new_source: HabitSource;
  actor: HabitSource;
  changed_at: string;
};

type DateRangeInput = {
  from?: unknown;
  to?: unknown;
};

type HabitHistoryInput = DateRangeInput & {
  habit?: unknown;
};

export class HabitInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HabitInputError";
  }
}

function assertDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HabitInputError(`${field} must be a valid YYYY-MM-DD date`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new HabitInputError(`${field} must be a valid YYYY-MM-DD date`);
  }

  return value;
}

function assertRange(input: DateRangeInput): { from: string; to: string } {
  const from = assertDate(input.from, "from");
  const to = assertDate(input.to, "to");
  if (from > to) {
    throw new HabitInputError("from must be before or equal to to");
  }
  return { from, to };
}

function kievToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kiev",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

async function activeDefinitions(): Promise<(typeof habitDefinitionsTable.$inferSelect)[]> {
  return db
    .select()
    .from(habitDefinitionsTable)
    .where(eq(habitDefinitionsTable.active, true))
    .orderBy(asc(habitDefinitionsTable.sort_order));
}

async function assertActiveHabit(habit: unknown): Promise<string> {
  if (typeof habit !== "string" || habit.length === 0) {
    throw new HabitInputError("habit must be an active habit id");
  }

  const rows = await db
    .select({ id: habitDefinitionsTable.id })
    .from(habitDefinitionsTable)
    .where(and(eq(habitDefinitionsTable.id, habit), eq(habitDefinitionsTable.active, true)))
    .limit(1);

  if (rows.length === 0) {
    throw new HabitInputError("habit must be an active habit id");
  }

  return habit;
}

async function assertKnownHabit(habit: unknown): Promise<string> {
  if (typeof habit !== "string" || habit.length === 0) {
    throw new HabitInputError("habit must be a known habit id");
  }

  const rows = await db
    .select({ id: habitDefinitionsTable.id })
    .from(habitDefinitionsTable)
    .where(eq(habitDefinitionsTable.id, habit))
    .limit(1);

  if (rows.length === 0) {
    throw new HabitInputError("habit must be a known habit id");
  }

  return habit;
}

function assertDone(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0) return false;
  if (value === 1) return true;
  throw new HabitInputError("done must be a boolean or 0/1");
}

function assertSource(value: unknown): HabitSource {
  if (value === undefined) {
    return "manual";
  }
  if (value !== "auto" && value !== "manual") {
    throw new HabitInputError("source must be auto or manual");
  }
  return value;
}

function assertObjectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HabitInputError("body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function assertDefinitionId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,49}$/.test(value)) {
    throw new HabitInputError("id must use lowercase letters, numbers, and underscores");
  }
  return value;
}

function slugifyDefinitionLabel(label: string): string {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (slug.length === 0) return "habit";
  return /^[a-z]/.test(slug) ? slug.slice(0, 50) : `habit_${slug}`.slice(0, 50);
}

async function generateDefinitionId(label: string): Promise<string> {
  const existing = new Set(
    (await db.select({ id: habitDefinitionsTable.id }).from(habitDefinitionsTable)).map((row) => row.id),
  );
  const base = slugifyDefinitionLabel(label);
  if (!existing.has(base)) return base;

  for (let suffix = 2; ; suffix += 1) {
    const suffixText = `_${suffix}`;
    const candidate = `${base.slice(0, 50 - suffixText.length)}${suffixText}`;
    if (!existing.has(candidate)) return candidate;
  }
}

function assertLabel(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 80) {
    throw new HabitInputError("label must be 1-80 characters");
  }
  return value.trim();
}

function assertAutoFill(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new HabitInputError("auto_fill must be a boolean");
  return value;
}

function assertCategory(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 80) {
    throw new HabitInputError("category must be null or at most 80 characters");
  }
  return value.trim();
}

function toHabitCell(row: typeof habitsTable.$inferSelect): HabitCell {
  return {
    date: row.date,
    habit: row.habit,
    done: row.done,
    source: row.source,
    updated_at: row.updated_at,
  };
}

function toHabitEvent(row: typeof habitEventsTable.$inferSelect): HabitEvent {
  return {
    id: row.id,
    date: row.date,
    habit: row.habit,
    old_done: row.old_done,
    new_done: row.new_done,
    old_source: row.old_source,
    new_source: row.new_source,
    actor: row.actor,
    changed_at: row.changed_at,
  };
}

async function currentStreaks(habitIds: string[]): Promise<Map<string, number>> {
  if (habitIds.length === 0) return new Map();

  const today = kievToday();
  const rows = await db
    .select({
      date: habitsTable.date,
      habit: habitsTable.habit,
      done: habitsTable.done,
    })
    .from(habitsTable)
    .where(and(inArray(habitsTable.habit, habitIds), lte(habitsTable.date, today)))
    .orderBy(desc(habitsTable.date));

  const doneByHabit = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!doneByHabit.has(row.habit)) {
      doneByHabit.set(row.habit, new Set());
    }
    if (row.done) {
      doneByHabit.get(row.habit)!.add(row.date);
    }
  }

  const streaks = new Map<string, number>();
  for (const habitId of habitIds) {
    const doneDates = doneByHabit.get(habitId) ?? new Set<string>();
    let cursor = doneDates.has(today) ? today : addDays(today, -1);
    let streak = 0;

    while (doneDates.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }

    streaks.set(habitId, streak);
  }

  return streaks;
}

export async function listHabits(input: DateRangeInput): Promise<{ habits: HabitDefinition[]; entries: HabitCell[] }> {
  const range = assertRange(input);
  const definitions = await activeDefinitions();
  const habitIds = definitions.map((habit) => habit.id);
  const streaks = await currentStreaks(habitIds);

  const rows = habitIds.length === 0
    ? []
    : await db
        .select()
        .from(habitsTable)
        .where(and(gte(habitsTable.date, range.from), lte(habitsTable.date, range.to), inArray(habitsTable.habit, habitIds)))
        .orderBy(asc(habitsTable.date), asc(habitsTable.habit));

  return {
    habits: definitions.map((habit) => ({
      id: habit.id,
      label: habit.label,
      auto_fill: habit.auto_fill,
      category: habit.category,
      current_streak: streaks.get(habit.id) ?? 0,
    })),
    entries: rows.map(toHabitCell),
  };
}

export async function upsertHabit(body: unknown): Promise<HabitCell> {
  const input = assertObjectBody(body);
  const date = assertDate(input.date, "date");
  const habit = await assertActiveHabit(input.habit);
  const done = assertDone(input.done);
  const source = assertSource(input.source);
  const setWhere = source === "auto"
    ? sql`${habitsTable.source} <> 'manual' AND (${habitsTable.done} IS NOT excluded.done OR ${habitsTable.source} IS NOT excluded.source)`
    : sql`${habitsTable.done} IS NOT excluded.done OR ${habitsTable.source} IS NOT excluded.source`;

  await db
    .insert(habitsTable)
    .values({ date, habit, done, source, updated_at: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` })
    .onConflictDoUpdate({
      target: [habitsTable.date, habitsTable.habit],
      set: {
        done,
        source,
        updated_at: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      },
      setWhere,
    });

  const rows = await db
    .select()
    .from(habitsTable)
    .where(and(eq(habitsTable.date, date), eq(habitsTable.habit, habit)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error("Habit upsert did not return a row");
  }

  return toHabitCell(row);
}

export async function createHabitDefinition(body: unknown): Promise<HabitDefinitionRecord> {
  const input = assertObjectBody(body);
  const label = assertLabel(input.label);
  const id = input.id === undefined ? await generateDefinitionId(label) : assertDefinitionId(input.id);
  const auto_fill = assertAutoFill(input.auto_fill);
  const category = assertCategory(input.category);
  const [{ nextOrder }] = await db
    .select({ nextOrder: sql<number>`coalesce(max(${habitDefinitionsTable.sort_order}), 0) + 1` })
    .from(habitDefinitionsTable);

  const rows = await db
    .insert(habitDefinitionsTable)
    .values({ id, label, auto_fill, category, sort_order: nextOrder, active: true })
    .onConflictDoNothing()
    .returning();
  if (rows.length === 0) throw new HabitInputError("habit id already exists");
  return rows[0];
}

export async function reorderHabitDefinitions(body: unknown): Promise<HabitDefinitionRecord[]> {
  const input = assertObjectBody(body);
  if (!Array.isArray(input.ids) || input.ids.some((id) => typeof id !== "string")) {
    throw new HabitInputError("ids must be an array of active habit ids");
  }

  const ids = input.ids as string[];
  if (new Set(ids).size !== ids.length) {
    throw new HabitInputError("ids must not contain duplicates");
  }

  const definitions = await activeDefinitions();
  const activeIds = new Set(definitions.map((habit) => habit.id));
  if (ids.length !== activeIds.size || ids.some((id) => !activeIds.has(id))) {
    throw new HabitInputError("ids must contain every active habit exactly once");
  }

  const currentOrder = new Map(definitions.map((habit) => [habit.id, habit.sort_order]));
  db.transaction((tx) => {
    ids.forEach((id, index) => {
      const sortOrder = index + 1;
      if (currentOrder.get(id) === sortOrder) return;
      tx.update(habitDefinitionsTable)
        .set({
          sort_order: sortOrder,
          updated_at: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        })
        .where(eq(habitDefinitionsTable.id, id))
        .run();
    });
  });

  return activeDefinitions();
}

export async function updateHabitDefinition(idValue: unknown, body: unknown): Promise<HabitDefinitionRecord> {
  const id = assertDefinitionId(idValue);
  await assertKnownHabit(id);
  const input = assertObjectBody(body);
  if (input.label === undefined && input.auto_fill === undefined && input.category === undefined) {
    throw new HabitInputError("provide label, auto_fill, or category");
  }

  const changes: Partial<Pick<HabitDefinitionRecord, "label" | "auto_fill" | "category">> & { updated_at: ReturnType<typeof sql> } = {
    updated_at: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  };
  if (input.label !== undefined) changes.label = assertLabel(input.label);
  if (input.auto_fill !== undefined) changes.auto_fill = assertAutoFill(input.auto_fill);
  if (input.category !== undefined) changes.category = assertCategory(input.category);

  const [row] = await db
    .update(habitDefinitionsTable)
    .set(changes)
    .where(eq(habitDefinitionsTable.id, id))
    .returning();
  return row;
}

export async function archiveHabitDefinition(idValue: unknown): Promise<HabitDefinitionRecord> {
  const id = assertDefinitionId(idValue);
  await assertKnownHabit(id);
  const [row] = await db
    .update(habitDefinitionsTable)
    .set({ active: false, updated_at: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` })
    .where(eq(habitDefinitionsTable.id, id))
    .returning();
  return row;
}

export async function listHabitHistory(input: HabitHistoryInput): Promise<{ events: HabitEvent[] }> {
  const range = assertRange(input);
  const filters = [gte(habitEventsTable.date, range.from), lte(habitEventsTable.date, range.to)];
  if (input.habit !== undefined) {
    filters.push(eq(habitEventsTable.habit, await assertKnownHabit(input.habit)));
  }

  const rows = await db
    .select()
    .from(habitEventsTable)
    .where(and(...filters))
    .orderBy(desc(habitEventsTable.changed_at), desc(habitEventsTable.id));

  return { events: rows.map(toHabitEvent) };
}

function queryValue(value: Request["query"][string]): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function handleHabitError(error: unknown, res: Response): void {
  if (error instanceof HabitInputError) {
    res.status(400).json({ success: false, message: error.message });
    return;
  }
  throw error;
}

const router = Router();

router.get("/habits", async (req, res) => {
  try {
    res.json(
      await listHabits({
        from: queryValue(req.query.from),
        to: queryValue(req.query.to),
      }),
    );
  } catch (error) {
    handleHabitError(error, res);
  }
});

router.post("/habits", async (req, res) => {
  try {
    res.json(await upsertHabit(req.body));
  } catch (error) {
    handleHabitError(error, res);
  }
});

router.post("/habit-definitions", async (req, res) => {
  try {
    res.status(201).json(await createHabitDefinition(req.body));
  } catch (error) {
    handleHabitError(error, res);
  }
});

router.patch("/habit-definitions/order", async (req, res) => {
  try {
    res.json(await reorderHabitDefinitions(req.body));
  } catch (error) {
    handleHabitError(error, res);
  }
});

router.patch("/habit-definitions/:id", async (req, res) => {
  try {
    res.json(await updateHabitDefinition(req.params.id, req.body));
  } catch (error) {
    handleHabitError(error, res);
  }
});

router.delete("/habit-definitions/:id", async (req, res) => {
  try {
    res.json(await archiveHabitDefinition(req.params.id));
  } catch (error) {
    handleHabitError(error, res);
  }
});

router.get("/habits/history", async (req, res) => {
  try {
    res.json(
      await listHabitHistory({
        from: queryValue(req.query.from),
        to: queryValue(req.query.to),
        habit: queryValue(req.query.habit),
      }),
    );
  } catch (error) {
    handleHabitError(error, res);
  }
});

export default router;
