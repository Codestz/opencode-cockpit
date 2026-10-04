import { describe, expect, test } from "bun:test"
import type { Guard } from "../../src/core/guard.ts"
import { REVIEW_KEYS } from "../../src/core/view/keys.ts"
import type { Actions } from "../../src/tui/panel/actions.ts"
import { paneLayer } from "../../src/tui/panel/keys.ts"

/** Actions that only record what was asked of them. */
function recorder() {
  const called: string[] = []
  const actions = new Proxy({} as Actions, {
    get:
      (_, name) =>
      (...args: unknown[]) => {
        called.push(args.length ? `${String(name)}(${args.join(",")})` : String(name))
      },
  })
  return { actions, called }
}
/** A guard that runs everything and says where. */
function passThrough() {
  const where: string[] = []
  const guard = {
    run: (at: string, run: () => unknown) => {
      where.push(at)
      return run()
    },
  } as unknown as Guard
  return { guard, where }
}

const layer = () => paneLayer(recorder().actions, passThrough().guard)
const bindings = () => layer().bindings ?? []
const commands = () => layer().commands ?? []
/** Every key a binding takes, as OpenTUI names it: `return`, `shift+l`, `escape`. */
const boundKeys = () => bindings().flatMap((binding) => binding.key.split(","))

describe("the table", () => {
  test("every binding runs a command the layer has, and every command has a key", () => {
    const names = new Set(commands().map((command) => command.name))
    for (const binding of bindings()) expect(names).toContain(binding.cmd)
    const bound = new Set(bindings().map((binding) => binding.cmd))
    for (const name of names) expect(bound).toContain(name)
  })

  test("no key means two things — `s` submitted and `S` switched source once, a shift apart", () => {
    const keys = boundKeys()
    const twice = keys.filter((key, at) => keys.indexOf(key) !== at)
    expect(twice).toEqual([])
  })
})

describe("running a key", () => {
  const run = (name: string) => {
    const { actions, called } = recorder()
    const { guard, where } = passThrough()
    const command = paneLayer(actions, guard).commands?.find((each) => each.name === name)
    command?.run({} as never)
    return { called, where }
  }

  test("goes through the guard, under its own name", () => {
    expect(run("cockpit.review.pane.submit").where).toEqual(["pane.submit"])
  })

  test("a key that acts on the review leaves the keys screen first, then acts", () => {
    expect(run("cockpit.review.pane.down").called).toEqual(["leaveKeys", "move(1)"])
    expect(run("cockpit.review.pane.submit").called).toEqual(["leaveKeys", "submit"])
  })

  test("the keys that mean something on the keys screen keep it: ?, close and the numbers", () => {
    expect(run("cockpit.review.pane.keys").called).toEqual(["toggleKeys"])
    expect(run("cockpit.review.pane.quit").called).toEqual(["quit"])
    expect(run("cockpit.review.pane.stats").called).toEqual(["toggleStats"])
  })
})

describe("the keys screen says what is bound", () => {
  /** How the screen writes a key, in the names OpenTUI binds. */
  const SCREEN: Record<string, string[]> = {
    "j/k": ["j", "k"],
    "↑/↓": ["up", "down"],
    enter: ["return"],
    "←": ["left"],
    L: ["shift+l"],
    H: ["shift+h"],
    B: ["shift+b"],
    esc: ["escape"],
  }
  /**
   * Bound, and left off the screen on purpose — each with where the screen does say it, or why not.
   * A key bound anywhere else must be on the screen.
   */
  const UNLISTED: Record<string, string> = {
    right: "opens, like enter and l — the screen teaches those two",
    pagedown: "in d's line: (also pgdn, pgup)",
    pageup: "in d's line: (also pgdn, pgup)",
    "shift+right": "in L's line: (also shift+→, shift+←)",
    "shift+left": "in L's line: (also shift+→, shift+←)",
    "shift+/": "the same key as ?",
    q: "closes, kept for hands that learned it; the screen teaches esc (design-system.md)",
  }
  const shown = () => new Set(REVIEW_KEYS.flatMap((line) => line.keys.flatMap((key) => SCREEN[key] ?? [key])))

  test("every key on the screen is bound", () => {
    const bound = new Set(boundKeys())
    for (const key of shown()) expect(bound).toContain(key)
  })

  test("every bound key is on the screen, or unlisted with a reason", () => {
    const missing = boundKeys().filter((key) => !shown().has(key) && !(key in UNLISTED))
    expect(missing).toEqual([])
  })

  test("an unlisted key is still bound — the list cannot outlive the binding", () => {
    const bound = new Set(boundKeys())
    for (const key of Object.keys(UNLISTED)) expect(bound).toContain(key)
  })
})
