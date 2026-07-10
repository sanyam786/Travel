const Groq = require("groq-sdk");

const SYSTEM_PROMPT = `You are TripAI, an expert travel planner. Generate complete travel itineraries as JSON ONLY — no markdown, no explanation.

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
        "estimatedCost": "$400–800/person",
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
          "cost": "Free",
          "bookingUrl": null,
          "bookingRequired": false,
          "tips": "Insider tip",
          "babyFriendly": true
        }
      ]
    }
  ],
  "budgetEstimate": {
    "flights": "$800–1200 total",
    "accommodation": "$80–150/night",
    "food": "$30–60/day",
    "activities": "$200–400 total",
    "transport": "$100–200 total",
    "total": "$2000–4000 full trip"
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
    const { origin, destination, startDate, endDate, travelers, preferences } = JSON.parse(event.body);
    if (!origin || !destination || !startDate || !endDate) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields" }) };
    }

    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
    const p = preferences || {};

    const prompt = `Plan a ${days}-day trip from ${origin} to ${destination}.
- Dates: ${startDate} to ${endDate}
- Travelers: ${travelers || 1} adult(s)${p.withBaby ? " + 1 infant (note stroller access + family facilities)" : ""}
- Budget: ${p.budget || "moderate"}
- Interests: ${(p.interests || []).join(", ") || "culture, food, sightseeing"}
- Dietary: ${p.dietary || "none"}
- Accommodation: ${p.accommodation || "mid-range hotel"}
- Pace: ${p.pace || "moderate"}
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

    // Sanitize coordinates
    itinerary.days.forEach(day => {
      (day.places || []).forEach(p => {
        p.lat = parseFloat(p.lat) || 0;
        p.lng = parseFloat(p.lng) || 0;
      });
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, itinerary }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
