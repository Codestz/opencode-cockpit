import { contract, ErrorCode, RpcError } from "@opencode-cockpit/protocol"
import type { CallContext, Module } from "./module.ts"

type AnyHandler = (params: unknown, call: CallContext) => unknown

/** Validates params against the protocol contract and dispatches to module handlers. */
export class Router {
  private readonly handlers = new Map<string, AnyHandler>()

  add(name: string, handler: AnyHandler): void {
    if (!(name in contract)) throw new Error(`method ${name} is not declared in the protocol contract`)
    if (this.handlers.has(name)) throw new Error(`method ${name} registered twice`)
    this.handlers.set(name, handler)
  }

  addModule(module: Module): void {
    for (const [short, handler] of Object.entries(module.methods as Record<string, AnyHandler>)) {
      this.add(`${module.name}.${short}`, handler.bind(module.methods))
    }
  }

  has(name: string): boolean {
    return this.handlers.has(name)
  }

  async dispatch(name: string, params: unknown, call: CallContext): Promise<unknown> {
    const handler = this.handlers.get(name)
    const spec = contract[name as keyof typeof contract]
    if (!handler || !spec) throw new RpcError(ErrorCode.MethodNotFound, `unknown method ${name}`)
    const parsed = spec.params.safeParse(params)
    if (!parsed.success) {
      throw new RpcError(
        ErrorCode.InvalidParams,
        `invalid params for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
        { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      )
    }
    return handler(parsed.data, call)
  }
}
