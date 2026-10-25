export type Sensitivity = "routine" | "moderate" | "sensitive";
export type DataLifecycle = "standard_1yr" | "extended" | "delete_after_use";
export type ReviewStatus = "auto_approved" | "pending_review" | "approved" | "objected" | "denied";
export type ImagingMode = "spot" | "strip";
export type Confidence = "high" | "medium" | "low";
export type PriorityTier = "high" | "medium" | "low";

// A single candidate satellite pass, as returned by check-feasibility.
export interface Opportunity {
  satelliteId: string;
  passAt: string;
  deliveryEtaAt: string;
  nadirDeg: number;
  sunElevationDeg: number;
  cloudCoverPct: number;
  confidence: Confidence;
  resolutionM: number;
  coverageFraction: number;
  priorityTier: PriorityTier;
}

export interface ConflictSummary {
  hasConflict: boolean;
  overlapType: "full" | "partial" | null;
  ownRequest: boolean;
  conflictCount: number;
}

export interface TaskingRequest {
  id: string;
  requester_id: string;
  imaging_mode: ImagingMode;
  aoi_geojson: GeoJSON.Polygon;
  centroid_lat: number;
  centroid_lng: number;
  bounding_radius_km: number;
  rationale: string;
  sensitivity: Sensitivity;
  data_lifecycle: DataLifecycle;
  review_status: ReviewStatus;
  objection_flag: boolean;
  objection_reason: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;

  satellite_id: string;
  pass_at: string;
  delivery_eta_at: string;
  nadir_deg: number;
  sun_elevation_deg: number;
  cloud_cover_pct: number;
  resolution_m: number;
  confidence: Confidence;
  coverage_fraction: number;
  priority_tier: PriorityTier;
  acknowledged_conflict: boolean;
  impacted_geojson: GeoJSON.Polygon;
  impacted_centroid_lat: number;
  impacted_centroid_lng: number;
  impacted_bounding_radius_km: number;
  sent_to_scheduler_at: string | null;
}

// Shown inline on the request form so "sensitivity" isn't a guess — this is
// the rubric requesters self-classify against (v1: self-reported, not
// verified beyond the community-objection and review gates).
export const SENSITIVITY_RUBRIC: Record<Sensitivity, string> = {
  routine: "Public infrastructure, open terrain, or widely-known locations. No identifiable individuals or vulnerable populations expected.",
  moderate: "May capture populated areas, private property, or locations tied to an ongoing event. Some chance of identifiable people/structures.",
  sensitive: "Likely to capture vulnerable populations, active conflict/displacement, medical or humanitarian sites, or locations where imaging could cause harm if misused.",
};

export const DATA_LIFECYCLE_LABELS: Record<DataLifecycle, string> = {
  standard_1yr: "Standard — retain 1 year",
  extended: "Extended retention",
  delete_after_use: "Delete immediately after use",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  auto_approved: "Auto-approved",
  pending_review: "Pending review",
  approved: "Approved",
  objected: "Objected",
  denied: "Denied",
};
