import type { SegmentDef } from "../types.ts"
import { SEGMENTS as model } from "./model.ts"
import { SEGMENTS as place } from "./place.ts"
import { SEGMENTS as session } from "./session.ts"
import { SEGMENTS as system } from "./system.ts"

/**
 * Every built-in, grouped by what it talks about rather than listed in one file: adding a segment
 * should mean opening the twenty lines it belongs with, not four hundred.
 */
export const BUILTINS: SegmentDef[] = [...place, ...model, ...session, ...system]
