import { getDb } from "./db.js";
import { ulid } from "./ulid.js";

export interface KnowledgeEntry {
  id: string;
  category: string;
  subcategory: string | null;
  key: string;
  value: string;
  compressed: string | null;
  confidence: number;
  source: string | null;
  tags: string | null;
  created_at: number;
  updated_at: number;
  active: number;
  // Joined from access stats
  accessed_at?: number | null;
  access_count?: number;
}

export interface AddOptions {
  category: string;
  subcategory?: string;
  key: string;
  value: string;
  compressed?: string;
  confidence?: number;
  source?: string;
  tags?: string;
}

export interface UpdateOptions {
  value?: string;
  compressed?: string;
  confidence?: number;
  tags?: string;
  subcategory?: string;
}

export interface ListOptions {
  category?: string;
  subcategory?: string;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Add a new knowledge entry. Upserts on (category, subcategory, key).
 */
export function addKnowledge(opts: AddOptions): KnowledgeEntry {
  const db = getDb();
  const now = Date.now();

  // Check if entry exists for upsert
  const existing = db
    .prepare(
      `SELECT id FROM knowledge
     WHERE category = ? AND subcategory IS ? AND key = ? AND active = 1`
    )
    .get(
      opts.category,
      opts.subcategory ?? null,
      opts.key
    ) as { id: string } | undefined;

  if (existing) {
    // Upsert: update existing entry
    db.prepare(
      `UPDATE knowledge SET
        value = ?, compressed = ?, confidence = ?,
        source = ?, tags = ?, updated_at = ?
      WHERE id = ?`
    ).run(
      opts.value,
      opts.compressed ?? null,
      opts.confidence ?? 0.8,
      opts.source ?? null,
      opts.tags ?? null,
      now,
      existing.id
    );

    return getKnowledge(existing.id)!;
  }

  const id = ulid();
  db.prepare(
    `INSERT INTO knowledge
      (id, category, subcategory, key, value, compressed, confidence, source, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.category,
    opts.subcategory ?? null,
    opts.key,
    opts.value,
    opts.compressed ?? null,
    opts.confidence ?? 0.8,
    opts.source ?? null,
    opts.tags ?? null,
    now,
    now
  );

  // Initialize access stats
  db.prepare(
    `INSERT INTO knowledge_access_stats (knowledge_id, accessed_at, access_count)
    VALUES (?, ?, 0)`
  ).run(id, now);

  return getKnowledge(id)!;
}

/**
 * Get a single knowledge entry by ID.
 */
export function getKnowledge(id: string): KnowledgeEntry | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT k.*, s.accessed_at, s.access_count
     FROM knowledge k
     LEFT JOIN knowledge_access_stats s ON k.id = s.knowledge_id
     WHERE k.id = ?`
    )
    .get(id) as KnowledgeEntry | undefined;
}

/**
 * Get a knowledge entry by category and key.
 */
export function getByKey(
  category: string,
  key: string,
  subcategory?: string
): KnowledgeEntry | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT k.*, s.accessed_at, s.access_count
     FROM knowledge k
     LEFT JOIN knowledge_access_stats s ON k.id = s.knowledge_id
     WHERE k.category = ? AND k.subcategory IS ? AND k.key = ? AND k.active = 1`
    )
    .get(category, subcategory ?? null, key) as KnowledgeEntry | undefined;
}

/**
 * Update an existing knowledge entry.
 */
export function updateKnowledge(
  id: string,
  opts: UpdateOptions
): KnowledgeEntry | undefined {
  const db = getDb();
  const entry = getKnowledge(id);
  if (!entry) return undefined;

  const now = Date.now();
  const fields: string[] = ["updated_at = ?"];
  const values: unknown[] = [now];

  if (opts.value !== undefined) {
    fields.push("value = ?");
    values.push(opts.value);
  }
  if (opts.compressed !== undefined) {
    fields.push("compressed = ?");
    values.push(opts.compressed);
  }
  if (opts.confidence !== undefined) {
    fields.push("confidence = ?");
    values.push(opts.confidence);
  }
  if (opts.tags !== undefined) {
    fields.push("tags = ?");
    values.push(opts.tags);
  }
  if (opts.subcategory !== undefined) {
    fields.push("subcategory = ?");
    values.push(opts.subcategory);
  }

  values.push(id);
  db.prepare(`UPDATE knowledge SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values
  );

  return getKnowledge(id);
}

/**
 * Soft-delete a knowledge entry.
 */
export function removeKnowledge(id: string): boolean {
  const db = getDb();
  const result = db
    .prepare(`UPDATE knowledge SET active = 0, updated_at = ? WHERE id = ?`)
    .run(Date.now(), id);
  return result.changes > 0;
}

/**
 * Restore a soft-deleted entry.
 */
export function restoreKnowledge(id: string): boolean {
  const db = getDb();
  const result = db
    .prepare(`UPDATE knowledge SET active = 1, updated_at = ? WHERE id = ?`)
    .run(Date.now(), id);
  return result.changes > 0;
}

/**
 * Hard-delete a knowledge entry (use sparingly).
 */
export function purgeKnowledge(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM knowledge WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * List knowledge entries with optional filters.
 */
export function listKnowledge(opts: ListOptions = {}): KnowledgeEntry[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.activeOnly !== false) {
    conditions.push("k.active = 1");
  }
  if (opts.category) {
    conditions.push("k.category = ?");
    params.push(opts.category);
  }
  if (opts.subcategory) {
    conditions.push("k.subcategory = ?");
    params.push(opts.subcategory);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ? `LIMIT ?` : "";
  const offset = opts.offset ? `OFFSET ?` : "";

  if (opts.limit) params.push(opts.limit);
  if (opts.offset) params.push(opts.offset);

  return db
    .prepare(
      `SELECT k.*, s.accessed_at, s.access_count
     FROM knowledge k
     LEFT JOIN knowledge_access_stats s ON k.id = s.knowledge_id
     ${where}
     ORDER BY k.category, k.key
     ${limit} ${offset}`
    )
    .all(...params) as KnowledgeEntry[];
}

/**
 * Move an entry to a different category/key.
 */
export function moveKnowledge(
  id: string,
  newCategory: string,
  newKey?: string
): KnowledgeEntry | undefined {
  const db = getDb();
  const now = Date.now();

  const fields = ["category = ?", "updated_at = ?"];
  const values: unknown[] = [newCategory, now];

  if (newKey) {
    fields.push("key = ?");
    values.push(newKey);
  }

  values.push(id);
  const result = db
    .prepare(`UPDATE knowledge SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);

  if (result.changes === 0) return undefined;
  return getKnowledge(id);
}

/**
 * Record that an entry was accessed (updates stats table only, no FTS churn).
 */
export function touchKnowledge(id: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO knowledge_access_stats (knowledge_id, accessed_at, access_count)
    VALUES (?, ?, 1)
    ON CONFLICT(knowledge_id) DO UPDATE SET
      accessed_at = excluded.accessed_at,
      access_count = access_count + 1`
  ).run(id, Date.now());
}

/**
 * Get counts by category.
 */
export function getCategoryCounts(): Record<string, number> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT category, COUNT(*) as count
     FROM knowledge WHERE active = 1
     GROUP BY category ORDER BY category`
    )
    .all() as { category: string; count: number }[];

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.category] = row.count;
  }
  return result;
}

/**
 * Get total entry count.
 */
export function getTotalCount(): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM knowledge WHERE active = 1`)
    .get() as { count: number };
  return row.count;
}
