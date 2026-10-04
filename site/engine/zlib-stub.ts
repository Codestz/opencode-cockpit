// Review's PNG reader imports node:zlib; the site never decodes a PNG, so it gets a stub that says so.
export const inflate = (_: unknown, cb: (e: Error) => void) => cb(new Error("zlib unavailable in browser"))
export const inflateSync = () => { throw new Error("zlib unavailable in browser") }
