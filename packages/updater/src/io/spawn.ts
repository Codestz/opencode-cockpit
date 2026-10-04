/**
 * Running `opencode`, without blocking.
 *
 * Asynchronous because the dialog runs inside OpenCode's own event loop: `opencode plugin` installs
 * from npm and takes seconds, and a synchronous spawn would freeze the screen asking for it.
 */

import { spawn } from "node:child_process"

export function runOpencode(
  bin: string,
  args: readonly string[],
  cwd: string,
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = ""
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] })
    } catch (err) {
      resolve({ status: null, output: String(err) })
      return
    }
    child.stdout?.on("data", (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      output += String(chunk)
    })
    // ENOENT arrives here, not as a throw: there is no `opencode` to run.
    child.on("error", (err) => resolve({ status: null, output: String(err) }))
    child.on("close", (code) => resolve({ status: code ?? 1, output }))
  })
}
