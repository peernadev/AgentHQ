import { Suspense } from "react";
import { LiveNetworkDashboard } from "@/components/network/live-network-dashboard";

// The auth gate waits for a browser session before rendering this segment.
export const instant = false;

function DashboardLoading() {
  return <main aria-busy="true" aria-label="Loading mission control" className="flex min-h-screen items-center justify-center bg-background font-sans text-sm text-muted-foreground">
    <p role="status">Loading mission control…</p>
  </main>;
}

export default function DashboardPage() {
  return <Suspense fallback={<DashboardLoading />}><LiveNetworkDashboard /></Suspense>;
}
