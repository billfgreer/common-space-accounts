import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { AoiFootprint } from "../lib/geo";
import type { ConflictSummary, Opportunity } from "../lib/tasking";

export interface FeasibilitySelection {
  opportunity: Opportunity;
  acknowledgedConflict: boolean;
}

interface FeasibilityPickerProps {
  footprint: AoiFootprint;
  onChange: (selection: FeasibilitySelection | null) => void;
}

function opportunityKey(o: Opportunity): string {
  return `${o.satelliteId}@${o.passAt}`;
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

export default function FeasibilityPicker({ footprint, onChange }: FeasibilityPickerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [conflicts, setConflicts] = useState<ConflictSummary | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOpportunities([]);
    setConflicts(null);
    setSelectedKey(null);
    setAcknowledged(false);
    setError(null);
    onChange(null);

    async function run() {
      setLoading(true);
      try {
        const { data, error: invokeError } = await supabase.functions.invoke("check-feasibility", {
          body: {
            imaging_mode: footprint.mode,
            aoi_geojson: footprint.polygon,
            centroid_lat: footprint.centroidLat,
            centroid_lng: footprint.centroidLng,
            bounding_radius_km: footprint.boundingRadiusKm,
          },
        });
        if (cancelled) return;
        if (invokeError || data?.error) {
          setError("Could not check feasibility for this area. Try adjusting your selection.");
          return;
        }
        setOpportunities(data.opportunities ?? []);
        setConflicts(data.conflicts ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footprint]);

  const needsAcknowledgment = !!conflicts?.hasConflict && !conflicts.ownRequest;

  function selectOpportunity(o: Opportunity) {
    const key = opportunityKey(o);
    setSelectedKey(key);
    if (needsAcknowledgment && !acknowledged) {
      onChange(null);
    } else {
      onChange({ opportunity: o, acknowledgedConflict: acknowledged });
    }
  }

  function toggleAcknowledged(checked: boolean) {
    setAcknowledged(checked);
    const selected = opportunities.find((o) => opportunityKey(o) === selectedKey);
    if (selected && (checked || !needsAcknowledgment)) {
      onChange({ opportunity: selected, acknowledgedConflict: checked });
    } else {
      onChange(null);
    }
  }

  if (loading) return <p className="feasibility-status">Checking feasibility…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!opportunities.length) {
    return <p className="feasibility-status">No satellite passes found over this area in the next 4 days.</p>;
  }

  return (
    <div className="feasibility-picker">
      {conflicts?.hasConflict && (
        <div className="conflict-banner">
          <p>
            {conflicts.ownRequest
              ? "You already have another active request covering this area."
              : `${conflicts.overlapType === "full" ? "Fully" : "Partially"} overlaps ${conflicts.conflictCount} other active tasking request${conflicts.conflictCount === 1 ? "" : "s"}.`}
          </p>
          {needsAcknowledgment && (
            <label className="conflict-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => toggleAcknowledged(e.target.checked)}
              />
              I understand this area may already be covered and want to submit anyway.
            </label>
          )}
        </div>
      )}

      <p className="feasibility-note">
        Each pass images a fixed sensor swath along the satellite's ground track — the actual
        "impacted" footprint can be larger than your selected area.
      </p>

      <div className="opportunity-list">
        {opportunities.map((o) => {
          const key = opportunityKey(o);
          const isSelected = key === selectedKey;
          return (
            <label key={key} className={`opportunity-card${isSelected ? " selected" : ""}`}>
              <input
                type="radio"
                name="opportunity"
                checked={isSelected}
                onChange={() => selectOpportunity(o)}
              />
              <div className="opportunity-body">
                <div className="opportunity-header">
                  <span className="satellite-chip">{o.satelliteId}</span>
                  <span>{formatLocal(o.passAt)}</span>
                  <span className={`priority-badge priority-${o.priorityTier}`}>{o.priorityTier} priority</span>
                </div>
                <div className="opportunity-meta">
                  <span className={`confidence-badge confidence-${o.confidence}`}>
                    {o.confidence} confidence
                  </span>
                  <span>{Math.round(o.cloudCoverPct)}% cloud</span>
                  <span>{o.nadirDeg.toFixed(1)}&deg; nadir</span>
                  <span>
                    sun {o.sunElevationDeg >= 0 ? "+" : ""}
                    {o.sunElevationDeg.toFixed(0)}&deg;
                  </span>
                  <span>{o.resolutionM.toFixed(2)}m GSD</span>
                  <span>delivery ~{formatLocal(o.deliveryEtaAt)}</span>
                  {o.coverageFraction < 1 && (
                    <span className="coverage-note">{Math.round(o.coverageFraction * 100)}% of strip covered this pass</span>
                  )}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
