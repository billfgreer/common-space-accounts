import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { SENSITIVITY_RUBRIC, DATA_LIFECYCLE_LABELS, type Sensitivity, type DataLifecycle, type ImagingMode } from "../lib/tasking";
import AoiMap from "./AoiMap";
import FeasibilityPicker, { type FeasibilitySelection } from "./FeasibilityPicker";
import type { AoiFootprint } from "../lib/geo";

export default function TaskingRequestForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [imagingMode, setImagingMode] = useState<ImagingMode>("spot");
  const [footprint, setFootprint] = useState<AoiFootprint | null>(null);
  const [feasibility, setFeasibility] = useState<FeasibilitySelection | null>(null);
  const [rationale, setRationale] = useState("");
  const [sensitivity, setSensitivity] = useState<Sensitivity>("routine");
  const [dataLifecycle, setDataLifecycle] = useState<DataLifecycle>("standard_1yr");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function handleFootprintChange(next: AoiFootprint | null) {
    setFootprint(next);
    setFeasibility(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!footprint) {
      setError("Draw an AOI on the map before submitting.");
      return;
    }
    if (!feasibility) {
      setError("Select a satellite pass before submitting.");
      return;
    }

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
        setError("Could not submit request. Please check your inputs and try again.");
        return;
      }

      setResult(
        data.request.review_status === "auto_approved"
          ? "Request auto-approved."
          : "Request submitted and is pending review.",
      );
      setRationale("");
      setFootprint(null);
      setFeasibility(null);
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="tasking-form" onSubmit={handleSubmit}>
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

      {footprint && <FeasibilityPicker footprint={footprint} onChange={setFeasibility} />}

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

      {error && <p className="form-error">{error}</p>}
      {result && <p className="form-success">{result}</p>}

      <button type="submit" disabled={submitting || !footprint || !feasibility}>
        {submitting ? "Submitting..." : "Submit request"}
      </button>
    </form>
  );
}
