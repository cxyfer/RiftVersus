import type { BestOf } from "./comparison.js";

/** BO2 固定打滿兩局；其他賽制需有一方取得過半勝場。 */
export function isCompletedSeriesScore(bestOf: BestOf, a: number, b: number): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return false;
  if (bestOf === 2) return a + b === 2;
  const target = Math.floor(bestOf / 2) + 1;
  return (a === target && b < target) || (b === target && a < target);
}
