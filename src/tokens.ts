/**
 * Token estimation for export budgeting.
 *
 * Uses a conservative heuristic: ~4 characters per token for English text,
 * ~3.5 for technical content with special characters.
 * This is intentionally conservative (overestimates tokens) to stay within budget.
 *
 * For production accuracy, swap this with tiktoken/js-tiktoken.
 * The interface is stable — only this file needs to change.
 */

const CHARS_PER_TOKEN = 3.5; // Conservative for technical content

/**
 * Estimate token count for a string.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Check if text fits within a token budget.
 */
export function fitsInBudget(text: string, budget: number): boolean {
  return estimateTokens(text) <= budget;
}

/**
 * Truncate text to fit within a token budget, adding ellipsis.
 */
export function truncateToTokens(text: string, budget: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= budget) return text;

  const targetChars = Math.floor(budget * CHARS_PER_TOKEN) - 4; // room for "..."
  return text.slice(0, targetChars) + "...";
}
