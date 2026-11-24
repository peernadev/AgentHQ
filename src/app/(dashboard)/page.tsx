import { Suspense } from "react";
import { ProjectPicker } from "@/components/projects/project-picker";

// The auth gate waits for a browser session before rendering this segment.
export const instant = false;

function PickerLoading() {
  return <main aria-busy="true" aria-label="Loading your projects" className="flex min-h-screen items-center justify-center bg-background font-sans text-sm text-muted-foreground">
    <p role="status">Loading your projects…</p>
  </main>;
}

/** After sign-in: pick a project (or create one, for global owners). */
export default function ProjectsPage() {
  return <Suspense fallback={<PickerLoading />}><ProjectPicker /></Suspense>;
}
