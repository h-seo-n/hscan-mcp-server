
const BASE_URL = process.env.HEALTHHUB_API_URL ?? "https://api.healthhub.example.com";
const API_TIMEOUT_MS = 10_000;

async function callApi<T> (
    endpoint: string,
    options?: {
        method?: "GET" | "POST" | "PUT" | "DELETE";
        body?: Record<string, unknown>;
        params?: Record<string, string>;
    }
): Promise<T> {
    // default : get
    const { method = "GET", body, params } = options ?? {};
    const url = new URL(`${BASE_URL}${endpoint}`);
    if (params) {
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
        const response = await fetch(url.toString(), {
            method,
            headers: {"Content-Type": "application/json"},
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Healthhub API error: ${response.status} ${response.statusText}`);
        }

        return (await response.json()) as T;
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new Error(`Healthub API timeout (${API_TIMEOUT_MS}ms) for ${endpoint}`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}


// TODO : 각 api endpoint에 대해, 이를 callApi로 wrapping 하는 함수가 있어야 한다.

/**  ex. searchHospitals :
export async function searchHospitals(keyword: string): Promise<Hospital[]> {
  const data = await callApi<{ results: Hospital[] }>("/hospitals", {
    params: { keyword },
  });
  return data.results;
}
**/
