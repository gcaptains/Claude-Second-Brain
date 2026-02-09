import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const BRAIN_DIR =
  process.env.CLAUDE_BRAIN_DIR || join(homedir(), ".claude-brain");
const DB_PATH = process.env.CLAUDE_BRAIN_DB || join(BRAIN_DIR, "brain.db");

const SCHEMA_VERSION = 1;

const DEFAULT_CATEGORIES = [
  {
    name: "personal",
    description: "About you — name, location, timezone, work style",
    priority: 6,
    token_budget: 150,
  },
  {
    name: "systems",
    description: "Hardware & infrastructure — servers, workstations, network",
    priority: 1,
    token_budget: 400,
  },
  {
    name: "software",
    description: "Software stack & config — OS, editors, shells, tools",
    priority: 2,
    token_budget: 300,
  },
  {
    name: "home",
    description:
      "Home automation & IoT — HA setup, devices, automations, zones",
    priority: 4,
    token_budget: 250,
  },
  {
    name: "preferences",
    description: "How you like things done — code style, conventions, naming",
    priority: 3,
    token_budget: 350,
  },
  {
    name: "decisions",
    description: "Architectural choices & rationale — why you chose X over Y",
    priority: 5,
    token_budget: 300,
  },
  {
    name: "lessons",
    description: "Hard-won insights — never do X because Y",
    priority: 7,
    token_budget: 300,
  },
  {
    name: "people",
    description: "Collaborators & contacts — team members, roles, preferences",
    priority: 8,
    token_budget: 100,
  },
  {
    name: "workflows",
    description: "Recurring processes — deploy steps, review checklists",
    priority: 9,
    token_budget: 150,
  },
];

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function applyMigrations(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion < 1) {
    db.exec(`
      -- Core knowledge table
      CREATE TABLE IF NOT EXISTS categories (
        name          TEXT PRIMARY KEY,
        description   TEXT,
        priority      INTEGER DEFAULT 50,
        token_budget  INTEGER DEFAULT 200
      );

      CREATE TABLE IF NOT EXISTS knowledge (
        id            TEXT PRIMARY KEY,
        category      TEXT NOT NULL REFERENCES categories(name),
        subcategory   TEXT,
        key           TEXT NOT NULL,
        value         TEXT NOT NULL,
        compressed    TEXT,
        confidence    REAL DEFAULT 0.8 CHECK(confidence >= 0.0 AND confidence <= 1.0),
        source        TEXT,
        tags          TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        active        INTEGER DEFAULT 1 CHECK(active IN (0, 1)),
        UNIQUE(category, subcategory, key)
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_category_active
        ON knowledge(category, active);
      CREATE INDEX IF NOT EXISTS idx_knowledge_confidence
        ON knowledge(confidence DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_updated
        ON knowledge(updated_at DESC);

      -- Separate access stats to avoid FTS5 write amplification
      CREATE TABLE IF NOT EXISTS knowledge_access_stats (
        knowledge_id  TEXT PRIMARY KEY REFERENCES knowledge(id) ON DELETE CASCADE,
        accessed_at   INTEGER,
        access_count  INTEGER DEFAULT 0
      );

      -- Relations (lightweight knowledge graph)
      CREATE TABLE IF NOT EXISTS relations (
        from_id       TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
        to_id         TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        PRIMARY KEY(from_id, to_id, relation_type)
      );

      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);

      -- FTS5 for full-text search (external content, synced via triggers)
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        key,
        value,
        tags,
        content='knowledge',
        content_rowid='rowid',
        tokenize='unicode61 tokenchars "-._/"'
      );

      -- FTS5 sync triggers
      CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert
        AFTER INSERT ON knowledge BEGIN
          INSERT INTO knowledge_fts(rowid, key, value, tags)
          VALUES (new.rowid, new.key, new.value, new.tags);
        END;

      CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete
        AFTER DELETE ON knowledge BEGIN
          INSERT INTO knowledge_fts(knowledge_fts, rowid, key, value, tags)
          VALUES ('delete', old.rowid, old.key, old.value, old.tags);
        END;

      CREATE TRIGGER IF NOT EXISTS knowledge_fts_update
        AFTER UPDATE ON knowledge BEGIN
          INSERT INTO knowledge_fts(knowledge_fts, rowid, key, value, tags)
          VALUES ('delete', old.rowid, old.key, old.value, old.tags);
          INSERT INTO knowledge_fts(rowid, key, value, tags)
          VALUES (new.rowid, new.key, new.value, new.tags);
        END;
    `);

    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}

function seedCategories(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO categories (name, description, priority, token_budget)
    VALUES (@name, @description, @priority, @token_budget)
  `);

  const tx = db.transaction(() => {
    for (const cat of DEFAULT_CATEGORIES) {
      insert.run(cat);
    }
  });

  tx();
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  ensureDir(dirname(DB_PATH));
  const db = new Database(DB_PATH);

  // Critical pragmas — must be set before any operations
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  applyMigrations(db);
  seedCategories(db);

  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function getDbPath(): string {
  return DB_PATH;
}

export function getBrainDir(): string {
  return BRAIN_DIR;
}

export { DEFAULT_CATEGORIES };
