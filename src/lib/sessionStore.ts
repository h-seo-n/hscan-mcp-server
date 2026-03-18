// 각 채팅 세션에서의 대화 내역과 툴 사용 내역을 저장할 수 있게함.
import { randomUUID } from "crypto";
import type { SessionData, ContextSummary, ToolCallEntry } from "./types.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// 각 세션 유효 시간 (이 시간이 지나면 expire)
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

/** -------- Session & Transport state --------- */
 // session id -> mcp transport instance 매핑 (HTTP 재연결 위해)
const transports = new Map<string, StreamableHTTPServerTransport>();
// session id => session data (history, context, metadata) 매핑
const sessions = new Map<string, SessionData>();



/** ---------- 연결통로 관리 (transport management)---------- */
export function getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
    return transports.get(sessionId);
}

export function setTransport(sessionId: string, transport: StreamableHTTPServerTransport): void {
    transports.set(sessionId, transport);
}

export function deleteTransport(sessionId: string): void {
    transports.delete(sessionId);
}


// -------- 세션 &  세션 데이터 관리 -----------
function createEmptyContext(): ContextSummary {
    return {
        currentStep: "idle",
        selectedHospital: null,
        selectedImages: null,
        issuanceRequestId: null,
        notes: [],
    };
}

// MCP 서버 initialization 시 세션 생성
export function createSession(sessionId: string): SessionData {
    const session: SessionData = {
        sessionId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        toolHistory: [],
        context: createEmptyContext(),
    };
    sessions.set(sessionId, session);
    return session;
}

// get session data by session id
export function getSession(sessionId: string): SessionData | undefined {
    const session = sessions.get(sessionId);
    if (session) {
        session.lastActivity = Date.now();
    }
    return session;
}

// Delete session and transport (on browser)
export function deleteSession(sessionId: string): void {
    sessions.delete(sessionId);
    transports.delete(sessionId);
}


/** ------- Tool 사용내역 기록 -------- */
export function logToolCall(
    sessionId: string,
    tool: string,
    args: Record<string, unknown>,
    result: unknown,
    success: boolean,
    durationMs: number,
): ToolCallEntry {
    const session = sessions.get(sessionId);
    if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
    }

    const entry: ToolCallEntry = {
        id: randomUUID(),
        timestamp: Date.now(),
        tool,
        arguments: args,
        result,
        success,
        durationMs,
    };

    session.toolHistory.push(entry);
    session.lastActivity = Date.now();

    return entry;
}


// 전체 Tool 사용내역 반환
export function getToolHistory(sessionId: string): ToolCallEntry[] {
    return sessions.get(sessionId)?.toolHistory ?? [];
}

/** --------- 대화 context 관리 -------- */
export function updateContext(
    sessionId: string,
    updates: Partial<ContextSummary>,
): ContextSummary | undefined {
    const session = sessions.get(sessionId);
    if (!session) return undefined;

    // 바뀐 부분 덮어쓰기
    session.context = {...session.context, ...updates };
    session.lastActivity = Date.now();

    return session.context;
}

// 현 세션 context 반환
export function getContext(sessionId: string): ContextSummary | undefined {
    return sessions.get(sessionId)?.context;
}
// context의 notes property에 내용 추가
export function addContextNote(sessionId: string, note: string): void {
    const session = sessions.get(sessionId);
    if (session) {
        session.context.notes.push(note);
        session.lastActivity = Date.now();
    }
}


/** -------------- 주기적으로 outdated 세션 청소 ------------- */
function cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.lastActivity > SESSION_TTL_MS) {
            sessions.delete(sessionId);
            transports.delete(sessionId);
            cleaned ++
        }
    }
    if (cleaned > 0) {
        console.log(`[SessionStore] Cleaned up ${cleaned} expired session(s).\n Active: ${sessions.size}`);
    }
}

setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);



/** -------- debug helpers------------ */
export function getActiveSessionCount(): number {
    return sessions.size;
}

export function getSessionSummary(sessionId: string): object | undefined {
    const session = sessions.get(sessionId);
    if (!session) return undefined;
}