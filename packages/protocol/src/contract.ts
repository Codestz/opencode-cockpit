import type { z } from "zod"

export interface MethodSpec<P extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
  params: P
  result: R
}

export const method = <P extends z.ZodType, R extends z.ZodType>(params: P, result: R): MethodSpec<P, R> => ({
  params,
  result,
})

export type Contract = Record<string, MethodSpec>
export type EventContract = Record<string, z.ZodType>

export type ParamsOf<C extends Contract, M extends keyof C> = z.input<C[M]["params"]>
export type ResultOf<C extends Contract, M extends keyof C> = z.output<C[M]["result"]>
export type EventOf<E extends EventContract, T extends keyof E> = z.output<E[T]>
/** Params after schema parsing (defaults applied): what handlers receive. */
export type ParsedParamsOf<C extends Contract, M extends keyof C> = z.output<C[M]["params"]>
