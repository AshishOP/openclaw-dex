/**
 * Core Memory Injection System for OpenClaw
 *
 * This module bakes the memory system directly into the agent loop,
 * making it automatic rather than dependent on agent instructions.
 *
 * Place at: src/agents/memory/core-memory.ts
 *
 * Key features:
 * - Auto-reads memory/index.md on session start
 * - Keyword-based memory injection based on conversation context
 * - Auto-creates memory nodes for important information
 * - Tiered memory: core (always), contextual (keyword-triggered), archival (search)
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveAgentWorkspaceDir } from "../agent-scope.js";

// ============================================================================
// Types
// ============================================================================

export type MemoryTier = "core" | "contextual" | "archival";

export type MemoryNode = {
  id: string;
  title: string;
  keywords: string[];
  tier: MemoryTier;
  content: string;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number;
};

export type MemoryIndex = {
  version: 1;
  nodes: Record<string, MemoryIndexEntry>;
  keywordMap: Record<string, string[]>; // keyword -> nodeIds
};

export type MemoryIndexEntry = {
  id: string;
  title: string;
  keywords: string[];
  tier: MemoryTier;
  filePath: string;
  createdAt: number;
  updatedAt: number;
};

export type CoreMemoryConfig = {
  enabled?: boolean;
  indexPath?: string;
  nodesDir?: string;
  maxTokens?: number;
  tiers?: MemoryTier[];
  autoCreate?: boolean;
  coreKeywords?: string[]; // Always inject these keywords
};

export type MemoryInjectionResult = {
  injected: boolean;
  nodes: MemoryNode[];
  totalTokens: number;
  matchedKeywords: string[];
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_INDEX_PATH = "memory/index.md";
const DEFAULT_NODES_DIR = "memory/nodes";
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_TIERS: MemoryTier[] = ["core", "contextual"];

// Approximate tokens per character (conservative estimate)
const CHARS_PER_TOKEN = 4;

// ============================================================================
// Memory Index Operations
// ============================================================================

/**
 * Parse memory index from markdown file
 */
export async function loadMemoryIndex(indexPath: string): Promise<MemoryIndex | null> {
  try {
    const content = await fs.readFile(indexPath, "utf-8");
    return parseMemoryIndexMarkdown(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Parse memory index from markdown format
 *
 * Expected format:
 * ```
 * # Memory Index
 *
 * ## Core Memories
 * - [user_preferences](nodes/user_preferences.md) - keywords: preferences, settings, config
 * - [identity](nodes/identity.md) - keywords: name, who am i, identity
 *
 * ## Contextual Memories
 * - [max_the_dog](nodes/max_the_dog.md) - keywords: Max, dog, pet, golden retriever
 * ```
 */
function parseMemoryIndexMarkdown(content: string): MemoryIndex {
  const index: MemoryIndex = {
    version: 1,
    nodes: {},
    keywordMap: {},
  };

  let currentTier: MemoryTier = "contextual";
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect tier headers
    if (trimmed.toLowerCase().includes("## core")) {
      currentTier = "core";
      continue;
    }
    if (trimmed.toLowerCase().includes("## contextual")) {
      currentTier = "contextual";
      continue;
    }
    if (trimmed.toLowerCase().includes("## archival")) {
      currentTier = "archival";
      continue;
    }

    // Parse node entries: - [title](path) - keywords: k1, k2, k3
    const nodeMatch = trimmed.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)\s*-?\s*keywords?:\s*(.+)$/i);
    if (nodeMatch) {
      const title = nodeMatch[1].trim();
      const filePath = nodeMatch[2].trim();
      const keywordsStr = nodeMatch[3].trim();
      const keywords = keywordsStr.split(",").map((k) => k.trim().toLowerCase());

      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "_");

      const entry: MemoryIndexEntry = {
        id,
        title,
        keywords,
        tier: currentTier,
        filePath,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      index.nodes[id] = entry;

      // Build keyword map
      for (const keyword of keywords) {
        if (!index.keywordMap[keyword]) {
          index.keywordMap[keyword] = [];
        }
        if (!index.keywordMap[keyword].includes(id)) {
          index.keywordMap[keyword].push(id);
        }
      }
    }
  }

  return index;
}

/**
 * Save memory index to markdown file
 */
export async function saveMemoryIndex(indexPath: string, index: MemoryIndex): Promise<void> {
  const markdown = serializeMemoryIndexToMarkdown(index);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, markdown, "utf-8");
}

