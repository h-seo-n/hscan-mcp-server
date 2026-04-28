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
type ImageId = string;

interface Series {
    seriesNumber: string | null;
    seriesInstanceUID: string;
    seriesDescription: string | null;
    images: ImageId[];
}

type PatientSex = "M" | "F" | "O";

export interface Case {
    caseId: string;
    patientId: string;
    birthDate: string;
    patientName: string;
    patientSex: PatientSex;
    studyDate: string;
    accessionNumber: string;
    studyInstanceUID: string;
    studyDescription: string;
    modality: string;
    institutionName: string;
    imageHash: Record<string, string>;
    bodyPart: string[];
    series: Series[];
    createdAt: string | null;
    userId: string;
    requestedDate: string;
    acceptedDate: string;
    locked: boolean;
    contentIds: ImageId[];
}

interface SortInfo {
    sorted: boolean;
    unsorted: boolean;
    empty: boolean;
}

interface Pageable {
    pageNumber: number;
    pageSize: number;
    sort: SortInfo;
    offset: number;
    paged: boolean;
    unpaged: boolean;
}

export interface CasePageResponse {
    content: Case[];
    pageable: Pageable;
    sort: SortInfo;
    first: boolean;
    last: boolean;
    totalElements: number;
    totalPages: number;
    size: number;
    number: number;
    numberOfElements: number;
    empty: boolean;
}

interface PriceBase {
    type: "SIMPLE" | "VOLUME2";
}

interface SimplePrice extends PriceBase {
    type: "SIMPLE";
    amount: number;
    taxFree: number;
}

interface VolumeUnit {
    name: string;
    virtualVolume: number;
    volume: number;
    price: number;
    taxFree: number;
    unit: string;
}

export type ModalityKey = 
  | "CT" | "MR" | "CR" | "DX" | "ECG" | "ES"
  | "MG" | "NM" | "PET" | "RF" | "US" | "XA"
  | "XC" | "PX" | "OCT" | "IVOCT" | "IVUS";

interface ModalityConfig {
    virtualSize: number;
}

interface Volume2Price extends PriceBase {
    type: "VOLUME2";
    units: VolumeUnit[];
    modalities: Partial<Record<ModalityKey, ModalityConfig>>;
    defaultOption: ModalityConfig;
    useExpectedPrice: boolean;
}

export type HospitalPrice = SimplePrice | Volume2Price;

export type Hospital = {
    id: string;
    name: string;
    address: string | null;
    registrationNumberRequired: boolean;
    disabed: boolean;
    price: HospitalPrice
    useMailing: boolean;
    mailingMandatory: boolean;
    loadEnabled: boolean;
    storeEnabled: boolean;
    health: unknown | null;
    onlineIssuanceMessage: string | null;
    hpacsHospitalId: string[];
}

export type mailingAddress = {
    postalCode: string;
    baseAddress: string;
    detailAddress: string;
    receiverName: string;
    receiverPhone: string;
}