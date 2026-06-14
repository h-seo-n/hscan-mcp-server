import "dotenv/config";
import type { Case, CasePageResponse, Hospital, mailingAddress, Volume2Price, ModalityKey } from "./types.js";

const BASE_URL = process.env.HEALTHHUB_API_URL ?? "https://mano-snucse.healthhub.dev/";
// const BASE_URL = "https://api.healthhub.example.com"
const API_TIMEOUT_MS = 10_000;
// 영상(jpeg/dicom) 다운로드는 용량이 커서 일반 API보다 훨씬 오래 걸릴 수 있음
const DOWNLOAD_TIMEOUT_MS = 120_000;

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
                "Accept": "application/json, text/plain, */*",
                ...(authToken ? { Authorization: authToken } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Healthhub API error: ${response.status} ${response.statusText} ${errorText}`);
        }

        //return (await response.json()) as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : null) as T;
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

export async function getCase(caseId: string, authToken?: string): Promise<Case> {
    return callApi<Case>(`case/${caseId}`, { authToken });
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

/*export interface CdDeliveryResult {
    trackingNumber?: string;
    shippingCompany?: string;
    sender?: string;
    sentAt?: string;
}*/

export interface HospitalStudy {
    studyInstanceUID: string;
    date: string;
    modalities: string[];
    studyDescription: string | null;
    status: string;
    numImages: number;
}

interface CdDeliveryPaymentResponse {
    id: string;
    userId: string;
    price: {
        amount: number;
        taxFree: number;
        refundableAmount: number;
        refundableTaxFree: number;
    };
    paymentStatus: string;
    caseIds: string[];
    mailingAddress: {
        id: string | null;
        userId: string | null;
        postalCode: string;
        baseAddress: string;
        detailAddress: string;
        receiverName: string | null;
        receiverPhone: string | null;
    };
    mailStatus: string;
}

export async function requestCdDelivery(args: {
    caseIds: string[];
    mailingAddress: mailingAddress;
    deliveryFee: number;
    authToken?: string;
}): Promise<CdDeliveryPaymentResponse> {
    const payment = await callApi<CdDeliveryPaymentResponse>("cd-delivery/payment", {
        method: "POST",
        body: {
            caseIds: args.caseIds,
            mailingAddress: args.mailingAddress,
            deliveryFee: args.deliveryFee,
        },
        authToken: args.authToken
    });

    return payment;
    // await callApi(`cd-delivery/payment/${payment.id}`, {
    //     method: "PUT",
    //     body: {},
    //     authToken: args.authToken
    // });
}

export async function uploadStudy(
    hospitalId: string,
    caseId: string,
    authToken?: string,
): Promise<unknown> {
    return callApi(`hospital/${hospitalId}/study`, {
        method: "POST",
        body: { caseId : [caseId] },
        authToken,
    });
}

export async function getStudiesByHospital(
    hospitalId: string,
    authToken?: string,
): Promise<HospitalStudy[]> {
    return callApi<HospitalStudy[]>(`hospital/${hospitalId}/study`, { authToken });
}

function calculatePrice(hospital: Hospital, modalities: string[]): number {
    const price = hospital.price;

    if (price.type === "SIMPLE") {
        return price.amount;
    }

    const volume2Price = price as Volume2Price;

    const totalVirtualSize = modalities.reduce((sum, modality) => {
        const config = volume2Price.modalities[modality as ModalityKey] ?? volume2Price.defaultOption;
        return sum + config.virtualSize;
    }, 0);

    const sortedUnits = [...volume2Price.units].sort((a, b) => a.virtualVolume - b.virtualVolume);
    const unit = sortedUnits.find(u => u.virtualVolume >= totalVirtualSize) ?? sortedUnits[sortedUnits.length - 1];

    return unit.price;
}

export async function requestImageIssuance(args: {
    hospitalId: string;
    studyInstanceUID: string;
    authToken?: string;
}): Promise<StudyPaymentResponse> {
    const [studies, hospitals] = await Promise.all([
        getStudiesByHospital(args.hospitalId, args.authToken),
        getHospitals(args.authToken)
    ]);
    const study = studies.find(s => s.studyInstanceUID === args.studyInstanceUID);
    if (!study) {
        throw new Error(`Study with instance UID ${args.studyInstanceUID} not found in hospital ${args.hospitalId}`);
    }
    const hospital = hospitals.find(h => h.id === args.hospitalId);
    if (!hospital) {
        throw new Error(`Hospital with ID ${args.hospitalId} not found`);
    }
    const price = calculatePrice(hospital, study.modalities);
    const payment = await callApi<StudyPaymentResponse>("hospital/study/payment", {
        method: "POST",
        body: {
            mailingIncluded: false,
            price, 
            requestStudies: {
                [args.hospitalId]: [
                   study
                ],
            },
        },
        authToken: args.authToken,
    });

    return payment;

    // await callApi(`hospital/study/payment/${payment.id}`, {
    //     method: "PUT",
    //     body: {},
    //     authToken: args.authToken,  
    // });
}


interface StudyPaymentResponse {
    id: string;
    price: {
        totalFee: number;
    };
}


async function callApiRaw(
    endpoint: string,
    options?: {
        params?: Record<string, string | string[]>;
        authToken?: string;
        timeoutMs?: number;
    },
): Promise<Buffer> {
    const { params, authToken, timeoutMs = API_TIMEOUT_MS } = options ?? {};
    const url = new URL(`${BASE_URL}${endpoint}`);

    if (params) {
        for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) {
                value.forEach((v) => url.searchParams.append(key, v));
            } else {
                url.searchParams.set(key, value);
            }
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                ...(authToken ? { Authorization: authToken } : {}),
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Healthhub API error: ${response.status} ${response.statusText}`);
        }

        return Buffer.from(await response.arrayBuffer());
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new Error(`Healthhub API timeout (${timeoutMs}ms) for ${endpoint}`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export async function downloadImage(args: {
    ids: string[];
    fileType: "jpeg" | "dicom";
    authToken?: string;
}): Promise<Buffer> {
    const key = crypto.randomUUID();
    return callApiRaw(`case/${args.fileType}/sse/${key}`, {
        params: { ids: args.ids },
        authToken: args.authToken,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });
}
