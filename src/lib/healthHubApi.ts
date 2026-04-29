import "dotenv/config";
import type { Case, CasePageResponse, Hospital, mailingAddress } from "./types.js";

const BASE_URL = process.env.HEALTHHUB_API_URL ?? "https://mano-snucse.healthhub.dev/";
// const BASE_URL = "https://api.healthhub.example.com"
const API_TIMEOUT_MS = 10_000;

async function callApi<T>(
    endpoint: string,
    options?: {
        method?: "GET" | "POST" | "PUT" | "DELETE";
        body?: Record<string, unknown>;
        params?: Record<string, string>;
        authToken?: string;
    },
): Promise<T> {
    const { method = "GET", body, params, authToken } = options ?? {};
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
            headers: {
                "Content-Type": "application/json",
                ...(authToken ? { Authorization: authToken } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Healthhub API error: ${response.status} ${response.statusText} ${response.text}`);
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

export async function getCases(params: { page?: number; size?: number } = {}, authToken?: string): Promise<Case[]> {
    const data = await callApi<CasePageResponse>("case", {
        params: {
            page: String(params.page ?? 0),
            size: String(params.size ?? 5),
        },
        authToken,
    });
    return data.content;
}

export async function getHospitals(authToken?: string): Promise<Hospital[]> {
    return callApi<Hospital[]>("hospital", { authToken });
}

export async function createShareCode(caseId: string[], authToken?: string): Promise<{ code: string }> {
    const now = new Date();
    const tenMinutesLater = new Date(now.getTime() + 10 * 60 * 1000);
    return callApi<{ code: string }>("share-code", {
        method: "POST",
        body: { 
            caseId,
            startDtime: now.toISOString(),
            endDtime: tenMinutesLater.toISOString(),
        },
        authToken
    });
}

export interface CdDeliveryResult {
    trackingNumber?: string;
    shippingCompany?: string;
    sender?: string;
    sentAt?: string;
}

export async function requestCdDelivery(args: {
    caseIds: string[];
    mailingAddress: Partial<mailingAddress>;
    deliveryFee: number;
    authToken?: string;
}): Promise<CdDeliveryResult> {
    await callApi("cd-delivery/payment", {
        method: "POST",
        body: {
            caseIds: args.caseIds,
            mailingAddress: args.mailingAddress,
            deliveryFee: args.deliveryFee,
        },
        authToken: args.authToken
    });

    return callApi<CdDeliveryResult>("hospital/study/payment", {
        params: { page: "0", size: "5" },
        authToken: args.authToken
    });
}

export async function uploadStudy(
    hospitalId: string,
    caseId: string,
    authToken?: string,
): Promise<unknown> {
    return callApi(`hospital/${hospitalId}/study`, {
        method: "POST",
        body: { caseId },
        authToken,
    });
}

export async function getStudiesByHospital(
    hospitalId: string,
    authToken?: string,
): Promise<unknown> {
    return callApi(`hospital/${hospitalId}/study`, { authToken });
}

export async function requestImageIssuance(args: {
    caseId: string;
    downloadFee: number;
    authToken?: string;
}): Promise<unknown> {
    await callApi("cd-delivery/payment", {
        method: "POST",
        body: { caseId: args.caseId, downloadFee: args.downloadFee },
        authToken: args.authToken,
    });
    return callApi("cd-delivery/confirm", { authToken: args.authToken });
}
