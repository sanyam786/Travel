const { createClient } = require("@supabase/supabase-js");

const RESEND_API_URL = "https://api.resend.com/emails";

function siteUrl(event) {
  const host = event.headers["x-forwarded-host"] || event.headers.host;
  const proto = event.headers["x-forwarded-proto"] || "https";
  return process.env.URL || `${proto}://${host}`;
}

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

    const { tripId, collaboratorEmail } = JSON.parse(event.body || "{}");
    if (!tripId || !collaboratorEmail) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: "Missing tripId or collaboratorEmail" }) };
    }

    const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data: userData, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !userData?.user) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: "Invalid session" }) };
    }
    const caller = userData.user;

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Re-derive everything server-side — never trust role/email content from the client beyond routing.
    const { data: trip, error: tripErr } = await admin.from("trips").select("id,title,destination,user_id").eq("id", tripId).single();
    if (tripErr || !trip) return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: "Trip not found" }) };
    if (trip.user_id !== caller.id) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: "Only the trip owner can invite collaborators" }) };
    }

    const { data: collab, error: collabErr } = await admin
      .from("trip_collaborators")
      .select("invite_token, role, invited_email")
      .eq("trip_id", tripId)
      .eq("invited_email", collaboratorEmail.toLowerCase())
      .single();
    if (collabErr || !collab) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: "Invite record not found — create it before calling this function" }) };
    }

    const inviterName = caller.user_metadata?.full_name || caller.email;
    const tripName = trip.title || trip.destination;
    const link = `${siteUrl(event)}/join?trip=${trip.id}&token=${collab.invite_token}`;

    if (process.env.RESEND_API_KEY) {
      const emailRes = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "WanderAI <onboarding@resend.dev>",
          to: [collab.invited_email],
          subject: `${inviterName} invited you to plan "${tripName}" on WanderAI`,
          html: `<p><strong>${inviterName}</strong> invited you to collaborate on <strong>${tripName}</strong> as a${collab.role === "editor" ? "n editor" : " viewer"}.</p>
                 <p><a href="${link}">Open the trip →</a></p>
                 <p style="color:#64748B;font-size:13px">If you don't have a WanderAI account yet, this link will let you create one.</p>`
        })
      });
      if (!emailRes.ok) {
        const errBody = await emailRes.text();
        console.error("Resend error:", errBody);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, emailSent: false, warning: "Invite saved but email failed to send" }) };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, emailSent: !!process.env.RESEND_API_KEY }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
