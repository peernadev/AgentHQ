import { Suspense } from "react";
import { MissionDashboard } from "@/components/mission-dashboard";
import { Skeleton } from "@/components/ui/skeleton";

function DashboardLoading() {
  return (
    <main aria-busy="true" aria-label="Loading mission control" className="min-h-screen [font-family:var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif] bg-muted/35 p-4 sm:p-6">
      <div className="mx-auto max-w-[1800px]">
        <p role="status" className="mb-8 text-2xl font-semibold">Loading mission control…</p>
        <div aria-hidden="true" className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
          <Skeleton className="h-36 motion-reduce:animate-none" />
          <div className="space-y-6">
            <Skeleton className="h-20 motion-reduce:animate-none" />
            <div className="grid gap-4 sm:grid-cols-3">
              {[1, 2, 3].map(item => <Skeleton key={item} className="h-72 motion-reduce:animate-none" />)}
            </div>
            <Skeleton className="h-40 motion-reduce:animate-none" />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return <Suspense fallback={<DashboardLoading />}><MissionDashboard /></Suspense>;
}
