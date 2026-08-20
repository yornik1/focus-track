import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveHabitDefinition,
  createHabitDefinition,
  getHabits,
  reorderHabitDefinitions,
  updateHabitDefinition,
  updateHabitManual,
  type HabitCell,
  type HabitDefinition,
  type HabitDefinitionInput,
  type HabitManualUpdate,
  type HabitsResponse,
} from "@/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import {
  applyOptimisticHabitUpdate,
  buildHabitGridWeeks,
  formatHabitDateLabel,
  getHabitCell,
  moveHabitId,
  upsertHabitCell,
  type HabitDropPosition,
} from "@/lib/habit-grid";

function cellKey(habit: string, date: string): string {
  return `${habit}:${date}`;
}

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return "none";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatWeekRange(start: string, end: string): string {
  return `${formatHabitDateLabel(start)}–${formatHabitDateLabel(end)}`;
}

function stateLabel(cell: HabitCell | undefined): string {
  if (!cell) return "missing";
  return cell.done ? "done" : "not done";
}

function HabitTooltip({ cell, date }: { cell: HabitCell | undefined; date: string }) {
  return (
    <div className="space-y-1">
      <div className="font-medium text-primary-foreground">{date}</div>
      <div>state: {stateLabel(cell)}</div>
      <div>source: {cell?.source ?? "none"}</div>
      <div>updated: {formatUpdatedAt(cell?.updated_at)}</div>
    </div>
  );
}

type HabitEditorState = { mode: "create" } | { mode: "edit"; habit: HabitDefinition };

