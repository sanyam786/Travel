const Groq = require("groq-sdk");

const SYSTEM_PROMPT = `You are WanderAI, an expert travel planner. Generate complete travel itineraries as JSON ONLY — no markdown, no explanation.

All monetary fields are structured objects, never strings: { "min": number, "max": number, "free": boolean, "unit": string }.
- "min"/"max" are plain numeric estimates with no currency symbols or separators (use "max" equal to "min" for a single fixed price).
- "free" is true only for genuinely free places/activities (in that case min and max should be 0).
- "unit" is an optional short suffix like "/night", "/day", "/person", or " total" — omit it ("") when not needed.
- Every number MUST be denominated in the single currency specified in the user message. Do not mix currencies.

Return this EXACT structure:
{
  "title": "X Days in Destination",
  "summary": "2-3 sentence overview",
  "highlights": ["highlight 1", "highlight 2", "highlight 3"],
  "days": [
    {
      "day": 1,
      "city": "City",
      "country": "Country",
      "title": "Day theme",
      "transport": {
        "mode": "flight",
        "icon": "✈️",
        "from": "Origin City",
        "to": "Destination City",
        "duration": "~9 hrs",
        "estimatedCost": { "min": 400, "max": 800, "free": false, "unit": "/person" },
        "bookingUrl": "https://google.com/flights",
        "notes": "Book 2–3 months ahead"
      },
      "places": [
        {
          "id": "d1p1",
          "name": "Place Name",
          "lat": 35.7148,
          "lng": 139.7967,
          "category": "attraction",
          "timeOfDay": "Morning",
          "duration": "1.5 hours",
          "description": "Why visit this place",
          "practicalInfo": "Opening hours, entry requirements",
          "cost": { "min": 0, "max": 0, "free": true, "unit": "" },
          "bookingUrl": null,
          "bookingRequired": false,
          "tips": "Insider tip",
          "babyFriendly": true
        }
      ]
    }
  ],
  "budgetEstimate": {
    "flights": { "min": 800, "max": 1200, "free": false, "unit": " total" },
    "accommodation": { "min": 80, "max": 150, "free": false, "unit": "/night" },
    "food": { "min": 30, "max": 60, "free": false, "unit": "/day" },
    "activities": { "min": 200, "max": 400, "free": false, "unit": " total" },
    "transport": { "min": 100, "max": 200, "free": false, "unit": " total" },
    "total": { "min": 2000, "max": 4000, "free": false, "unit": " full trip" }
  },
  "urgentBookings": [
    {
      "what": "Flights",
      "when": "2–3 months ahead",
      "why": "Prices spike closer to date",
      "url": "https://google.com/flights"
    }
  ],
  "packingEssentials": ["item1", "item2", "item3"],
  "bestTimeToVisit": "Note if season is suboptimal"
}

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

    const AGE_LABELS = { infant: "infant (0–2)", toddler: "toddler (2–4)", child: "child (5–9)", preteen: "preteen (10–12)", teen: "teen (13–17)" };
    const kids = Array.isArray(p.children) ? p.children : [];
    const kidsNote = kids.length
      ? ` + ${kids.length} ${kids.length > 1 ? "children" : "child"} (${kids.map(a => AGE_LABELS[a] || a).join(", ")}) — include age-appropriate activities and pacing, and note stroller/nursing access for any infants or toddlers`
      : "";

    const prompt = `Plan a ${days}-day trip from ${origin} to ${destination}.
- Dates: ${startDate} to ${endDate}
- Travelers: ${travelers || 1} adult(s)${kidsNote}
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

    let itinerary;
    const raw = completion.choices[0].message.content;
    try { itinerary = JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]*\}/); if (!m) throw new Error("Invalid JSON from AI"); itinerary = JSON.parse(m[0]); }

    if (!itinerary.days || !Array.isArray(itinerary.days)) throw new Error("Invalid itinerary structure");

    const sanitizeCost = (c) => {
      if (c && typeof c === "object" && !Array.isArray(c)) {
        const min = parseFloat(c.min);
        const max = parseFloat(c.max);
        return { min: isNaN(min) ? 0 : min, max: isNaN(max) ? (isNaN(min) ? 0 : min) : max, free: !!c.free, unit: typeof c.unit === "string" ? c.unit : "" };
      }
      // Fallback if the model ever returns a plain string/number despite instructions.
      const n = parseFloat(c);
      return isNaN(n) ? { min: 0, max: 0, free: true, unit: "" } : { min: n, max: n, free: n === 0, unit: "" };
    };

    // Currency is authoritative from the request, not the AI's echo — and sanitize coordinates + cost shapes.
    itinerary.currency = currency;
    itinerary.days.forEach(day => {
      (day.places || []).forEach(place => {
        place.lat = parseFloat(place.lat) || 0;
        place.lng = parseFloat(place.lng) || 0;
        place.cost = sanitizeCost(place.cost);
      });
      if (day.transport) day.transport.estimatedCost = sanitizeCost(day.transport.estimatedCost);
    });
    if (itinerary.budgetEstimate && typeof itinerary.budgetEstimate === "object") {
      Object.keys(itinerary.budgetEstimate).forEach(k => {
        itinerary.budgetEstimate[k] = sanitizeCost(itinerary.budgetEstimate[k]);
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, itinerary }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
