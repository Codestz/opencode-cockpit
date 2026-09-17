import type { Module } from "../core/module.ts"
import { ShellModule, type ShellModuleOptions } from "./shell/module.ts"

export interface ModuleOptions {
  shell?: ShellModuleOptions
}

/** Every capability the daemon hosts. Add new modules here. */
export function createModules(options: ModuleOptions = {}): Module[] {
  return [new ShellModule(options.shell)]
}
