const Groq = require("groq-sdk");
const { kidsNote, sanitizeItinerary, sanitizeDay, parseAiJson, COST_SCHEMA_NOTE, DAY_SCHEMA, FULL_ITINERARY_SCHEMA } = require("./_lib/itinerary-helpers");

const TRIP_SYSTEM_PROMPT = `You are WanderAI, an expert travel planner. A traveler already received a plan and wants it regenerated with specific changes. Produce a fresh, complete itinerary as JSON ONLY — no markdown, no explanation.

${COST_SCHEMA_NOTE}

Return this EXACT structure:
${FULL_ITINERARY_SCHEMA}

Use precise real GPS coordinates. All places must be real existing locations.`;

const DAY_SYSTEM_PROMPT = `You are WanderAI, an expert travel planner. A traveler wants a single day of their existing itinerary regenerated with specific changes, while the rest of the trip stays as-is. Produce JSON ONLY for that one day — no markdown, no explanation, no wrapping object, no other days.

${COST_SCHEMA_NOTE}

Return this EXACT structure for the single day:
${DAY_SCHEMA}

Keep the day's city/country and transport consistent with the neighboring days described below, unless the traveler's feedback explicitly asks to change them. Use precise real GPS coordinates. All places must be real existing locations.`;

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
    const body = JSON.parse(event.body);
    const { scope, origin, destination, startDate, endDate, travelers, originCurrency, preferences, feedback } = body;

    if (!origin || !destination || !startDate || !endDate) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields" }) };
    }
    if (!feedback || !feedback.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Feedback is required to regenerate" }) };
    }

    const currency = originCurrency || "USD";
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
    const p = preferences || {};
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const baseDetails = `- Dates: ${startDate} to ${endDate}
- Travelers: ${travelers || 1} adult(s)${kidsNote(p)}
- Budget: ${p.budget || "moderate"}
- Interests: ${(p.interests || []).join(", ") || "culture, food, sightseeing"}
- Dietary: ${p.dietary || "none"}
- Accommodation: ${p.accommodation || "mid-range hotel"}
- Pace: ${p.pace || "moderate"}
- Currency: price every cost field as plain numbers in ${currency} (ISO code) — the traveler's home currency.
${p.notes ? "- Notes: " + p.notes : ""}`;

    if (scope === "day") {
      const { dayIndex, currentDay, previousDayCity, nextDayCity } = body;
      if (currentDay == null || dayIndex == null) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing currentDay/dayIndex for day regeneration" }) };
      }

      const prompt = `This is day ${dayIndex + 1} of a ${days}-day trip from ${origin} to ${destination}.
${baseDetails}

Current plan for this day (to be replaced):
${JSON.stringify({ city: currentDay.city, country: currentDay.country, title: currentDay.title, transport: currentDay.transport, places: (currentDay.places || []).map(pl => pl.name) })}

Neighboring context: ${previousDayCity ? "the previous day ends in " + previousDayCity + ". " : "this is the first day. "}${nextDayCity ? "the next day needs to start from wherever this day ends, and continues toward " + nextDayCity + "." : "this is the last day."}

Traveler's feedback — apply this fully: "${feedback.trim()}"

Regenerate just this one day.`;

      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: DAY_SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 3000,
        response_format: { type: "json_object" }
      });

      const day = parseAiJson(completion.choices[0].message.content);
      if (!day.places || !Array.isArray(day.places)) throw new Error("Invalid day structure");
      day.day = dayIndex + 1;
      sanitizeDay(day);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, day }) };
    }

    // scope === "trip"
    const prompt = `Plan a ${days}-day trip from ${origin} to ${destination}.
${baseDetails}

The traveler already saw a version of this plan and wants it regenerated with this feedback — apply it fully: "${feedback.trim()}"

Cover all ${days} days with real places, accurate GPS, costs, booking links. Include flight on day 1 if international.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: TRIP_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
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
