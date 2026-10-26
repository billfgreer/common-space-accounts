// Hands an approved tasking request off to Satellite Foresight, the
// standalone scheduler app. Foresight has no API or backend of its own (see
// project notes), so the transport is a deep link: the task payload is
// base64-encoded into a `?import=` query param that Foresight reads on load.
//
// Only the request's owner or an admin may trigger this, and only once the
// request has cleared review (approved / auto_approved) — sending an
// unapproved request to the scheduler would bypass the governance gate in
// submit-tasking-request. The Foresight task object is rebuilt here from the
// stored row rather than trusted from the client, consistent with how
// governance-critical values are handled elsewhere in this project.

import { adminClient, requireCaller } from "../_shared/auth.ts";
import { buildForesightTask, encodeForesightTask } from "../_shared/foresight.ts";
import { corsJson, handlePreflight } from "../_shared/cors.ts";

const FORESIGHT_BASE_URL = "https://billfgreer.github.io/satellite-foresight/";
const SENDABLE_STATUSES = ["approved", "auto_approved"];

interface SendPayload {
  request_id: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return corsJson({ error: "method not allowed" }, { status: 405 });
  }

  const supabaseAdmin = adminClient();
  const caller = await requireCaller(req, supabaseAdmin);
  if ("error" in caller) {
    return corsJson({ error: caller.error }, { status: 401 });
  }

  let payload: SendPayload;
  try {
    payload = await req.json();
  } catch {
    return corsJson({ error: "invalid request body" }, { status: 400 });
  }

  const { request_id } = payload;
  if (!request_id?.trim()) {
    return corsJson({ error: "invalid_fields" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await supabaseAdmin
    .from("tasking_requests")
    .select("*")
    .eq("id", request_id)
    .single();

  if (fetchError || !row) {
    return corsJson({ error: "not_found" }, { status: 404 });
  }
  if (row.requester_id !== caller.userId && caller.profile.role !== "admin") {
    return corsJson({ error: "forbidden" }, { status: 403 });
  }
  if (!SENDABLE_STATUSES.includes(row.review_status)) {
    return corsJson({ error: "not_approved" }, { status: 409 });
  }

  const task = buildForesightTask(row);
  const encoded = encodeForesightTask(task);
  const url = `${FORESIGHT_BASE_URL}?import=${encodeURIComponent(encoded)}`;

  const { error: updateError } = await supabaseAdmin
    .from("tasking_requests")
    .update({ sent_to_scheduler_at: new Date().toISOString() })
    .eq("id", request_id);

  if (updateError) {
    return corsJson({ error: "update_failed" }, { status: 500 });
  }

  return corsJson({ url }, { status: 200 });
});
