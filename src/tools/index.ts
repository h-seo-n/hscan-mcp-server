import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
//import * as api from "../lib/healthHubApi.ts";
//import * as store from "../lib/sessionStore.ts";

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
}