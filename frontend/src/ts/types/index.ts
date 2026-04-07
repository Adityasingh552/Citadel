/** Citadel frontend type definitions. */

export type EventType = 'accident';
export type Severity = 'high' | 'medium' | 'low';
export type TicketStatus = 'issued' | 'pending' | 'resolved';
export type DashboardView = 'overview' | 'incidents' | 'live' | 'monitor' | 'cameras' | 'settings';

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
    total_tickets: number;
    severity_breakdown: SeverityBreakdown;
    timeline_24h: TimelinePoint[];
}

export interface ConfidenceBin {
    label: string;
    count: number;
}

export interface Incident {
    id: string;
    ticket_id: string | null;
    timestamp: string;
    event_type: string;
    confidence: number;
    severity: Severity;
    evidence_path: string | null;
    source_video: string | null;
    metadata: Record<string, unknown> | null;
    status: TicketStatus | 'no_ticket';
    issued_at: string | null;
    created_at: string;
}

export interface IncidentListResponse {
    incidents: Incident[];
    total: number;
    limit: number;
    offset: number;
}

export interface IncidentStats {
    total_incidents: number;
    resolved_count: number;
    pending_count: number;
    issued_count: number;
    avg_confidence: number;
    confidence_distribution: ConfidenceBin[];
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
    model_path: string;
    confidence_threshold_manual: number;
    confidence_threshold_cctv: number;
    detect_accidents: boolean;
}

export interface ChartDataPoint {
    label: string;
    value: number;
    color: string;
}

// ── Camera / Monitor Types ──

export interface CameraInfo {
    id: string;
    /** 'caltrans' for California cameras; 'iowa' for Iowa DOT cameras. Absent on older cached data. */
    source?: 'caltrans' | 'iowa';
    district: number;
    district_name: string;
    location_name: string;
    latitude: number;
    longitude: number;
    snapshot_url: string;
    stream_url: string;
    direction: string;
    county: string;        // Iowa: mapped from 'region'
    route: string;
    in_service: boolean;
    update_frequency: number;  // minutes
    // Iowa-specific (undefined for Caltrans cameras)
    region?: string;           // Iowa DOT region name
    state?: string;            // 'Iowa'
    common_id?: string;        // e.g. 'DQTV17'
    camera_type?: string;      // 'Iowa DOT' | 'RWIS' | ...
    fid?: number;              // ArcGIS feature ID
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
    paused: boolean;
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

// ── Alerts & Notifications ──

export interface AlertLog {
    id: string;
    event_id: string;
    channel: string;
    status: 'sent' | 'failed' | 'suppressed' | 'dispatched';
    recipient: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
}

export interface AlertLogListResponse {
    alerts: AlertLog[];
    total: number;
    limit: number;
    offset: number;
}

export interface AlertStats {
    total_sent: number;
    total_failed: number;
    total_suppressed: number;
    by_channel: Record<string, { sent: number; failed: number; suppressed: number }>;
}

export interface TwilioConfig {
    enabled_manual: boolean;
    enabled_cctv: boolean;
}

export interface EmailConfig {
    enabled: boolean;
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_password?: string;
    from_address: string;
    to_addresses: string[];
}

export interface WebhookConfig {
    enabled: boolean;
    url: string;
    headers: Record<string, string>;
}

export interface NotificationChannels {
    twilio: TwilioConfig;
    email: EmailConfig;
    webhook: WebhookConfig;
    cooldown_seconds: number;
}

export interface ServiceStatus {
    model: boolean;
    detection: boolean;
    twilio: boolean;
    telegram: boolean;
    email: boolean;
}
