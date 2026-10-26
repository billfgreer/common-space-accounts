import { useState } from "react";
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

const STEP_LABELS = ["Register", "Request", "Feasibility", "Order"];
const SENDABLE_STATUSES = new Set(["approved", "auto_approved"]);

type Step = 2 | 3 | 4;

function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function WizardProgress({ step }: { step: Step }) {
  return (
    <ol className="wizard-progress">
      {STEP_LABELS.map((label, idx) => {
        const n = idx + 1;
        const status = n === 1 || n < step ? "done" : n === step ? "active" : "upcoming";
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
  const [step, setStep] = useState<Step>(2);

  // Step 2 — request fields.
  const [imagingMode, setImagingMode] = useState<ImagingMode>("spot");
  const [footprint, setFootprint] = useState<AoiFootprint | null>(null);
  const [rationale, setRationale] = useState("");
  const [sensitivity, setSensitivity] = useState<Sensitivity>("routine");
  const [dataLifecycle, setDataLifecycle] = useState<DataLifecycle>("standard_1yr");

  // Step 3 — feasibility.
  const [feasibility, setFeasibility] = useState<FeasibilitySelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 4 — order.
  const [submittedRequest, setSubmittedRequest] = useState<TaskingRequest | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  function handleFootprintChange(next: AoiFootprint | null) {
    setFootprint(next);
    setFeasibility(null);
  }

  function resetWizard() {
    setStep(2);
    setImagingMode("spot");
    setFootprint(null);
    setRationale("");
    setSensitivity("routine");
    setDataLifecycle("standard_1yr");
    setFeasibility(null);
    setSubmitError(null);
    setSubmittedRequest(null);
    setOrderError(null);
  }

  function goToFeasibility() {
    if (!footprint || !rationale.trim()) return;
    setStep(3);
  }

  async function submitRequest() {
    if (!footprint || !feasibility) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { opportunity, acknowledgedConflict } = feasibility;
      const { data, error: invokeError } = await supabase.functions.invoke("submit-tasking-request", {
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
      });

      if (invokeError || data?.error) {
        setSubmitError("Could not submit request. Please check your inputs and try again.");
        return;
      }

      setSubmittedRequest(data.request);
      setStep(4);
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  async function placeOrder() {
    if (!submittedRequest) return;
    setOrderError(null);
    setOrderBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-to-scheduler", {
        body: { request_id: submittedRequest.id },
      });
      if (error || !data?.url) {
        setOrderError("Could not place this order. Please try again.");
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
      setSubmittedRequest((prev) => (prev ? { ...prev, sent_to_scheduler_at: new Date().toISOString() } : prev));
      onSubmitted();
    } finally {
      setOrderBusy(false);
    }
  }

  return (
    <div className="wizard">
      <WizardProgress step={step} />

      {step === 2 && (
        <div className="wizard-panel">
          <div className="cs-eyebrow">Step 02</div>
          <h2>New tasking request</h2>

          <fieldset>
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

          <AoiMap mode={imagingMode} onChange={handleFootprintChange} />

          <label>
            Rationale — why this area, why now
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} required />
          </label>

          <fieldset>
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

          <label>
            Data lifecycle
            <select value={dataLifecycle} onChange={(e) => setDataLifecycle(e.target.value as DataLifecycle)}>
              {(Object.keys(DATA_LIFECYCLE_LABELS) as DataLifecycle[]).map((key) => (
                <option key={key} value={key}>
                  {DATA_LIFECYCLE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <div className="wizard-actions">
            <button type="button" disabled={!footprint || !rationale.trim()} onClick={goToFeasibility}>
              Next: Check feasibility
            </button>
          </div>
        </div>
      )}

      {step === 3 && footprint && (
        <div className="wizard-panel">
          <div className="cs-eyebrow">Step 03</div>
          <h2>Check feasibility</h2>
          <FeasibilityPicker footprint={footprint} onChange={setFeasibility} />

          {submitError && <p className="form-error">{submitError}</p>}

          <div className="wizard-actions">
            <button type="button" className="wizard-back" onClick={() => setStep(2)}>
              Back
            </button>
            <button type="button" disabled={!feasibility || submitting} onClick={submitRequest}>
              {submitting ? "Submitting..." : "Submit request"}
            </button>
          </div>
        </div>
      )}

      {step === 4 && submittedRequest && (
        <div className="wizard-panel">
          <div className="cs-eyebrow">Step 04</div>
          <h2>Order</h2>

          <div className="order-summary">
            <div className="order-summary-header">
              <span>
                {submittedRequest.imaging_mode === "spot" ? "Spot" : "Strip"} ·{" "}
                {submittedRequest.centroid_lat.toFixed(3)}, {submittedRequest.centroid_lng.toFixed(3)}
              </span>
              <span className={`status-badge status-${submittedRequest.review_status}`}>
                {REVIEW_STATUS_LABELS[submittedRequest.review_status]}
              </span>
            </div>
            <p className="request-meta">
              {submittedRequest.satellite_id} pass {formatLocal(submittedRequest.pass_at)} ·{" "}
              {submittedRequest.confidence} confidence · {Math.round(submittedRequest.cloud_cover_pct)}% cloud ·{" "}
              {submittedRequest.nadir_deg.toFixed(1)}&deg; nadir
            </p>
            <p className="request-meta">
              Sensitivity: {submittedRequest.sensitivity} · Data lifecycle:{" "}
              {DATA_LIFECYCLE_LABELS[submittedRequest.data_lifecycle]}
            </p>
            <p>{submittedRequest.rationale}</p>
          </div>

          {SENDABLE_STATUSES.has(submittedRequest.review_status) ? (
            <>
              {orderError && <p className="form-error">{orderError}</p>}
              {submittedRequest.sent_to_scheduler_at ? (
                <p className="form-success">
                  Order placed {new Date(submittedRequest.sent_to_scheduler_at).toLocaleString()}.
                </p>
              ) : null}
              <div className="wizard-actions">
                <button type="button" disabled={orderBusy} onClick={placeOrder}>
                  {orderBusy ? "Placing order..." : submittedRequest.sent_to_scheduler_at ? "Resend order" : "Place order"}
                </button>
              </div>
            </>
          ) : (
            <p className="feasibility-status">
              This request needs admin review before it can be ordered. Check its status in "Your requests" below —
              you'll be able to place the order from there once it's approved.
            </p>
          )}

          <div className="wizard-actions">
            <button type="button" className="wizard-back" onClick={resetWizard}>
              Start another request
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
