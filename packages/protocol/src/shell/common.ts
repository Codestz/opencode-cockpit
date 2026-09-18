import { z } from "zod"

/** Identity and ownership, shared by every shell message. */
export const ShellId = z.string().regex(/^sh_[a-z2-7]{8}$/, "expected sh_ followed by 8 base32 chars")

export const Owner = z.object({
  /** Absolute project directory the shell belongs to. */
  project: z.string().min(1),
  /** OpenCode session that started it, when started by an agent. */
  session: z.string().min(1).optional(),
  /** Opaque id of the client instance that started it; used to route notifications to one place. */
  instance: z.string().min(1).optional(),
})

export const ShellStatus = z.enum(["running", "exited", "killed", "failed"])

export type Owner = z.output<typeof Owner>
export type ShellStatus = z.output<typeof ShellStatus>
