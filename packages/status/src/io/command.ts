/** Running a command segment's shell command; when to run it and what its output means is `core/command.ts`. */

/** The real shell, used outside tests. */
export async function execShell(command: string, stdin: string, timeoutMs: number): Promise<string> {
  const proc = Bun.spawn(["/bin/sh", "-c", command], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "ignore",
    env: process.env,
  })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  try {
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) throw new Error(`exit ${code}`)
    return out
  } finally {
    clearTimeout(timer)
  }
}
