import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
//import * as api from "../lib/healthHubApi.ts";
//import * as store from "../lib/sessionStore.ts";
import type { Case } from "../lib/types.ts"; 
import type {  mailingAddress } from "../lib/types.ts";


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
            const response = await fetch("https://mano-snucse.healthhub.dev/case", {
                method: "GET"
            });
            const cases = await response.json() as Case[];
            const result = filterCases(cases, (args as any).input);
            
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
        
    );

    server.tool(
        "shareImage",
        "영상 공유",
        {
            inputSchema: z.object({
                caseId: z.string(),
            })
        },

        async (args) => {
            const caseId = (args as any).input.caseId;
            const response = await fetch("https://mano-snucse.healthhub.dev/share-code", {
                method: "POST",
                
                headers: {
                    "Content-Type": "application/json",
                }, 
                body: JSON.stringify({
                    caseId,
                }),
            });
            const result = await response.json();
            const pin = result.pin; 
            // 공유 코드 json에서 받아오기. 근데 API에서 찾을 수 없었음... 일단 pin으로 가정

            return {
                content: [
                    {
                        type: "text",
                        text: pin.toString().slice(0,6),
                    }
                ]
            }
        }
    );

    /* CD 발급 신청하면 결제 창으로 넘어가는데 결제 창으로 넘어가는 것까지만 구현해야할지? 결제 완료까지 여기서 이루어지는건지..?
    -> 일단 결제 api 호출까지만 구현해놓음
    수정 필요 */

    server.tool(
        "IssueCD",
        "CD 발급", 
        {
            inputSchema: z.object({
                caseId: z.string(),
                address: mailingAddressSchema,
            })
        },
        async (args : {input: { caseId: string; address: mailingAddress }}) => {
            const { caseId, address } = args.input;
            //const { caseId, address } = (args as any).input; - alternative

            await fetch("https://mano-snucse.healthhub.dev/cd-delivery/payment", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ caseId, address }),
            });

            return {
                content: [
                    {
                        type: "text",
                        text: "CD 발급 신청? 완료되었습니다."
                    }
                ]
            }
        }
    ) 
}