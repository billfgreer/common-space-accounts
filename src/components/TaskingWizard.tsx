import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  SENSITIVITY_RUBRIC,
  DATA_LIFECYCLE_LABELS,
  REVIEW_STATUS_LABELS,
  type Sensitivity,
  type DataLifecycle,
  type ImagingMode,
  type TaskingRequest,
} from "../lib/tasking";
import AoiMap from "./AoiMap";
import FeasibilityPicker, { type FeasibilitySelection } from "./FeasibilityPicker";
import type { AoiFootprint } from "../lib/geo";

const STEP_LABELS = ["Request", "Feasibility", "Order"];
const SENDABLE_STATUSES = new Set(["approved", "auto_approved"]);

type Stage = 1 | 2 | 3;

interface OrderState {
  busy: boolean;
  error: string | null;
}

function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function WizardProgress({ stage }: { stage: Stage }) {
  return (
    <ol className="wizard-progress">
      {STEP_LABELS.map((label, idx) => {
        const n = idx + 1;
        const status = n < stage ? "done" : n === stage ? "active" : "upcoming";
        return (
          <li key={label} className={`wizard-step wizard-step-${status}`}>
            <span className="wizard-step-dot">
              {status === "done" ? "\u2713" : String(n).padStart(2, "0")}
            </span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function TaskingWizard({ onSubmitted }: { onSubmitted: () => void }) {
  // Request fields.
  const [imagingMode, setImagingMode] = useState<ImagingMode>("spot");
  const [footprint, setFootprint] = useState<AoiFootprint | null>(null);
  const [rationale, setRationale] = useState("");
  const [sensitivity, setSensitivity] = useState<Sensitivity>("routine");
  const [dataLifecycle] = useState<DataLifecycle>("standard_1yr");

  // Feasibility.
  const [feasibility, setFeasibility] = useState<FeasibilitySelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Order.
  const [submittedRequests, setSubmittedRequests] = useState<TaskingRequest[]>([]);
  const [orderState, setOrderState] = useState<Record<string, OrderState>>({});

  const feasibilityRef = useRef<HTMLDivElement>(null);
  const orderRef = useRef<HTMLDivElement>(null);

  const hasRequestDetails = !!footprint && !!rationale.trim();
  const isSubmitted = submittedRequests.length > 0;
  const stage: Stage = isSubmitted ? 3 : hasRequestDetails ? 2 : 1;

  // Swoop the newly-relevant section into view as the workflow advances.
  useEffect(() => {
    if (stage === 2) feasibilityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (stage === 3) orderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [stage]);

  function handleFootprintChange(next: AoiFootprint | null) {
    setFootprint(next);
    setFeasibility(null);
  }

  function resetWizard() {
    setImagingMode("spot");
    setFootprint(null);
    setRationale("");
    setSensitivity("routine");
    setFeasibility(null);
    setSubmitError(null);
    setSubmittedRequests([]);
    setOrderState({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitRequest() {
    if (!footprint || !feasibility || feasibility.opportunities.length === 0) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { opportunities, acknowledgedConflict } = feasibility;
      const results = await Promise.all(
        opportunities.map((opportunity) =>
          supabase.functions.invoke("submit-tasking-request", {
            body: {
              imaging_mode: footprint.mode,
              aoi_geojson: footprint.polygon,
              centroid_lat: footprint.centroidLat,
              centroid_lng: footprint.centroidLng,
              bounding_radius_km: footprint.boundingRadiusKm,
              rationale,
              sensitivity,
              data_lifecycle: dataLifecycle,
              satellite_id: opportunity.satelliteId,
              pass_at: opportunity.passAt,
              delivery_eta_at: opportunity.deliveryEtaAt,
              nadir_deg: opportunity.nadirDeg,
              sun_elevation_deg: opportunity.sunElevationDeg,
              cloud_cover_pct: opportunity.cloudCoverPct,
              resolution_m: opportunity.resolutionM,
              confidence: opportunity.confidence,
              coverage_fraction: opportunity.coverageFraction,
              priority_tier: opportunity.priorityTier,
              acknowledged_conflict: acknowledgedConflict,
            },
          })
        )
      );

      if (results.some((r) => r.error || r.data?.error)) {
        setSubmitError("Could not submit one or more requests. Please check your inputs and try again.");
        return;
      }

      setSubmittedRequests(results.map((r) => r.data.request as TaskingRequest));
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  async function placeOrder(requestId: string) {
    setOrderState((prev) => ({ ...prev, [requestId]: { busy: true, error: null } }));
    try {
      const { data, error } = await supabase.functions.invoke("send-to-scheduler", {
        body: { request_id: requestId },
      });
      if (error || !data?.url) {
        setOrderState((prev) => ({
          ...prev,
          [requestId]: { busy: false, error: "Could not place this order. Please try again." },
        }));
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
      setSubmittedRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, sent_to_scheduler_at: new Date().toISOString() } : r))
      );
      setOrderState((prev) => ({ ...prev, [requestId]: { busy: false, error: null } }));
      onSubmitted();
    } catch {
      setOrderState((prev) => ({
        ...prev,
        [requestId]: { busy: false, error: "Could not place this order. Please try again." },
      }));
    }
  }

  return (
    <div className="wizard">
      <WizardProgress stage={stage} />

      <div className="wizard-map-step">
        <AoiMap mode={imagingMode} onChange={handleFootprintChange} locked={isSubmitted} />

        <div className="wizard-panel wizard-map-panel">
          <div className="cs-eyebrow">Step 01</div>
          <h2>New tasking request</h2>

          <fieldset disabled={isSubmitted}>
            <legend>Imaging mode</legend>
            <label className="radio-row">
              <input
                type="radio"
                name="imaging_mode"
                checked={imagingMode === "spot"}
                onChange={() => setImagingMode("spot")}
              />
              <span>
                <strong>Spot</strong> — single 6&times;6km footprint
              </span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="imaging_mode"
                checked={imagingMode === "strip"}
                onChange={() => setImagingMode("strip")}
              />
              <span>
                <strong>Strip</strong> — 6km-wide swath, up to 30km long
              </span>
            </label>
          </fieldset>

          <label>
            Rationale — why this area, why now
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              required
              disabled={isSubmitted}
            />
          </label>

          <fieldset disabled={isSubmitted}>
            <legend>Sensitivity classification</legend>
            {(Object.keys(SENSITIVITY_RUBRIC) as Sensitivity[]).map((level) => (
              <label key={level} className="radio-row">
                <input
                  type="radio"
                  name="sensitivity"
                  value={level}
                  checked={sensitivity === level}
                  onChange={() => setSensitivity(level)}
                />
                <span>
                  <strong>{level}</strong> — {SENSITIVITY_RUBRIC[level]}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </div>

      <div className={`wizard-reveal${hasRequestDetails && !isSubmitted ? " is-open" : ""}`}>
        <div className="wizard-reveal-inner" ref={feasibilityRef}>
          <div className="wizard-panel">
            <div className="cs-eyebrow">Step 02</div>
            <h2>Check feasibility</h2>

            {footprint && <FeasibilityPicker footprint={footprint} onChange={setFeasibility} />}

            {submitError && <p className="form-error">{submitError}</p>}

            <div className="wizard-actions">
              <button type="button" disabled={!feasibility || submitting} onClick={submitRequest}>
                {submitting
                  ? "Submitting..."
                  : feasibility && feasibility.opportunities.length > 1
                    ? `Submit ${feasibility.opportunities.length} requests`
                    : "Submit request"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`wizard-reveal${isSubmitted ? " is-open" : ""}`}>
        <div className="wizard-reveal-inner" ref={orderRef}>
          <div className="wizard-panel">
            <div className="cs-eyebrow">Step 03</div>
            <h2>Order</h2>
            <p className="request-meta">
              {submittedRequests.length} request{submittedRequests.length === 1 ? "" : "s"} submitted
            </p>

            <div className="order-list">
              {submittedRequests.map((request) => {
                const state = orderState[request.id];
                return (
                  <div key={request.id} className="order-summary">
                    <div className="order-summary-header">
                      <span>
                        {request.imaging_mode === "spot" ? "Spot" : "Strip"} ·{" "}
                        {request.centroid_lat.toFixed(3)}, {request.centroid_lng.toFixed(3)}
                      </span>
                      <span className={`status-badge status-${request.review_status}`}>
                        {REVIEW_STATUS_LABELS[request.review_status]}
                      </span>
                    </div>
                    <p className="request-meta">
                      {request.satellite_id} pass {formatLocal(request.pass_at)} ·{" "}
                      {request.confidence} confidence · {Math.round(request.cloud_cover_pct)}% cloud ·{" "}
                      {request.nadir_deg.toFixed(1)}&deg; nadir
                    </p>
                    <p className="request-meta">
                      Sensitivity: {request.sensitivity} · Data lifecycle:{" "}
                      {DATA_LIFECYCLE_LABELS[request.data_lifecycle]}
                    </p>
                    <p>{request.rationale}</p>

                    {SENDABLE_STATUSES.has(request.review_status) ? (
                      <>
                        {state?.error && <p className="form-error">{state.error}</p>}
                        {request.sent_to_scheduler_at ? (
                          <p className="form-success">
                            Order placed {new Date(request.sent_to_scheduler_at).toLocaleString()}.
                          </p>
                        ) : null}
                        <div className="wizard-actions">
                          <button type="button" disabled={state?.busy} onClick={() => placeOrder(request.id)}>
                            {state?.busy
                              ? "Placing order..."
                              : request.sent_to_scheduler_at
                                ? "Resend order"
                                : "Place order"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="feasibility-status">
                        Needs admin review before it can be ordered. Check "Your requests" below.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="wizard-actions">
              <button type="button" className="wizard-back" onClick={resetWizard}>
                Start another request
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
