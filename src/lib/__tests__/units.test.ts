import { describe, expect, it } from "vitest";
import {
  formatBothUnits,
  formatPieces,
  formatSticks,
  piecesToSticks,
  pricePerPieceFrom,
  setCredits,
  sticksToPieces,
} from "../units";

/** The piece → stick → set ladder from spec §5.3.1. */
const PIECES_PER_STICK = {
  kwekKwek: 4,
  calamares: 3,
  squidball: 5,
  fishball: 10,
  kikiamBig: 4,
} as const;

describe("unit ladder", () => {
  it("converts pieces to sticks without flooring", () => {
    expect(piecesToSticks(540, PIECES_PER_STICK.fishball).toFixed(1)).toBe("54.0");
    expect(piecesToSticks(275, PIECES_PER_STICK.squidball).toFixed(1)).toBe("55.0");
    expect(piecesToSticks(543, PIECES_PER_STICK.fishball).toFixed(1)).toBe("54.3");
  });

  it("builds one standard set: 250 sticks, 1,300 pieces", () => {
    const components = [
      { pieces: PIECES_PER_STICK.kwekKwek, sticks: 50, expected: 200 },
      { pieces: PIECES_PER_STICK.calamares, sticks: 50, expected: 150 },
      { pieces: PIECES_PER_STICK.squidball, sticks: 50, expected: 250 },
      { pieces: PIECES_PER_STICK.fishball, sticks: 50, expected: 500 },
      { pieces: PIECES_PER_STICK.kikiamBig, sticks: 50, expected: 200 },
    ];
    let totalPieces = 0;
    let totalSticks = 0;
    for (const c of components) {
      const pieces = sticksToPieces(c.sticks, c.pieces).toNumber();
      expect(pieces).toBe(c.expected);
      totalPieces += pieces;
      totalSticks += c.sticks;
    }
    expect(totalPieces).toBe(1300);
    expect(totalSticks).toBe(250);
  });

  it("derives price per piece and never stores it", () => {
    expect(pricePerPieceFrom("10.00", PIECES_PER_STICK.fishball).toFixed(4)).toBe("1.0000");
    expect(pricePerPieceFrom("15.00", PIECES_PER_STICK.kwekKwek).toFixed(4)).toBe("3.7500");
  });

  it("floors only when counting set credits", () => {
    expect(setCredits(60, 50)).toBe(1); // kwek-kwek 240 pcs
    expect(setCredits(30, 50)).toBe(0); // fishball 300 pcs — no credit
    expect(setCredits(100, 50)).toBe(2); // components stack
    expect(setCredits(49.9, 50)).toBe(0);
    expect(setCredits(-5, 50)).toBe(0);
  });

  it("rejects a zero or negative piecesPerStick instead of dividing by zero", () => {
    expect(() => piecesToSticks(100, 0)).toThrow();
    expect(() => pricePerPieceFrom(10, -1)).toThrow();
  });

  it("always shows both units to a human", () => {
    expect(formatPieces(1300)).toBe("1,300 pcs");
    expect(formatSticks(54)).toBe("54.0 sticks");
    expect(formatBothUnits(540, PIECES_PER_STICK.fishball)).toBe("540 pcs (54.0 sticks)");
  });
});
