export { getDb, closeDb, getDbPath, getBrainDir } from "./db.js";
export {
  addKnowledge,
  getKnowledge,
  getByKey,
  updateKnowledge,
  removeKnowledge,
  restoreKnowledge,
  purgeKnowledge,
  moveKnowledge,
  listKnowledge,
  touchKnowledge,
  getCategoryCounts,
  getTotalCount,
  type KnowledgeEntry,
  type AddOptions,
  type UpdateOptions,
  type ListOptions,
} from "./knowledge.js";
export { search, exactLookup, type SearchOptions, type SearchResult } from "./search.js";
export { exportKnowledge, syncToClaudeMd, type ExportOptions } from "./export.js";
export { importFromClaudeMd, importFromFile, type ImportResult } from "./import.js";
export { estimateTokens, fitsInBudget, truncateToTokens } from "./tokens.js";
