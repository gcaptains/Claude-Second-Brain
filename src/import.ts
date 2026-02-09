import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { addKnowledge, type AddOptions } from "./knowledge.js";
import { BRAIN_START_MARKER, BRAIN_END_MARKER } from "./export.js";

export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Import knowledge from an existing CLAUDE.md file.
 * Parses structured markdown (headers + bullet points) into knowledge entries.
 */
export function importFromClaudeMd(filePath?: string): ImportResult {
  const target = filePath || findClaudeMd();
  if (!target || !existsSync(target)) {
    return { total: 0, imported: 0, skipped: 0, errors: [`File not found: ${target || "(no CLAUDE.md found)"}`] };
  }

  const content = readFileSync(target, "utf-8");
  return parseAndImport(content, `import:${target}`);
}

/**
 * Import from a plain text/markdown file.
 */
export function importFromFile(filePath: string): ImportResult {
  if (!existsSync(filePath)) {
    return { total: 0, imported: 0, skipped: 0, errors: [`File not found: ${filePath}`] };
  }

  const content = readFileSync(filePath, "utf-8");
  return parseAndImport(content, `import:${filePath}`);
}

/**
 * Find the user's CLAUDE.md file, checking standard locations.
 */
function findClaudeMd(): string | null {
  const candidates = [
    join(homedir(), ".claude", "CLAUDE.md"),
    join(process.cwd(), "CLAUDE.md"),
    join(homedir(), "CLAUDE.md"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Parse markdown content into knowledge entries and import them.
 */
function parseAndImport(rawContent: string, source: string): ImportResult {
  // Strip any existing brain-managed section
  let content = rawContent;
  const startIdx = content.indexOf(BRAIN_START_MARKER);
  const endIdx = content.indexOf(BRAIN_END_MARKER);
  if (startIdx !== -1 && endIdx !== -1) {
    content =
      content.slice(0, startIdx) +
      content.slice(endIdx + BRAIN_END_MARKER.length);
  }

  const result: ImportResult = { total: 0, imported: 0, skipped: 0, errors: [] };
  const lines = content.split("\n");

  let currentCategory = "preferences"; // default category
  let currentSubcategory: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect h1/h2/h3 headers → map to categories
    const h1Match = trimmed.match(/^#\s+(.+)/);
    const h2Match = trimmed.match(/^##\s+(.+)/);
    const h3Match = trimmed.match(/^###\s+(.+)/);

    if (h1Match || h2Match) {
      const header = (h1Match || h2Match)![1].toLowerCase().trim();
      currentCategory = mapHeaderToCategory(header);
      currentSubcategory = undefined;
      continue;
    }

    if (h3Match) {
      currentSubcategory = slugify(h3Match[1].trim());
      continue;
    }

    // Detect bullet points → knowledge entries
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (!bulletMatch) continue;

    const bulletContent = bulletMatch[1];
    result.total++;

    // Try to extract key: value pairs
    const kvMatch = bulletContent.match(
      /^\*\*(.+?)\*\*[:\s]+(.+)/ // **key:** value
    ) || bulletContent.match(
      /^`(.+?)`[:\s]+(.+)/ // `key`: value
    ) || bulletContent.match(
      /^(.+?):\s+(.+)/ // key: value
    );

    let key: string;
    let value: string;

    if (kvMatch) {
      key = slugify(kvMatch[1].trim());
      value = kvMatch[2].trim();
    } else {
      // No clear key:value — use first few words as key
      const words = bulletContent.split(/\s+/);
      key = slugify(words.slice(0, 3).join("-"));
      value = bulletContent;
    }

    if (!key || !value) {
      result.skipped++;
      continue;
    }

    try {
      const opts: AddOptions = {
        category: currentCategory,
        key,
        value,
        source,
        confidence: 0.7, // Lower confidence for imports — user should review
      };
      if (currentSubcategory) {
        opts.subcategory = currentSubcategory;
      }
      addKnowledge(opts);
      result.imported++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Duplicate key — skip, don't error
      if (msg.includes("UNIQUE constraint")) {
        result.skipped++;
      } else {
        result.errors.push(`Failed to import "${key}": ${msg}`);
      }
    }
  }

  return result;
}

/**
 * Map common markdown headers to brain categories.
 */
function mapHeaderToCategory(header: string): string {
  const lower = header.toLowerCase().replace(/[^a-z0-9\s]/g, "");

  const mappings: Record<string, string[]> = {
    systems: ["system", "hardware", "infrastructure", "server", "machine", "network"],
    software: ["software", "tool", "editor", "ide", "stack", "language", "framework"],
    home: ["home", "automation", "iot", "smart home", "ha ", "homeassistant"],
    preferences: ["preference", "style", "convention", "format", "standard", "rule"],
    decisions: ["decision", "choice", "rationale", "architecture", "design"],
    lessons: ["lesson", "insight", "gotcha", "pitfall", "warning", "tip", "note"],
    people: ["people", "team", "contact", "collaborator", "member"],
    workflows: ["workflow", "process", "deploy", "pipeline", "ci", "cd"],
    personal: ["personal", "about", "bio", "profile", "context"],
  };

  for (const [category, keywords] of Object.entries(mappings)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }

  return "preferences"; // Safe default
}

/**
 * Convert a string to a URL-safe slug.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
