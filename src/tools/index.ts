import "dotenv/config";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as api from "../lib/healthHubApi.js";
import type { Case, Hospital } from "../lib/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol";

/** File for Tool Registration
 * -> llms can use the tools provided by our server to execute actions.
 */

/** Helper: getting auth token */
function getAuthToken(extra: RequestHandlerExtra<any, any>): string | undefined {
    const raw = extra.requestInfo?.headers?.authorization;
    return Array.isArray(raw) ? raw[0] : raw; //header keys are lowercase
}

/** Helper: tool wrapper - 매 툴이 사용될때마다 소요 시간 및 내역, 결과 기록 + 에러 핸들링이 되도록 함. */
async function withLogging<T>(
    toolName: string,
    args: Record<string, unknown>,
    handler: () => Promise<T>,
): Promise<T> {
    const start = Date.now();
    console.log(`[tool:start] ${toolName}`, args);
    try {
        const result = await handler();
        console.log(`[tool:ok] ${toolName} ${Date.now() - start}ms`);
        return result;
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[tool:err] ${toolName} ${Date.now() - start}ms: ${errMsg}`);
        throw error;
    }
}

interface CaseFilterInput {
    studyDescription?: string;
    institutionName?: string;
    modality?: string;
    bodyPart?: string;
}

function filterCases(cases: Case[], input: CaseFilterInput): Case[] {
    return cases.filter((c) => {
        const matchStudyDescription =
            !input.studyDescription ||
            c.studyDescription.toLowerCase().includes(input.studyDescription.toLowerCase());
        const matchInstitutionName =
            !input.institutionName ||
            c.institutionName.toLowerCase().includes(input.institutionName.toLowerCase());
        const matchModality =
            !input.modality || c.modality.toLowerCase() === input.modality.toLowerCase();
        const matchBodyPart =
            !input.bodyPart ||
            c.bodyPart.some((bp) => bp.toLowerCase() === input.bodyPart!.toLowerCase());

        return matchStudyDescription && matchInstitutionName && matchModality && matchBodyPart;
    });
}

function filterHospitals(hospitals: Hospital[], input: { name?: string }): Hospital[] {
    return hospitals.filter(
        (h) => !input.name || h.name.toLowerCase().includes(input.name.toLowerCase()),
    );
}

export function registerTools(server: McpServer): void {
    server.registerTool(
        "getImageList",
        {
            description:
                "주어진 필터링 옵션에 맞는 케이스 목록을 반환합니다. 옵션은 studyDescription, institutionName, modality, bodyPart이 있습니다. 각 옵션은 문자열입니다.",
            inputSchema: {
                studyDescription: z.string().optional(),
                institutionName: z.string().optional(),
                modality: z.string().optional(),
                bodyPart: z.string().optional(),
            },
        },
        async (args, extra) =>
            withLogging("getImageList", args, async () => {
                const cases = await api.getCases({ page: 0, size: 5 }, getAuthToken(extra));
                const result = filterCases(cases, args);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                total: result.length,
                                cases: result,
                            }),
                        },
                    ],
                };
            }),
    );

    server.registerTool(
        "shareImage",
        {
            description: "의사에게 케이스를 공유하기 위한 6자리 코드를 발급합니다.",
            inputSchema: {
                caseId: z.string().array(),
            },
        },
        async (args, extra) =>
            withLogging("shareImage", args, async () => {
                const result = await api.createShareCode(args.caseId, getAuthToken(extra));
                return {
                    content: [
                        {
                            type: "text",
                            text: result.code.toString().slice(0, 6),
                        },
                    ],
                };
            }),
    );

    server.registerTool(
        "IssueCD",
        {
            description: "CD 배송을 신청합니다.",
            inputSchema: {
                caseIds: z.string().array(),
                mailingAddress: z.object({
                    baseAddress: z.string(),
                    detailAddress: z.string(),
                    receiverName: z.string(),
                    receiverPhone: z.string(),
                }),
                deliveryFee: z.number(),
            },
        },
        async (args, extra) =>
            withLogging("IssueCD", args, async () => {
                const result = await api.requestCdDelivery({
                    caseIds: args.caseIds,
                    mailingAddress: args.mailingAddress,
                    deliveryFee: args.deliveryFee,
                    authToken: getAuthToken(extra)
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                message: "CD 발급 신청 완료되었습니다.",
                                trackingNumber: result.trackingNumber,
                                shippingCompany: result.shippingCompany,
                                sender: result.sender,
                                sentAt: result.sentAt,
                            }),
                        },
                    ],
                };
            }),
    );

    server.registerTool(
        "searchHospital",
        {
            description: "병원을 검색합니다.",
            inputSchema: {
                name: z.string().optional(),
            },
        },
        async (args, extra) =>
            withLogging("searchHospital", args, async () => {
                const hospitals = await api.getHospitals(getAuthToken(extra));
                const result = filterHospitals(hospitals, args);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                total: result.length,
                                hospitals: result,
                            }),
                        },
                    ],
                };
            }),
    );
}
