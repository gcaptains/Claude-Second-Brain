#!/usr/bin/env node

import { Command } from "commander";
import { getDb, closeDb, getDbPath, getBrainDir } from "./db.js";
import {
  addKnowledge,
  listKnowledge,
  getByKey,
  getKnowledge,
  updateKnowledge,
  removeKnowledge,
  restoreKnowledge,
  moveKnowledge,
  getCategoryCounts,
  getTotalCount,
} from "./knowledge.js";
import { search } from "./search.js";
import { exportKnowledge, syncToClaudeMd } from "./export.js";
import { importFromClaudeMd, importFromFile } from "./import.js";
import { estimateTokens } from "./tokens.js";
import { createInterface } from "node:readline";

const program = new Command();

program
  .name("brain")
  .description(
    "Claude Second Brain — personal knowledge database for Claude Code"
  )
  .version("0.1.0");

// ─── ADD ──────────────────────────────────────────────────────────────
program
  .command("add")
  .description("Add a knowledge entry")
  .argument("<category>", "Category (e.g. systems, preferences, lessons)")
  .argument("<key>", "Short identifier for this fact")
  .argument("[value...]", "The knowledge to store (all remaining args)")
  .option("-s, --subcategory <sub>", "Subcategory for grouping")
  .option("-t, --tags <tags>", "Comma-separated tags")
  .option("-c, --compressed <text>", "Compressed/minimal version")
  .option("--confidence <n>", "Confidence 0.0-1.0", "0.8")
  .option("--source <source>", "Where this knowledge came from")
  .option("--stdin", "Read value from stdin")
  .action(async (category, key, valueArgs, opts) => {
    try {
      let value: string;

      if (opts.stdin) {
        value = await readStdin();
      } else if (valueArgs.length > 0) {
        // Treat all remaining args as the value (avoids quoting issues)
        value = valueArgs.join(" ");
      } else {
        // Interactive: prompt for value
        value = await prompt("Value: ");
      }

      if (!value.trim()) {
        console.error("Error: value cannot be empty");
        process.exit(1);
      }

      const entry = addKnowledge({
        category,
        key,
        value: value.trim(),
        subcategory: opts.subcategory,
        tags: opts.tags,
        compressed: opts.compressed,
        confidence: parseFloat(opts.confidence),
        source: opts.source,
      });

      console.log(`Saved: ${entry.category}/${entry.key}`);
      console.log(`  ID: ${entry.id}`);
      console.log(`  Tokens: ~${estimateTokens(entry.compressed || entry.value)}`);
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── EDIT ─────────────────────────────────────────────────────────────
program
  .command("edit")
  .description("Edit an existing knowledge entry")
  .argument("<category>", "Category")
  .argument("<key>", "Key to edit")
  .argument("[value...]", "New value (all remaining args)")
  .option("-t, --tags <tags>", "Update tags")
  .option("-c, --compressed <text>", "Update compressed version")
  .option("--confidence <n>", "Update confidence")
  .action(async (category, key, valueArgs, opts) => {
    try {
      const entry = getByKey(category, key);
      if (!entry) {
        console.error(`Not found: ${category}/${key}`);
        process.exit(1);
      }

      const updates: Record<string, unknown> = {};

      if (valueArgs.length > 0) {
        updates.value = valueArgs.join(" ");
      }
      if (opts.tags !== undefined) updates.tags = opts.tags;
      if (opts.compressed !== undefined) updates.compressed = opts.compressed;
      if (opts.confidence !== undefined)
        updates.confidence = parseFloat(opts.confidence);

      if (Object.keys(updates).length === 0) {
        // No args — show current value and prompt
        console.log(`Current value: ${entry.value}`);
        const newValue = await prompt("New value (Enter to keep): ");
        if (newValue.trim()) {
          updates.value = newValue.trim();
        } else {
          console.log("No changes.");
          return;
        }
      }

      const updated = updateKnowledge(entry.id, updates);
      if (updated) {
        console.log(`Updated: ${updated.category}/${updated.key}`);
      }
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── RM ───────────────────────────────────────────────────────────────
program
  .command("rm")
  .description("Remove a knowledge entry (soft delete)")
  .argument("<category>", "Category")
  .argument("<key>", "Key to remove")
  .option("--purge", "Permanently delete (no undo)")
  .action((category, key, opts) => {
    try {
      const entry = getByKey(category, key);
      if (!entry) {
        console.error(`Not found: ${category}/${key}`);
        process.exit(1);
      }

      if (opts.purge) {
        const { purgeKnowledge } = require("./knowledge.js");
        purgeKnowledge(entry.id);
        console.log(`Purged: ${category}/${key} (permanent)`);
      } else {
        removeKnowledge(entry.id);
        console.log(`Removed: ${category}/${key}`);
        console.log(`  Restore with: brain restore ${entry.id}`);
      }
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── RESTORE ──────────────────────────────────────────────────────────
program
  .command("restore")
  .description("Restore a soft-deleted entry")
  .argument("<id>", "Entry ID to restore")
  .action((id) => {
    try {
      if (restoreKnowledge(id)) {
        console.log(`Restored: ${id}`);
      } else {
        console.error(`Not found or already active: ${id}`);
      }
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── LIST ─────────────────────────────────────────────────────────────
program
  .command("list")
  .description("List knowledge entries")
  .argument("[category]", "Filter by category")
  .option("-k, --keys-only", "Show only keys, no values")
  .option("-a, --all", "Include soft-deleted entries")
  .option("-l, --limit <n>", "Max entries to show")
  .action((category, opts) => {
    try {
      const entries = listKnowledge({
        category,
        activeOnly: !opts.all,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      if (entries.length === 0) {
        console.log(
          category
            ? `No entries in "${category}".`
            : "No entries yet. Use `brain add` to start."
        );
        return;
      }

      // Group by category
      const grouped = new Map<string, typeof entries>();
      for (const e of entries) {
        if (!grouped.has(e.category)) grouped.set(e.category, []);
        grouped.get(e.category)!.push(e);
      }

      for (const [cat, catEntries] of grouped) {
        console.log(`\n${cat} (${catEntries.length})`);
        console.log("─".repeat(40));
        for (const e of catEntries) {
          const prefix = e.subcategory ? `${e.subcategory}/` : "";
          const inactive = e.active === 0 ? " [deleted]" : "";
          if (opts.keysOnly) {
            console.log(`  ${prefix}${e.key}${inactive}`);
          } else {
            const display = e.compressed || e.value;
            const truncated =
              display.length > 80 ? display.slice(0, 77) + "..." : display;
            console.log(`  ${prefix}${e.key}: ${truncated}${inactive}`);
          }
        }
      }
      console.log(`\nTotal: ${entries.length} entries`);
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── SEARCH ───────────────────────────────────────────────────────────
program
  .command("search")
  .description("Search knowledge entries (full-text)")
  .argument("<query...>", "Search query")
  .option("-c, --category <cat>", "Filter by category")
  .option("-t, --tags <tags>", "Filter by tag")
  .option("-l, --limit <n>", "Max results", "10")
  .action((queryArgs, opts) => {
    try {
      const query = queryArgs.join(" ");
      const results = search({
        query,
        category: opts.category,
        tags: opts.tags,
        limit: parseInt(opts.limit),
      });

      if (results.length === 0) {
        console.log(`No results for "${query}".`);
        return;
      }

      console.log(`Found ${results.length} results:\n`);
      for (const r of results) {
        const prefix = r.subcategory ? `${r.subcategory}/` : "";
        console.log(`  [${r.category}] ${prefix}${r.key}`);
        console.log(`    ${r.snippet.replace(/>>>/g, "→").replace(/<<</g, "←")}`);
        console.log(
          `    confidence: ${r.confidence.toFixed(2)}  accessed: ${r.access_count ?? 0}x`
        );
        console.log();
      }
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── GET ──────────────────────────────────────────────────────────────
program
  .command("get")
  .description("Get a specific entry by category/key")
  .argument("<category>", "Category")
  .argument("<key>", "Key")
  .action((category, key) => {
    try {
      const entry = getByKey(category, key);
      if (!entry) {
        console.error(`Not found: ${category}/${key}`);
        process.exit(1);
      }

      console.log(`Category:    ${entry.category}`);
      if (entry.subcategory) console.log(`Subcategory: ${entry.subcategory}`);
      console.log(`Key:         ${entry.key}`);
      console.log(`Value:       ${entry.value}`);
      if (entry.compressed) console.log(`Compressed:  ${entry.compressed}`);
      console.log(`Confidence:  ${entry.confidence.toFixed(2)}`);
      if (entry.tags) console.log(`Tags:        ${entry.tags}`);
      if (entry.source) console.log(`Source:      ${entry.source}`);
      console.log(
        `Created:     ${new Date(entry.created_at).toISOString()}`
      );
      console.log(
        `Updated:     ${new Date(entry.updated_at).toISOString()}`
      );
      console.log(`Accessed:    ${entry.access_count ?? 0}x`);
      console.log(`ID:          ${entry.id}`);
      console.log(`Tokens:      ~${estimateTokens(entry.compressed || entry.value)}`);
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── MV ───────────────────────────────────────────────────────────────
program
  .command("mv")
  .description("Move an entry to a different category or rename its key")
  .argument("<category>", "Current category")
  .argument("<key>", "Current key")
  .argument("<new-category>", "New category")
  .argument("[new-key]", "New key (optional)")
  .action((category, key, newCategory, newKey) => {
    try {
      const entry = getByKey(category, key);
      if (!entry) {
        console.error(`Not found: ${category}/${key}`);
        process.exit(1);
      }

      const moved = moveKnowledge(entry.id, newCategory, newKey);
      if (moved) {
        console.log(
          `Moved: ${category}/${key} → ${moved.category}/${moved.key}`
        );
      }
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── EXPORT ───────────────────────────────────────────────────────────
program
  .command("export")
  .description("Export knowledge as formatted text")
  .option(
    "-f, --format <fmt>",
    "Output format: claude-md, claude-dense, json",
    "claude-md"
  )
  .option("-b, --budget <n>", "Token budget for export", "2000")
  .option("-c, --categories <cats>", "Comma-separated category filter")
  .option("--sync", "Write to CLAUDE.md (with section markers)")
  .option("--sync-target <path>", "Custom CLAUDE.md path for sync")
  .option("--dry-run", "Preview sync without writing")
  .action((opts) => {
    try {
      const categories = opts.categories
        ? opts.categories.split(",").map((s: string) => s.trim())
        : undefined;

      const output = exportKnowledge({
        format: opts.format,
        budget: parseInt(opts.budget),
        categories,
      });

      if (opts.sync || opts.syncTarget) {
        if (opts.dryRun) {
          console.log("--- DRY RUN (would write to CLAUDE.md) ---\n");
          console.log(output);
          console.log(`\n--- ~${estimateTokens(output)} tokens ---`);
          return;
        }

        const { path, diff } = syncToClaudeMd(output, opts.syncTarget);
        console.log(`Synced to ${path} ${diff}`);
        console.log(`  ~${estimateTokens(output)} tokens`);
      } else {
        console.log(output);
        console.log(`\n--- ~${estimateTokens(output)} tokens ---`);
      }
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── IMPORT ───────────────────────────────────────────────────────────
program
  .command("import")
  .description("Import knowledge from a file (CLAUDE.md or markdown)")
  .argument("[file]", "File to import (default: auto-detect CLAUDE.md)")
  .action((file) => {
    try {
      const result = file ? importFromFile(file) : importFromClaudeMd();

      console.log(`Import complete:`);
      console.log(`  Found:    ${result.total} entries`);
      console.log(`  Imported: ${result.imported}`);
      console.log(`  Skipped:  ${result.skipped} (duplicates)`);
      if (result.errors.length > 0) {
        console.log(`  Errors:`);
        for (const err of result.errors) {
          console.log(`    - ${err}`);
        }
      }
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── STATS ────────────────────────────────────────────────────────────
program
  .command("stats")
  .description("Show knowledge base statistics")
  .action(() => {
    try {
      const counts = getCategoryCounts();
      const total = getTotalCount();

      console.log("Claude Second Brain - Statistics\n");
      console.log(`Database: ${getDbPath()}`);
      console.log(`Total entries: ${total}\n`);

      if (total === 0) {
        console.log("No entries yet. Try:");
        console.log(
          '  brain add systems home-server Unraid 7.1, 64GB ECC, RTX 3090'
        );
        console.log("  brain import  (to bootstrap from existing CLAUDE.md)");
        return;
      }

      console.log("By category:");
      const db = getDb();
      const cats = db
        .prepare(`SELECT name, description FROM categories ORDER BY priority`)
        .all() as { name: string; description: string }[];

      for (const cat of cats) {
        const count = counts[cat.name] || 0;
        const bar = "█".repeat(Math.min(count, 30));
        console.log(`  ${cat.name.padEnd(12)} ${String(count).padStart(4)}  ${bar}`);
      }

      // Estimate export size
      const exported = exportKnowledge({ budget: 2000 });
      console.log(`\nExport size: ~${estimateTokens(exported)} tokens (2000 budget)`);
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── CATEGORIES ───────────────────────────────────────────────────────
program
  .command("categories")
  .description("List available categories")
  .action(() => {
    try {
      const db = getDb();
      const cats = db
        .prepare(
          `SELECT name, description, token_budget FROM categories ORDER BY priority`
        )
        .all() as { name: string; description: string; token_budget: number }[];

      console.log("Available categories:\n");
      for (const cat of cats) {
        console.log(`  ${cat.name.padEnd(14)} ${cat.description}`);
      }
    } catch (e) {
      handleError(e);
    } finally {
      closeDb();
    }
  });

// ─── Helpers ──────────────────────────────────────────────────────────

function handleError(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

program.parse();
