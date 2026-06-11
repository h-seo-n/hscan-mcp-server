// 서버 공통 설정. index.ts와 툴에서 동일한 값을 공유한다.
export const PORT = parseInt(process.env.PORT ?? "3000", 10);
export const HOST = process.env.HOST ?? "127.0.0.1";

// 브라우저가 다운로드 링크로 실제 접근할 수 있는 외부 주소.
// 배포 시 PUBLIC_BASE_URL 로 덮어쓴다. (예: https://mcp.hscan.dev)
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? `http://${HOST}:${PORT}`).replace(/\/+$/, "");
