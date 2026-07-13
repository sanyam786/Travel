// Shared helpers for generate-trip.js and regenerate-trip.js.
// Not itself a Netlify function (no exports.handler), so it's never deployed as an endpoint.

const AGE_LABELS = { infant: "infant (0–2)", toddler: "toddler (2–4)", child: "child (5–9)", preteen: "preteen (10–12)", teen: "teen (13–17)" };

function kidsNote(preferences) {
  const kids = Array.isArray(preferences?.children) ? preferences.children : [];
  if (!kids.length) return "";
  return ` + ${kids.length} ${kids.length > 1 ? "children" : "child"} (${kids.map(a => AGE_LABELS[a] || a).join(", ")}) — include age-appropriate activities and pacing, and note stroller/nursing access for any infants or toddlers`;
}

// Coerces a cost field (however the model returned it) into { min, max, free, unit }.
function sanitizeCost(c) {
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const min = parseFloat(c.min);
    const max = parseFloat(c.max);
    return { min: isNaN(min) ? 0 : min, max: isNaN(max) ? (isNaN(min) ? 0 : min) : max, free: !!c.free, unit: typeof c.unit === "string" ? c.unit : "" };
  }
  const n = parseFloat(c);
  return isNaN(n) ? { min: 0, max: 0, free: true, unit: "" } : { min: n, max: n, free: n === 0, unit: "" };
}

function sanitizePlace(place) {
  place.lat = parseFloat(place.lat) || 0;
  place.lng = parseFloat(place.lng) || 0;
  place.cost = sanitizeCost(place.cost);
  return place;
}

function sanitizeDay(day) {
  (day.places || []).forEach(sanitizePlace);
  if (day.transport) day.transport.estimatedCost = sanitizeCost(day.transport.estimatedCost);
  return day;
}

function sanitizeItinerary(itinerary, currency) {
  itinerary.currency = currency;
  itinerary.days.forEach(sanitizeDay);
  if (itinerary.budgetEstimate && typeof itinerary.budgetEstimate === "object") {
    Object.keys(itinerary.budgetEstimate).forEach(k => {
      itinerary.budgetEstimate[k] = sanitizeCost(itinerary.budgetEstimate[k]);
    });
  }
  return itinerary;
}

function parseAiJson(raw) {
  try { return JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Invalid JSON from AI");
    return JSON.parse(m[0]);
  }
}

const COST_SCHEMA_NOTE = `All monetary fields are structured objects, never strings: { "min": number, "max": number, "free": boolean, "unit": string }.
- "min"/"max" are plain numeric estimates with no currency symbols or separators (use "max" equal to "min" for a single fixed price).
- "free" is true only for genuinely free places/activities (in that case min and max should be 0).
- "unit" is an optional short suffix like "/night", "/day", "/person", or " total" — omit it ("") when not needed.
- Every number MUST be denominated in the single currency specified in the user message. Do not mix currencies.`;

const DAY_SCHEMA = `{
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
}`;

const FULL_ITINERARY_SCHEMA = `{
  "title": "X Days in Destination",
  "summary": "2-3 sentence overview",
  "highlights": ["highlight 1", "highlight 2", "highlight 3"],
  "days": [${DAY_SCHEMA}],
  "budgetEstimate": {
    "flights": { "min": 800, "max": 1200, "free": false, "unit": " total" },
    "accommodation": { "min": 80, "max": 150, "free": false, "unit": "/night" },
    "food": { "min": 30, "max": 60, "free": false, "unit": "/day" },
    "activities": { "min": 200, "max": 400, "free": false, "unit": " total" },
    "transport": { "min": 100, "max": 200, "free": false, "unit": " total" },
    "total": { "min": 2000, "max": 4000, "free": false, "unit": " full trip" }
  },
  "urgentBookings": [
    { "what": "Flights", "when": "2–3 months ahead", "why": "Prices spike closer to date", "url": "https://google.com/flights" }
  ],
  "packingEssentials": ["item1", "item2", "item3"],
  "bestTimeToVisit": "Note if season is suboptimal"
}`;

module.exports = { kidsNote, sanitizeCost, sanitizePlace, sanitizeDay, sanitizeItinerary, parseAiJson, COST_SCHEMA_NOTE, DAY_SCHEMA, FULL_ITINERARY_SCHEMA };
