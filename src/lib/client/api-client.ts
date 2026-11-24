"use client";

import type { User } from "firebase/auth";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Sent as X-Project-Id: the project a dashboard route acts on. */
  projectId?: string | null;
  signal?: AbortSignal;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Firebase ID tokens are attached only to this app's API, never persisted. */
export async function apiRequest<T>(user: User, path: string, options: RequestOptions = {}): Promise<T> {
  const base = "https://agenthq.invalid";
  const hasControlOrSpace = Array.from(path).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 32 || code === 127;
  });
  if (!path.startsWith("/api/") || path.includes("\\") || path.includes("#") || hasControlOrSpace) {
    throw new ApiError("Requests must use a local /api/ path.", 400, "invalid_api_path");
  }
  const url = new URL(path, base);
  if (url.origin !== base || !url.pathname.startsWith("/api/")) {
    throw new ApiError("Requests must use a local /api/ path.", 400, "invalid_api_path");
  }

  const method = (options.method ?? (options.body === undefined ? "GET" : "POST")).toUpperCase();
  if (options.body !== undefined && (method === "GET" || method === "HEAD")) {
    throw new ApiError("GET and HEAD requests cannot include a body.", 400, "invalid_request_body");
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    try {
      body = JSON.stringify(options.body);
      if (body === undefined) throw new Error("Not JSON");
    } catch {
      throw new ApiError("The request body must be valid JSON.", 400, "invalid_request_body");
    }
  }

  options.signal?.throwIfAborted();
  let token: string;
  try {
    token = await user.getIdToken();
  } catch {
    options.signal?.throwIfAborted();
    throw new ApiError("Your session could not be refreshed. Sign in again and retry.", 401, "auth_token_failed");
  }
  options.signal?.throwIfAborted();

  let response: Response;
  let raw: string;
  try {
    response = await fetch(url.pathname + url.search, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.projectId ? { "X-Project-Id": options.projectId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body } : {}),
      signal: options.signal,
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    raw = await response.text();
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0, "network_error");
  }

  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : undefined;
  } catch {
    if (response.ok) throw new ApiError("The server returned an unreadable response. Please retry.", 502, "invalid_response");
  }
  if (!response.ok) {
    const fields = record(payload);
    const nested = record(fields?.error);
    const message = response.status === 503
      ? "Gemini is busy right now. Please try again shortly."
      : typeof fields?.error === "string" ? fields.error
        : typeof nested?.message === "string" ? nested.message
          : typeof fields?.message === "string" ? fields.message
            : `Request failed (${response.status}). Please try again.`;
    const code = typeof fields?.code === "string" ? fields.code
      : typeof nested?.code === "string" ? nested.code : undefined;
    throw new ApiError(message, response.status, code, fields?.details ?? nested?.details);
  }
  return payload as T;
}
