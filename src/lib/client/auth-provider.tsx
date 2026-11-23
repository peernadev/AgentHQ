"use client";

import {
  createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { AgentHQMark } from "@/components/agenthq-mark";
import { Button } from "@/components/ui/button";
import { getFirebaseClient } from "./firebase";

interface FirebaseAuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const FirebaseAuthContext = createContext<FirebaseAuthState | null>(null);

function authErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "FirebaseSetupError") return error.message;
  const code = error !== null && typeof error === "object" && "code" in error ? error.code : null;
  switch (code) {
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups for this site, then try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled. Choose Sign in with Google to try again.";
    case "auth/unauthorized-domain":
      return "This site's domain is not authorized for Firebase sign-in. Ask the project owner to add it in Firebase Authentication settings.";
    case "auth/operation-not-allowed":
      return "Google sign-in is not enabled. Ask the project owner to enable the Google provider in Firebase Authentication.";
    case "auth/invalid-api-key":
    case "auth/app-not-authorized":
    case "auth/invalid-auth-event":
      return "Firebase sign-in configuration needs attention. Ask the project owner to check the public Firebase settings, then reload.";
    case "auth/network-request-failed":
      return "Could not connect to Google sign-in. Check your connection and try again.";
    case "auth/web-storage-unsupported":
      return "This browser is blocking sign-in storage. Allow site storage or try another browser.";
    case "auth/account-exists-with-different-credential":
      return "This account uses a different sign-in method. Contact the project owner for access.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact the project owner for access.";
    case "auth/too-many-requests":
      return "There have been too many sign-in attempts. Wait a moment, then try again.";
    default:
      return "Sign-in could not be completed. Try again, or reload the page if the problem continues.";
  }
}

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const actionPending = useRef(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    // Initialize after mounting; server rendering and imports stay configuration-free.
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const { auth } = getFirebaseClient();
        unsubscribe = onAuthStateChanged(auth, (nextUser) => {
          if (!active) return;
          setUser(nextUser);
          setLoading(false);
          setError(null);
        }, (cause) => {
          if (!active) return;
          setUser(null);
          setLoading(false);
          setError(authErrorMessage(cause));
        });
      } catch (cause) {
        if (!active) return;
        setUser(null);
        setLoading(false);
        setError(authErrorMessage(cause));
      }
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async () => {
    if (actionPending.current) return;
    actionPending.current = true;
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      // Default profile/email scopes only. No Workspace credentials are extracted.
      await signInWithPopup(getFirebaseClient().auth, provider);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      actionPending.current = false;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (actionPending.current) return;
    actionPending.current = true;
    setError(null);
    try {
      await firebaseSignOut(getFirebaseClient().auth);
      setUser(null);
    } catch {
      const message = "Sign-out could not be completed. Check your connection and try again.";
      setError(message);
      throw new Error(message);
    } finally {
      actionPending.current = false;
    }
  }, []);

  const value = useMemo(() => ({ user, loading, error, signIn, signOut }), [user, loading, error, signIn, signOut]);
  return <FirebaseAuthContext.Provider value={value}>{children}</FirebaseAuthContext.Provider>;
}

export function useFirebaseAuth(): FirebaseAuthState {
  const context = useContext(FirebaseAuthContext);
  if (!context) throw new Error("useFirebaseAuth must be used inside FirebaseAuthProvider.");
  return context;
}

export function FirebaseAuthGate({ children }: { children: ReactNode }) {
  const { user, loading, error, signIn } = useFirebaseAuth();
  const [signingIn, setSigningIn] = useState(false);
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground" aria-busy="true">
        <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
          Restoring your session…
        </div>
      </main>
    );
  }
  if (user) return <Fragment key={user.uid}>{children}</Fragment>;

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background p-4 font-sans text-foreground sm:p-6">
      {/* Hexagon texture stays in the backdrop; the card below is solid so it never sits behind text. */}
      <div className="bg-hex pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_75%)]" aria-hidden="true" />
      <section className="relative w-full max-w-sm space-y-7 rounded-xl border border-border bg-card p-7 text-card-foreground sm:p-8" aria-labelledby="sign-in-title">
        <div className="flex items-center gap-2.5 text-sm font-medium">
          <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface-raised text-primary">
            <AgentHQMark className="size-[18px]" />
          </span>
          AgentHQ
        </div>
        <div className="space-y-2">
          <h1 id="sign-in-title" className="text-2xl font-semibold tracking-tight">Sign in to mission control</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">Use your team&apos;s Google account to see missions, workers and reviews.</p>
        </div>
        {error && <p role="alert" className="rounded-md border border-status-failed/30 bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{error}</p>}
        <Button
          type="button"
          size="lg"
          disabled={signingIn}
          aria-busy={signingIn}
          className="min-h-11 w-full disabled:cursor-wait"
          onClick={async () => {
            setSigningIn(true);
            try { await signIn(); } finally { setSigningIn(false); }
          }}
        >
          {signingIn ? "Opening Google sign-in…" : "Sign in with Google"}
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">Only team members listed by the project can open the workspace.</p>
      </section>
    </main>
  );
}
