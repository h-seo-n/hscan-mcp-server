import "dotenv/config";
import { date, z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as api from "../lib/healthHubApi.js";
import * as downloads from "../lib/downloadStore.js";
import { PUBLIC_BASE_URL } from "../lib/config.js";
import {downloadImage} from "../lib/healthHubApi.js";
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

/** Helper: 오래 걸리는 작업 동안 주기적으로 progress 알림을 보내 클라이언트의 요청 타임아웃을 갱신한다.
 *  클라이언트가 요청에 progressToken을 실어 보낸 경우에만 알림을 전송한다. 반환된 함수를 호출해 중단한다. */
function startProgressHeartbeat(
    extra: RequestHandlerExtra<any, any>,
    message: string,
    intervalMs = 5_000,
): () => void {
    const progressToken = extra._meta?.progressToken;
    if (progressToken === undefined) {
        return () => {};
    }

    let progress = 0;
    const timer = setInterval(() => {
        progress += 1;
        extra
            .sendNotification({
                method: "notifications/progress",
                params: { progressToken, progress, message },
            })
            .catch((err) => {
                console.error(`[progress] failed to send notification: ${err}`);
            });
    }, intervalMs);

    return () => clearInterval(timer);
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


    server.registerTool(
        "uploadImage",
        {
            description: "의료 영상을 업로드합니다.",
            inputSchema: {
                hospitalId: z.string(),
                caseId: z.string(),
            },
        },
        async (args, extra) =>
            withLogging("uploadImage", args, async () => {
                await api.uploadStudy(args.hospitalId, args.caseId, getAuthToken(extra));
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                message: "의료 영상 보내기를 완료했습니다.",
                            }),
                        },
                    ],
                };
            }),
    );

    server.registerTool(
        "getImageByHospital",
        {
            description: "병원 이름으로 해당 병원에서 촬영한 의료 영상 목록을 검색합니다.",
            inputSchema: {
                hospitalName: z.string(),
            },
        },
        async (args, extra) =>
            withLogging("getImageByHospital", args, async () => {
                const authToken = getAuthToken(extra);
                const hospitals = await api.getHospitals(authToken);
                const hospital = hospitals.find((h) => h.name === args.hospitalName);

                if (!hospital) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    error: `'${args.hospitalName}' 병원을 찾을 수 없습니다.`,
                                }),
                            },
                        ],
                    };
                }

                const result = await api.getStudiesByHospital(hospital.id, authToken);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                message: `'${args.hospitalName}' 병원의 영상 검색 결과입니다.`,
                                result,
                            }),
                        },
                    ],
                };
            }),
    );

    server.registerTool(
        "requestImage",
        {
            description: "영상 발급을 신청합니다.",
            inputSchema: {
                hospitalId: z.string(),
                studyInstanceUID: z.string(),
            },
        },
        async (args, extra) =>
            withLogging("requestImage", args, async () => {
                await api.requestImageIssuance({
                    hospitalId: args.hospitalId,
                    studyInstanceUID: args.studyInstanceUID,
                    authToken: getAuthToken(extra),
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                message: "영상 발급 신청이 완료되었습니다.",
                            }),
                        },
                    ],
                };
            }),
    );


    server.registerTool(
        "downloadImage",
        {
            description: "영상을 다운로드합니다. jpeg 또는 dicom 형식을 선택할 수 있습니다. 결과로 받은 downloadUrl로 브라우저에서 다운로드합니다.",
            inputSchema: {
                ids: z.array(z.string()),
                fileType: z.enum(["jpeg", "dicom"]),
            },
        },
        async (args, extra) =>
            withLogging("downloadImage", args, async () => {
                // 다운로드는 오래 걸릴 수 있어 진행 알림으로 클라이언트 요청 타임아웃을 갱신한다.
                const stopHeartbeat = startProgressHeartbeat(extra, "영상 다운로드 중...");
                let zipBuffer: Buffer;
                try {
                    zipBuffer = await downloadImage({
                        ids: args.ids,
                        fileType: args.fileType,
                        authToken: getAuthToken(extra),
                    });
                } finally {
                    stopHeartbeat();
                }

                // 이 서버는 브라우저와 분리된 HTTP 서버이므로 서버 디스크에 저장하지 않는다.
                // 대신 파일을 메모리에 staging하고 브라우저가 받아갈 다운로드 URL을 반환한다.
                const fileName = `images_${Date.now()}.zip`;
                const token = downloads.stageDownload(zipBuffer, fileName, "application/zip");
                const downloadUrl = `${PUBLIC_BASE_URL}/download/${token}`;

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                message: "영상 다운로드가 준비되었습니다. downloadUrl로 다운로드하세요. (10분 후 만료)",
                                fileType: args.fileType,
                                downloadUrl,
                                expiresInMinutes: 10,
                                fileName,
                            }),
                        },
                    ],
                };
            }),
    );

    
}
