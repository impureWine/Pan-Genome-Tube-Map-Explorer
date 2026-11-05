"use client";
import { useEffect, useState } from "react";

export interface Remote<T> { data: T | null; loading: boolean; error: string | null; duration: number | null }

export function useGenomeAPI<T>(path: string | null, revision: number): Remote<T> {
  const [result, setResult] = useState<Remote<T>>({ data: null, loading: true, error: null, duration: null });
  useEffect(() => {
    if (!path) return;
    let active = true;
    const controller = new AbortController();
    const delay = window.setTimeout(async () => {
      setResult({ data: null, loading: true, error: null, duration: null });
      const started = performance.now();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(path, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(`${response.status}: ${typeof body?.detail === "string" ? body.detail : "The genome request failed."}`);
        }
        const data: T = await response.json();
        if (active) setResult({ data, loading: false, error: null, duration: Math.round(performance.now() - started) });
      } catch (error) {
        if (active) setResult({ data: null, loading: false, duration: null,
          error: controller.signal.aborted ? "The genome request timed out. Check the backend connection." :
            error instanceof Error ? error.message : "The genome service could not be reached." });
      } finally { window.clearTimeout(timeout); }
    }, 160);
    return () => { active = false; window.clearTimeout(delay); controller.abort(); };
  }, [path, revision]);
  return result;
}
