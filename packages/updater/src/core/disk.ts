/**
 * The two things the core reads from disk, behind an interface so the tests can hand it a
 * filesystem made of a plain object. The real one is `io/disk.ts`.
 */

export interface Disk {
  /** File contents, or undefined when it does not exist or cannot be read. */
  read(path: string): string | undefined
  /** Entry names in a directory, or empty when it does not exist. */
  list(path: string): string[]
}

/** A filesystem from `{ "/abs/path": "contents" }`, for tests. Directories are implied by paths. */
export function memoryDisk(files: Record<string, string>): Disk {
  return {
    read: (path) => files[path],
    list(path) {
      const prefix = path.endsWith("/") ? path : `${path}/`
      const names = new Set<string>()
      for (const file of Object.keys(files)) {
        if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split("/")[0] as string)
      }
      return [...names].sort()
    },
  }
}

export function readJson(disk: Disk, path: string): unknown {
  const text = disk.read(path)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
