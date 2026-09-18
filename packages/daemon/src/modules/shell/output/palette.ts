/** Standard xterm palette, so the daemon can hand UIs resolved colours instead of escape codes. */
const BASE = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
]
const STEPS = [0, 95, 135, 175, 215, 255]
const hex = (n: number) => n.toString(16).padStart(2, "0")

export function paletteColor(index: number): string {
  if (index < 16) return BASE[index] ?? "#ffffff"
  if (index < 232) {
    const value = index - 16
    const r = STEPS[Math.floor(value / 36) % 6] ?? 0
    const g = STEPS[Math.floor(value / 6) % 6] ?? 0
    const b = STEPS[value % 6] ?? 0
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  const grey = 8 + (index - 232) * 10
  return `#${hex(grey)}${hex(grey)}${hex(grey)}`
}

export function rgbColor(value: number): string {
  return `#${hex((value >> 16) & 0xff)}${hex((value >> 8) & 0xff)}${hex(value & 0xff)}`
}
