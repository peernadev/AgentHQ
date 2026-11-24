"use client";

import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@/types/api";
import { apiRequest } from "@/lib/client/api-client";
import { useFirebaseAuth } from "@/lib/client/auth-provider";

const LAST_PROJECT = "agenthq:last-project";

/** The last project this browser opened (a convenience only; the server decides access). */
export function lastProject(): string | null {
  try { return window.localStorage.getItem(LAST_PROJECT); } catch { return null; }
}
export function rememberProject(id: string) {
  try { window.localStorage.setItem(LAST_PROJECT, id); } catch { /* private mode: fine */ }
}

/** GET /api/me for the signed-in user: their projects, roles and whether they may create projects. */
export function useMe() {
  const { user } = useFirebaseAuth();
  // Each result is tagged with the request number it answers; loading = the latest hasn't arrived.
  const [result, setResult] = useState<{ run: number; me: MeResponse | null; error: string }>({ run: -1, me: null, error: "" });
  const [run, setRun] = useState(0);
  const refresh = useCallback(() => setRun((n) => n + 1), []);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    apiRequest<MeResponse>(user, "/api/me", { signal: controller.signal })
      .then((res) => setResult({ run, me: res, error: "" }))
      .catch((e) => { if (!controller.signal.aborted) setResult((cur) => ({ run, me: cur.me, error: e instanceof Error ? e.message : "Could not load your projects." })); });
    return () => controller.abort();
  }, [user, run]);

  return { me: result.me, error: result.error, loading: result.run !== run, refresh };
}
