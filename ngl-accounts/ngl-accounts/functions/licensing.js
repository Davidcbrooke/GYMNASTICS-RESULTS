/* Pure licensing rules - no Firebase or Stripe here, so they can be unit tested.
   The Club Account page uses the same rules for display; these are the ones enforced. */

const PATHWAYS = {
  preschool:    'Pre-School',
  schools:      'Schools',
  recreational: 'Recreational',
  general:      'General League',
  performance:  'Performance League',
  university:   'University League',
  masters:      'Masters'
};

const MAX_GYMNASTS = 5000;

/* Starting prices, pence. Admin can change them in settings/licensing.pathways.
   unitPence/interval  licence fee per gymnast (the NGL Awards Programme Licence)
   bookPence           book fee per gymnast who needs a new book (rrpPence = suggested price to families)
   clubFee             yearly club fee for the plans: bands by number of gymnasts in the pathway,
                       each with a full price (shown) and a founding club price (charged while
                       founding pricing is open, and kept by founding clubs at renewal)
   themes              Pre-School: themes included, price of each extra theme
   products            things clubs buy: pricePence to the club, rrpPence suggested to families,
                       perGymnastPerYear caps how many a club can order
   A pathway with no licence fee or book fee is not yet on sale. */
const DEFAULT_PRICING = {
  preschool: {
    bookPence: 1000, unitPence: 100, interval: 'month',
    clubFee: { bands: [{ max: null, fullPence: 40000, foundingPence: 20000 }] },
    themes: { included: 10, extraPence: 2500 },
    products: { medal: { name: 'Medal', pricePence: 200, rrpPence: 400, perGymnastPerYear: 10 } }
  },
  schools: { bookPence: 800, unitPence: 100, interval: 'month' },
  recreational: {
    bookPence: 500, rrpPence: 1000, unitPence: 100, interval: 'month',
    clubFee: { bands: [
      { max: 199,  fullPence: 100000, foundingPence: 50000 },
      { max: 499,  fullPence: 150000, foundingPence: 100000 },
      { max: null, fullPence: 200000, foundingPence: 150000 }
    ] },
    products: {
      medal: { name: 'Medal', pricePence: 250, rrpPence: 500, perGymnastPerYear: 3 },
      book:  { name: 'Awards Book', pricePence: 500, rrpPence: 1000, perGymnastPerYear: 1 }
    }
  },
  general:     { bookPence: 1000, unitPence: 100, interval: 'month' },
  performance: { bookPence: 1000, unitPence: 100, interval: 'month' }
  // university, masters: on sale once a licence fee and book fee are set in the NGL admin tab
};
const DEFAULT_FOUNDING_UNTIL = '2027-08-31';

function pricingFor(settings, pathway) {
  const saved = (settings && settings.pathways && settings.pathways[pathway]) || {};
  const p = { ...(DEFAULT_PRICING[pathway] || {}), ...saved };
  const ok = Number.isInteger(p.bookPence) && Number.isInteger(p.unitPence) && p.unitPence > 0 &&
    (p.interval === 'week' || p.interval === 'month');
  return ok ? p : null;
}

function foundingOpen(settings, now = new Date()) {
  const until = (settings && settings.foundingUntil) || DEFAULT_FOUNDING_UNTIL;
  return ukDate(now) <= until;
}

/* Yearly club fee for a pathway and number of gymnasts.
   founding = club already holds founding pricing (kept at renewal). Returns null if the pathway has none. */
function clubFeeFor(price, gymnasts, { founding = false } = {}) {
  const bands = price && price.clubFee && price.clubFee.bands;
  if (!Array.isArray(bands) || !bands.length) return null;
  const band = bands.find(b => b.max == null || gymnasts <= b.max) || bands[bands.length - 1];
  const i = bands.indexOf(band);
  const lo = i === 0 ? 1 : bands[i - 1].max + 1;
  return {
    band: band.max == null ? `${lo}+ gymnasts` : `${lo}–${band.max} gymnasts`,
    fullPence: band.fullPence,
    foundingPence: band.foundingPence,
    pence: founding ? band.foundingPence : band.fullPence,
    founding
  };
}

/* Check an order of products against the pathway's catalogue and the club's licensed gymnasts.
   items: [{id, qty}] ; orderedThisYear: {id: qty already ordered in the last 12 months} */
