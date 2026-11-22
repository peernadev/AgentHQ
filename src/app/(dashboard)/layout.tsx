import type { ReactNode } from "react";
import { FirebaseAuthGate, FirebaseAuthProvider } from "@/lib/client/auth-provider";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <FirebaseAuthProvider><FirebaseAuthGate>{children}</FirebaseAuthGate></FirebaseAuthProvider>;
}
