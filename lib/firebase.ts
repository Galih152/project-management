// lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported, Analytics } from "firebase/analytics";

// Pakai config kamu (boleh langsung di sini, atau pindah ke env NEXT_PUBLIC_*)
const firebaseConfig = {
  apiKey: "AIzaSyCjvGGw7PGYvDRalL4N8S0kpYclXVJqO68",
  authDomain: "dailyuser-2747f.firebaseapp.com",
  databaseURL: "https://dailyuser-2747f-default-rtdb.firebaseio.com",
  projectId: "dailyuser-2747f",
  storageBucket: "dailyuser-2747f.firebasestorage.app",
  messagingSenderId: "481625882072",
  appId: "1:481625882072:web:8dd980abeae0d99be046ad",
  measurementId: "G-KH29EJ15FL",
};

// Hindari inisialisasi ganda saat dev/HMR
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Services yang kamu butuhkan
export const db = getFirestore(app);

// Analytics hanya jalan di browser
export async function initAnalytics(): Promise<Analytics | undefined> {
  if (typeof window === "undefined") return;
  try {
    const ok = await isSupported();
    return ok ? getAnalytics(app) : undefined;
  } catch {
    return undefined;
  }
}
