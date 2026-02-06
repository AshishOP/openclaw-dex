import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../tools/common.js";
import { jsonResult, readStringParam } from "../tools/common.js";
import { withTimeout } from "../tools/web-shared.js";

const NotionSearchSchema = Type.Object({
  query: Type.String({ description: "Search query" }),
});

const NotionCreatePageSchema = Type.Object({
  databaseId: Type.String({ description: "ID of the database to add to" }),
  title: Type.String({ description: "Title of the new page" }),
  content: Type.Optional(Type.String({ description: "Markdown content body" })),
});

export function createNotionTool(opts?: { apiKey?: string }): AnyAgentTool {
  const apiKey = opts?.apiKey || process.env.NOTION_KEY;

  if (!apiKey) {
    return {
      name: "notion_placeholder",
      label: "Notion (Disabled)",
      description: "Notion integration is disabled because NOTION_KEY is missing.",
      parameters: Type.Object({}),
      execute: async () => jsonResult({ error: "Missing NOTION_KEY in .env" }),
    };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };

  return {
    name: "notion_tool",
    label: "Notion Integration",
    description:
      "Search, Read, and Write to Notion workspace. useful for project management and noting ideas.",
    parameters: Type.Union([NotionSearchSchema, NotionCreatePageSchema]),
    // Note: Simplified schema for demo, ideally utilize sub-tools or specific actions
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      // Simple action dispatch based on params
      if ("query" in params) {
        // Search
        const query = readStringParam(params, "query");
        const res = await fetch("https://api.notion.com/v1/search", {
          method: "POST",
          headers,
          body: JSON.stringify({ query, page_size: 5 }),
          signal: withTimeout(undefined, 10000),
        });
        const data = await res.json();
        return jsonResult(data);
      } else if ("databaseId" in params) {
        // Create Page
        const dbId = readStringParam(params, "databaseId");
        const title = readStringParam(params, "title");
        const body = {
          parent: { database_id: dbId },
          properties: {
            Name: {
              title: [{ text: { content: title } }],
            },
          },
        };
        const res = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: withTimeout(undefined, 10000),
        });
        const data = await res.json();
        return jsonResult(data);
      }

      return jsonResult({ error: "Unknown notion action" });
    },
  };
}
