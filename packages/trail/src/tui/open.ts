/**
 * A link opened in the browser from the interface thread, without stalling it: `spawn`, detached,
 * output ignored, unreferenced — measured on both OpenCodes at a few milliseconds and no frame lost
 * (docs/opencode/trail-interface.md, spike 5). Never `spawnSync` here: a synchronous spawn on the
 * interface thread takes the renderer down with it (gotchas.md).
 *
 * Which program opens it is client's `openerFor`, shared with Review. Only `http(s)` is ever handed
 * over. A missing opener arrives later, as an `error` event rather than a throw, so it has a listener;
 * either way the person is told, with the link to open by hand.
 */

import { spawn } from "node:child_process"
import { openerFor, systemOpenerWhere } from "@opencode-cockpit/client/opener"
import { openable } from "../core/links.ts"

/** Opens `url`, and calls `failed` with why if it could not be. Returns at once. */
export function openUrl(url: string, failed: (why: string) => void): void {
  const opener = openable(url) ? openerFor(url, systemOpenerWhere()) : undefined
  if (!opener) {
    failed(/^https?:\/\//i.test(url) ? "no program here opens links" : "only http(s) links are opened")
    return
  }
  try {
    const child = spawn(opener.command, opener.args, { detached: true, stdio: "ignore", windowsHide: true })
    child.on("error", (error) => failed(error.message))
    child.unref()
  } catch (error) {
    failed(error instanceof Error ? error.message : String(error))
  }
}
