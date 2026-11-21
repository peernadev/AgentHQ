"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthResponse } from "@/types/api";

type Status = "loading" | "ok" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<HealthResponse>)
      .then((data) => setStatus(data.ok ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">AgentHQ</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl font-medium">API: {status}</p>
        </CardContent>
      </Card>
    </main>
  );
}
