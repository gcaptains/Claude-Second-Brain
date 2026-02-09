# Claude Second Brain

A personal knowledge database that gives Claude Code persistent memory across sessions. Stop re-explaining your systems, preferences, and hard-won lessons every time you start a new conversation.

Built on [John Boyd's Destruction and Creation](https://www.danford.net/boyd/destroy.htm) thesis:
**Destroy** raw conversational noise into atomic facts. **Create** compressed, token-efficient context that Claude reads on startup.

## The Problem

Every Claude Code session starts from zero. You re-explain:
- Your server hardware and network topology
- Your code style preferences and naming conventions
- Your home automation setup
- Architectural decisions and *why* you made them
- Debugging lessons you've already learned the hard way

This costs real money (tokens) and real time. Worse, the best insights from past sessions are lost forever.

## The Solution

```
~/.claude-brain/brain.db  ──→  brain export --sync  ──→  ~/.claude/CLAUDE.md
      (SQLite)                   (token-budgeted)           (Claude reads this)
```

A single SQLite file holds your curated personal knowledge. The `brain` CLI compresses and exports it into your `CLAUDE.md` file, where Claude Code reads it automatically at the start of every session.

## Quick Start

```bash
# Install
npm install
npm run build

# Add your first facts
brain add systems home-server Unraid 7.2, 128GB ECC, RTX 4090, 100TB raw
brain add preferences code-style TypeScript strict, composition over inheritance, conventional commits
brain add lessons mdns-vlans Never trust mDNS across VLANs without Avahi reflector
brain add decisions db-choice Chose SQLite over Postgres — zero infra, single file, portable

# See what you've stored
brain list
brain stats

# Export to CLAUDE.md so Claude reads it next session
brain export --sync
```

That's it. Next time you start Claude Code, it knows your systems, your preferences, and your lessons.

## Installation

### From source (recommended)

```bash
git clone <this-repo>
cd Claude-Second-Brain
npm install
npm run build

# Option A: link globally
npm link
brain stats

# Option B: use via npm scripts
npm run brain -- stats
npm run brain -- add systems workstation Mac Studio M2 Ultra, 192GB RAM
```

### Development mode (no build step)

```bash
npm run dev -- stats
npm run dev -- add systems workstation Mac Studio M2 Ultra, 192GB RAM
```

## Commands

### `brain add <category> <key> [value...]`

Add a knowledge entry. All words after the key are treated as the value — no quoting needed.

```bash
# Simple — no quotes required
brain add systems home-server Unraid 7.2, 128GB ECC, RTX 4090

# With options
brain add systems router Ubiquiti UDM-Pro, VLANs for IoT/trusted/guest \
  --tags "network,ubiquiti" \
  --compressed "UDM-Pro, 3 VLANs"

# With subcategory
brain add home lights Hue bulbs in every room, circadian schedule \
  -s lighting

# From stdin (useful for piping)
echo "Custom Zsh with Starship prompt, Neovim, tmux" | brain add software shell-setup --stdin

# Interactive (omit the value, get prompted)
brain add personal timezone
> Value: US/Pacific, prefer morning sessions
```

**Options:**

| Flag | Description |
|------|-------------|
| `-s, --subcategory <sub>` | Group entries within a category |
| `-t, --tags <tags>` | Comma-separated tags for filtering |
| `-c, --compressed <text>` | Minimal version for tight token budgets |
| `--confidence <n>` | How sure you are (0.0-1.0, default: 0.8) |
| `--source <source>` | Where this came from (e.g., "session-2024-03") |
| `--stdin` | Read value from stdin |

**Upsert behavior:** Adding to the same `category + key` updates the existing entry instead of creating a duplicate.

### `brain edit <category> <key> [value...]`

Modify an existing entry. Omit the value to get prompted with the current value shown.

```bash
# Inline update
brain edit systems home-server Unraid 7.2, 192GB ECC, RTX 4090, 120TB raw

# Update just the tags
brain edit systems home-server --tags "server,unraid,gpu"

# Update compressed version
brain edit systems home-server --compressed "Unraid/192GB/4090/120TB"

# Interactive — shows current value, prompts for new
brain edit systems home-server
> Current value: Unraid 7.2, 128GB ECC, RTX 4090, 100TB raw
> New value (Enter to keep):
```

### `brain rm <category> <key>`

Soft-delete an entry. It's still in the database but excluded from exports and searches.

```bash
brain rm systems old-laptop
# Removed: systems/old-laptop
#   Restore with: brain restore 01KH2420ZCCP581SN0PH7K7WZ7

# Permanent delete (no undo)
brain rm systems old-laptop --purge
```

### `brain restore <id>`

Undo a soft delete.

```bash
brain restore 01KH2420ZCCP581SN0PH7K7WZ7
```

### `brain list [category]`

Browse your knowledge base.

```bash
# Everything
brain list

# One category
brain list systems

# Just keys (no values)
brain list -k

# Include deleted entries
brain list --all
```

**Sample output:**

```
systems (3)
────────────────────────────────────────
  home-server: Unraid 7.2, 128GB ECC, RTX 4090, 100TB raw storage
  router: Ubiquiti UDM-Pro, VLANs for IoT/trusted/guest
  workstation: Mac Studio M2 Ultra, 192GB RAM

preferences (2)
────────────────────────────────────────
  code-style: TypeScript strict, composition over inheritance, conventional commits
  editor: Neovim with LazyVim, Catppuccin theme, Copilot disabled

Total: 5 entries
```

### `brain search <query...>`

Full-text search across all entries using SQLite FTS5 with BM25 ranking.

```bash
brain search unraid
brain search network vlan
brain search docker --category systems
brain search typescript --tags preferences
```

Key names are weighted 10x and tags 5x, so searching for "router" will prioritize entries keyed as "router" over entries that merely mention it in the value.

### `brain get <category> <key>`

Show full details for a single entry.

```bash
brain get systems home-server
# Category:    systems
# Key:         home-server
# Value:       Unraid 7.2, 128GB ECC, RTX 4090, 100TB raw storage
# Confidence:  0.80
# Created:     2026-02-09T21:13:57.484Z
# Updated:     2026-02-09T21:15:22.101Z
# Accessed:    4x
# ID:          01KH2420ZCCP581SN0PH7K7WZ7
# Tokens:      ~15
```

### `brain mv <category> <key> <new-category> [new-key]`

Move an entry to a different category or rename it.

```bash
# Recategorize
brain mv lessons mdns-vlans systems

# Recategorize and rename
brain mv lessons mdns-vlans systems network-mdns-gotcha
```

### `brain export`

Generate formatted output from your knowledge base, respecting a token budget.

```bash
# Default: readable markdown, 2000 token budget
brain export

# Dense format (fewer tokens, optimized for LLM consumption)
brain export --format claude-dense

# Custom budget
brain export --budget 1000

# Filter categories
brain export --categories systems,preferences

# JSON export (no budget, all entries)
brain export --format json

# Write directly to CLAUDE.md (with section markers)
brain export --sync

# Preview what sync would write
brain export --sync --dry-run

# Sync to a custom path
brain export --sync --sync-target ~/projects/myapp/CLAUDE.md
```

**Export formats:**

**`claude-md`** (default) — readable markdown with headers:
```markdown
# Personal Context

## Systems
- **home-server:** Unraid 7.2, 128GB ECC, RTX 4090, 100TB raw storage
- **router:** Ubiquiti UDM-Pro, VLANs for IoT/trusted/guest

## Preferences
- **code-style:** TypeScript strict, composition over inheritance
```

**`claude-dense`** — ~40% fewer tokens, same information:
```markdown
# Context

**Systems:** home-server: Unraid 7.2/128GB/4090/100TB | router: UDM-Pro, 3 VLANs
**Preferences:** code-style: TS strict, composition>inheritance, conventional commits
```

**`json`** — raw data, no budget:
```json
[{"id":"01KH...","category":"systems","key":"home-server","value":"..."}]
```

### `brain export --sync`

The key command for Claude Code integration. Writes your knowledge into `~/.claude/CLAUDE.md` using section markers:

```markdown
<!-- CLAUDE-BRAIN START -->
# Personal Context
...your knowledge here...
<!-- CLAUDE-BRAIN END -->
```

Any content you've written outside these markers is preserved. Run it whenever you've updated your knowledge and want Claude to pick up the changes.

### `brain import [file]`

Bootstrap your knowledge base from an existing markdown file. Parses headers into categories and bullet points into entries.

```bash
# Auto-detect: checks ~/.claude/CLAUDE.md, then ./CLAUDE.md
brain import

# Specific file
brain import ~/notes/my-systems.md
```

The importer maps common headers to categories:
- "Systems", "Hardware", "Infrastructure" → `systems`
- "Preferences", "Style", "Conventions" → `preferences`
- "Lessons", "Gotchas", "Tips" → `lessons`
- etc.

Imported entries get a lower confidence (0.7) as a reminder to review and curate them.

### `brain stats`

Overview of your knowledge base.

```
Claude Second Brain - Statistics

Database: /home/user/.claude-brain/brain.db
Total entries: 47

By category:
  systems         12  ████████████
  software         8  ████████
  preferences      7  ███████
  home             6  ██████
  decisions        5  █████
  personal         4  ████
  lessons          3  ███
  people           1  █
  workflows        1  █

Export size: ~1847 tokens (2000 budget)
```

### `brain categories`

List all available categories with descriptions.

```
Available categories:

  systems        Hardware & infrastructure — servers, workstations, network
  software       Software stack & config — OS, editors, shells, tools
  preferences    How you like things done — code style, conventions, naming
  home           Home automation & IoT — HA setup, devices, automations, zones
  decisions      Architectural choices & rationale — why you chose X over Y
  personal       About you — name, location, timezone, work style
  lessons        Hard-won insights — never do X because Y
  people         Collaborators & contacts — team members, roles, preferences
  workflows      Recurring processes — deploy steps, review checklists
```

## Categories

| Category | What goes here | Examples |
|----------|---------------|----------|
| `systems` | Hardware, servers, network topology | "Home server: Unraid, 64GB RAM" |
| `software` | OS, editors, shells, toolchain | "Neovim with LazyVim, Zsh + Starship" |
| `preferences` | Code style, conventions, how you work | "Always TypeScript strict, colocated tests" |
| `home` | Home automation, IoT, smart home | "HA on Unraid VM, 47 devices, 12 zones" |
| `decisions` | Architectural choices with rationale | "SQLite over Postgres: zero infra" |
| `personal` | About you — identity, timezone, style | "US/Pacific, prefer morning deep work" |
| `lessons` | Hard-won insights, pitfalls, gotchas | "Never use mDNS across VLANs" |
| `people` | Team members, collaborators, contacts | "Alice: backend lead, prefers Go" |
| `workflows` | Recurring processes, checklists | "Deploy: run tests, build, tag, push" |

## How Token Budgeting Works

The export system uses a two-phase approach to stay within your token budget:

**Phase 1 — Guarantee coverage.** Each non-empty category gets at least one entry in the export, chosen by the highest-scoring entry in that category. This ensures Claude always has at least a hint about each domain of your knowledge.

**Phase 2 — Fill greedily.** Remaining budget is filled with the highest-scoring entries globally, regardless of category. This means the most important, most frequently accessed, most recently updated knowledge floats to the top.

**Entry scoring formula:**

```
score = confidence * (1 + ln(access_count + 1)) * recency_weight * new_boost
```

- `confidence` — your stated confidence in this fact (0.0–1.0)
- `access_count` — how often you've searched for or viewed this entry
- `recency_weight` — decays over time (half-life ~30 days)
- `new_boost` — 1.5x boost for entries less than 7 days old (so new facts don't get permanently buried)

**The `compressed` field is key.** If an entry has a compressed version, that's what gets exported. This is how you achieve Boyd-style information compression:

```bash
brain add systems home-server \
  "Unraid 7.2 on a custom tower with 128GB ECC DDR5, an NVIDIA RTX 4090 for Plex transcoding, 100TB of raw storage across 8 drives with dual parity" \
  --compressed "Unraid 7.2/128GB ECC/RTX 4090/100TB/dual parity"
```

The full value is stored for your reference. The compressed version is what Claude sees — maximum information per token.

## Data Storage

Everything lives in a single SQLite file:

```
~/.claude-brain/
  brain.db          ← your entire knowledge base
```

**Backup** is just copying a file:
```bash
cp ~/.claude-brain/brain.db ~/.claude-brain/brain.db.bak
```

**Move between machines** by copying `brain.db`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_BRAIN_DIR` | `~/.claude-brain` | Directory for the database |
| `CLAUDE_BRAIN_DB` | `~/.claude-brain/brain.db` | Full path to the database file |

## Architecture

```
src/
  cli.ts          ← Commander.js CLI with 12 commands
  db.ts           ← SQLite connection, WAL mode, FTS5 schema, migrations
  knowledge.ts    ← CRUD operations for knowledge entries
  search.ts       ← FTS5 full-text search with BM25 ranking
  export.ts       ← Token-budgeted markdown export, CLAUDE.md sync
  import.ts       ← Parse markdown files into knowledge entries
  tokens.ts       ← Token estimation for budget control
  ulid.ts         ← Monotonic ULID generator (time-sortable IDs)
  index.ts        ← Library exports for programmatic use
```

### Database Schema

**`knowledge`** — core entries with category, key, value, optional compressed form, confidence score, tags, and soft-delete support. Unique constraint on `(category, subcategory, key)`.

**`knowledge_access_stats`** — separate table to track access frequency and recency without triggering FTS5 re-indexing on every read.

**`knowledge_fts`** — FTS5 virtual table synced via triggers for full-text search with BM25 ranking.

**`relations`** — lightweight knowledge graph edges (related_to, depends_on, contradicts, supersedes) for future use.

**`categories`** — configurable categories with priority ordering and per-category token budgets.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **SQLite, not Postgres** | Zero infrastructure. Single file. Portable. 2TB limit is plenty. |
| **FTS5, not vector embeddings** | Curated knowledge base of hundreds to low-thousands of entries doesn't need semantic search. FTS5 is built into SQLite with no extra dependencies. |
| **Human curation, not auto-capture** | Boyd's destruction requires *judgment*. Auto-capture creates noise; deliberate curation creates signal. |
| **Token budgeting, not dump everything** | LLMs pay less attention to content in the middle of large contexts. Dense, prioritized context beats verbose dumps. |
| **Separate access stats table** | Prevents FTS5 write amplification — reading an entry shouldn't re-index the search table. |
| **ULID IDs** | Time-sortable, collision-free, work offline. Better than UUID for debugging (you can see when entries were created). |
| **Section markers in CLAUDE.md** | Preserves user-written content outside the brain-managed section. Safe to run `--sync` repeatedly. |

## Typical Workflow

### Day 1: Bootstrap

```bash
# If you already have a CLAUDE.md with useful context
brain import

# Review what was imported
brain list

# Fix any miscategorized entries
brain mv preferences my-server systems

# Add things the importer missed
brain add personal name Your Name
brain add personal timezone US/Pacific

# Sync to Claude
brain export --sync
```

### Daily use

After a productive Claude session where you explained something new:

```bash
# Capture the key insight
brain add lessons docker-macvlan Docker macvlan breaks host-to-container communication, use ipvlan l2 instead

# Capture a new preference discovered through experience
brain add preferences error-handling Prefer Result types over try/catch in TypeScript

# Sync when ready
brain export --sync
```

### Periodic review

```bash
# See what you have
brain stats

# Browse by category
brain list lessons
brain list decisions

# Update stale entries
brain edit systems home-server New specs after upgrade

# Remove obsolete entries
brain rm software old-editor-config
```

## Roadmap

### Phase 2: Integration
- MCP server so Claude can query the brain mid-session
- Post-session hooks to suggest knowledge extractions
- `brain review` interactive curation mode (like `git add -p`)

### Phase 3: Intelligence
- Confidence decay over time (unused entries lose priority)
- Contradiction detection between entries
- LLM-assisted compression (use Claude to write compressed versions)

### Phase 4: Collaboration
- Export/import between machines
- Team knowledge bases with shared categories
- Git-tracked export files for version history

## Library Usage

The core modules are exported for programmatic use:

```typescript
import {
  addKnowledge,
  search,
  exportKnowledge,
  syncToClaudeMd,
} from "claude-second-brain";

// Add an entry
addKnowledge({
  category: "systems",
  key: "home-server",
  value: "Unraid 7.2, 128GB ECC",
});

// Search
const results = search({ query: "unraid" });

// Export with budget
const markdown = exportKnowledge({ budget: 1500, format: "claude-dense" });

// Sync to CLAUDE.md
syncToClaudeMd(markdown);
```

## License

MIT
