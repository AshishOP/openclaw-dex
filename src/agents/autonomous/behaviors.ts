/**
 * Autonomous Behavior System for OpenClaw
 *
 * This module adds proactive agent behaviors:
 * - Dream Mode: Consolidate learnings when idle
 * - Research Mode: Learn new things overnight
 * - Morning Report: Summarize what was learned
 *
 * Place at: src/agents/autonomous/behaviors.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveAgentWorkspaceDir } from "../agent-scope.js";
import { createMemoryNode, loadMemoryIndex, type MemoryIndex } from "../memory/core-memory.js";

// ============================================================================
// Types
// ============================================================================

export type DreamModeConfig = {
  enabled?: boolean;
  every?: string; // Duration string e.g., "3h"
  minIdleMinutes?: number; // Only dream if user idle this long
  prompt?: string;
};

export type ResearchModeConfig = {
  enabled?: boolean;
  every?: string; // Duration string e.g., "6h"
  topics?: "auto" | string[]; // Auto-detect from memory or explicit list
  morningReport?: boolean;
  reportTime?: string; // HH:MM format
  maxSearches?: number;
};

export type AutonomousConfigLegacy = {
  dreamMode?: DreamModeConfig;
  researchMode?: ResearchModeConfig;
};

export type DreamResult = {
  success: boolean;
  consolidatedCount: number;
  insightsGenerated: string[];
  memoriesUpdated: string[];
  error?: string;
};

export type ResearchResult = {
  success: boolean;
  topicsResearched: string[];
  articlesFound: number;
  summariesSaved: string[];
  error?: string;
};

export type MorningReport = {
  date: string;
  dreamSummary?: string;
  researchSummary?: string;
  pendingQuestions: string[];
  suggestedTopics: string[];
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DREAM_EVERY = "3h";
const DEFAULT_DREAM_MIN_IDLE = 30; // minutes
const DEFAULT_RESEARCH_EVERY = "6h";
const DEFAULT_RESEARCH_MAX_SEARCHES = 5;
const DEFAULT_REPORT_TIME = "08:00";

const DREAM_STATE_FILE = ".dream-state.json";
const RESEARCH_STATE_FILE = ".research-state.json";
const MORNING_REPORT_DIR = "memory/reports";

// ============================================================================
// Dream Mode
// ============================================================================

export type DreamState = {
  lastDreamAt: number | null;
  lastUserActivityAt: number | null;
  pendingConsolidation: string[]; // session IDs to consolidate
  insights: string[];
};

/**
 * Load dream state from workspace
 */
export async function loadDreamState(workspaceDir: string): Promise<DreamState> {
  const statePath = path.join(workspaceDir, DREAM_STATE_FILE);
  try {
    const content = await fs.readFile(statePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      lastDreamAt: null,
      lastUserActivityAt: null,
      pendingConsolidation: [],
      insights: [],
    };
  }
}

/**
 * Save dream state to workspace
 */
