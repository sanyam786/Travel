// Shared helper: approximate expected weather for a destination during given dates,
// based on historical averages from the last 2 years (Open-Meteo — free, no API key).
window.WanderWeather = (function () {
  const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
  const cache = {};

  async function geocode(place) {
    const name = (place || '').split(',')[0].trim();
    if (!name) return null;
    const res = await fetch(GEOCODE_URL + '?name=' + encodeURIComponent(name) + '&count=1');
    const data = await res.json();
    const r = data.results && data.results[0];
    return r ? { lat: r.latitude, lon: r.longitude, label: r.name } : null;
  }

  function shiftYear(dateStr, years) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.toISOString().slice(0, 10);
  }

  function describe(avgHigh) {
    if (avgHigh >= 32) return { label: 'Hot', tip: 'Pack light, breathable clothing and sun protection.' };
    if (avgHigh >= 24) return { label: 'Warm', tip: 'Light clothing, with a layer for evenings.' };
    if (avgHigh >= 15) return { label: 'Mild', tip: 'Pack layers — a light jacket is a good idea.' };
    if (avgHigh >= 5) return { label: 'Cool', tip: 'Pack a warm jacket and layers.' };
    return { label: 'Cold', tip: 'Pack heavy winter clothing.' };
  }

  // Returns { avgHigh, avgLow, unit, label, tip, place } based on historical daily
  // max/min temperatures for the same calendar dates in the last 2 years, or null
  // if the destination couldn't be geocoded or no historical data was available.
  async function getApprox(place, startDate, endDate) {
    if (!place || !startDate || !endDate) return null;
    const key = place + '|' + startDate + '|' + endDate;
    if (cache[key]) return cache[key];

    try {
      const loc = await geocode(place);
      if (!loc) return null;

      const results = await Promise.all([1, 2].map(y => {
        const s = shiftYear(startDate, y);
        const e = shiftYear(endDate, y);
        return fetch(ARCHIVE_URL + '?latitude=' + loc.lat + '&longitude=' + loc.lon
          + '&start_date=' + s + '&end_date=' + e
          + '&daily=temperature_2m_max,temperature_2m_min&timezone=auto')
          .then(r => r.json()).catch(() => null);
      }));

      let highs = [], lows = [];
      results.forEach(r => {
        if (r && r.daily) {
          highs = highs.concat((r.daily.temperature_2m_max || []).filter(v => v != null));
          lows = lows.concat((r.daily.temperature_2m_min || []).filter(v => v != null));
        }
      });
      if (!highs.length || !lows.length) return null;

      const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
      const avgHigh = Math.round(avg(highs));
      const avgLow = Math.round(avg(lows));
      const info = describe(avgHigh);

      const result = { avgHigh, avgLow, unit: '°C', label: info.label, tip: info.tip, place: loc.label };
      cache[key] = result;
      return result;
    } catch {
      return null;
    }
  }

  return { getApprox };
})();
