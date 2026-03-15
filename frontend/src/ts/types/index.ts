/** Citadel frontend type definitions. */

export type EventType = 'accident' | 'vehicle';
export type Severity = 'high' | 'medium' | 'low';
export type TicketStatus = 'issued' | 'pending' | 'resolved';
export type DashboardView = 'overview' | 'events' | 'tickets' | 'live' | 'monitor' | 'cameras' | 'settings';

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    confidence: number;
}

export interface CitadelEvent {
    id: string;
    timestamp: string;
    event_type: EventType;
    confidence: number;
    severity: Severity;
    evidence_path: string | null;
    bbox_data: Record<string, unknown>[] | null;
    source_video: string | null;
    frame_number: number | null;
    metadata_: Record<string, unknown> | null;
    created_at: string;
}

export interface EventListResponse {
    events: CitadelEvent[];
    total: number;
    limit: number;
    offset: number;
}

export interface ViolationTicket {
    id: string;
    event_id: string;
    violation_type: EventType;
    vehicle_description: string | null;
    location_info: string | null;
    evidence_path: string | null;
    issued_at: string;
    status: TicketStatus;
    created_at: string;
}

export interface TicketListResponse {
    tickets: ViolationTicket[];
    total: number;
    limit: number;
    offset: number;
}

export interface TimelinePoint {
    hour: string;
    count: number;
}

export interface SeverityBreakdown {
    high: number;
    medium: number;
    low: number;
}

export interface SystemStats {
    total_events: number;
    total_accidents: number;
    total_vehicles: number;
    total_tickets: number;
    severity_breakdown: SeverityBreakdown;
    timeline_24h: TimelinePoint[];
}

export interface DetectionResult {
    label: string;
    confidence: number;
    bbox: BoundingBox;
}

export interface VideoProcessingResult {
    video_name: string;
    total_frames: number;
    frames_processed: number;
    events_created: number;
    tickets_created: number;
    detections: DetectionResult[];
}

export interface AppSettings {
    model_name: string;
    confidence_threshold: number;
    detect_accidents: boolean;
    detect_vehicles: boolean;
    frame_interval: number;
}

export interface ChartDataPoint {
    label: string;
    value: number;
    color: string;
}

// ── Camera / Monitor Types ──

export interface CameraInfo {
    id: string;
    district: number;
    district_name: string;
    location_name: string;
    latitude: number;
    longitude: number;
    snapshot_url: string;
    stream_url: string;
    direction: string;
    county: string;
    route: string;
    in_service: boolean;
    update_frequency: number;  // minutes — from Caltrans currentImageUpdateFrequency
}

export interface CameraListResponse {
    cameras: CameraInfo[];
    total: number;
    limit: number;
}

export interface CameraDistrict {
    id: number;
    name: string;
}

export interface MonitorDetection {
    label: string;
    confidence: number;
    severity: string;
    evidence_path: string | null;
    timestamp: string;
    camera_name: string;
    event_id: string;
}

export interface MonitorStatus {
    active: boolean;
    camera_id: string | null;
    camera_name: string;
    camera_location: string;
    started_at: string | null;
    frames_analyzed: number;
    detections_found: number;
    accidents_found: number;
    last_frame_time: string | null;
    last_snapshot_url: string | null;
    poll_interval: number;
    stream_mode: boolean;
    stream_interval: number;
    recent_detections: MonitorDetection[];
    error: string | null;
    skipped_unchanged: number;
}

export interface MonitorStatusResponse {
    monitors: MonitorStatus[];
    active_count: number;
    total_count: number;
}
