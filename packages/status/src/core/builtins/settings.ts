/** Reading a segment's own settings out of its config entry, safely. */

import type { SegmentConfig } from "../config.ts"

export function num(config: SegmentConfig, key: string, fallback: number): number {
  const value = config[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function str(config: SegmentConfig, key: string): string | undefined {
  const value = config[key]
  return typeof value === "string" ? value : undefined
}
