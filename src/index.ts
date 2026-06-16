import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "./tools/index.js";
import * as store from "./lib/sessionStore.js";
import * as downloads from "./lib/downloadStore.js";
import { HOST, PORT } from "./lib/config.js";
import llmProxyRouter from "./routes/llmProxy.js";


/* ---- SERVER CONFIG ---- */
// 배포 가정 x 상태에서 localhost의 클라이언트가 서버에 접속할 수 있도록
const ALLOWED_ORIGINS = [
  "http://localhost:5173", 
  "http://localhost:5174",
  "http://localhost:3001",
  "http://127.0.0.1:5173",
]

/* ---- EXPRESS SETUP ---- */
const app = express();

app.use(
    cors({
        origin: (origin, callback) => {
            // allow requests with no origin (e.g. curl, postman, mcp inspector)
            if (!origin) return callback(null, true);
            if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
            callback(new Error(`CORS: origin ${origin} not allowed`));
        },
        credentials: true,
        exposedHeaders: ["Mcp-Session-Id"],
    }),
);

app.use(express.json({ limit: "1mb" }));
app.use("/api/llm", llmProxyRouter);


/* ---------- MCP server instance per session --------- */
// each mcp server has same tools - but each session has its own transport & state
function createMcpServerForSession(): McpServer {
    const server = new McpServer({
        name: "hscan-mcp-server",
        version: "1.0.0",
    });

    registerTools(server);

    return server;
}

/** -------- MCP 서버 endpoint -------- 
 * 1. POST /mcp - 
 * - 요청에 sessionId X : 클라이언트의 세션 초기화/서버 연결 요구 들어주기 or 
 * - 요청에 sessionId O : 세션에서 툴 사용 요구 들어주기
*/
app.post("/mcp", async (req, res) => {
    // get session id from headers
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // -- 1. 존재하는 세션의 경우 --
    if (sessionId) {
        const transport = store.getTransport(sessionId);
        if (transport) {
            // 세션의 lastActivity 업데이트 용도
            store.getSession(sessionId);
            await transport.handleRequest(req, res, req.body);
            return;
        }

        // 세션 X : 
        res.status(404).json({
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message: "Session not found. Please re-initialize.",
            },
            id: null,
        });
        return;
    }

    /** 2. sessionId가 없음, 새로운 session을 초기화하려고 하는 InitializeRequest로 간주 */
    // - sessionId가 없는데 초기화 요청도 아니면 에러 답변
    if (!isInitializeRequest(req.body)) {
        res.status(400).json({
            jsonrpc: "2.0",
            error: {
                code: -32600,
                message: "First request must be an InitializeRequest.",
            },
            id: null
        });
        return;
    }
    // - 새로운 세션 & transport 생성
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId: string) => {
            console.group(`[MCP] New Session: ${newSessionId}`);
            store.setTransport(newSessionId, transport);
            store.createSession(newSessionId);
        },
    });

    const mcpServer = createMcpServerForSession();
    await mcpServer.connect(transport);
    
    try {
        console.log(`\nHandling MCP request: ${req.body?.method || 'unknown method'} (session: ${sessionId || 'new'})`);
        await transport.handleRequest(req, res, req.body);
    } catch (err) {
        console.error('MCP error:', err);
        if(!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
                id: null,
            });
        }
    }
});

/**
 * 2. DELETE /mcp : 클라이언트 측에서 세션 종료 (탭 종료 등)
 */
app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId) {
        res.status(400).json({ error: "Missing Mcp-Session-Id header "});
        return;
    }
    const transport = store.getTransport(sessionId);
    if (transport) {
        await transport.handleRequest(req, res);
        store.deleteSession(sessionId);
        console.log(`[MCP] Session terminated: ${sessionId}`);
    } else {
        res.status(404).json({ error: "Session not found" });
    }
});


/* ------ 영상 다운로드 endpoint ------ */
// downloadImage 툴이 staging한 파일을 브라우저가 받아간다. Content-Disposition: attachment 로
// 브라우저 네이티브 다운로드를 트리거한다. 토큰은 일회성이며 전송 후 폐기된다.
app.get("/download/:token", (req, res) => {
    const item = downloads.getDownload(req.params.token);
    if (!item) {
        res.status(404).json({ error: "Download not found or expired" });
        return;
    }

    res.setHeader("Content-Type", item.contentType);
    res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(item.fileName)}"`,
    );
    res.setHeader("Content-Length", item.buffer.length.toString());
    res.send(item.buffer);

    downloads.deleteDownload(req.params.token);
});


/* ------ 디버깅용 REST endpoint ------ */
// GET all sessions
app.get("/api/sessions", (_req, res) => {
    res.json({ activeSessions: store.getActiveSessionCount() });
});

// GET session summary with session id
app.get("/api/sessions/:id", (req, res) => {
    const summary = store.getSessionSummary(req.params.id);
    if (!summary) {
        res.status(404).json({ error: "Session not found" });
        return;
    }
    res.json(summary);
});

// GET full session tool use history
app.get("/api/sessions/:id/history", (req, res) => {
    const history = store.getToolHistory(req.params.id);
    res.json({ toolHistory: history });
})

// GET session context summary
app.get("/api/session/:id/context", (req, res) => {
    const context = store.getContext(req.params.id);
    if (!context) {
        res.status(404).json({ error: "Session not found" });
        return;
    }
    res.json(context);
});

// Health Check
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        activeSessions: store.getActiveSessionCount(),
        uptime: process.uptime(),
    });
});


app.listen(PORT, HOST, () => {
    console.log(`
╔═════════════════════════════════════════════════════╗
║  HScan MCP Server                                   ║
║  ──────────────────────────────────────────────     ║
║  MCP endpoint : http://${HOST}:${PORT}/mcp           ║
║  Health check : http://${HOST}:${PORT}/health        ║
║  Debug API    : http://${HOST}:${PORT}/api/sessions  ║
╚═════════════════════════════════════════════════════╝
        `);
});
