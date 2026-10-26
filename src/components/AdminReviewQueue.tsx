import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { TaskingRequest } from "../lib/tasking";

export default function AdminReviewQueue() {
  const [pending, setPending] = useState<TaskingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("tasking_requests")
      .select("*")
      .eq("review_status", "pending_review")
      .order("created_at", { ascending: true });
    setPending(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(requestId: string, decision: "approved" | "denied") {
    const reason = window.prompt(`Reason for ${decision === "approved" ? "approving" : "denying"} this request?`);
    if (!reason?.trim()) return;

    setBusyId(requestId);
    try {
      await supabase.functions.invoke("review-tasking-request", {
        body: { request_id: requestId, decision, decision_reason: reason },
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p>Loading review queue...</p>;

  return (
    <div className="requests-list">
      <div className="cs-eyebrow">Admin</div>
      <h2>Pending review ({pending.length})</h2>
      {pending.length === 0 && <p>Nothing awaiting review.</p>}
      {pending.map((r) => (
        <div key={r.id} className="request-card">
          <div className="request-card-header">
            <span>
              {r.imaging_mode === "spot" ? "Spot" : "Strip"} · {r.centroid_lat.toFixed(3)}, {r.centroid_lng.toFixed(3)}
            </span>
            <span>{r.sensitivity}</span>
          </div>
          <p>{r.rationale}</p>
          <p className="request-meta">
            {r.satellite_id} pass {new Date(r.pass_at).toLocaleString()} · {r.confidence} confidence ·{" "}
            {Math.round(r.cloud_cover_pct)}% cloud · {r.nadir_deg.toFixed(1)}&deg; nadir
            {r.acknowledged_conflict ? " · conflict acknowledged" : ""}
          </p>
          {r.objection_flag && <p className="form-error">Flagged: {r.objection_reason}</p>}
          <div className="review-actions">
            <button disabled={busyId === r.id} onClick={() => decide(r.id, "approved")}>
              Approve
            </button>
            <button
              className="btn-outline-danger"
              disabled={busyId === r.id}
              onClick={() => decide(r.id, "denied")}
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
