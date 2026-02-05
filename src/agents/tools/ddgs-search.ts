/**
 * DuckDuckGo Search Provider for OpenClaw
 *
 * Free web search using DDGS (DuckDuckGo Search) - no API key required!
 *
 * This file should be placed at: src/agents/tools/ddgs-search.ts
 * And imported in: src/agents/tools/web-search.ts
 *
 * Usage in config:
 *   tools.web.search.provider: "ddgs"
 *   tools.web.search.backend: "duckduckgo" | "bing" | "google" | "mojeek"
 */

import type { OpenClawConfig } from "../../config/config.js";
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from "./web-shared.js";

// DDGS doesn't have an official npm package, so we use the HTML scraping approach
// Similar to the Python ddgs library but in TypeScript

const DDGS_SEARCH_URL = "https://html.duckduckgo.com/html/";
const DDGS_CACHE = new Map<string, CacheEntry<DDGSSearchResult>>();

export type DDGSBackend = "duckduckgo" | "bing" | "google" | "mojeek" | "yandex";

export type DDGSSearchResult = {
  query: string;
  results: Array<{
    title: string;
    url: string;
    description: string;
  }>;
  tookMs: number;
  cached?: boolean;
};

export type DDGSConfig = {
  enabled?: boolean;
  backend?: DDGSBackend;
  maxResults?: number;
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
  region?: string; // e.g., "wt-wt" for worldwide, "us-en" for US English
  safesearch?: "off" | "moderate" | "strict";
};

/**
 * Extract search results from DuckDuckGo HTML response
 */
function parseDDGSHtml(html: string): Array<{ title: string; url: string; description: string }> {
  const results: Array<{ title: string; url: string; description: string }> = [];

  // DuckDuckGo HTML search returns results in <div class="result"> elements
  // This is a simplified parser - in production, use a proper HTML parser

  // Match result blocks
  const resultPattern =
    /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/gi;
  const matches = html.matchAll(resultPattern);

  for (const match of matches) {
    const block = match[1] || "";

    // Extract title and URL from <a class="result__a">
    const titleMatch = block.match(
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/i,
    );
    const title = titleMatch?.[2]?.trim() || "";
    let url = titleMatch?.[1]?.trim() || "";

    // DuckDuckGo returns redirect URLs, extract actual URL
    if (url.includes("uddg=")) {
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        url = decodeURIComponent(uddgMatch[1]);
      }
    }

    // Extract description from <a class="result__snippet">
    const descMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    let description = descMatch?.[1]?.trim() || "";
    // Strip HTML tags from description
    description = description.replace(/<[^>]+>/g, "").trim();

    if (title && url) {
      results.push({ title, url, description });
    }
  }

  return results;
}

/**
 * Perform DuckDuckGo search via HTML scraping
 */
export async function runDDGSSearch(params: {
  query: string;
  count: number;
  timeoutSeconds: number;
  cacheTtlMs: number;
  region?: string;
  safesearch?: "off" | "moderate" | "strict";
}): Promise<DDGSSearchResult> {
  const cacheKey = normalizeCacheKey(
    `ddgs:${params.query}:${params.count}:${params.region || "wt-wt"}:${params.safesearch || "moderate"}`,
  );

  const cached = readCache(DDGS_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const start = Date.now();

  // Build form data for POST request
  const formData = new URLSearchParams();
  formData.append("q", params.query);
  formData.append("b", ""); // Start at first result
  if (params.region) {
    formData.append("kl", params.region);
  }

  // Safesearch: -2 = off, -1 = moderate, 1 = strict
  const safesearchMap = { off: "-2", moderate: "-1", strict: "1" };
  formData.append("p", safesearchMap[params.safesearch || "moderate"]);

  const response = await withTimeout(
    fetch(DDGS_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: formData.toString(),
    }),
    params.timeoutSeconds * 1000,
  );

  if (!response.ok) {
    throw new Error(`DDGS search failed (${response.status}): ${response.statusText}`);
  }

  const html = await response.text();
  const allResults = parseDDGSHtml(html);
  const results = allResults.slice(0, params.count);

  const payload: DDGSSearchResult = {
    query: params.query,
    results,
    tookMs: Date.now() - start,
  };

  writeCache(DDGS_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

/**
 * Resolve DDGS config from OpenClaw config
 */
export function resolveDDGSConfig(cfg?: OpenClawConfig): DDGSConfig {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") {
    return {};
  }

  // Check if ddgs-specific config exists
  const ddgs = "ddgs" in search ? (search as { ddgs?: DDGSConfig }).ddgs : undefined;
  return ddgs || {};
}

/**
 * Check if DDGS provider is configured
 */
export function isDDGSProvider(cfg?: OpenClawConfig): boolean {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") {
    return false;
  }
  const provider = "provider" in search ? (search as { provider?: string }).provider : undefined;
  return provider?.toLowerCase() === "ddgs" || provider?.toLowerCase() === "duckduckgo";
}

/**
 * Create DDGS search tool (to be merged into web-tools.ts)
 */
export function createDDGSSearchConfig(cfg?: OpenClawConfig) {
  const ddgsCfg = resolveDDGSConfig(cfg);
  return {
    maxResults: ddgsCfg.maxResults ?? 5,
    timeoutSeconds: resolveTimeoutSeconds(ddgsCfg.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
    cacheTtlMs: resolveCacheTtlMs(ddgsCfg.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
    region: ddgsCfg.region ?? "wt-wt",
    safesearch: ddgsCfg.safesearch ?? "moderate",
  };
}
