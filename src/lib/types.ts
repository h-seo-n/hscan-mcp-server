/** tool 사용 내역 데이터타입 */
export interface ToolCallEntry {
    id: string;
    timestamp: number;
    tool: string;
    arguments: Record<string, unknown>;
    result: unknown;
    success: boolean;
    durationMs: number;
}

/** 대화 context 요약 데이터타입 */
export interface ContextSummary {
    currentStep: string; // ex. hospital_selected, images_selected 등
    selectedHospital: { id: string; name: string } | null;
    selectedImages: { id: string; name: string }[] | null;
    issuanceRequestId: string | null;
    notes: string[];
}

/** 각 세션별 MCP 서버 저장 정보 */
export interface SessionData {
    sessionId: string;
    createdAt: number;
    lastActivity: number;
    toolHistory: ToolCallEntry[];
    context: ContextSummary;
}

/**
 * TODO: 
 * healthhub api 명세서를 보고
 * 병원, 영상, 결과, 유저 정보... 등에 대한 필요한 데이터타입이나 인터페이스를 정의하기
 */

export type Case = {
    caseId: string
    patientId: string
    birthDate: string
    patientName: string
    patientSex: string
    studyDate: string
    accessionNumber: string
    studyInstanceUID: string
    studyDescription: string
    modality: string
    institutionName: string
    imageHash : {
        additionalProp1: string
        additionalProp2: string
        additionalProp3: string
    }
    bodyPart: [
        string
    ]
    series: [
        {
            seriesNumber: string
            seriesInstanceUID: string
            seriesDescription: string
            images: [
                string
            ]
        }
    ]
    userId: string
    
}

export type mailingAddress = {
    postalCode: string
    baseAddress: string
    detailAddress: string
    receiverName: string
    receiverPhone: string
}