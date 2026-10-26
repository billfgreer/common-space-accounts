import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { REVIEW_STATUS_LABELS, type TaskingRequest } from "../lib/tasking";

const SENDABLE_STATUSES = new Set(["approved", "auto_approved"]);

export default function MyRequestsList({ refreshKey }: { refreshKey: number }) {
  const [requests, setRequests] = useState<TaskingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("tasking_requests")
      .select("*")
      .order("created_at", { ascending: false });
    setRequests(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function sendToScheduler(requestId: string) {
    setSendError(null);
    setBusyId(requestId);
    try {
      const { data, error } = await supabase.functions.invoke("send-to-scheduler", {
        body: { request_id: requestId },
      });
      if (error || !data?.url) {
        setSendError("Could not place this order. Please try again.");
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p>Loading requests...</p>;
  if (requests.length === 0) return <p>No tasking requests yet.</p>;

  return (
    <div className="requests-list">
      <div className="cs-eyebrow">Activity</div>
      <h2>Your requests</h2>
      {sendError && <p className="form-error">{sendError}</p>}
      {requests.map((r) => (
        <div key={r.id} className="request-card">
          <div className="request-card-header">
            <span>
              {r.imaging_mode === "spot" ? "Spot" : "Strip"} · {r.centroid_lat.toFixed(3)}, {r.centroid_lng.toFixed(3)}
            </span>
            <span className={`status-badge status-${r.review_status}`}>
              {REVIEW_STATUS_LABELS[r.review_status]}
            </span>
          </div>
          <p>{r.rationale}</p>
          <p className="request-meta">
            Sensitivity: {r.sensitivity} · Data lifecycle: {r.data_lifecycle}
          </p>
          <p className="request-meta">
            {r.satellite_id} pass {new Date(r.pass_at).toLocaleString()} · {r.confidence} confidence ·{" "}
            {Math.round(r.cloud_cover_pct)}% cloud · {r.nadir_deg.toFixed(1)}&deg; nadir
          </p>
          {r.objection_flag && <p className="form-error">Flagged: {r.objection_reason}</p>}
          {r.decision_reason && <p className="request-meta">Decision note: {r.decision_reason}</p>}
          {SENDABLE_STATUSES.has(r.review_status) && (
            <div className="review-actions">
              <button disabled={busyId === r.id} onClick={() => sendToScheduler(r.id)}>
                {busyId === r.id ? "Placing order..." : r.sent_to_scheduler_at ? "Resend order" : "Place order"}
              </button>
              {r.sent_to_scheduler_at && (
                <span className="request-meta">Sent {new Date(r.sent_to_scheduler_at).toLocaleString()}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
