import "server-only";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";

// Small helpers shared by the API route handlers.

/** Thrown inside a handler to return an error response; caught by `handle`. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** Wraps a handler so thrown HttpErrors become `{ error }` responses and anything else a 500. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      // Next's own control-flow errors (e.g. the prerender bailout when a GET handler reads
      // request headers under cacheComponents) must reach Next untouched, not become a 500.
      unstable_rethrow(err);
      if (err instanceof HttpError) return jsonError(err.status, err.message);
      console.error(err);
      return jsonError(500, "Internal server error");
    }
  };
}

/** Parses the JSON body as an object, or throws 400. With `optional`, an empty body yields `{}`. */
export async function readBody(
  req: Request,
  { optional = false }: { optional?: boolean } = {},
): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (optional && !text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function str(body: Record<string, unknown>, key: string, opts: { max?: number } = {}): string {
  const v = optStr(body, key, opts);
  if (v === undefined) throw new HttpError(400, `"${key}" is required`);
  return v;
}

export function optStr(
  body: Record<string, unknown>,
  key: string,
  { max = 2000 }: { max?: number } = {},
): string | undefined {
  const v = body[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new HttpError(400, `"${key}" must be a string`);
  const t = v.trim();
  if (!t) return undefined;
  if (t.length > max) throw new HttpError(400, `"${key}" is too long (max ${max})`);
  return t;
}