function serializeMemoryIndexToMarkdown(index: MemoryIndex): string {
  const lines: string[] = [
    "# Memory Index",
    "",
    "> Auto-generated by Core Memory System. Edit with care.",
    "",
  ];

  const tiers: MemoryTier[] = ["core", "contextual", "archival"];

  for (const tier of tiers) {
    const nodes = Object.values(index.nodes).filter((n) => n.tier === tier);
    if (nodes.length === 0) continue;

    lines.push(`## ${tier.charAt(0).toUpperCase() + tier.slice(1)} Memories`);
    lines.push("");

    for (const node of nodes) {
      lines.push(`- [${node.title}](${node.filePath}) - keywords: ${node.keywords.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Memory Node Operations
// ============================================================================

/**
 * Load a memory node from disk
 */
export async function loadMemoryNode(
  workspaceDir: string,
  entry: MemoryIndexEntry,
): Promise<MemoryNode | null> {
  const nodePath = path.join(workspaceDir, entry.filePath);

  try {
    const content = await fs.readFile(nodePath, "utf-8");
    return {
      id: entry.id,
      title: entry.title,
      keywords: entry.keywords,
      tier: entry.tier,
      content,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      accessCount: 0,
      lastAccessedAt: Date.now(),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Create a new memory node
 */
export async function createMemoryNode(params: {
  workspaceDir: string;
  indexPath: string;
  title: string;
  keywords: string[];
  content: string;
  tier?: MemoryTier;
}): Promise<MemoryNode> {
  const { workspaceDir, indexPath, title, keywords, content, tier = "contextual" } = params;

  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const filePath = path.join(DEFAULT_NODES_DIR, `${id}.md`);
  const fullPath = path.join(workspaceDir, filePath);

  // Write node content
  const nodeContent = [
    `# ${title}`,
    "",
    `> Keywords: ${keywords.join(", ")}`,
    `> Created: ${new Date().toISOString()}`,
    "",
    content,
  ].join("\n");

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, nodeContent, "utf-8");

  // Update index
  const index = (await loadMemoryIndex(path.join(workspaceDir, indexPath))) || {
    version: 1,
    nodes: {},
    keywordMap: {},
  };

  const entry: MemoryIndexEntry = {
    id,
    title,
    keywords: keywords.map((k) => k.toLowerCase()),
    tier,
    filePath,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  index.nodes[id] = entry;

  // Update keyword map
  for (const keyword of entry.keywords) {
    if (!index.keywordMap[keyword]) {
      index.keywordMap[keyword] = [];
    }
    if (!index.keywordMap[keyword].includes(id)) {
      index.keywordMap[keyword].push(id);
    }
  }

  await saveMemoryIndex(path.join(workspaceDir, indexPath), index);

  return {
    id,
    title,
    keywords: entry.keywords,
    tier,
    content: nodeContent,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    accessCount: 0,
    lastAccessedAt: Date.now(),
  };
}

// ============================================================================
// Memory Injection
// ============================================================================

/**
 * Extract keywords from conversation context
 */
function extractKeywordsFromContext(text: string): string[] {
  // Normalize and tokenize
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Also extract multi-word phrases (2-3 words)
  const phrases: string[] = [];
  const wordList = words.slice();
  for (let i = 0; i < wordList.length - 1; i++) {
    phrases.push(`${wordList[i]} ${wordList[i + 1]}`);
    if (i < wordList.length - 2) {
      phrases.push(`${wordList[i]} ${wordList[i + 1]} ${wordList[i + 2]}`);
    }
  }

  return [...new Set([...words, ...phrases])];
}

/**
 * Find matching memory nodes based on keywords
 */
export function findMatchingNodes(
  index: MemoryIndex,
  keywords: string[],
  tiers: MemoryTier[],
): { entries: MemoryIndexEntry[]; matchedKeywords: string[] } {
  const matchedNodeIds = new Set<string>();
  const matchedKeywords: string[] = [];

  // Always include core tier nodes
  if (tiers.includes("core")) {
    for (const node of Object.values(index.nodes)) {
      if (node.tier === "core") {
        matchedNodeIds.add(node.id);
      }
    }
  }

  // Find keyword matches
  for (const keyword of keywords) {
    const nodeIds = index.keywordMap[keyword];
    if (nodeIds) {
      for (const nodeId of nodeIds) {
        const node = index.nodes[nodeId];
        if (node && tiers.includes(node.tier)) {
          matchedNodeIds.add(nodeId);
          if (!matchedKeywords.includes(keyword)) {
            matchedKeywords.push(keyword);
          }
        }
      }
    }

    // Also check partial matches (keyword contains or is contained in index keyword)
    for (const [indexKeyword, nodeIds] of Object.entries(index.keywordMap)) {
      if (indexKeyword.includes(keyword) || keyword.includes(indexKeyword)) {
        for (const nodeId of nodeIds) {
          const node = index.nodes[nodeId];
          if (node && tiers.includes(node.tier)) {
            matchedNodeIds.add(nodeId);
            if (!matchedKeywords.includes(indexKeyword)) {
              matchedKeywords.push(indexKeyword);
            }
          }
        }
      }
    }
  }

  const entries = Array.from(matchedNodeIds)
    .map((id) => index.nodes[id])
    .filter((n): n is MemoryIndexEntry => n !== undefined);

  return { entries, matchedKeywords };
}

/**
 * Main injection function - call this at session start
 */
export async function injectMemories(params: {
  workspaceDir: string;
  conversationContext: string;
  config?: CoreMemoryConfig;
}): Promise<MemoryInjectionResult> {
  const { workspaceDir, conversationContext, config = {} } = params;

  const indexPath = path.join(workspaceDir, config.indexPath || DEFAULT_INDEX_PATH);
  const maxTokens = config.maxTokens || DEFAULT_MAX_TOKENS;
  const tiers = config.tiers || DEFAULT_TIERS;

  // Load index
  const index = await loadMemoryIndex(indexPath);
  if (!index || Object.keys(index.nodes).length === 0) {
    return {
      injected: false,
      nodes: [],
      totalTokens: 0,
      matchedKeywords: [],
    };
  }

  // Extract keywords from context
  const contextKeywords = extractKeywordsFromContext(conversationContext);
  const coreKeywords = config.coreKeywords || [];
  const allKeywords = [...new Set([...contextKeywords, ...coreKeywords])];

  // Find matching nodes
  const { entries, matchedKeywords } = findMatchingNodes(index, allKeywords, tiers);

  if (entries.length === 0) {
    return {
      injected: false,
      nodes: [],
      totalTokens: 0,
      matchedKeywords: [],
    };
  }

  // Load nodes, respecting token budget
  const nodes: MemoryNode[] = [];
  let totalChars = 0;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  // Sort by tier (core first) then by update time
  const sortedEntries = entries.sort((a, b) => {
    const tierOrder = { core: 0, contextual: 1, archival: 2 };
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.updatedAt - a.updatedAt;
  });

  for (const entry of sortedEntries) {
    const node = await loadMemoryNode(workspaceDir, entry);
    if (!node) continue;

    const nodeChars = node.content.length;
    if (totalChars + nodeChars > maxChars && nodes.length > 0) {
      // Budget exceeded, stop loading more
      break;
    }

    nodes.push(node);
    totalChars += nodeChars;
  }

  return {
    injected: nodes.length > 0,
    nodes,
    totalTokens: Math.ceil(totalChars / CHARS_PER_TOKEN),
    matchedKeywords,
  };
}

// ============================================================================
// Memory Formatting for Injection
// ============================================================================

/**
 * Format memories for system prompt injection
 */
export function formatMemoriesForPrompt(nodes: MemoryNode[]): string {
  if (nodes.length === 0) return "";

  const lines: string[] = ["", "=== LONG-TERM MEMORY (Auto-Injected) ===", ""];

  for (const node of nodes) {
    lines.push(`### ${node.title}`);
    lines.push(`[Keywords: ${node.keywords.join(", ")}]`);
    lines.push("");
    lines.push(node.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("=== END MEMORY ===");
  lines.push("");

  return lines.join("\n");
}

// ============================================================================
// Config Resolution
// ============================================================================

export function resolveMemoryConfig(cfg?: OpenClawConfig): CoreMemoryConfig {
  const defaults = cfg?.agents?.defaults;
  if (!defaults || typeof defaults !== "object") {
    return {};
  }

  // Check for memory config (custom extension)
  const memory =
    "memory" in defaults ? (defaults as { memory?: CoreMemoryConfig }).memory : undefined;
  return memory || {};
}

export function isMemoryInjectionEnabled(cfg?: OpenClawConfig): boolean {
  const memoryConfig = resolveMemoryConfig(cfg);
  // Enabled by default in Dex Edition
  return memoryConfig.enabled !== false;
}
