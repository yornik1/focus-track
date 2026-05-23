import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getLogs, patchLog, deleteLog, type LogEntry, type Category, type LogsFilter } from "@/api";

const CATEGORY_COLORS: Record<string, string> = {
  code: "bg-blue-500/15 text-blue-300 border border-blue-500/20",
  video: "bg-purple-500/15 text-purple-300 border border-purple-500/20",
  social: "bg-amber-500/15 text-amber-300 border border-amber-500/20",
  research: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20",
  communication: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/20",
  gaming: "bg-red-500/15 text-red-300 border border-red-500/20",
  news: "bg-orange-500/15 text-orange-300 border border-orange-500/20",
};

function categoryBadgeClass(cat: Category): string {
  return CATEGORY_COLORS[cat] ?? "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20";
}

function scoreTextColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

function formatDatetime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
}

interface EditState {
  id: string;
  field: "score" | "category";
  value: string;
}

export default function DatabasePage() {
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<LogsFilter>({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [editState, setEditState] = useState<EditState | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["logs", filter, page],
    queryFn: () => getLogs({ ...filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    keepPreviousData: true,
  } as any);

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<LogEntry, "score" | "category">> }) =>
      patchLog(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logs"] });
      setEditState(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLog,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["logs"] }),
  });

  const applyFilters = useCallback(() => {
    const f: LogsFilter = {};
    if (dateFrom) f.date_from = dateFrom;
    if (dateTo) f.date_to = dateTo;
    if (category) f.category = category as Category;
    if (minScore) f.min_score = parseFloat(minScore);
    if (maxScore) f.max_score = parseFloat(maxScore);
    setFilter(f);
    setPage(0);
  }, [dateFrom, dateTo, category, minScore, maxScore]);

  const clearFilters = () => {
    setDateFrom(""); setDateTo("");
    setCategory(""); setMinScore(""); setMaxScore("");
    setFilter({}); setPage(0);
  };

  const entries: LogEntry[] = (data as any)?.entries ?? [];
  const total: number = (data as any)?.total ?? 0;
  const ALL_CATEGORIES = ["code", "video", "social", "research", "communication", "gaming", "news", "idle"];
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleEditCommit = (entry: LogEntry) => {
    if (!editState) return;
    if (editState.field === "score") {
      const score = parseFloat(editState.value);
      if (isNaN(score) || score < 0 || score > 10) return;
      patchMutation.mutate({ id: entry.id, data: { score } });
    } else {
      patchMutation.mutate({ id: entry.id, data: { category: editState.value as Category } });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Database</h1>
        {total > 0 && (
          <span className="text-sm text-muted-foreground">{total} entries</span>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-background border border-input rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-background border border-input rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category | "")}
              className="bg-background border border-input rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Min score</label>
            <input
              type="number"
              min="0" max="10" step="0.5"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              placeholder="0"
              className="bg-background border border-input rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Max score</label>
            <input
              type="number"
              min="0" max="10" step="0.5"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              placeholder="10"
              className="bg-background border border-input rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-20"
            />
          </div>
          <div className="flex gap-2 pb-px">
            <button
              onClick={applyFilters}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Filter
            </button>
            <button
              onClick={clearFilters}
              className="px-4 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-accent transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="text-sm text-muted-foreground">Loading…</div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            No entries found.
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Datetime</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Score</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider flex-1">Summary</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const isEditingScore = editState?.id === entry.id && editState.field === "score";
                  const isEditingCat = editState?.id === entry.id && editState.field === "category";

                  return (
                    <tr
                      key={entry.id}
                      className={`border-b border-border/50 last:border-0 hover:bg-accent/30 transition-colors ${
                        idx % 2 === 0 ? "" : "bg-muted/10"
                      }`}
                    >
                      <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums whitespace-nowrap">
                        {formatDatetime(entry.datetime)}
                      </td>
                      <td className="px-4 py-3">
                        {isEditingCat ? (
                          <select
                            autoFocus
                            value={editState.value}
                            onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                            onBlur={() => handleEditCommit(entry)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleEditCommit(entry); if (e.key === "Escape") setEditState(null); }}
                            className="bg-background border border-input rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <button
                            onClick={() => setEditState({ id: entry.id, field: "category", value: entry.category })}
                            className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-80 transition-opacity ${categoryBadgeClass(entry.category)}`}
                          >
                            {entry.category}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditingScore ? (
                          <input
                            autoFocus
                            type="number"
                            min="0" max="10" step="0.1"
                            value={editState.value}
                            onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                            onBlur={() => handleEditCommit(entry)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleEditCommit(entry); if (e.key === "Escape") setEditState(null); }}
                            className="bg-background border border-input rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-16"
                          />
                        ) : (
                          <button
                            onClick={() => setEditState({ id: entry.id, field: "score", value: String(entry.score) })}
                            className={`text-sm font-semibold tabular-nums cursor-pointer hover:opacity-70 transition-opacity ${scoreTextColor(entry.score)}`}
                          >
                            {entry.score.toFixed(1)}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate">
                        {entry.summary}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => {
                            if (confirm("Delete this entry?")) deleteMutation.mutate(entry.id);
                          }}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M11 3.5l-.5 7.5a1 1 0 0 1-1 .93H4.5a1 1 0 0 1-1-.93L3 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages} · Showing {entries.length} of {total} total
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 text-xs rounded-md bg-secondary text-secondary-foreground disabled:opacity-40 hover:bg-accent transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page === totalPages - 1}
                    className="px-3 py-1 text-xs rounded-md bg-secondary text-secondary-foreground disabled:opacity-40 hover:bg-accent transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Click any score or category cell to inline edit. Press Enter to save, Escape to cancel.
      </p>
    </div>
  );
}
