import axios, { AxiosInstance } from "axios";
import https from "https";
import { createComponentLogger } from "../lib/logger";

const log = createComponentLogger("memory-client");

export interface MemorySearchResult {
  id: string;
  content: string;
  category: string;
  importance?: string;
  confidence?: number;
  memory_type?: string; // "distilled" | "neuralese" — defaults to "distilled" if absent
  session_shared?: boolean;
}

// Shape returned by POST /v1/memories/search
interface MemorySearchApiResult {
  memory_id: string;
  content: string;
  category: string;
  memory_type: string;
  session_shared: boolean;
  relevance_score: number;
}

// Shape returned by GET /v1/memories?importance=critical
interface MemoryListApiResult {
  memory_id: string;
  content: string;
  category: string;
  importance: string;
}

export class MemoryClient {
  private baseUrl: string;
  private enabled: boolean;
  private axiosInstance: AxiosInstance;

  constructor() {
    this.baseUrl = process.env.MEMORY_SERVICE_URL || "";
    this.enabled = process.env.MEMORY_SERVICE_ENABLED === "true";

    const allowSelfSigned = process.env.ALLOW_SELF_SIGNED_CERTS === "true";
    this.axiosInstance = axios.create({
      httpsAgent: new https.Agent({
        rejectUnauthorized: !allowSelfSigned,
      }),
      timeout: 10000,
    });
  }

  isEnabled(): boolean {
    return this.enabled && !!this.baseUrl;
  }

  /**
   * Retrieve memories using a two-call tiered approach that mirrors the agent's
   * retrieve endpoint logic:
   *
   *   Tier 1 — Critical: ALL critical-importance memories, always included (no threshold)
   *   Tier 2 — Semantic:  remaining slots filled by semantic search (min_relevance 0.5)
   *
   * Both calls run in parallel. Results are merged and deduplicated by id.
   * Returns an empty array on any error — never throws.
   */
  async retrieveMemories(
    query: string,
    userId: string,
    requestToken?: string,
    limit?: number,
  ): Promise<MemorySearchResult[]> {
    if (!this.isEnabled()) {
      log.info(
        {
          memory_service_url: this.baseUrl || "Not Set",
          memory_service_enabled: this.enabled,
        },
        "Memory service disabled or not configured, skipping retrieval",
      );
      return [];
    }

    const effectiveLimit =
      limit ?? parseInt(process.env.MEMORY_SEARCH_LIMIT || "10", 10);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (requestToken) {
      headers["Authorization"] = `Bearer ${requestToken}`;
    }

    const [criticalResult, searchResult] = await Promise.allSettled([
      // Tier 1 — always fetch ALL critical memories unconditionally
      this.axiosInstance.get<{ data: MemoryListApiResult[] }>(
        `${this.baseUrl}/v1/memories?importance=critical&limit=50`,
        { headers },
      ),
      // Tier 2 — semantic search for contextually relevant memories
      this.axiosInstance.post<{ results: MemorySearchApiResult[] }>(
        `${this.baseUrl}/v1/memories/search`,
        { query, user_id: userId, limit: effectiveLimit, min_relevance: 0.5 },
        { headers },
      ),
    ]);

    const criticals: MemorySearchResult[] =
      criticalResult.status === "fulfilled"
        ? (criticalResult.value.data.data || []).map((m) => ({
            id: m.memory_id,
            content: m.content,
            category: m.category,
            importance: m.importance,
            confidence: 1.0,
            memory_type: "distilled",
          }))
        : (log.warn(
            { err: (criticalResult as PromiseRejectedResult).reason?.message },
            "Failed to fetch critical memories",
          ),
          []);

    const semantic: MemorySearchResult[] =
      searchResult.status === "fulfilled"
        ? (searchResult.value.data.results || []).map((r) => ({
            id: r.memory_id,
            content: r.content,
            category: r.category,
            memory_type: r.memory_type,
            session_shared: r.session_shared,
            confidence: r.relevance_score,
          }))
        : (log.warn(
            { err: (searchResult as PromiseRejectedResult).reason?.message },
            "Failed to fetch semantic memories",
          ),
          []);

    // Merge: criticals first, then semantic results not already in criticals
    const seen = new Set(criticals.map((m) => m.id));
    const merged = [...criticals, ...semantic.filter((m) => !seen.has(m.id))];

    log.debug(
      {
        critical_count: criticals.length,
        semantic_count: semantic.length,
        merged_count: merged.length,
      },
      "Memory retrieval breakdown",
    );

    return merged;
  }
}

export const memoryClient = new MemoryClient();
