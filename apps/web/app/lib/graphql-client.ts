interface GraphQlClientError {
  message?: string;
  extensions?: { code?: string };
}

export interface GraphQlClientResponse<T> {
  data?: T;
  errors?: GraphQlClientError[];
}

export async function readGraphQlResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<GraphQlClientResponse<T>> {
  const text = await response.text();
  const trimmed = text.trimStart();

  if (!trimmed) return {};

  if (isJsonResponse(response, trimmed)) {
    try {
      return JSON.parse(text) as GraphQlClientResponse<T>;
    } catch {
      throw new Error(fallbackMessage);
    }
  }

  throw new Error(fallbackMessage);
}

function isJsonResponse(response: Response, bodyStart: string): boolean {
  const contentType = response.headers.get('content-type') ?? '';
  return (
    contentType.toLowerCase().includes('application/json') ||
    bodyStart.startsWith('{') ||
    bodyStart.startsWith('[')
  );
}
