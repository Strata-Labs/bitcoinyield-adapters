/**
 * HTTP helper with retries + timeouts.
 *
 * Wraps native fetch (Node 20+) with sensible defaults so adapters don't
 * have to reimplement retry logic or worry about hung requests. The timeout
 * covers the FULL request including the body read — a server that returns
 * headers and then stalls the body must not hang an adapter run.
 */

export interface HttpOptions {
  /** Request timeout in ms. Default: 10_000 */
  timeout?: number;
  /** Max retry attempts (in addition to the first try). Default: 3 */
  retries?: number;
  /** Headers to include. */
  headers?: Record<string, string>;
  /** Initial retry delay in ms (doubles each attempt). Default: 500 */
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

async function requestBody(
  url: string,
  init: RequestInit,
  options: HttpOptions = {},
  parse: "json" | "text",
): Promise<unknown> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelay = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: mergeHeaders(init.headers, options.headers),
      });

      // Retry on 5xx and 429; throw on other 4xx
      if (response.status >= 500 || response.status === 429) {
        await drainBody(response);
        lastError = new Error(`HTTP ${response.status} from ${url}`);
        if (attempt < retries) {
          clearTimeout(timer);
          await delay(retryDelay * 2 ** attempt);
          continue;
        }
        throw lastError;
      }
      if (!response.ok) {
        const snippet = await safeSnippet(response);
        throw new Error(
          `HTTP ${response.status} from ${url}${snippet ? `: ${snippet}` : ""}`,
        );
      }
      return parse === "json" ? await response.json() : await response.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries && isRetryableError(err)) {
        clearTimeout(timer);
        await delay(retryDelay * 2 ** attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`Request failed: ${url}`);
}

/** Case-insensitive merge — `options.headers` wins over `init.headers`. */
function mergeHeaders(
  base: HeadersInit | undefined,
  extra: Record<string, string> | undefined,
): Headers {
  const headers = new Headers(base);
  for (const [key, value] of Object.entries(extra ?? {})) {
    headers.set(key, value);
  }
  return headers;
}

/** Release the connection of a response we're abandoning (retry paths). */
async function drainBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Abandoned-body cleanup is best-effort.
  }
}

async function safeSnippet(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(err.message)
    );
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET request returning parsed JSON. Throws on non-2xx responses (after retries).
 */
export async function get<T = unknown>(
  url: string,
  options?: HttpOptions,
): Promise<T> {
  return (await requestBody(url, { method: "GET" }, options, "json")) as T;
}

/**
 * POST request with JSON body, returning parsed JSON. Throws on non-2xx responses.
 */
export async function post<T = unknown>(
  url: string,
  body: unknown,
  options?: HttpOptions,
): Promise<T> {
  return (await requestBody(
    url,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
    options,
    "json",
  )) as T;
}

/**
 * GET request returning the response body as text. For endpoints that don't
 * return JSON (e.g., blockchain.info's address-balance endpoint).
 */
export async function getText(
  url: string,
  options?: HttpOptions,
): Promise<string> {
  return (await requestBody(url, { method: "GET" }, options, "text")) as string;
}

/**
 * GraphQL POST. Throws on transport errors AND on `errors[]` in the response.
 *
 * @example
 *   const data = await http.graphql<{ poolV2: PoolV2 }>(
 *     'https://api.morpho.org/graphql',
 *     `query Get($id: String!) { poolV2(id: $id) { ... } }`,
 *     { id: '0x...' },
 *   )
 */
export async function graphql<T = unknown>(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
  options?: HttpOptions,
): Promise<T> {
  const response = await post<{ data?: T; errors?: unknown[] }>(
    url,
    { query, variables },
    options,
  );
  if (response.errors && response.errors.length > 0) {
    throw new Error(
      `GraphQL error from ${url}: ${JSON.stringify(response.errors)}`,
    );
  }
  if (!response.data) {
    throw new Error(`GraphQL response from ${url} had no data field`);
  }
  return response.data;
}
