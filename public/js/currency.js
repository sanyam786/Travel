// Shared currency helper: supported currency list, country/place guessing,
// live exchange rates (frankfurter.dev — free, no API key), and formatting
// of the itinerary's structured { min, max, free, unit } cost objects.
window.WanderCurrency = (function () {
  const API = 'https://api.frankfurter.dev/v1';

  // frankfurter.dev's supported currency set — keep the picker limited to
  // these so every selectable currency always has a live rate available.
  const SUPPORTED = ['AUD','BRL','CAD','CHF','CNY','CZK','DKK','EUR','GBP','HKD','HUF','IDR','ILS','INR','ISK','JPY','KRW','MXN','MYR','NOK','NZD','PHP','PLN','RON','SEK','SGD','THB','TRY','USD','ZAR'];

  const SYMBOLS = {
    USD:'$', EUR:'€', GBP:'£', JPY:'¥', INR:'₹', AUD:'A$', CAD:'C$', CHF:'CHF',
    CNY:'¥', SGD:'S$', THB:'฿', BRL:'R$', ZAR:'R', NZD:'NZ$', SEK:'kr', NOK:'kr',
    DKK:'kr', TRY:'₺', IDR:'Rp', PHP:'₱', MYR:'RM', KRW:'₩', PLN:'zł', ILS:'₪',
    HKD:'HK$', CZK:'Kč', HUF:'Ft', ISK:'kr', RON:'lei'
  };

  const GUESS = {
    japan:'JPY', italy:'EUR', spain:'EUR', france:'EUR', greece:'EUR', germany:'EUR', portugal:'EUR',
    usa:'USD', 'united states':'USD', uk:'GBP', 'united kingdom':'GBP', thailand:'THB',
    australia:'AUD', brazil:'BRL', 'new zealand':'NZD', india:'INR', turkey:'TRY',
    indonesia:'IDR', singapore:'SGD', china:'CNY', 'south korea':'KRW', mexico:'MXN',
    switzerland:'CHF', canada:'CAD', 'south africa':'ZAR', philippines:'PHP', malaysia:'MYR',
    israel:'ILS', 'hong kong':'HKD', czech:'CZK', hungary:'HUF', iceland:'ISK',
    romania:'RON', poland:'PLN', norway:'NOK', sweden:'SEK', denmark:'DKK'
  };

  function guess(place) {
    const key = (place || '').toLowerCase();
    for (const [k, v] of Object.entries(GUESS)) if (key.includes(k)) return v;
    return 'USD';
  }

  function symbol(code) {
    return SYMBOLS[code] || (code + ' ');
  }

  const rateCache = {};
  async function getRate(from, to) {
    if (!from || !to || from === to) return 1;
    const key = from + '_' + to;
    if (rateCache[key] != null) return rateCache[key];
    try {
      const res = await fetch(API + '/latest?from=' + from + '&to=' + to);
      const data = await res.json();
      const rate = data.rates && data.rates[to];
      if (rate) rateCache[key] = rate;
      return rate || null;
    } catch {
      return null;
    }
  }

  function formatAmount(n, code) {
    const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
    return symbol(code) + rounded.toLocaleString();
  }

  // cost: { min, max, free, unit } — amounts are in `fromCode`.
  // Converts to `toCode` using `rate` (fromCode -> toCode, i.e. 1 fromCode = rate toCode).
  function formatCost(cost, fromCode, toCode, rate) {
    if (!cost) return '';
    if (cost.free) return 'Free';
    const r = (fromCode === toCode || !rate) ? 1 : rate;
    const hasMin = cost.min != null && cost.min !== '';
    const hasMax = cost.max != null && cost.max !== '';
    if (!hasMin && !hasMax) return '';
    const min = hasMin ? cost.min * r : null;
    const max = hasMax ? cost.max * r : null;
    let text;
    if (min != null && max != null && max !== min) text = formatAmount(min, toCode) + '–' + formatAmount(max, toCode);
    else text = formatAmount(min != null ? min : max, toCode);
    if (cost.unit) text += cost.unit;
    return text;
  }

  // Parses a plain-language amount typed by an editor (e.g. "400-800", "500", "free")
  // back into a { min, max, free } object, in whatever currency is currently displayed.
  function parseCostInput(str) {
    const s = (str || '').trim();
    if (!s || /^free$/i.test(s)) return { min: 0, max: 0, free: true };
    const nums = (s.match(/[\d.]+/g) || []).map(Number).filter(n => !isNaN(n));
    if (!nums.length) return { min: 0, max: 0, free: true };
    if (nums.length >= 2) return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]), free: false };
    return { min: nums[0], max: nums[0], free: false };
  }

  // Plain (no symbol, no conversion) representation of a cost object — used to
  // pre-fill an inline edit input with the raw base-currency numbers.
  function formatPlain(cost) {
    if (!cost) return '';
    if (cost.free) return 'Free';
    const hasMin = cost.min != null && cost.min !== '';
    const hasMax = cost.max != null && cost.max !== '';
    if (!hasMin && !hasMax) return '';
    if (hasMin && hasMax && cost.max !== cost.min) return cost.min + '-' + cost.max;
    return String(hasMin ? cost.min : cost.max);
  }

  return { SUPPORTED, guess, symbol, getRate, formatAmount, formatCost, parseCostInput, formatPlain };
})();
