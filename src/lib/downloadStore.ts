// 브라우저 클라이언트가 받아갈 수 있도록 다운로드 파일을 메모리에 잠시 보관한다.
// 툴 실행 시 zip 버퍼를 staging 하고, GET /download/:token 으로 브라우저가 받아간다.
import { randomUUID } from "crypto";

export interface StagedDownload {
    buffer: Buffer;
    fileName: string;
    contentType: string;
    expiresAt: number;
}

// staging된 파일 유효 시간 (이 시간이 지나면 만료)
const DOWNLOAD_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // check every minute

const downloads = new Map<string, StagedDownload>();

/** 다운로드 파일을 보관하고 접근용 토큰을 반환한다. */
export function stageDownload(buffer: Buffer, fileName: string, contentType: string): string {
    const token = randomUUID();
    downloads.set(token, {
        buffer,
        fileName,
        contentType,
        expiresAt: Date.now() + DOWNLOAD_TTL_MS,
    });
    return token;
}

/** 토큰으로 보관된 파일을 조회한다. 만료된 경우 제거하고 undefined를 반환한다. */
export function getDownload(token: string): StagedDownload | undefined {
    const item = downloads.get(token);
    if (!item) return undefined;
    if (Date.now() > item.expiresAt) {
        downloads.delete(token);
        return undefined;
    }
    return item;
}

/** 전송 완료 후 보관된 파일을 제거한다. */
export function deleteDownload(token: string): void {
    downloads.delete(token);
}

/** 주기적으로 만료된 파일 청소 */
setInterval(() => {
    const now = Date.now();
    for (const [token, item] of downloads.entries()) {
        if (now > item.expiresAt) downloads.delete(token);
    }
}, CLEANUP_INTERVAL_MS);
