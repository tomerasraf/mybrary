import { describe, expect, it } from "vitest";
import { Desk, LINE_CHARS, pagePosition } from "@/world/desk";

describe("the typewriter's page", () => {
  it("knows which line and letter a text has reached", () => {
    expect(pagePosition(0)).toEqual({ line: 0, col: 0 });
    expect(pagePosition(LINE_CHARS - 1)).toEqual({ line: 0, col: LINE_CHARS - 1 });
    expect(pagePosition(LINE_CHARS)).toEqual({ line: 1, col: 0 });
    expect(pagePosition(LINE_CHARS * 3 + 5)).toEqual({ line: 3, col: 5 });
    expect(pagePosition(-4)).toEqual({ line: 0, col: 0 });
  });

  it("keeps a very long thought on the last line instead of running off the page", () => {
    const far = pagePosition(LINE_CHARS * 400 + 7);
    expect(far.line).toBe(pagePosition(LINE_CHARS * 399).line);
    expect(far.col).toBe(7);
  });

  it("rings for a new line only when the text crosses onto one", () => {
    const desk = new Desk();
    expect(desk.type(5)).toBe(false);
    expect(desk.type(LINE_CHARS - 1)).toBe(false);
    expect(desk.type(LINE_CHARS + 1)).toBe(true);
    expect(desk.type(LINE_CHARS + 2)).toBe(false);
    // Deleting back onto the line above is not a new line.
    expect(desk.type(3)).toBe(false);
    // Tearing the page out starts a fresh one.
    desk.tearPage();
    expect(desk.type(2)).toBe(false);
    for (let i = 0; i < 5; i++) {
      desk.strike(i % 2 === 0);
      desk.update(1 / 30);
    }
  });
});
