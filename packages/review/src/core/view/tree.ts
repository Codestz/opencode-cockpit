/**
 * Changed files, grouped the way they live on disk.
 *
 * A flat list of full paths is unreadable past about ten files: every row repeats the same prefix and
 * the part that identifies the file — its name — is the part that gets elided away. Grouping puts the
 * prefix on its own row once and leaves each file showing its basename, which is what you actually
 * read.
 *
 * Pure: paths in, rows out. No OpenCode, no terminal, no knowledge of how a row is painted.
 */

export interface TreeFile {
  kind: "file"
  /** The full path, which is how every other part of the review identifies a file. */
  path: string
  /** Just the basename — what the row shows. */
  name: string
  depth: number
}

export interface TreeFolder {
  kind: "folder"
  /** The folder's path, so it can be collapsed and remembered by identity rather than by index. */
  path: string
  /**
   * What the row shows. A chain with nothing to choose between its steps is joined — `.github` that
   * contains only `workflows` reads as `.github/workflows`, one row instead of two, exactly as a pull
   * request shows it.
   */
  name: string
  depth: number
  /** Files anywhere beneath it, for the count on the row. */
  files: number
}

export type TreeRow = TreeFile | TreeFolder

interface Node {
  children: Map<string, Node>
  files: string[]
}

const node = (): Node => ({ children: new Map(), files: [] })

/** Builds the directory trie. Files sit in the folder that holds them; order follows the input. */
function build(paths: readonly string[]): Node {
  const root = node()
  for (const path of paths) {
    const parts = path.split("/")
    const name = parts.pop()
    if (!name) continue
    let at = root
    for (const part of parts) {
      let next = at.children.get(part)
      if (!next) {
        next = node()
        at.children.set(part, next)
      }
      at = next
    }
    at.files.push(path)
  }
  return root
}

const countFiles = (from: Node): number =>
  from.files.length + [...from.children.values()].reduce((sum, child) => sum + countFiles(child), 0)

/**
 * Flattens the trie into rows, joining folder chains that hold nothing else.
 *
 * `collapsed` names folders whose contents are hidden — by path, so that toggling one open does not
 * shift which folder a later index refers to.
 */
export function treeRows(paths: readonly string[], collapsed: ReadonlySet<string> = new Set()): TreeRow[] {
  const rows: TreeRow[] = []

  const walk = (from: Node, prefix: string, depth: number) => {
    for (const [name, child] of from.children) {
      /** Join a chain of single-child folders into one row: `.github/workflows`, not two levels. */
      let label = name
      let at = child
      let path = prefix ? `${prefix}/${name}` : name
      while (at.files.length === 0 && at.children.size === 1) {
        const [onlyName, only] = [...at.children][0] as [string, Node]
        label = `${label}/${onlyName}`
        path = `${path}/${onlyName}`
        at = only
      }

      rows.push({ kind: "folder", path, name: label, depth, files: countFiles(at) })
      if (!collapsed.has(path)) walk(at, path, depth + 1)
    }

    for (const file of from.files) {
      rows.push({ kind: "file", path: file, name: file.slice(file.lastIndexOf("/") + 1), depth })
    }
  }

  walk(build(paths), "", 0)
  return rows
}

/** The files a row stands for: itself, or everything beneath a folder. */
export function filesUnder(rows: readonly TreeRow[], row: TreeRow): string[] {
  if (row.kind === "file") return [row.path]
  return rows
    .filter((other): other is TreeFile => other.kind === "file" && other.path.startsWith(`${row.path}/`))
    .map((file) => file.path)
}
