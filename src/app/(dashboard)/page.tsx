import { Suspense } from "react";
import { MissionDashboard } from "@/components/mission-dashboard";
import { Skeleton } from "@/components/ui/skeleton";

// The auth gate waits for a browser session before rendering this segment.
export const instant = false;

function DashboardLoading() {
  return <main aria-busy="true" aria-label="Loading mission workspace" className="min-h-screen bg-background text-foreground [font-family:var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif] md:grid md:grid-cols-[240px_minmax(0,1fr)]">
    <div aria-hidden="true" className="border-b bg-muted/60 p-6 md:min-h-screen md:border-r md:border-b-0"><Skeleton className="h-7 w-28 motion-reduce:animate-none" /><div className="mt-10 hidden space-y-3 md:block"><Skeleton className="h-7 w-full motion-reduce:animate-none" /><Skeleton className="h-7 w-3/4 motion-reduce:animate-none" /></div></div>
    <div className="px-[18px] py-8 sm:px-12 md:py-16"><div className="mx-auto max-w-[920px]"><p role="status" className="text-2xl font-semibold tracking-tight">Loading your workspace…</p><div aria-hidden="true" className="mt-8 space-y-7"><Skeleton className="h-8 w-72 max-w-full motion-reduce:animate-none" /><Skeleton className="h-px w-full motion-reduce:animate-none" /><Skeleton className="h-14 w-full motion-reduce:animate-none" /><Skeleton className="h-14 w-full motion-reduce:animate-none" /></div></div></div>
  </main>;
}

export default function DashboardPage() {
  return <Suspense fallback={<DashboardLoading />}><MissionDashboard /></Suspense>;
}
