/** Resolves true once something accepts TCP connections on host:port. */
export async function probePort(port: number, host = "127.0.0.1", timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    Bun.connect({
      hostname: host,
      port,
      socket: {
        open(socket) {
          socket.end()
          finish(true)
        },
        data() {},
        error() {
          finish(false)
        },
        connectError() {
          finish(false)
        },
      },
    }).catch(() => finish(false))
  })
}
