import { Decimal, dec, divide, qty } from "./money";

/**
 * The unit ladder: piece → stick → set (spec §5.3.1).
 *
 *   piece — the ONLY stock unit. Ledger, issuance, returns, waste, counts.
 *   stick — what a customer buys. A product-specific number of pieces.
 *   set   — a five-product bundle of sticks, used only for vendor incentive.
 *
 * Every piece↔stick conversion in the codebase goes through this file. An inline
 * `/ 10` or `* 4` anywhere else is a bug (spec §3 rule 9).
 */

export function assertPiecesPerStick(piecesPerStick: unknown): Decimal {
  const p = dec(piecesPerStick as never);
  if (!p.isFinite() || p.lessThanOrEqualTo(0)) {
    throw new Error(`piecesPerStick must be > 0, received ${String(piecesPerStick)}`);
  }
  return p;
}

/** Unfloored, on purpose: revenue is computed on pieces, so 54.3 sticks is a real value. */
export function piecesToSticks(pieces: unknown, piecesPerStick: unknown): Decimal {
  const per = assertPiecesPerStick(piecesPerStick);
  return dec(pieces as never).dividedBy(per);
}

export function sticksToPieces(sticks: unknown, piecesPerStick: unknown): Decimal {
  const per = assertPiecesPerStick(piecesPerStick);
  return dec(sticks as never).times(per);
}

/** Derived, never stored (spec §5.3.1). */
export function pricePerPieceFrom(pricePerStick: unknown, piecesPerStick: unknown): Decimal {
  const per = assertPiecesPerStick(piecesPerStick);
  return dec(pricePerStick as never).dividedBy(per);
}

/**
 * How many whole set-components this product's sales completed.
 * Flooring happens ONLY here and in the compensation engine — never in revenue.
 */
export function setCredits(sticksSold: unknown, requiredSticks: unknown): number {
  const required = dec(requiredSticks as never);
  if (required.lessThanOrEqualTo(0)) return 0;
  const ratio = divide(dec(sticksSold as never), required);
  if (ratio === null || ratio.isNegative()) return 0;
  return ratio.floor().toNumber();
}

export function formatPieces(pieces: unknown): string {
  const p = qty(pieces as never, 0);
  return `${p.toNumber().toLocaleString("en-PH")} pcs`;
}

export function formatSticks(sticks: unknown): string {
  return `${qty(sticks as never, 1).toFixed(1)} sticks`;
}

/** "540 pcs (54.0 sticks)" — always show both where a human reads a quantity (spec §13). */
export function formatBothUnits(pieces: unknown, piecesPerStick: unknown): string {
  return `${formatPieces(pieces)} (${formatSticks(piecesToSticks(pieces, piecesPerStick))})`;
}
