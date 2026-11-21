import { NextResponse } from "next/server";
import type { HealthResponse } from "@/types/api";

export function GET() {
  return NextResponse.json<HealthResponse>({ ok: true });
}
