import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getDb } from "./db.js";
import { estimateTokens, truncateToTokens } from "./tokens.js";
import type { KnowledgeEntry } from "./knowledge.js";

const BRAIN_START_MARKER = "<!-- CLAUDE-BRAIN START -->";
const BRAIN_END_MARKER = "<!-- CLAUDE-BRAIN END -->";

export interface ExportOptions {
  /** Total token budget for the export. Default: 2000 */
  budget?: number;
  /** Output format. Default: "claude-md" */
  format?: "claude-md" | "claude-dense" | "json";
  /** Filter to specific categories */
  categories?: string[];
  /** Write to CLAUDE.md (sync mode) */
  sync?: boolean;
  /** Target path for sync. Default: ~/.claude/CLAUDE.md */
  syncTarget?: string;
  /** Dry run — return output without writing */
  dryRun?: boolean;
}

interface CategoryBudget {
  name: string;
  priority: number;
  configuredBudget: number;
  entryCount: number;
  allocatedTokens: number;
}

interface RankedEntry {
  entry: KnowledgeEntry;
  score: number;
  tokens: number;
  display: string;
}

/**
 * Export knowledge as formatted text with token budgeting.
 */
export function exportKnowledge(opts: ExportOptions = {}): string {
  const budget = opts.budget ?? 2000;
  const format = opts.format ?? "claude-md";

  if (format === "json") {
    return exportJson(opts.categories);
  }

  const dense = format === "claude-dense";
  return exportMarkdown(budget, dense, opts.categories);
}

/**
 * Sync export to CLAUDE.md file with section markers.
 * Preserves any user-written content outside the markers.
 */
export function syncToClaudeMd(
  content: string,
  targetPath?: string
): { path: string; diff: string } {
  const target = targetPath || join(homedir(), ".claude", "CLAUDE.md");
  let existing = "";
  let diff = "";

  if (existsSync(target)) {
    existing = readFileSync(target, "utf-8");
  }

  const startIdx = existing.indexOf(BRAIN_START_MARKER);
  const endIdx = existing.indexOf(BRAIN_END_MARKER);

  const brainSection = `${BRAIN_START_MARKER}\n${content}\n${BRAIN_END_MARKER}`;

  let newContent: string;
  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing brain section
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + BRAIN_END_MARKER.length);
    const oldSection = existing.slice(
      startIdx + BRAIN_START_MARKER.length,
      endIdx
    );
    newContent = before + brainSection + after;
    diff = oldSection.trim() === content.trim() ? "(no changes)" : "(updated)";
  } else {
    // Append brain section
    newContent = existing
      ? existing.trimEnd() + "\n\n" + brainSection + "\n"
      : brainSection + "\n";
    diff = "(new section added)";
  }

  writeFileSync(target, newContent, "utf-8");
  return { path: target, diff };
}

function exportJson(categories?: string[]): string {
  const db = getDb();
  let query = `SELECT k.*, s.accessed_at, s.access_count
    FROM knowledge k
    LEFT JOIN knowledge_access_stats s ON k.id = s.knowledge_id
    WHERE k.active = 1`;
  const params: unknown[] = [];

  if (categories?.length) {
    const placeholders = categories.map(() => "?").join(", ");
    query += ` AND k.category IN (${placeholders})`;
    params.push(...categories);
  }

  query += " ORDER BY k.category, k.key";
  const entries = db.prepare(query).all(...params) as KnowledgeEntry[];
  return JSON.stringify(entries, null, 2);
}

function exportMarkdown(
  budget: number,
  dense: boolean,
  filterCategories?: string[]
): string {
  const db = getDb();

  // Get categories with their budgets
  const categories = db
    .prepare(
      `SELECT c.name, c.priority, c.token_budget,
            (SELECT COUNT(*) FROM knowledge k WHERE k.category = c.name AND k.active = 1) as entry_count
     FROM categories c
     ORDER BY c.priority`
    )
    .all() as {
    name: string;
    priority: number;
    token_budget: number;
    entry_count: number;
  }[];

  // Filter if requested
  const activeCats = categories.filter(
    (c) =>
      c.entry_count > 0 &&
      (!filterCategories?.length || filterCategories.includes(c.name))
  );

  if (activeCats.length === 0) {
    return "# Personal Context\n\n_No knowledge entries yet. Use `brain add` to start building your knowledge base._";
  }

  // Allocate tokens using global ranking with per-category min/max
  const headerOverhead = dense ? 0 : estimateTokens("# Personal Context\n\n");
  let availableBudget = budget - headerOverhead;

  // Phase 1: Get all entries ranked globally
  const allRanked = getRankedEntries(db, activeCats, dense, filterCategories);

  // Phase 2: Fill budget greedily, ensuring each category gets at least one entry
  const selected = greedyBudgetFill(allRanked, activeCats, availableBudget);

  // Phase 3: Format output
  return formatOutput(selected, dense);
}

