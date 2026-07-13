const Groq = require("groq-sdk");
const { kidsNote, sanitizeItinerary, parseAiJson, COST_SCHEMA_NOTE, FULL_ITINERARY_SCHEMA } = require("./_lib/itinerary-helpers");

const SYSTEM_PROMPT = `You are WanderAI, an expert travel planner. Generate complete travel itineraries as JSON ONLY — no markdown, no explanation.

${COST_SCHEMA_NOTE}

Return this EXACT structure:
${FULL_ITINERARY_SCHEMA}

Use precise real GPS coordinates. All places must be real existing locations.`;

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { origin, destination, startDate, endDate, travelers, originCurrency, preferences } = JSON.parse(event.body);
    if (!origin || !destination || !startDate || !endDate) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields" }) };
    }

    const currency = originCurrency || "USD";
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
    const p = preferences || {};

    const prompt = `Plan a ${days}-day trip from ${origin} to ${destination}.
- Dates: ${startDate} to ${endDate}
- Travelers: ${travelers || 1} adult(s)${kidsNote(p)}
- Budget: ${p.budget || "moderate"}
- Interests: ${(p.interests || []).join(", ") || "culture, food, sightseeing"}
- Dietary: ${p.dietary || "none"}
- Accommodation: ${p.accommodation || "mid-range hotel"}
- Pace: ${p.pace || "moderate"}
- Currency: price every cost field as plain numbers in ${currency} (ISO code) — the traveler's home currency. Estimate realistic ${currency} amounts for the destination's actual price level, don't just reuse USD numbers relabeled.
${p.notes ? "- Notes: " + p.notes : ""}

Cover all ${days} days with real places, accurate GPS, costs, booking links. Include flight on day 1 if international.`;

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      temperature: 0.65,
      max_tokens: 8000,
      response_format: { type: "json_object" }
    });

    const itinerary = parseAiJson(completion.choices[0].message.content);
    if (!itinerary.days || !Array.isArray(itinerary.days)) throw new Error("Invalid itinerary structure");

    sanitizeItinerary(itinerary, currency);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, itinerary }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
