import { gateway, generateText } from "ai";
import { appConfig } from "@/app.config";

type SearchType = "auto" | "fast" | "instant";
type SearchCategory =
  | "company"
  | "people"
  | "research paper"
  | "news"
  | "personal site"
  | "financial report";

export type WebSearchInput = {
  readonly abortSignal?: AbortSignal;
  readonly query: string;
  readonly type?: string;
  readonly numResults?: number;
  readonly category?: string;
  readonly includeDomains?: readonly string[];
  readonly excludeDomains?: readonly string[];
};

function isSearchType(value: unknown): value is SearchType {
  return value === "auto" || value === "fast" || value === "instant";
}

function isSearchCategory(value: unknown): value is SearchCategory {
  return (
    value === "company" ||
    value === "people" ||
    value === "research paper" ||
    value === "news" ||
    value === "personal site" ||
    value === "financial report"
  );
}

/** Map legacy Exa types (`neural`, `keyword`, `deep`, …) onto Gateway's allowed set. */
export function coerceSearchType(value: unknown): SearchType {
  return isSearchType(value) ? value : "auto";
}

function toolCallInput(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function sanitizeSearchArgs(
  raw: Record<string, unknown>,
  fallbackQuery: string,
): {
  query: string;
  type: SearchType;
  num_results?: number;
  category?: SearchCategory;
  include_domains?: string[];
  exclude_domains?: string[];
} {
  const query = typeof raw.query === "string" && raw.query.trim() ? raw.query.trim() : fallbackQuery;
  const numResults =
    typeof raw.num_results === "number"
      ? raw.num_results
      : typeof raw.numResults === "number"
        ? raw.numResults
        : undefined;
  const includeDomains = Array.isArray(raw.include_domains)
    ? raw.include_domains.filter((domain): domain is string => typeof domain === "string")
    : Array.isArray(raw.includeDomains)
      ? raw.includeDomains.filter((domain): domain is string => typeof domain === "string")
      : undefined;
  const excludeDomains = Array.isArray(raw.exclude_domains)
    ? raw.exclude_domains.filter((domain): domain is string => typeof domain === "string")
    : Array.isArray(raw.excludeDomains)
      ? raw.excludeDomains.filter((domain): domain is string => typeof domain === "string")
      : undefined;

  return {
    query,
    type: coerceSearchType(raw.type),
    ...(numResults !== undefined ? { num_results: Math.min(20, Math.max(1, Math.round(numResults))) } : {}),
    ...(isSearchCategory(raw.category) ? { category: raw.category } : {}),
    ...(includeDomains && includeDomains.length > 0 ? { include_domains: includeDomains } : {}),
    ...(excludeDomains && excludeDomains.length > 0 ? { exclude_domains: excludeDomains } : {}),
  };
}

export async function searchWeb(input: WebSearchInput) {
  const query = input.query.trim();
  if (!query) {
    throw new Error("A search query is required.");
  }

  const type = coerceSearchType(input.type);
  const category = isSearchCategory(input.category) ? input.category : undefined;
  const numResults = input.numResults
    ? Math.min(20, Math.max(1, Math.round(input.numResults)))
    : 10;

  const result = await generateText({
    abortSignal: input.abortSignal,
    model: appConfig.models.chatFast,
    prompt: query,
    reasoning: appConfig.models.reasoning.webSearch,
    repairToolCall: async ({ toolCall }) => {
      const repaired = sanitizeSearchArgs(toolCallInput(toolCall.input), query);
      return {
        ...toolCall,
        input: JSON.stringify(repaired),
      };
    },
    system:
      "Call exa_search with the user's query. If you set type, it must be auto, fast, or instant. Prefer auto.",
    toolChoice: "required",
    tools: {
      exa_search: gateway.tools.exaSearch({
        contents: { highlights: { maxCharacters: 1000 } },
        ...(category ? { category } : {}),
        ...(input.excludeDomains && input.excludeDomains.length > 0
          ? { excludeDomains: [...input.excludeDomains] }
          : {}),
        ...(input.includeDomains && input.includeDomains.length > 0
          ? { includeDomains: [...input.includeDomains] }
          : {}),
        numResults,
        type,
      }),
    },
  });

  const toolResult = result.toolResults.find((entry) => entry.toolName === "exa_search");
  const output = toolResult?.output;
  if (output && typeof output === "object" && "error" in output) {
    const message =
      "message" in output && typeof output.message === "string"
        ? output.message
        : "Web search failed.";
    throw new Error(message);
  }
  if (output && typeof output === "object" && "results" in output) {
    return output;
  }

  throw new Error("Web search did not return results.");
}
