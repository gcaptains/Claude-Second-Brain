# Claude Second Brain — Architecture Plan

## The Problem

Every Claude Code session starts from zero. You re-explain your system architecture,
your personal preferences, your home automation setup, your project decisions, your
debugging patterns. This costs real money (tokens) and real time. Worse, the best
insights from past sessions — the hard-won "aha" moments — are lost forever.

## Boyd's Framework: Destruction and Creation

John Boyd's epistemological thesis gives us the design principle:

**Destruction (Analysis):** Take raw, high-entropy conversational data and decompose
it into atomic, categorized knowledge units. Strip away the noise — the back-and-forth,
the false starts, the redundancy. Extract only the signal.

**Creation (Synthesis):** Recombine those atomic units into compressed, structured
context that can be injected into future sessions. The output should be *denser than
the input* — more information per token.

This is lossy compression with human judgment. Not "save everything" — save what matters.

---

## Landscape Analysis

### What exists today (Feb 2026)

| Tool | Approach | Strengths | Weaknesses |
|------|----------|-----------|------------|
| **Claude Code Auto Memory** | File-based (MEMORY.md + topic files) | Native, zero setup, free | Manual, no search, no categorization, no compression |
| **claude-mem** (thedotmack) | MCP plugin, SQLite + Chroma, 3-layer progressive disclosure | Automatic capture, 10x token savings, vector search | Requires Bun, Chroma, agent-sdk; coding-session focused only |
| **memory-mcp** (yuvalsuede) | Two-tier (CLAUDE.md + state.json), Haiku extraction | $0.05-0.10/day, no vector DB needed, 80/20 tier split | Code-project focused, no personal knowledge, JSON storage |
| **Mem0** | Hybrid (vector + KV + graph stores), cloud API | 26% accuracy boost, 91% faster, production-grade | Cloud dependency, not local-first, $24M VC = eventual lock-in |
| **Graphiti/Neo4j** | Temporal knowledge graph | Rich relationships, incremental updates | Heavy infrastructure (Neo4j), enterprise-grade overkill |

### The gap none of them fill

All existing tools focus on **code project memory** — what did Claude learn about *this
codebase*. None of them handle **personal knowledge** — who you are, what systems you
run, your decision-making patterns, your home setup, your preferences across *all*
projects and *all* domains.

You need a **cross-project, cross-domain personal knowledge base** — not another
code-memory plugin.

---

## Proposed Architecture

### Design Principles

1. **Local-first, single-file** — SQLite. No cloud, no Docker, no vector DB server.
   Portable. Backupable. `cp brain.db brain.db.bak`. Done.

