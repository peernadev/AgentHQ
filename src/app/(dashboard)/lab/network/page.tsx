import { Suspense } from "react";
import { AgentNetworkDashboard } from "@/components/agent-network-dashboard";

export default function NetworkPreviewPage() {
  return <Suspense fallback={<main aria-busy="true" className="min-h-screen bg-background p-8 text-foreground"><p role="status">Loading the network preview…</p></main>}><AgentNetworkDashboard /></Suspense>;
}