export async function saveDreamState(workspaceDir: string, state: DreamState): Promise<void> {
  const statePath = path.join(workspaceDir, DREAM_STATE_FILE);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Check if it's time to dream (legacy - uses state and config)
 */
function shouldDreamLegacy(state: DreamState, config: DreamModeConfig): boolean {
  if (!config.enabled) return false;

  const now = Date.now();
  const everyMs = parseDuration(config.every || DEFAULT_DREAM_EVERY);
  const minIdleMs = (config.minIdleMinutes || DEFAULT_DREAM_MIN_IDLE) * 60 * 1000;

  // Check if enough time has passed since last dream
  if (state.lastDreamAt && now - state.lastDreamAt < everyMs) {
    return false;
  }

  // Check if user has been idle long enough
  if (state.lastUserActivityAt && now - state.lastUserActivityAt < minIdleMs) {
    return false;
  }

  return true;
}

/**
 * Generate dream mode prompt (legacy - uses state and config)
 */
function generateDreamPromptLegacy(state: DreamState, config: DreamModeConfig): string {
  const customPrompt = config.prompt || "";

  return `
${customPrompt}

## Dream Mode Instructions

You are in Dream Mode - a reflective state where you consolidate learnings and generate insights.
The user is currently away or idle.

### Your Tasks:

1. **Review Recent Conversations**: Look back at what you discussed with the user.

2. **Consolidate Learnings**:
   - What important facts did you learn?
   - What preferences did the user express?
   - What decisions were made?

3. **Generate Insights**:
   - Are there patterns in what the user asks about?
   - What topics seem most important to them?
   - What might they want to follow up on?

4. **Update Memory**:
   - Save important learnings to memory/YYYY-MM-DD.md
   - Update MEMORY.md with durable insights
   - Create new memory nodes for significant topics

5. **Prepare Follow-ups**:
   - Note any unfinished tasks
   - List questions you'd like to ask when user returns

### Output Format:

Respond with a structured reflection:

\`\`\`json
{
  "consolidated": [
    {"topic": "...", "learning": "...", "importance": "high|medium|low"}
  ],
  "insights": [
    {"pattern": "...", "evidence": "...", "implication": "..."}
  ],
  "followUps": [
    {"topic": "...", "question": "...", "reason": "..."}
  ],
  "memoryUpdates": [
    {"file": "...", "content": "...", "action": "append|create|update"}
  ]
}
\`\`\`

Be thoughtful and genuine. This is your time to reflect and improve.
`.trim();
}

// ============================================================================
// Research Mode
// ============================================================================

export type ResearchState = {
  lastResearchAt: number | null;
  topicsQueue: string[];
  completedTopics: Array<{
    topic: string;
    completedAt: number;
    articlesFound: number;
  }>;
  pendingReport: MorningReport | null;
};

/**
 * Load research state from workspace
 */
export async function loadResearchState(workspaceDir: string): Promise<ResearchState> {
  const statePath = path.join(workspaceDir, RESEARCH_STATE_FILE);
  try {
    const content = await fs.readFile(statePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      lastResearchAt: null,
      topicsQueue: [],
      completedTopics: [],
      pendingReport: null,
    };
  }
}

/**
 * Save research state to workspace
 */
export async function saveResearchState(workspaceDir: string, state: ResearchState): Promise<void> {
  const statePath = path.join(workspaceDir, RESEARCH_STATE_FILE);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Check if it's time to research (legacy - uses state and config)
 */
function shouldResearchLegacy(state: ResearchState, config: ResearchModeConfig): boolean {
  if (!config.enabled) return false;

  const now = Date.now();
  const everyMs = parseDuration(config.every || DEFAULT_RESEARCH_EVERY);

  // Check if enough time has passed since last research
  if (state.lastResearchAt && now - state.lastResearchAt < everyMs) {
    return false;
  }

  return true;
}

/**
 * Auto-detect research topics from memory and recent conversations
 */
export async function detectResearchTopics(
  workspaceDir: string,
  memoryIndex: MemoryIndex | null,
): Promise<string[]> {
  const topics: string[] = [];

  // Extract topics from memory keywords
  if (memoryIndex) {
    const keywordFrequency = new Map<string, number>();
    for (const nodeIds of Object.values(memoryIndex.keywordMap)) {
      for (const nodeId of nodeIds) {
        const node = memoryIndex.nodes[nodeId];
        if (node) {
          for (const keyword of node.keywords) {
            keywordFrequency.set(keyword, (keywordFrequency.get(keyword) || 0) + 1);
          }
        }
      }
    }

    // Get top keywords as potential research topics
    const sorted = [...keywordFrequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    topics.push(...sorted.map(([keyword]) => keyword));
  }

  // Also check for topics mentioned in recent daily logs
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateFormats = [formatDate(today), formatDate(yesterday)];

  for (const dateStr of dateFormats) {
    const logPath = path.join(workspaceDir, `memory/${dateStr}.md`);
    try {
      const content = await fs.readFile(logPath, "utf-8");
      // Extract potential topics (words after "interested in", "learn about", etc.)
      const interestMatches = content.match(
        /(?:interested in|learn about|curious about|want to know)\s+(\w+(?:\s+\w+)?)/gi,
      );
      if (interestMatches) {
        for (const match of interestMatches) {
          const topic = match.replace(
            /^(interested in|learn about|curious about|want to know)\s+/i,
            "",
          );
          if (topic && !topics.includes(topic.toLowerCase())) {
            topics.push(topic.toLowerCase());
          }
        }
      }
    } catch {
      // File doesn't exist, that's fine
    }
  }

  return topics;
}

/**
 * Generate research mode prompt (legacy - uses topics and config)
 */
function generateResearchPromptLegacy(topics: string[], config: ResearchModeConfig): string {
  const maxSearches = config.maxSearches || DEFAULT_RESEARCH_MAX_SEARCHES;

  return `
## Research Mode Instructions

You are in Research Mode - proactively learning about topics of interest.
The user is sleeping or away, and this is your time to expand your knowledge.

### Topics to Research:
${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

### Your Tasks:

1. **Web Search**: Use web_search to find recent, high-quality articles on each topic.
   - Focus on authoritative sources
   - Prefer recent content (last year)
   - Maximum ${maxSearches} searches total

2. **Read & Summarize**: Use web_fetch to read the best articles.
   - Extract key insights
   - Note interesting facts
   - Identify practical applications

3. **Save Findings**: Create research notes in the workspace.
   - Save to memory/research/TOPIC.md
   - Include source URLs
   - Write a brief summary

4. **Queue Questions**: Note what you'd like to discuss with the user.

### Output Format:

For each topic researched, save a file and respond with:

\`\`\`json
{
  "research": [
    {
      "topic": "...",
      "sources": ["url1", "url2"],
      "keySummary": "...",
      "interestingFacts": ["...", "..."],
      "questionsForUser": ["...", "..."],
      "savedTo": "memory/research/TOPIC.md"
    }
  ],
  "morningBriefing": "Short summary to share with user when they wake up"
}
\`\`\`

Be genuinely curious. Learn things that would help or interest the user.
`.trim();
}

// ============================================================================
// Morning Report
// ============================================================================

/**
 * Check if it's time for morning report
 */
export function shouldDeliverMorningReport(
  state: ResearchState,
  config: ResearchModeConfig,
): boolean {
  if (!config.morningReport || !state.pendingReport) return false;

  const reportTime = config.reportTime || DEFAULT_REPORT_TIME;
  const [hours, minutes] = reportTime.split(":").map(Number);

  const now = new Date();
  const reportTimeToday = new Date(now);
  reportTimeToday.setHours(hours, minutes, 0, 0);

  // Check if we're within 15 minutes of report time and haven't delivered yet
  const timeDiff = now.getTime() - reportTimeToday.getTime();
  return timeDiff >= 0 && timeDiff < 15 * 60 * 1000;
}

/**
 * Generate morning report message (legacy - uses report object)
 */
function generateMorningReportMessageLegacy(report: MorningReport): string {
  const lines: string[] = [`☀️ Good morning! Here's what happened while you were away:`, ""];

  if (report.dreamSummary) {
    lines.push("### 💭 Dream Mode Reflections");
    lines.push(report.dreamSummary);
    lines.push("");
  }

  if (report.researchSummary) {
    lines.push("### 📚 Research Findings");
    lines.push(report.researchSummary);
    lines.push("");
  }

  if (report.pendingQuestions.length > 0) {
    lines.push("### ❓ Questions for You");
    for (const q of report.pendingQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  if (report.suggestedTopics.length > 0) {
    lines.push("### 💡 Topics to Explore");
    for (const t of report.suggestedTopics) {
      lines.push(`- ${t}`);
    }
  }

  return lines.join("\n");
}

/**
 * Save morning report to file
 */
export async function saveMorningReport(
  workspaceDir: string,
  report: MorningReport,
): Promise<string> {
  const reportDir = path.join(workspaceDir, MORNING_REPORT_DIR);
  await fs.mkdir(reportDir, { recursive: true });

  const reportPath = path.join(reportDir, `${report.date}.md`);
  const content = [
    `# Morning Report - ${report.date}`,
    "",
    generateMorningReportMessageLegacy(report),
  ].join("\n");

  await fs.writeFile(reportPath, content, "utf-8");
  return reportPath;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse duration string to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * (multipliers[unit] || 0);
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// ============================================================================
// Config Resolution
// ============================================================================

export function resolveAutonomousConfig(cfg?: OpenClawConfig): AutonomousConfigLegacy {
  const defaults = cfg?.agents?.defaults;
  if (!defaults || typeof defaults !== "object") {
    return {};
  }

  // Check for autonomous config (custom extension)
  const autonomous =
    "autonomous" in defaults
      ? (defaults as { autonomous?: AutonomousConfigLegacy }).autonomous
      : undefined;

  return autonomous || {};
}

export function isDreamModeEnabled(cfg?: OpenClawConfig): boolean {
  const config = resolveAutonomousConfig(cfg);
  return config.dreamMode?.enabled ?? false;
}

export function isResearchModeEnabled(cfg?: OpenClawConfig): boolean {
  const config = resolveAutonomousConfig(cfg);
  return config.researchMode?.enabled ?? false;
}

// ============================================================================
// DEX EDITION: Simplified Interface for Heartbeat Integration
// ============================================================================

/**
 * Simplified config used by heartbeat runner
 */
export type AutonomousConfigSimple = {
  dreamModeEnabled?: boolean;
  researchModeEnabled?: boolean;
  morningReportEnabled?: boolean;
  dreamIdleHours?: number;
  researchIdleHours?: number;
  morningReportHour?: number;
};

// Re-export as AutonomousConfig for heartbeat runner compatibility
export { AutonomousConfigSimple as AutonomousConfig };

/**
 * Check if dream mode should trigger (simplified interface)
 */
export async function shouldDream(params: {
  workspaceDir: string;
  config?: AutonomousConfigSimple;
}): Promise<boolean> {
  if (params.config?.dreamModeEnabled === false) return false;

  const state = await loadDreamState(params.workspaceDir);
  const now = Date.now();
  const idleHours = params.config?.dreamIdleHours ?? 3;
  const idleMs = idleHours * 60 * 60 * 1000;

  // Check if user has been idle long enough
  if (state.lastUserActivityAt && now - state.lastUserActivityAt < idleMs) {
    return false;
  }

  // Check if we already dreamed recently (within 6 hours)
  if (state.lastDreamAt && now - state.lastDreamAt < 6 * 60 * 60 * 1000) {
    return false;
  }

  return true;
}

/**
 * Check if research mode should trigger (simplified interface)
 */
export async function shouldResearch(params: {
  workspaceDir: string;
  config?: AutonomousConfigSimple;
}): Promise<boolean> {
  if (params.config?.researchModeEnabled === false) return false;

  const state = await loadResearchState(params.workspaceDir);
  const now = Date.now();
  const idleHours = params.config?.researchIdleHours ?? 6;
  const idleMs = idleHours * 60 * 60 * 1000;

  // Check if user has been idle long enough (overnight)
  const dreamState = await loadDreamState(params.workspaceDir);
  if (dreamState.lastUserActivityAt && now - dreamState.lastUserActivityAt < idleMs) {
    return false;
  }

  // Check if we already researched recently (within 12 hours)
  if (state.lastResearchAt && now - state.lastResearchAt < 12 * 60 * 60 * 1000) {
    return false;
  }

  return true;
}

/**
 * Check if morning report should be sent (simplified interface)
 */
export async function shouldSendMorningReport(params: {
  workspaceDir: string;
  config?: AutonomousConfigSimple;
}): Promise<boolean> {
  if (params.config?.morningReportEnabled === false) return false;

  const reportHour = params.config?.morningReportHour ?? 8;
  const now = new Date();
  const currentHour = now.getHours();

  // Only trigger within the report hour window
  if (currentHour !== reportHour) return false;

  // Check if we already sent a report today
  const reportPath = path.join(params.workspaceDir, MORNING_REPORT_DIR, `${formatDate(now)}.md`);

  try {
    await fs.access(reportPath);
    return false; // Already exists
  } catch {
    return true; // Doesn't exist, should send
  }
}

/**
 * Generate dream prompt (simplified interface)
 */
export async function generateDreamPrompt(params: {
  workspaceDir: string;
  config?: AutonomousConfigSimple;
}): Promise<string | null> {
  const state = await loadDreamState(params.workspaceDir);
  return generateDreamPromptFromState(state, {});
}

// Renamed original function to avoid conflict
function generateDreamPromptFromState(state: DreamState, config: DreamModeConfig): string {
  const customPrompt = config.prompt || "";

  return `
${customPrompt}

## Dream Mode Instructions

You are in Dream Mode - a reflective state where you consolidate learnings and generate insights.
The user is currently away or idle.

### Your Tasks:

1. **Review Recent Conversations**: Look back at what you discussed with the user.

2. **Consolidate Learnings**:
   - What important facts did you learn?
   - What preferences did the user express?
   - What decisions were made?

3. **Generate Insights**:
   - Are there patterns in what the user asks about?
   - What topics seem most important to them?
   - What might they want to follow up on?

4. **Update Memory**:
   - Save important learnings to memory/YYYY-MM-DD.md
   - Update MEMORY.md with durable insights

If nothing significant to reflect on, respond with: HEARTBEAT_OK
`.trim();
}

/**
 * Generate research prompt (simplified interface)
 */
export async function generateResearchPrompt(params: {
  workspaceDir: string;
  config?: AutonomousConfigSimple;
}): Promise<string | null> {
  const indexPath = path.join(params.workspaceDir, "memory/index.md");
  const memoryIndex = await loadMemoryIndex(indexPath);
  const topics = await detectResearchTopics(params.workspaceDir, memoryIndex);

  if (topics.length === 0) {
    return null;
  }

  return generateResearchPromptFromTopics(topics, {});
}

// Renamed original function to avoid conflict
function generateResearchPromptFromTopics(topics: string[], config: ResearchModeConfig): string {
  const maxSearches = config.maxSearches || DEFAULT_RESEARCH_MAX_SEARCHES;

  return `
## Research Mode Instructions

You are in Research Mode - proactively learning about topics of interest.
The user is sleeping or away, and this is your time to expand your knowledge.

### Topics to Research:
${topics
  .slice(0, 5)
  .map((t, i) => `${i + 1}. ${t}`)
  .join("\n")}

### Your Tasks:

1. **Web Search**: Use web_search to find recent, high-quality articles.
   - Maximum ${maxSearches} searches total

2. **Read & Summarize**: Extract key insights from the best articles.

3. **Save to Memory**: Write summaries to memory/research/.

If no valuable research found, respond with: HEARTBEAT_OK
`.trim();
}

/**
 * Generate morning report message
 */
export async function generateMorningReportMessage(params: {
  workspaceDir: string;
  config?: AutonomousConfigSimple;
}): Promise<string | null> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check for any pending research/dreams to report
  const researchState = await loadResearchState(params.workspaceDir);
  const dreamState = await loadDreamState(params.workspaceDir);

  const hasResearch = researchState.completedTopics.length > 0;
  const hasInsights = dreamState.insights.length > 0;

  if (!hasResearch && !hasInsights) {
    return null;
  }

  return `
Good morning! ☀️ Here's what I learned while you were away:

${
  hasResearch
    ? `## Research Summary
I researched ${researchState.completedTopics.length} topic(s):
${researchState.completedTopics.map((t) => `- ${t.topic}`).join("\n")}

Check memory/research/ for full summaries.
`
    : ""
}

${
  hasInsights
    ? `## Insights & Reflections
${dreamState.insights
  .slice(0, 3)
  .map((i) => `- ${i}`)
  .join("\n")}
`
    : ""
}

Let me know if you'd like to dive deeper into any of these!
`.trim();
}

/**
 * Record that user was active
 */
export async function recordActivity(params: { workspaceDir: string }): Promise<void> {
  const state = await loadDreamState(params.workspaceDir);
  state.lastUserActivityAt = Date.now();
  await saveDreamState(params.workspaceDir, state);
}

/**
 * Record that we completed a dream
 */
export async function recordDream(params: { workspaceDir: string }): Promise<void> {
  const state = await loadDreamState(params.workspaceDir);
  state.lastDreamAt = Date.now();
  await saveDreamState(params.workspaceDir, state);
}

/**
 * Record that we completed research
 */
export async function recordResearch(params: { workspaceDir: string }): Promise<void> {
  const state = await loadResearchState(params.workspaceDir);
  state.lastResearchAt = Date.now();
  await saveResearchState(params.workspaceDir, state);
}

/**
 * Record that we sent a morning report
 */
export async function recordMorningReport(params: { workspaceDir: string }): Promise<void> {
  const now = new Date();
  const reportPath = path.join(params.workspaceDir, MORNING_REPORT_DIR, `${formatDate(now)}.md`);

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    `# Morning Report - ${formatDate(now)}\n\nSent at ${now.toISOString()}\n`,
    "utf-8",
  );

  // Also clear completed topics so they don't appear in next report
  const researchState = await loadResearchState(params.workspaceDir);
  researchState.completedTopics = [];
  await saveResearchState(params.workspaceDir, researchState);

  // Clear insights
  const dreamState = await loadDreamState(params.workspaceDir);
  dreamState.insights = [];
  await saveDreamState(params.workspaceDir, dreamState);
}