2. **Human-in-the-loop** — No auto-capture of everything (that's what claude-mem does).
   Instead: deliberate curation. You decide what goes in. Boyd's destruction requires
   *judgment*, not bulk ingestion.

3. **Atomic knowledge units** — Each entry is one fact, one preference, one decision.
   Not paragraphs. Not documents. Atoms.

4. **Compression-native** — Every entry has a `compressed` field: the minimum viable
   representation. "Home server: Unraid, 64GB RAM, RTX 3090" not "I have a home server
   that I set up last year running Unraid OS with 64 gigabytes of RAM and..."

5. **Multi-domain categories** — Not just code. Personal, systems, home, decisions,
   preferences, lessons, people, workflows.

6. **Token-budget aware** — Export knows how many tokens you're spending. You set a
   budget (e.g., 2000 tokens) and it prioritizes what to include.

7. **Claude Code native** — First-class export to CLAUDE.md / memory files. Works
   with the tool you already use.

### Data Model

```
┌─────────────────────────────────────────────────────────────────┐
│                         knowledge                               │
├─────────────────────────────────────────────────────────────────┤
│ id            TEXT PRIMARY KEY (ulid)                            │
│ category      TEXT NOT NULL                                      │
│ subcategory   TEXT                                               │
│ key           TEXT NOT NULL        -- short identifier            │
│ value         TEXT NOT NULL        -- the atomic fact             │
│ compressed    TEXT                 -- min-token representation    │
│ confidence    REAL DEFAULT 0.8    -- 0.0-1.0, decays over time  │
│ source        TEXT                 -- where this came from        │
│ tags          TEXT                 -- comma-separated             │
│ created_at    TEXT NOT NULL                                      │
│ updated_at    TEXT NOT NULL                                      │
│ accessed_at   TEXT                 -- for LRU/frequency tracking  │
│ access_count  INTEGER DEFAULT 0                                  │
│ superseded_by TEXT                 -- points to newer version     │
│ active        INTEGER DEFAULT 1   -- soft delete                 │
├─────────────────────────────────────────────────────────────────┤
│ UNIQUE(category, key)                                            │
│ INDEX(category, active)                                          │
│ INDEX(tags)                                                      │
│ INDEX(confidence DESC)                                           │
│ FTS5(key, value, compressed, tags)                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         categories                              │
├─────────────────────────────────────────────────────────────────┤
│ name          TEXT PRIMARY KEY                                    │
│ description   TEXT                                               │
│ icon          TEXT           -- for CLI display                   │
│ priority      INTEGER        -- export ordering                  │
│ token_budget  INTEGER        -- max tokens in export             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         relations                               │
├─────────────────────────────────────────────────────────────────┤
│ from_id       TEXT REFERENCES knowledge(id)                      │
│ to_id         TEXT REFERENCES knowledge(id)                      │
│ relation_type TEXT NOT NULL    -- "depends_on", "contradicts",   │
│                               -- "supersedes", "related_to"     │
│ PRIMARY KEY(from_id, to_id, relation_type)                      │
└─────────────────────────────────────────────────────────────────┘
```

### Default Categories

| Category | Description | Example Entries |
|----------|-------------|-----------------|
| `personal` | About you | Name, location, timezone, work style |
| `systems` | Hardware & infrastructure | Servers, workstations, network topology |
| `software` | Software stack & config | OS, editors, shells, dotfiles conventions |
| `home` | Home automation & IoT | HA setup, devices, automations, zones |
| `preferences` | How you like things done | Code style, commit conventions, naming |
| `decisions` | Architectural choices & rationale | "Chose SQLite over Postgres because..." |
| `lessons` | Hard-won insights | "Never use X with Y because Z" |
| `people` | Collaborators & contacts | Team members, their roles, preferences |
| `workflows` | Recurring processes | Deploy steps, review checklist, backup routine |
| `projects` | Active project context | Current goals, blockers, architecture |

### System Components

```
┌──────────────────────────────────────────────────────────────┐
│                        CLI (`brain`)                          │
│                                                              │
│  brain add <category> <key> <value>    -- ingest a fact      │
│  brain add -i                          -- interactive mode    │
│  brain recall <query>                  -- search/retrieve     │
│  brain recall --category systems       -- filter by category │
│  brain export --format claude-md       -- → CLAUDE.md        │
│  brain export --budget 2000            -- token-limited       │
│  brain export --format json            -- raw export          │
│  brain ingest <file>                   -- bulk import         │
│  brain stats                           -- db statistics       │
│  brain decay                           -- age out stale facts │
│  brain review                          -- audit & curate      │
│  brain sync                            -- push to CLAUDE.md   │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                    Core Library                               │
│                                                              │
│  db.ts          -- SQLite connection, migrations              │
│  knowledge.ts   -- CRUD for knowledge entries                 │
│  categories.ts  -- category management                        │
│  search.ts      -- FTS5 full-text search                      │
│  export.ts      -- format converters (CLAUDE.md, JSON, etc)  │
│  compress.ts    -- token counting & budget allocation         │
│  decay.ts       -- confidence decay over time                 │
│  relations.ts   -- knowledge graph edges                      │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                    Storage                                    │
│                                                              │
│  ~/.claude-brain/brain.db     -- SQLite database              │
│  ~/.claude-brain/backups/     -- automatic backups            │
│  ~/.claude-brain/exports/     -- generated CLAUDE.md files    │
└──────────────────────────────────────────────────────────────┘
```

### Export: The Creation Phase

The export system is where Boyd's "creation" happens. Given a token budget, it:

1. **Ranks** entries by `confidence * access_count * recency_weight`
2. **Groups** by category, respecting each category's `token_budget`
3. **Selects** the `compressed` field (or `value` if no compressed version exists)
4. **Formats** as structured markdown optimized for LLM consumption
5. **Outputs** to CLAUDE.md or a memory file that Claude Code reads on startup

Example output (targeting ~800 tokens):

```markdown
# Personal Context

## Systems
- Primary workstation: Mac Studio M2 Ultra, 192GB RAM, macOS Sequoia
- Home server: Unraid 7.1, 64GB ECC, RTX 3090, 80TB raw storage
- Network: Ubiquiti UDM-Pro, VLANs for IoT/trusted/guest

## Home
- Home Assistant on Unraid VM, Z-Wave + Zigbee + Matter
- 47 devices across 12 zones
- Key automations: presence-based HVAC, circadian lighting, security arming

## Preferences
- TypeScript > JavaScript, always strict mode
- Prefer composition over inheritance
- Commit messages: conventional commits, imperative mood
- Tests: colocated with source, *.test.ts naming

## Active Decisions
- Chose SQLite for brain DB: zero-infra, single-file, 2TB limit is plenty
- Using Unraid over TrueNAS: better Docker/VM support, community plugins
- Home Assistant over HomeKit: automation flexibility, local-first

## Lessons Learned
- Never trust mDNS across VLANs without Avahi reflector
- Unraid parity checks: schedule monthly, not weekly (disk wear)
- Claude works best with compressed, structured context — not prose
```

### Token Budget Allocation

The export system uses a priority-weighted budget allocator:

```
Total budget: 2000 tokens
─────────────────────────
systems:     400 tokens (20%)
preferences: 350 tokens (17.5%)
decisions:   300 tokens (15%)
lessons:     300 tokens (15%)
home:        250 tokens (12.5%)
personal:    150 tokens (7.5%)
workflows:   150 tokens (7.5%)
projects:    100 tokens (5%)
─────────────────────────
```

Percentages are configurable. Unused budget from sparse categories redistributes
to categories with overflow.

---

## What This Is NOT

- **Not auto-capture.** Claude-mem already does that. This is deliberate curation.
- **Not a code-memory tool.** Memory-mcp and Auto Memory handle that. This is
  cross-domain personal knowledge.
- **Not a vector database.** FTS5 full-text search is sufficient for a curated
  knowledge base of hundreds to low-thousands of entries. No embeddings needed.
- **Not cloud-dependent.** Everything runs locally. No API calls for storage or
  retrieval (though you could optionally use an LLM for compression assistance).

## What This IS

- A **personal knowledge substrate** that persists across all Claude sessions
- A **compression engine** that turns verbose knowledge into dense, token-efficient context
- A **curation tool** that puts you in control of what Claude knows about you
- A **Boyd machine** — systematic destruction of noise and creation of signal

---

## Implementation Phases

### Phase 1: Foundation (this PR)
- SQLite database with schema, migrations, FTS5
- Core CRUD operations for knowledge entries
- CLI with `add`, `recall`, `export`, `stats` commands
- CLAUDE.md export with token budgeting
- Seed categories and example data

### Phase 2: Intelligence
- Confidence decay over time (entries you never access lose priority)
- Relation tracking between knowledge entries
- Duplicate/contradiction detection
- `brain review` interactive curation mode

### Phase 3: Integration
- MCP server so Claude can query the brain mid-session
- Hook into Claude Code's post-session to suggest knowledge extractions
- Import from existing CLAUDE.md / MEMORY.md files
- Optional LLM-assisted compression (use Claude to compress entries)

### Phase 4: Collaboration
- Export/import between machines (brain.db is just a file)
- Merge strategy for syncing across devices
- Team knowledge bases (shared categories)
- Git-tracked export files for version history

---

## Technology Choices & Rationale

| Choice | Rationale | Alternative Considered |
|--------|-----------|----------------------|
| **SQLite** | Zero infrastructure, single file, FTS5 built-in, 2TB limit | Postgres (overkill), JSON files (no search), Chroma (extra dependency) |
| **TypeScript** | Claude Code ecosystem is Node/TS, type safety for schema | Python (Mem0 ecosystem but different toolchain), Rust (overkill) |
| **FTS5** | Built into SQLite, no external deps, fast for <10K entries | Vector embeddings (need embedding API or local model), simple LIKE (too slow) |
| **ULID** | Time-sortable, no collisions, works offline | UUID (not sortable), auto-increment (not portable) |
| **Commander.js** | Standard Node CLI framework, minimal | Ink (TUI overkill), yargs (heavier), raw process.argv (too manual) |
| **No vector DB** | Curated knowledge base is small enough for FTS5 | Chroma (claude-mem uses it but needs server), FAISS (C++ deps) |
| **No LLM dependency** | Core ops work offline, LLM compression is optional | Required LLM calls (Mem0 approach — adds cost and latency to every op) |
