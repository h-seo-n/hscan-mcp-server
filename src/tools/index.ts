import "dotenv/config";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
//import * as api from "../lib/healthHubApi.ts";
//import * as store from "../lib/sessionStore.ts";
import type { CasePageResponse } from "../lib/types.ts"; 
import type { Case } from "../lib/types.ts";
import type {  mailingAddress } from "../lib/types.ts";
import type { Hospital } from "../lib/types.ts";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

const SESSION = process.env.SESSION ?? "";
const XSRF_TOKEN = process.env.XSRF_TOKEN ?? "";

const authHeaders = {
    "Cookie": `SESSION=${SESSION}; XSRF-TOKEN=${XSRF_TOKEN}`,
    "X-Xsrf-Token": XSRF_TOKEN,
};

/** File for Tool Registration 
 * -> llms can use the tools provided by our server to execute actions.
**/

/** Helper: tool wrapper - 매 툴이 사용될때마다 소요 시간 및 내역, 결과 기록 + 에러 핸들링이 되도록 함. */
function withLogging(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    handler: () => Promise<unknown>,
) {
    return async () => {
        const start = Date.now();
        try {
            const result = await handler();
            // store.logToolCall(sessionId, toolName, args, result, true, Date.now() - start);
            return result;
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);

            // store.logToolCall(sessionId, toolName, args, { error: errMsg }, false, Date.now() - start);
            throw error;
        }
    };
}

/** input에 맞는 case filtering 함수 
 * 병원 API가 GET/case, GET/case/{id}, 등으로 케이스 검색을 지원함. 
 * 우선 실제로 검색에 사용할 만한 필터 4개로 filtering 함수 구현해봄. 
 * API에서 지원하는 필터링 옵션을 완전히 이해하지 못해서 일단 임의로 골랐음. 
 * 지원하는 필터링만 구현해도 괜찮을 듯... 
*/

function filterCases(cases: Case[], input: any): Case[] {
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
            c.bodyPart.some((bp) => bp.toLowerCase() === input.bodyPart.toLowerCase());

        return (
            matchStudyDescription && matchInstitutionName && matchModality && matchBodyPart
        );
    })
}

function filterHospitals(hospitals: Hospital[], input: any): Hospital[] {
    return hospitals.filter((h) => {
        const matchName = !input.name || h.name.toLowerCase().includes(input.name.toLowerCase());
        return matchName;
    });
}

// schema.ts
export const mailingAddressSchema = z.object({
  postalCode: z.string(),
  baseAddress: z.string(),
  detailAddress: z.string(),
  receiverName: z.string(),
  receiverPhone: z.string(),
});


/**
 * TODO : registerTools() 안에 필요한 tool들의 목록을 모두 구현해야 함.
 * @param server 
 *  * each tool :
 *    1. receive argument from LLM
 *    2. calls HealthHub API function
 *    3. logs the call + result in session's toolHistory(tool 사용내역)
 *    4. update session's contextSummary (대화 내역 요약)
 *    5. Returns compact result to LLM (툴 사용 결과를 반환)
 * Tool 목록 - 노션에 있으니 보고 하기 (https://www.notion.so/her-she-y-personal/PRD-322582b3bbeb818fb40bdbb5f2d299b1?source=copy_link#324582b3bbeb80f3902ceb524eef1c7b )
 */
export function registerTools(server: McpServer): void {
    /**
     * ex.
     * server.tool(
     *  "search_hospitals",
     *  "주어진 키워드로 병원을 검색합니다.",
     * {
     * ...
     * },
     * ....
     * )
     */
    server.tool(
        "getImageList",
        "주어진 필터링 옵션에 맞는 케이스 목록을 반환합니다. 옵션은 studyDescription, institutionName, modality, bodyPart이 있습니다. 각 옵션은 문자열입니다.",
        {
            //title: "Get Image List",
            inputSchema: z.object({
            studyDescription: z.string().optional(),
            institutionName: z.string().optional(),
            modality: z.string().optional(),
            bodyPart: z.string().optional(),
            
            }) 
        },

        async (args) => {
            const response = await fetch("https://snucse.hscan.kr/api/hscan/case?page=0&size=5", {
                method: "GET",
                headers: authHeaders,
            });
            
            /* API 응답 확인용 로그 
            const rawText = await response.text();
            console.error("API 응답:", rawText); */

            const casePageResponse = await response.json() as CasePageResponse;
            const cases = casePageResponse.content;
            // const { cases } = await response.json() as CasePageResponse; - alternative
            const result = filterCases(cases, args as any);
            
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            total: result.length,
                            cases: result,
                        })
                    }
            ]
            }
        }
        
    )

    server.tool(
        "shareImage",
        "의사에게 케이스를 공유하기 위한 6자리 코드를 발급합니다.",
        {
            inputSchema: z.object({
                caseId: z.string(),
            })
        },

        async (args) => {
            const caseId = (args as any).caseId;
            const response = await fetch("https://snucse.hscan.kr/api/hscan/share-code", {
                method: "POST",
                
                headers: {
                    ...authHeaders,
                    "Content-Type": "application/json",
                }, 
                body: JSON.stringify({
                    caseId,
                }),
            });
            const result = await response.json();
            
            const code = result.code; 

            return {
                content: [
                    {
                        type: "text",
                        text: code.toString().slice(0,6),
                    }
                ]
            }
        }
    )

    server.tool(
        "IssueCD",
        "CD 배송을 신청합니다.", 
        {
            inputSchema: z.object({
                caseId: z.string(),
                mailingAddress: z.object({
                    baseAddress: z.string(),
                    detailAddress: z.string(),
                    receiverName: z.string(),
                    receiverPhone: z.string()
                }),
                deliveryFee: z.number()
            })
        },
        async (args) => {
            //const { caseId, address } = args;
            const { caseId, address } = args as any;

            const prepareResponse = await fetch("https://snucse.hscan.kr/api/hscan/cd-delivery/payment", {
                method: "POST",
                headers: {
                    ...authHeaders,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ caseId, address }),
            });
            
            const payment = await prepareResponse.json();
            const paymentId = payment.paymentId; // 결제 준비 응답에서 paymentId 받아오기. API 명세서에 paymentId가 있는지 확실하지 않음. 일단 가정

            const confirmResponse = await fetch(`https://snucse.hscan.kr/api/hscan/hospital/study/payment?page=0&size=5`, {
                method: "GET",
                headers: {
                    ...authHeaders,
                    "Content-Type": "application/json",
                },
            });

            const result = await confirmResponse.json();
                
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
                        })
                    }
                ]
            }
        }
    )
    

    server.tool(
        "searchHospital",
        "병원을 검색합니다.",

         {
            inputSchema: z.object({
            name: z.string().optional()            
            }) 
        },

        async (args) => {
            const response = await fetch("https://snucse.hscan.kr/api/hscan/hospital", {
                method: "GET",
                headers: authHeaders,
            });
            const rawText = await response.text();
            const hospitals = JSON.parse(rawText) as Hospital[];
            const result = filterHospitals(hospitals, args as any);
            
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            total: result.length,
                            hospitals: result,
                        })
                    }
            ]
            }
        }

    )

    




}
