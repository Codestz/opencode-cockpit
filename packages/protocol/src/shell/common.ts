import { z } from "zod"

/** Identity and ownership, shared by every shell message. */
export const ShellId = z.string().regex(/^sh_[a-z2-7]{8}$/, "expected sh_ followed by 8 base32 chars")

export const Owner = z.object({
  /** Absolute project directory the shell belongs to. */
  project: z.string().min(1),
  /** OpenCode session that started it, when started by an agent. */
  session: z.string().min(1).optional(),
  /**
   * The session whose tool call started it — a subagent's, when one did. `session` is the
   * conversation (a subagent's shell is shown where the person is looking), this is
   * who asked, so notices about the shell go to the agent that cares about it. Optional because an
   * older plugin never sends it and an older daemon drops it; without it, notices go to `session`.
   */
  origin: z.string().min(1).optional(),
  /** Opaque id of the client instance that started it; used to route notifications to one place. */
  instance: z.string().min(1).optional(),
})

export const ShellStatus = z.enum(["running", "exited", "killed", "failed"])

export type Owner = z.output<typeof Owner>
export type ShellStatus = z.output<typeof ShellStatus>
