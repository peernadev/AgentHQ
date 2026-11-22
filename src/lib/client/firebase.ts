"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

function setupError(message: string): Error {
  const error = new Error(message);
  error.name = "FirebaseSetupError";
  return error;
}

/** Browser-only and lazy: importing this module never initializes Firebase. */
export function getFirebaseClient(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (typeof window === "undefined") {
    throw setupError("Firebase sign-in is only available in a browser.");
  }

  // Direct references are required for Next.js to inline public configuration.
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };

  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    throw setupError(
      "Firebase is not configured. Set the public Firebase API key, auth domain, project ID, and app ID, then restart the app.",
    );
  }

  const app = getApps().some((item) => item.name === "[DEFAULT]")
    ? getApp()
    : initializeApp(config);
  return { app, auth: getAuth(app), db: getFirestore(app) };
}
