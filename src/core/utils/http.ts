/**
 * HTTP helper with retries + timeouts.
 *
 * Wraps native fetch (Node 20+) with sensible defaults so adapters don't
 * have to reimplement retry logic or worry about hung requests.
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

async function request(
  url: string,
  init: RequestInit,
  options: HttpOptions = {},
): Promise<Response> {
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
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          ...(options.headers ?? {}),
        },
      });
      clearTimeout(timer);

      // Retry on 5xx and 429; throw on other 4xx
      if (response.status >= 500 || response.status === 429) {
        lastError = new Error(`HTTP ${response.status} from ${url}`);
        if (attempt < retries) {
          await delay(retryDelay * 2 ** attempt);
          continue;
        }
        throw lastError;
      }
      return response;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries && isRetryableError(err)) {
        await delay(retryDelay * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error(`Request failed: ${url}`);
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
  const response = await request(url, { method: "GET" }, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return (await response.json()) as T;
}

/**
 * POST request with JSON body, returning parsed JSON. Throws on non-2xx responses.
 */
export async function post<T = unknown>(
  url: string,
  body: unknown,
  options?: HttpOptions,
): Promise<T> {
  const response = await request(
    url,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
    options,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return (await response.json()) as T;
}

/**
 * GET request returning the response body as text. For endpoints that don't
 * return JSON (e.g., blockchain.info's address-balance endpoint).
 */
export async function getText(
  url: string,
  options?: HttpOptions,
): Promise<string> {
  const response = await request(url, { method: "GET" }, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return await response.text();
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
