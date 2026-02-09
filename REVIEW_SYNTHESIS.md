# Architecture Review Synthesis

## Reviewers
1. **DB/Storage Engineer** — Schema design, SQLite pitfalls, FTS5 configuration
2. **CLI/UX Engineer** — Command design, interaction model, daily-use friction
3. **Systems Architect** — Strategic fit, adoption risk, Boyd fidelity

## Consensus Findings

### Critical (must fix before building)

1. **Cold-start problem is existential.** Manual-only curation will be abandoned in 1-2 weeks.
   Import from existing CLAUDE.md must be Phase 1, not Phase 3.

2. **Phase sequencing is backwards.** Friction-reducing features deferred; optimization features
   prioritized. Resequence: front-load user value, back-load optimization.

3. **Missing core CLI commands.** No `edit`, `rm`, `list`, `mv` — a curation tool without
   these is not viable.

4. **FTS5 write amplification.** Access tracking (`accessed_at`, `access_count`) in the main
   table causes FTS5 re-indexing on every read. Separate into a stats table.

5. **WAL mode and busy_timeout not specified.** Non-negotiable for concurrent CLI + MCP access.
   Must be enabled on database open.

6. **CLAUDE.md export targets wrong location.** Must write to `~/.claude/CLAUDE.md` with
   section markers (`<!-- BRAIN START -->` / `<!-- BRAIN END -->`), not custom directory.

7. **Shell quoting on `brain add` values.** Multi-word values will break. Treat remaining
   argv as value, support stdin, default to interactive when value omitted.

### Important (fix in implementation)

8. **`superseded_by` duplicates relations table.** Pick one. Decision: drop column, use relations.

9. **Tags index on comma-separated field is useless.** Drop the B-tree index, rely on FTS5.

10. **FTS5 needs explicit tokenizer, column weights, and sync triggers.** Default tokenizer
    breaks on technical identifiers. Missing triggers = stale index.

11. **Static token budget percentages are brittle.** Use global ranking with per-category
    min/max instead of fixed percentage allocation.

12. **`sync` vs `export` ambiguity.** Merge: `export` generates output, `--sync` flag
    writes it to CLAUDE.md.

13. **Boyd's "Destruction" is unimplemented.** `brain ingest` must actually decompose raw text
    into atomic entries, not just import structured data.

14. **`projects` category overlaps per-project CLAUDE.md.** Drop it. Use brain for
    cross-project personal knowledge only.

### Deferred (noted for later phases)

15. **sqlite-vec escape hatch** if semantic search becomes needed at scale.
16. **Tab completion scripts** for bash/zsh/fish.
17. **Auto-suggest, human-approve** as primary interaction loop (Phase 2).
18. **MCP server** for mid-session queries (Phase 2).

## Revised Phase Sequencing

### Phase 1: Foundation + Immediate Value (this PR)
- SQLite schema with all fixes (WAL, FTS5 triggers, stats table, etc.)
- Full CLI: `add`, `edit`, `rm`, `list`, `search`, `export --sync`, `stats`, `ingest`
- CLAUDE.md export with section markers and token budgeting
- Import from existing CLAUDE.md (bootstrap from what you already have)
- Seed categories (without `projects`)

### Phase 2: Integration + Reduced Friction
- MCP server for mid-session queries
- Post-session suggestion hooks (auto-suggest, human-approve)
- `brain review` guided curation
- Basic relations between entries

### Phase 3: Intelligence
- Confidence decay
- Contradiction detection
- LLM-assisted compression
- Advanced ranking

### Phase 4: Collaboration
- Multi-device sync
- Team knowledge bases
- Git-tracked exports
