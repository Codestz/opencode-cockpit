/**
 * The two agent tools as plain functions of the trail, so either OpenCode's adapter is only wiring:
 * read the file, call one of these, append what it returns.
 */

import { checkAdd, checkList, recordedEvent, type Who } from "./add.ts"
import { conversationThings, type Thing } from "./model.ts"
import { apply, type Event, matchRecord, type State } from "./store.ts"
import { addedText, listText } from "./text.ts"

export type AddOutcome =
  | { ok: false; text: string }
  /** `event` is what to append; `state` already holds it. */
  | { ok: true; text: string; event: Event; thing: Thing }

/** `trail_add`: checked, folded into `state`, and answered. Nothing is written here. */
export function runAdd(state: State, args: unknown, who: Who): AddOutcome {
  const checked = checkAdd(args)
  if (!checked.ok) return { ok: false, text: checked.error }
  const merged = matchRecord(state, who.rootSession, checked.fields.url, checked.fields.ref) !== undefined
  const event = recordedEvent(checked.fields, who, state)
  apply(state, event)
  const record = matchRecord(state, who.rootSession, event.url, event.ref)
  const things = conversationThings(state, who.rootSession)
  const thing = things.find((each) => each.key === record?.key) as Thing
  const target = event.for
  const forMissing =
    target !== undefined &&
    matchRecord(state, who.rootSession, /^https?:/.test(target) ? target : undefined, target) === undefined
  return {
    ok: true,
    event,
    thing,
    text: addedText({
      thing,
      merged,
      count: things.length,
      stripped: checked.stripped,
      ...(forMissing && target ? { forMissing: target } : {}),
    }),
  }
}

/** `trail_list`: the trail as text, the same order as `/trail`. */
export function runList(state: State, args: unknown, session: string, now: number): string {
  return listText({ state, session, now, ...checkList(args) })
}
