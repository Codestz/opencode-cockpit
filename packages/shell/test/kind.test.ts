import { describe, expect, test } from "bun:test"
import { classify } from "../src/core/kind.ts"

describe("classify", () => {
  test("servers", () => {
    for (const command of [
      "npm run dev",
      "next dev -p 3000",
      "vite preview",
      "docker compose up",
      "uvicorn app:api",
    ]) {
      expect(classify(command)).toBe("server")
    }
  })

  test("tests, including watch mode", () => {
    for (const command of ["npm test", "vitest --watch", "pytest -q", "go test ./...", "playwright test"]) {
      expect(classify(command)).toBe("tests")
    }
  })

  test("builds, even for tools that usually serve", () => {
    for (const command of ["npm run build", "vite build", "cargo build --release", "./gradlew assemble"]) {
      expect(classify(command)).toBe("build")
    }
  })

  test("watchers that are neither tests nor builds", () => {
    expect(classify("tsc --watch --noEmit")).toBe("build") // tsc compiles; build wins
    expect(classify("watchexec -- ./sync.sh")).toBe("watcher")
  })

  test("anything else is a task", () => {
    expect(classify("psql -c 'select 1'")).toBe("task")
    expect(classify("tail -f /var/log/system.log")).toBe("task")
  })
})
