// Admin decision on a pending_review tasking request (decision-rights
// workflow). Only role = admin may call this. A reason is always required —
// rationale logging applies to decisions, not just requests.

import { adminClient, requireCaller } from "../_shared/auth.ts";

interface ReviewPayload {
  request_id: string;
  decision: "approved" | "denied";
  decision_reason: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }

  const supabaseAdmin = adminClient();
  const caller = await requireCaller(req, supabaseAdmin);
  if ("error" in caller) {
    return new Response(JSON.stringify({ error: caller.error }), { status: 401 });
  }
  if (caller.profile.role !== "admin") {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  let payload: ReviewPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid request body" }), { status: 400 });
  }

  const { request_id, decision, decision_reason } = payload;
  if (!request_id || !["approved", "denied"].includes(decision) || !decision_reason?.trim()) {
    return new Response(JSON.stringify({ error: "invalid_fields" }), { status: 400 });
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("tasking_requests")
    .select("review_status")
    .eq("id", request_id)
    .single();

  if (fetchError || !existing) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  }
  if (existing.review_status !== "pending_review") {
    return new Response(JSON.stringify({ error: "not_pending" }), { status: 409 });
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("tasking_requests")
    .update({
      review_status: decision,
      decision_reason,
      decided_at: new Date().toISOString(),
      decided_by: caller.userId,
    })
    .eq("id", request_id)
    .select()
    .single();

  if (updateError) {
    return new Response(JSON.stringify({ error: "update_failed" }), { status: 500 });
  }

  return new Response(JSON.stringify({ request: updated }), { status: 200 });
});