function checkOrder(price, items, gymnasts, orderedThisYear = {}) {
  if (!Array.isArray(items) || !items.length) return { error: 'Choose something to order.' };
  const lines = [];
  for (const it of items) {
    const qty = Number(it && it.qty);
    if (!Number.isInteger(qty) || qty < 0) return { error: 'Quantities must be whole numbers.' };
    if (qty === 0) continue;
    if (it.id === 'theme') {
      const t = price.themes;
      if (!t || !t.extraPence) return { error: 'Extra themes are not available for this pathway.' };
      if (qty > 20) return { error: 'Up to 20 extra themes per order.' };
      lines.push({ id: 'theme', name: 'Extra theme', qty, unitPence: t.extraPence });
      continue;
    }
    const prod = price.products && price.products[it.id];
    if (!prod) return { error: 'Unknown product.' };
    const cap = gymnasts * (prod.perGymnastPerYear || 1) - (orderedThisYear[it.id] || 0);
    if (qty > cap) return { error: `You can order up to ${Math.max(cap, 0)} more ${prod.name.toLowerCase()}${cap === 1 ? '' : 's'} this year for ${gymnasts} licensed gymnasts.` };
    lines.push({ id: it.id, name: prod.name, qty, unitPence: prod.pricePence });
  }
  if (!lines.length) return { error: 'Choose something to order.' };
  return { lines, totalPence: lines.reduce((a, l) => a + l.qty * l.unitPence, 0) };
}

/* Monthly equivalent for totals: weekly x 52 / 12 */
function monthlyEquivalentPence(unitPence, interval, gymnasts) {
  const per = unitPence * gymnasts;
  return interval === 'week' ? Math.round(per * 52 / 12) : per;
}

/* Today's date in the UK as 'YYYY-MM-DD' (holiday windows are UK dates). */
function ukDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
}

/* windows: [{label, start:'YYYY-MM-DD', end:'YYYY-MM-DD'}], start and end inclusive. */
function currentWindow(windows, now = new Date()) {
  const today = ukDate(now);
  return (windows || []).find(w => w.start <= today && today <= w.end) || null;
}

function nextWindow(windows, now = new Date()) {
  const today = ukDate(now);
  return (windows || [])
    .filter(w => w.start > today)
    .sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}

function validWindows(windows) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return Array.isArray(windows) && windows.every(w =>
    w && typeof w.label === 'string' && w.label.length <= 60 &&
    iso.test(w.start) && iso.test(w.end) && w.start <= w.end);
}

/* Books ordered when starting a licence: 0..gymnasts, default all */
function checkBooks(books, gymnasts) {
  const b = books === undefined || books === null ? gymnasts : books;
  if (!Number.isInteger(b) || b < 0 || b > gymnasts) return { error: `Books must be between 0 and ${gymnasts}.` };
  return { books: b };
}

function checkGymnasts(n, { allowZero = false } = {}) {
  if (!Number.isInteger(n)) return 'Enter a whole number of gymnasts.';
  if (n < (allowZero ? 0 : 1)) return allowZero ? 'Number of gymnasts cannot be negative.' : 'Enter at least 1 gymnast.';
  if (n > MAX_GYMNASTS) return `For more than ${MAX_GYMNASTS} gymnasts please contact NGL.`;
  return null;
}

/* What a change of numbers means. Pence throughout.
   Returns {kind, allowed, reason, books, bookFeePence, periodFromPence, periodToPence}
   (period = each weekly or monthly payment, per the pathway's interval).
   books = how many of the added gymnasts need a new book (default: all of them);
   gymnasts who already have a book pay no book fee. */
function planChange({ current, requested, bookPence, unitPence, windows, books, now = new Date() }) {
  const base = {
    bookFeePence: 0,
    periodFromPence: current * unitPence,
    periodToPence: requested * unitPence
  };
  if (requested === current) return { ...base, kind: 'none', allowed: false, reason: 'That is the number you already have.' };
  if (requested > current) {
    const added = requested - current;
    const b = books === undefined || books === null ? added : books;
    if (!Number.isInteger(b) || b < 0 || b > added) {
      return { ...base, kind: 'increase', allowed: false, reason: `Books must be between 0 and ${added} (the number of gymnasts you are adding).` };
    }
    return { ...base, kind: 'increase', allowed: true, books: b, bookFeePence: b * bookPence };
  }
  const kind = requested === 0 ? 'cancel' : 'decrease';
  const open = currentWindow(windows, now);
  if (open) return { ...base, kind, allowed: true, window: open };
  const next = nextWindow(windows, now);
  return {
    ...base, kind, allowed: false, nextWindow: next,
    reason: next
      ? `Numbers can only go down during a holiday window. The next one is ${next.label} (${next.start} to ${next.end}).`
      : 'Numbers can only go down during a holiday window. NGL has not published the next window yet.'
  };
}

/* Stripe subscription status -> NGL licence status */
function licenceStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':
    case 'trialing': return 'active';
    case 'past_due':
    case 'unpaid': return 'past_due';
    case 'incomplete': return 'pending';
    case 'canceled':
    case 'incomplete_expired':
    case 'paused': return 'lapsed';
    default: return 'lapsed';
  }
}

/* An active or payment-due licence still gives access; Stripe is retrying a failed payment. */
function givesAccess(status) {
  return status === 'active' || status === 'past_due';
}

module.exports = {
  PATHWAYS, MAX_GYMNASTS, DEFAULT_PRICING, DEFAULT_FOUNDING_UNTIL, pricingFor, foundingOpen, clubFeeFor, checkOrder, monthlyEquivalentPence, ukDate, currentWindow, nextWindow, validWindows,
  checkGymnasts, checkBooks, planChange, licenceStatus, givesAccess
};
