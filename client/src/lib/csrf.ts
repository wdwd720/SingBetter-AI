const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let cachedToken: string | null = null;
let inFlightToken: Promise<string | null> | null = null;

const normalizeUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const isApiUrl = (url: string): boolean =>
  url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);

const fetchCsrfToken = async (
  fetchImpl: typeof window.fetch,
): Promise<string | null> => {
  if (cachedToken) return cachedToken;
  if (inFlightToken) return inFlightToken;

  inFlightToken = (async () => {
    try {
      const response = await fetchImpl("/api/csrf-token", {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { csrfToken?: string | null };
      const token =
        typeof payload.csrfToken === "string" && payload.csrfToken.length > 0
          ? payload.csrfToken
          : null;
      cachedToken = token;
      return token;
    } catch {
      return null;
    } finally {
      inFlightToken = null;
    }
  })();

  return inFlightToken;
};

export const installCsrfFetchInterceptor = () => {
  if (typeof window === "undefined") return;
  const originalFetch = window.fetch.bind(window);
  if ((window as any).__csrfInterceptorInstalled) return;
  (window as any).__csrfInterceptorInstalled = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = normalizeUrl(input);
    const method = (
      init?.method ||
      (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    if (
      stateChangingMethods.has(method) &&
      isApiUrl(url) &&
      !url.includes("/api/csrf-token")
    ) {
      const token = await fetchCsrfToken(originalFetch);
      if (token) {
        const headers = new Headers(
          init?.headers ||
            (input instanceof Request ? input.headers : undefined),
        );
        headers.set("X-CSRF-Token", token);
        init = { ...(init || {}), headers };
      }
    }

    return originalFetch(input, init);
  };
};
