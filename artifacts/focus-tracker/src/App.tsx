import { useState, useLayoutEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TodayPage from "@/pages/Today";
import CalendarPage from "@/pages/Calendar";
import DatabasePage from "@/pages/Database";
import SettingsPage from "@/pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

type Tab = "today" | "calendar" | "database" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "calendar", label: "Calendar" },
  { id: "database", label: "Database" },
  { id: "settings", label: "Settings" },
];

function Layout() {
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const mainRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.scrollTo(0, 0);
  }, [activeTab]);

  const selectTab = (tab: Tab) => setActiveTab(tab);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border bg-sidebar sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 flex items-center gap-8 h-14">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="3" fill="white" />
                <circle cx="7" cy="7" r="6" stroke="white" strokeWidth="1.5" fill="none" strokeDasharray="3 2" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">Focus</span>
          </div>
          <nav className="flex items-center gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors font-medium ${
                  activeTab === tab.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main ref={mainRef} className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {activeTab === "today" && <TodayPage />}
        {activeTab === "calendar" && <CalendarPage />}
        {activeTab === "database" && <DatabasePage />}
        {activeTab === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Layout />
    </QueryClientProvider>
  );
}
