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

const SEARX_CACHE = new Map<string, CacheEntry<SearxSearchResult>>();

export type SearxSearchResult = {
  query: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
  }>;
  tookMs: number;
  cached?: boolean;
};

export type SearxConfig = {
  baseUrl?: string; // e.g. "http://127.0.0.1:8080"
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
};

export async function runSearxSearch(params: {
  query: string;
  count: number;
  baseUrl: string; // http://localhost:8080
  timeoutSeconds: number;
  cacheTtlMs: number;
}): Promise<SearxSearchResult> {
  const cacheKey = normalizeCacheKey(`searx:${params.query}:${params.count}`);

  const cached = readCache(SEARX_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const start = Date.now();

  // Clean base URL
  const baseUrl = params.baseUrl.replace(/\/$/, "");
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", params.query);
  url.searchParams.set("format", "json");

  // Correct usage: get signal, pass to fetch
  const signal = withTimeout(undefined, params.timeoutSeconds * 1000);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`SearX search failed (${response.status}): ${response.statusText}`);
  }

  const data = (await response.json()) as { results?: Array<any> };
  const rawResults = Array.isArray(data.results) ? data.results : [];

  // Map to standard format
  const results = rawResults.slice(0, params.count).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    content: r.content || r.snippet || "",
  }));

  const payload: SearxSearchResult = {
    query: params.query,
    results,
    tookMs: Date.now() - start,
  };

  writeCache(SEARX_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

export function isSearxProvider(cfg?: OpenClawConfig): boolean {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") return false;
  // We'll treat 'provider: "searx"' as the trigger
  // @ts-ignore
  return search.provider === "searx";
}

export function resolveSearxConfig(cfg?: OpenClawConfig): SearxConfig {
  const search = cfg?.tools?.web?.search as any;
  if (!search) return {};

  // Check for 'searx' object or top-level keys if we want
  return search.searx || {};
}