function HabitEditorDialog({
  editor,
  pending,
  error,
  onClose,
  onSave,
}: {
  editor: HabitEditorState | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (value: HabitDefinitionInput, mode: HabitEditorState["mode"]) => void;
}) {
  const habit = editor?.mode === "edit" ? editor.habit : null;
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [autoFill, setAutoFill] = useState(false);

  useEffect(() => {
    setLabel(habit?.label ?? "");
    setCategory(habit?.category ?? "");
    setAutoFill(habit?.auto_fill ?? false);
  }, [editor, habit]);

  return (
    <Dialog open={editor !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editor?.mode === "edit" ? "Edit activity" : "Add activity"}</DialogTitle>
          <DialogDescription>
            {editor?.mode === "edit"
              ? "Update the activity name and automation settings."
              : "Give the activity a clear name. Emoji are welcome."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editor) return;
            onSave({ label, category: category.trim() || null, auto_fill: autoFill }, editor.mode);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="habit-label">Label</Label>
            <Input
              id="habit-label"
              value={label}
              placeholder="Reading 📚"
              maxLength={80}
              required
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="habit-category">Category</Label>
            <Input
              id="habit-category"
              value={category}
              placeholder="Optional"
              maxLength={80}
              onChange={(event) => setCategory(event.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <Label htmlFor="habit-auto">Auto-filled</Label>
              <div className="text-xs text-muted-foreground">External agents may update this activity.</div>
            </div>
            <Switch id="habit-auto" checked={autoFill} onCheckedChange={setAutoFill} />
          </div>
          {error && <div className="text-sm text-red-300">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HabitCellButton({
  cell,
  date,
  disabled,
  isPending,
  isToday,
  isFuture,
  onToggle,
}: {
  cell: HabitCell | undefined;
  date: string;
  disabled: boolean;
  isPending: boolean;
  isToday: boolean;
  isFuture: boolean;
  onToggle: () => void;
}) {
  const done = cell?.done === true;
  const tone = done
    ? "bg-green-500/85 border-green-400 text-green-950 hover:bg-green-400"
    : "bg-zinc-700/55 border-zinc-600 text-zinc-300 hover:bg-zinc-600";
  const todayRing = isToday ? "ring-2 ring-cyan-300 ring-offset-2 ring-offset-background" : "";
  const futureStyle = isFuture ? "opacity-35 cursor-not-allowed hover:bg-zinc-700/55" : "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${date}: ${stateLabel(cell)}`}
          aria-pressed={done}
          disabled={disabled}
          onClick={onToggle}
          className={`aspect-square w-full rounded-md border text-[10px] font-semibold tabular-nums transition-colors ${tone} ${todayRing} ${futureStyle} disabled:pointer-events-none disabled:opacity-45`}
        >
          {isPending ? "..." : done ? "✓" : ""}
        </button>
      </TooltipTrigger>
      <TooltipContent className="bg-popover text-popover-foreground border border-border shadow-xl">
        <HabitTooltip cell={cell} date={date} />
      </TooltipContent>
    </Tooltip>
  );
}

function HabitRow({
  habit,
  entries,
  weeks,
  pendingKey,
  onToggle,
  onEdit,
  onDelete,
  deleting,
  position,
  total,
  reorderDisabled,
  dragging,
  dropPosition,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onKeyboardMove,
}: {
  habit: HabitDefinition;
  entries: HabitCell[];
  weeks: ReturnType<typeof buildHabitGridWeeks>;
  pendingKey: string | null;
  onToggle: (data: HabitManualUpdate) => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  position: number;
  total: number;
  reorderDisabled: boolean;
  dragging: boolean;
  dropPosition: HabitDropPosition | null;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onKeyboardMove: (direction: -1 | 1) => void;
}) {
  const handleReorderKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onKeyboardMove(event.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative grid grid-cols-[190px_repeat(4,minmax(0,1fr))] gap-3 items-center border-t border-border py-3 transition-opacity ${
        dragging ? "opacity-45" : ""
      }`}
    >
      {dropPosition && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-cyan-400 ${
            dropPosition === "before" ? "top-0" : "bottom-0"
          }`}
        />
      )}
      <div className="flex min-w-0 items-center pr-2">
        <button
          type="button"
          draggable={!reorderDisabled}
          disabled={reorderDisabled}
          aria-label={`Reorder ${habit.label}. Position ${position} of ${total}. Use Up and Down arrow keys.`}
          title="Drag to reorder"
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={handleReorderKey}
          className="mr-1 flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-medium text-foreground">{habit.label}</span>
            {habit.auto_fill && (
              <span className="shrink-0 rounded border border-cyan-500/25 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-300">
                auto
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>streak <span className="font-medium text-foreground tabular-nums">{habit.current_streak}</span></span>
            {habit.category && <span className="truncate">· {habit.category}</span>}
          </div>
          <div className="mt-1 flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Edit ${habit.label}`}
              title="Edit"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-300"
                  aria-label={`Delete ${habit.label}`}
                  title="Delete"
                  disabled={deleting}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {habit.label}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The activity will be archived. Its cells and audit history will be preserved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Delete activity</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
      {weeks.map((week, weekIndex) => (
        <div
          key={week.startDate}
          className={`grid grid-cols-7 gap-1 ${weekIndex > 0 ? "border-l border-border pl-3" : ""}`}
        >
          {week.days.map((day) => {
            const cell = getHabitCell(entries, habit.id, day.date);
            const key = cellKey(habit.id, day.date);
            return (
              <HabitCellButton
                key={day.date}
                cell={cell}
                date={day.date}
                disabled={day.isFuture || pendingKey !== null}
                isPending={pendingKey === key}
                isToday={day.isToday}
                isFuture={day.isFuture}
                onToggle={() => onToggle({ date: day.date, habit: habit.id, done: !(cell?.done === true) })}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function HabitsPage() {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const [editor, setEditor] = useState<HabitEditorState | null>(null);
  const [draggedHabitId, setDraggedHabitId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ habitId: string; position: HabitDropPosition } | null>(null);
  useEffect(() => {
    const refreshDate = () => setNow(new Date());
    const interval = window.setInterval(refreshDate, 60_000);
    window.addEventListener("focus", refreshDate);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshDate);
    };
  }, []);

  const weeks = useMemo(() => buildHabitGridWeeks(now), [now]);
  const days = weeks.flatMap((week) => week.days);
  const from = days[0]?.date ?? "";
  const to = days[days.length - 1]?.date ?? "";
  const queryKey = ["habits", from, to] as const;

  const { data, isLoading, isError, error } = useQuery<HabitsResponse>({
    queryKey,
    queryFn: () => getHabits(from, to),
    enabled: from.length > 0 && to.length > 0,
  });

  const mutation = useMutation<
    HabitCell,
    Error,
    HabitManualUpdate,
    { previous: HabitsResponse | undefined }
  >({
    mutationFn: updateHabitManual,
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<HabitsResponse>(queryKey);
      queryClient.setQueryData<HabitsResponse>(queryKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          entries: applyOptimisticHabitUpdate(old.entries, next, new Date().toISOString()),
        };
      });
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSuccess: (cell) => {
      queryClient.setQueryData<HabitsResponse>(queryKey, (old) => {
        if (!old) return old;
        return { ...old, entries: upsertHabitCell(old.entries, cell) };
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const definitionMutation = useMutation({
    mutationFn: ({
      value,
      mode,
      id,
    }: {
      value: HabitDefinitionInput;
      mode: HabitEditorState["mode"];
      id?: string;
    }) => {
      if (mode === "create") return createHabitDefinition(value);
      if (!id) throw new Error("Missing activity id");
      return updateHabitDefinition(id, value);
    },
    onSuccess: () => {
      setEditor(null);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const reorderMutation = useMutation<
    Awaited<ReturnType<typeof reorderHabitDefinitions>>,
    Error,
    string[],
    { previous: HabitsResponse | undefined }
  >({
    mutationFn: reorderHabitDefinitions,
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<HabitsResponse>(queryKey);
      const order = new Map(ids.map((id, index) => [id, index]));
      queryClient.setQueryData<HabitsResponse>(queryKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          habits: [...old.habits].sort(
            (left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
          ),
        };
      });
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: archiveHabitDefinition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const pendingKey = mutation.isPending ? cellKey(mutation.variables.habit, mutation.variables.date) : null;

  const reorder = (sourceId: string, targetId: string, position: HabitDropPosition) => {
    if (!data || reorderMutation.isPending) return;
    const currentIds = data.habits.map((habit) => habit.id);
    const nextIds = moveHabitId(currentIds, sourceId, targetId, position);
    if (nextIds !== currentIds) reorderMutation.mutate(nextIds);
  };

  const finishDrag = () => {
    setDraggedHabitId(null);
    setDropTarget(null);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Habits</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatHabitDateLabel(from)} - {formatHabitDateLabel(to)}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-green-500" />
                done
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-zinc-700" />
                missing
              </span>
            </div>
            <Button type="button" size="icon" aria-label="Add activity" title="Add activity" onClick={() => {
              definitionMutation.reset();
              setEditor({ mode: "create" });
            }}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <div className="min-w-[1050px] p-4">
            <div className="grid grid-cols-[190px_repeat(4,minmax(0,1fr))] gap-3 items-end pb-3">
              <div />
              {weeks.map((week, weekIndex) => (
                <div key={week.startDate} className={weekIndex > 0 ? "border-l border-border pl-3" : ""}>
                  <div className="mb-2 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {formatWeekRange(week.days[0].date, week.days[6].date)}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {week.days.map((day) => (
                      <div key={day.date} className="text-center">
                        <div className={`text-[9px] font-medium ${day.isToday ? "text-cyan-300" : "text-muted-foreground"}`}>
                          {day.weekday}
                        </div>
                        <div className={`text-[11px] tabular-nums ${day.isToday ? "text-cyan-200" : "text-foreground"}`}>
                          {day.dayOfMonth}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {isLoading && (
              <div className="border-t border-border py-8 text-sm text-muted-foreground">Loading habits...</div>
            )}
            {isError && (
              <div className="border-t border-border py-8 text-sm text-red-300">
                {error instanceof Error ? error.message : "Failed to load habits"}
              </div>
            )}
            {mutation.isError && (
              <div className="border-t border-border py-3 text-sm text-red-300">
                {mutation.error.message || "Failed to update habit"}
              </div>
            )}
            {archiveMutation.isError && (
              <div className="border-t border-border py-3 text-sm text-red-300">
                {archiveMutation.error.message || "Failed to delete activity"}
              </div>
            )}
            {reorderMutation.isError && (
              <div className="border-t border-border py-3 text-sm text-red-300">
                {reorderMutation.error.message || "Failed to reorder activities"}
              </div>
            )}
            {data?.habits.map((habit, index) => (
              <HabitRow
                key={habit.id}
                habit={habit}
                entries={data.entries}
                weeks={weeks}
                pendingKey={pendingKey}
                onToggle={(next) => mutation.mutate(next)}
                onEdit={() => {
                  definitionMutation.reset();
                  setEditor({ mode: "edit", habit });
                }}
                onDelete={() => archiveMutation.mutate(habit.id)}
                deleting={archiveMutation.isPending && archiveMutation.variables === habit.id}
                position={index + 1}
                total={data.habits.length}
                reorderDisabled={reorderMutation.isPending}
                dragging={draggedHabitId === habit.id}
                dropPosition={dropTarget?.habitId === habit.id ? dropTarget.position : null}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", habit.id);
                  setDraggedHabitId(habit.id);
                  setDropTarget(null);
                }}
                onDragOver={(event) => {
                  const sourceId = draggedHabitId || event.dataTransfer.getData("text/plain");
                  if (!sourceId || sourceId === habit.id || reorderMutation.isPending) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const position = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
                  setDropTarget((current) =>
                    current?.habitId === habit.id && current.position === position
                      ? current
                      : { habitId: habit.id, position },
                  );
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = event.dataTransfer.getData("text/plain") || draggedHabitId;
                  const position = dropTarget?.habitId === habit.id ? dropTarget.position : "before";
                  if (sourceId) reorder(sourceId, habit.id, position);
                  finishDrag();
                }}
                onDragEnd={finishDrag}
                onKeyboardMove={(direction) => {
                  const targetIndex = index + direction;
                  const target = data.habits[targetIndex];
                  if (!target) return;
                  reorder(habit.id, target.id, direction < 0 ? "before" : "after");
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <HabitEditorDialog
        editor={editor}
        pending={definitionMutation.isPending}
        error={definitionMutation.isError ? definitionMutation.error.message : null}
        onClose={() => {
          if (!definitionMutation.isPending) {
            definitionMutation.reset();
            setEditor(null);
          }
        }}
        onSave={(value, mode) =>
          definitionMutation.mutate({
            value,
            mode,
            id: editor?.mode === "edit" ? editor.habit.id : undefined,
          })
        }
      />
    </TooltipProvider>
  );
}
