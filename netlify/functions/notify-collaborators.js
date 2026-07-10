const { createClient } = require("@supabase/supabase-js");

const RESEND_API_URL = "https://api.resend.com/emails";

const CHANGE_COPY = {
  itinerary_edit: (actor, trip) => `${actor} updated the itinerary for "${trip}"`,
  collaborator_added: (actor, trip) => `${actor} joined "${trip}"`,
  collaborator_removed: (actor, trip) => `Someone was removed from "${trip}"`,
  role_changed: (actor, trip) => `A collaborator's role changed on "${trip}"`
};

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const token = authHeader && authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: "Missing auth token" }) };

    const { tripId, changeType } = JSON.parse(event.body || "{}");
    if (!tripId || !CHANGE_COPY[changeType]) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: "Missing/invalid tripId or changeType" }) };
    }

    const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data: userData, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !userData?.user) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: "Invalid session" }) };
    }
    const actor = userData.user;

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Confirm the actor actually has access to this trip (owner or accepted collaborator) before emailing anyone about it.
    const { data: trip } = await admin.from("trips").select("id,title,destination,user_id").eq("id", tripId).single();
    if (!trip) return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: "Trip not found" }) };

    const { data: collabRows } = await admin
      .from("trip_collaborators")
      .select("user_id")
      .eq("trip_id", tripId)
      .eq("status", "accepted");

    const isOwner = trip.user_id === actor.id;
    const isCollaborator = (collabRows || []).some(c => c.user_id === actor.id);
    if (!isOwner && !isCollaborator) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: "Not a member of this trip" }) };
    }

    const recipientIds = new Set([trip.user_id, ...(collabRows || []).map(c => c.user_id)]);
    recipientIds.delete(actor.id);
    recipientIds.delete(null);
    recipientIds.delete(undefined);

    if (!recipientIds.size || !process.env.RESEND_API_KEY) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, emailed: 0 }) };
    }

    const { data: recipients } = await admin.auth.admin.listUsers();
    const emailById = new Map((recipients?.users || []).map(u => [u.id, u.email]));

    const actorName = actor.user_metadata?.full_name || actor.email;
    const tripName = trip.title || trip.destination;
    const subject = CHANGE_COPY[changeType](actorName, tripName);

    let emailed = 0;
    for (const uid of recipientIds) {
      const email = emailById.get(uid);
      if (!email) continue;
      const res = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "WanderAI <onboarding@resend.dev>",
          to: [email],
          subject,
          html: `<p>${subject}.</p><p><a href="${process.env.URL || ""}/trip.html?id=${trip.id}">View the trip →</a></p>`
        })
      });
      if (res.ok) emailed++;
      else console.error("Resend error:", await res.text());
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, emailed }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