function getRankedEntries(
  db: ReturnType<typeof getDb>,
  categories: { name: string }[],
  dense: boolean,
  filterCategories?: string[]
): RankedEntry[] {
  let query = `SELECT k.*, s.accessed_at, s.access_count
    FROM knowledge k
    LEFT JOIN knowledge_access_stats s ON k.id = s.knowledge_id
    WHERE k.active = 1`;
  const params: unknown[] = [];

  if (filterCategories?.length) {
    const placeholders = filterCategories.map(() => "?").join(", ");
    query += ` AND k.category IN (${placeholders})`;
    params.push(...filterCategories);
  }

  const entries = db.prepare(query).all(...params) as KnowledgeEntry[];
  const now = Date.now();
  const DAY_MS = 86400000;

  return entries
    .map((entry) => {
      // Score: confidence * (1 + log(access_count + 1)) * recency_weight
      const accessCount = entry.access_count ?? 0;
      const accessedAt = entry.accessed_at ?? entry.created_at;
      const daysSinceAccess = (now - accessedAt) / DAY_MS;
      const recencyWeight = Math.max(0.1, 1 / (1 + daysSinceAccess / 30));

      // New entries (< 7 days) get a boost to avoid being permanently buried
      const newBoost = daysSinceAccess < 7 ? 1.5 : 1.0;

      const score =
        entry.confidence *
        (1 + Math.log(accessCount + 1)) *
        recencyWeight *
        newBoost;

      const display = entry.compressed || entry.value;
      const tokens = estimateTokens(formatEntry(entry, display, dense));

      return { entry, score, tokens, display };
    })
    .sort((a, b) => b.score - a.score);
}

function greedyBudgetFill(
  ranked: RankedEntry[],
  categories: { name: string }[],
  budget: number
): Map<string, RankedEntry[]> {
  const selected = new Map<string, RankedEntry[]>();
  let remaining = budget;

  // Phase 1: Guarantee at least one entry per non-empty category
  const catNames = new Set(categories.map((c) => c.name));
  const guaranteed = new Set<string>();

  for (const item of ranked) {
    if (remaining <= 0) break;
    const cat = item.entry.category;
    if (!catNames.has(cat) || guaranteed.has(cat)) continue;

    if (item.tokens <= remaining) {
      if (!selected.has(cat)) selected.set(cat, []);
      selected.get(cat)!.push(item);
      remaining -= item.tokens;
      guaranteed.add(cat);
    }
  }

  // Phase 2: Fill remaining budget greedily by score
  const usedIds = new Set(
    [...selected.values()].flat().map((r) => r.entry.id)
  );

  for (const item of ranked) {
    if (remaining <= 0) break;
    if (usedIds.has(item.entry.id)) continue;
    if (!catNames.has(item.entry.category)) continue;

    if (item.tokens <= remaining) {
      const cat = item.entry.category;
      if (!selected.has(cat)) selected.set(cat, []);
      selected.get(cat)!.push(item);
      remaining -= item.tokens;
      usedIds.add(item.entry.id);
    }
  }

  return selected;
}

function formatOutput(
  selected: Map<string, RankedEntry[]>,
  dense: boolean
): string {
  if (dense) {
    return formatDense(selected);
  }
  return formatReadable(selected);
}

function formatReadable(selected: Map<string, RankedEntry[]>): string {
  const sections: string[] = ["# Personal Context\n"];

  // Sort categories by the order they appear in the DB (priority)
  const db = getDb();
  const catOrder = db
    .prepare(`SELECT name FROM categories ORDER BY priority`)
    .all() as { name: string }[];
  const orderMap = new Map(catOrder.map((c, i) => [c.name, i]));

  const sortedCats = [...selected.keys()].sort(
    (a, b) => (orderMap.get(a) ?? 99) - (orderMap.get(b) ?? 99)
  );

  for (const cat of sortedCats) {
    const entries = selected.get(cat)!;
    sections.push(`## ${capitalize(cat)}`);
    for (const { entry, display } of entries) {
      const prefix = entry.subcategory ? `${entry.subcategory}/` : "";
      sections.push(`- **${prefix}${entry.key}:** ${display}`);
    }
    sections.push("");
  }

  return sections.join("\n").trim();
}

function formatDense(selected: Map<string, RankedEntry[]>): string {
  const sections: string[] = ["# Context\n"];

  const db = getDb();
  const catOrder = db
    .prepare(`SELECT name FROM categories ORDER BY priority`)
    .all() as { name: string }[];
  const orderMap = new Map(catOrder.map((c, i) => [c.name, i]));

  const sortedCats = [...selected.keys()].sort(
    (a, b) => (orderMap.get(a) ?? 99) - (orderMap.get(b) ?? 99)
  );

  for (const cat of sortedCats) {
    const entries = selected.get(cat)!;
    const items = entries.map(({ entry, display }) => {
      return `${entry.key}: ${display}`;
    });
    sections.push(`**${capitalize(cat)}:** ${items.join(" | ")}`);
  }

  return sections.join("\n").trim();
}

function formatEntry(
  entry: KnowledgeEntry,
  display: string,
  dense: boolean
): string {
  if (dense) {
    return `${entry.key}: ${display}`;
  }
  const prefix = entry.subcategory ? `${entry.subcategory}/` : "";
  return `- **${prefix}${entry.key}:** ${display}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { BRAIN_START_MARKER, BRAIN_END_MARKER };
