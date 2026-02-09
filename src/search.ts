import { getDb } from "./db.js";
import { touchKnowledge, type KnowledgeEntry } from "./knowledge.js";

export interface SearchOptions {
  query: string;
  category?: string;
  tags?: string;
  limit?: number;
  activeOnly?: boolean;
}

export interface SearchResult extends KnowledgeEntry {
  rank: number;
  snippet: string;
}

/**
 * Full-text search using FTS5 with BM25 ranking.
 * Column weights: key=10x, value=1x, tags=5x
 */
export function search(opts: SearchOptions): SearchResult[] {
  const db = getDb();
  const limit = opts.limit ?? 20;

  // Sanitize the query for FTS5 — escape special characters and add prefix matching
  const ftsQuery = sanitizeFtsQuery(opts.query);
  if (!ftsQuery) return [];

  const conditions: string[] = ["knowledge_fts MATCH ?"];
  const params: unknown[] = [ftsQuery];

  if (opts.activeOnly !== false) {
    conditions.push("k.active = 1");
  }
  if (opts.category) {
    conditions.push("k.category = ?");
    params.push(opts.category);
  }
  if (opts.tags) {
    // Filter by tag — check if the tag appears in the tags field
    conditions.push("k.tags LIKE ?");
    params.push(`%${opts.tags}%`);
  }

  params.push(limit);

  const where = conditions.join(" AND ");

  const results = db
    .prepare(
      `SELECT k.*, s.accessed_at, s.access_count,
            bm25(knowledge_fts, 10.0, 1.0, 5.0) as rank,
            snippet(knowledge_fts, 1, '>>>', '<<<', '...', 32) as snippet
     FROM knowledge_fts
     JOIN knowledge k ON k.rowid = knowledge_fts.rowid
     LEFT JOIN knowledge_access_stats s ON k.id = s.knowledge_id
     WHERE ${where}
     ORDER BY rank
     LIMIT ?`
    )
    .all(...params) as SearchResult[];

  // Record access for returned results
  for (const r of results) {
    touchKnowledge(r.id);
  }

  return results;
}

/**
 * Sanitize a user query for FTS5.
 * - Wraps individual terms in quotes if they contain special chars
 * - Adds implicit prefix matching with * for partial matches
 * - Handles empty/whitespace-only input
 */
function sanitizeFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Split into tokens, wrap each in quotes for safety, join with implicit AND
  const tokens = trimmed.split(/\s+/).filter(Boolean);

  return tokens
    .map((t) => {
      // FTS5 operators are case-sensitive (uppercase only)
      if (/^(AND|OR|NOT|NEAR)$/.test(t)) return t;
      // Escape quotes within the token
      const escaped = t.replace(/"/g, '""');
      // Use prefix matching for partial terms
      return `"${escaped}"*`;
    })
    .join(" ");
}

/**
 * Quick lookup by exact category + key.
 */
export function exactLookup(
  category: string,
  key: string
): KnowledgeEntry | undefined {
  const db = getDb();
  const result = db
    .prepare(
      `SELECT k.*, s.accessed_at, s.access_count
     FROM knowledge k
     LEFT JOIN knowledge_access_stats s ON k.id = s.knowledge_id
     WHERE k.category = ? AND k.key = ? AND k.active = 1`
    )
    .get(category, key) as KnowledgeEntry | undefined;

  if (result) {
    touchKnowledge(result.id);
  }

  return result;
}
