import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../tools/common.js";
import { jsonResult, readNumberParam } from "../tools/common.js";
import { runSearxSearch } from "../tools/searx-search.js";

const TECH_NEWS_SOURCES = ["Hacker News", "The Verge", "TechCrunch", "Ars Technica"];

const TechNewsSchema = Type.Object({
  count: Type.Optional(
    Type.Number({
      description: "Number of stories to fetch per source (default 3)",
      minimum: 1,
      maximum: 10,
    }),
  ),
});

export function createTechNewsTool(): AnyAgentTool {
  return {
    name: "tech_news_monitor",
    label: "Tech News Monitor",
    description:
      "Fetches and summarizes the latest top tech news from major sources using local SearXNG. Use this to generate a morning briefing or periodic update.",
    parameters: TechNewsSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const count = readNumberParam(params, "count") ?? 3;

      const results: Record<string, any[]> = {};

      for (const source of TECH_NEWS_SOURCES) {
        try {
          // Use local SearXNG for tech news monitoring
          const searchRes = await runSearxSearch({
            query: `latest top news stories from ${source} today`,
            count: count,
            baseUrl: "http://127.0.0.1:8080", // Local SearXNG
            timeoutSeconds: 30,
            cacheTtlMs: 300 * 1000,
          });

          // @ts-ignore
          results[source] = searchRes.results || [];
        } catch (err: unknown) {
          results[source] = [
            {
              error: `Failed to fetch from SearX: ${err instanceof Error ? err.message : String(err)}`,
            },
          ];
        }
      }

      return jsonResult({
        ok: true,
        timestamp: new Date().toISOString(),
        sources: results,
        summary_instruction:
          "Please summarize these headlines into a concise markdown bulleted list for the user.",
      });
    },
  };
}
