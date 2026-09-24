import { z } from "zod"

import { method } from "../contract.ts"
import { ShellId } from "./common.ts"
import { ShellInfo } from "./info.ts"
import {
  AttachParams,
  ClearParams,
  IdParams,
  ListParams,
  ReadParams,
  ReadResult,
  ResizeParams,
  ScreenParams,
  ScreenResult,
  StartParams,
  StopParams,
  WaitParams,
  WaitResult,
  WriteParams,
} from "./params.ts"
import { WatchParams, WatchRule, WatchStatus } from "./watch.ts"

export const shellContract = {
  "shell.start": method(StartParams, ShellInfo),
  "shell.list": method(ListParams, z.array(ShellInfo)),
  "shell.get": method(IdParams, ShellInfo),
  "shell.read": method(ReadParams, ReadResult),
  "shell.screen": method(ScreenParams, ScreenResult),
  "shell.write": method(WriteParams, z.object({ bytes: z.number().int() })),
  "shell.resize": method(ResizeParams, z.object({})),
  "shell.wait": method(WaitParams, WaitResult),
  "shell.stop": method(StopParams, ShellInfo),
  "shell.restart": method(IdParams, ShellInfo),
  "shell.remove": method(IdParams, z.object({})),
  "shell.clear": method(ClearParams, z.object({ removed: z.array(ShellId) })),
  "shell.watch": method(WatchParams, ShellInfo),
  "shell.unwatch": method(IdParams, ShellInfo),
  "shell.presets": method(
    z.object({}).optional(),
    z.array(z.object({ name: z.string(), match: z.string().optional(), rule: WatchRule })),
  ),
  "shell.attach": method(AttachParams, z.object({ offset: z.number().int(), replay: z.string() })),
  "shell.detach": method(IdParams, z.object({})),
}

export const shellEvents = {
  "shell.started": ShellInfo,
  "shell.exited": ShellInfo,
  "shell.removed": z.object({ id: ShellId }),
  "shell.output": z.object({ id: ShellId, offset: z.number().int(), data: z.string() }),
  /** Emitted only when a watcher's status changes, never per line. */
  "shell.watch": z.object({
    info: ShellInfo,
    previous: WatchStatus,
    current: WatchStatus,
    summary: z.string().optional(),
  }),
}
