import type { LODMode, LOD, Region } from "./types";

export const format = (n: number) => n.toLocaleString("en-US");
export function clampRegion(start: number, span: number, total: number): Region {
  const length = Math.max(1, Math.min(Math.round(span), total));
  const left = Math.max(0, Math.min(Math.round(start), total - length));
  return { start: left, end: left + length };
}
export function parseRegion(input: string, total: number): Region | null {
  const match = input.replaceAll(",", "").match(/^\s*(\d+)\s*[-–:]\s*(\d+)\s*$/);
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < end && end <= total
    ? { start, end } : null;
}
export function zoomRegion(region: Region, factor: number, total: number, anchor = 0.5): Region {
  const span = Math.max(1, Math.min(total, Math.round((region.end - region.start) * factor)));
  return clampRegion(region.start + (region.end - region.start - span) * anchor, span, total);
}
export function resolveLOD(mode: LODMode, region: Region): LOD {
  return mode === "auto" ? (region.end - region.start <= 1500 ? "micro" : "macro") : mode;
}
