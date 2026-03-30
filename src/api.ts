import type { RuntimeInfo, WifiSnapshot } from "./types";

const LOCAL_API_ORIGIN = "http://127.0.0.1:8787";
const HTML_RESPONSE_MESSAGE = "API returned HTML instead of JSON. The renderer is not connected to the local service.";
const NETWORK_ERROR_MESSAGE = "Unable to reach the local service at http://127.0.0.1:8787.";

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const isHtmlDocument = (payload: string) => {
  const normalized = payload.trim().toLowerCase();
  return normalized.startsWith("<!doctype") || normalized.startsWith("<html");
};

const buildApiUrls = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return [...new Set([normalizedPath, new URL(normalizedPath, LOCAL_API_ORIGIN).toString()])];
};

const readJsonBody = async <T>(response: Response) => {
  return (await response.json()) as T;
};

const readTextBody = async (response: Response) => {
  return await response.text();
};

const parseSuccessPayload = async <T>(response: Response, fallbackMessage: string) => {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return await readJsonBody<T>(response);
  }

  const payload = await readTextBody(response);

  if (isHtmlDocument(payload)) {
    throw new ApiRequestError(HTML_RESPONSE_MESSAGE, true);
  }

  throw new ApiRequestError(fallbackMessage);
};

const parseErrorResponse = async (response: Response, fallbackMessage: string) => {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = await readJsonBody<{ message?: string }>(response).catch(() => null);
    return new ApiRequestError(payload?.message ?? fallbackMessage);
  }

  const payload = await readTextBody(response).catch(() => "");

  if (isHtmlDocument(payload)) {
    return new ApiRequestError(HTML_RESPONSE_MESSAGE, true);
  }

  return new ApiRequestError(payload || fallbackMessage);
};

const normalizeRequestError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof TypeError) {
    return new ApiRequestError(NETWORK_ERROR_MESSAGE, true);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
};

const requestJson = async <T>(path: string, fallbackMessage: string): Promise<T> => {
  const urls = buildApiUrls(path);
  let lastError: Error | null = null;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const hasNextCandidate = index < urls.length - 1;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw await parseErrorResponse(response, fallbackMessage);
      }

      return await parseSuccessPayload<T>(response, fallbackMessage);
    } catch (error) {
      const normalizedError = normalizeRequestError(error, fallbackMessage);
      lastError = normalizedError;

      if (hasNextCandidate && normalizedError instanceof ApiRequestError && normalizedError.retryable) {
        continue;
      }

      if (hasNextCandidate && normalizedError instanceof TypeError) {
        continue;
      }

      throw normalizedError;
    }
  }

  throw lastError ?? new Error(fallbackMessage);
};

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  return await requestJson<RuntimeInfo>("/api/runtime-info", "Failed to load runtime info.");
}

export async function scanWifiEnvironment(): Promise<WifiSnapshot> {
  return await requestJson<WifiSnapshot>("/api/wifi/scan", "WiFi scan failed.");
}
