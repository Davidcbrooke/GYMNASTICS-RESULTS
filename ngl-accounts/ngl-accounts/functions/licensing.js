/* Pure licensing rules - no Firebase or Stripe here, so they can be unit tested.
   The Club Account page uses the same rules for display; these are the ones enforced.

   THE TERMLY MODEL
   - Club Licence: yearly, renews with the autumn term. First year is pro-rata by term
     (autumn 3/3, spring 2/3, summer 1/3, or free if the summer taster is on).
     Founding clubs keep the founding price at renewal.
   - Each term the club registers its number of gymnasts. That term's bill is:
       Gymnast Licence x gymnasts + that term's medals x gymnasts + books for gymnasts who need one
       (+ spare medals, + the Club Licence when it is due).
   - Numbers can go up at any time during a term (the added gymnasts are billed for the term).
     Numbers can only go down, or the licence end, by registering a lower number for the next term
     before it starts. A club that does not register is rolled over at its current number. */

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
const MAX_SPARE_PCT = 0.25;   // spare medals at registration: up to 25% of gymnasts

/* Prices in pence. Admin can change them in settings/licensing.pathways.
   termPence      Gymnast Licence per gymnast per term
   bookPence      book / passport per gymnast who needs one (rrpPence = suggested price to families)
   clubFee        yearly Club Licence: bands by gymnasts, full price (shown) and founding price (charged
                  while founding pricing is open, kept by founding clubs)
   medal          medal price to the club; perTerm = medals per gymnast per term
                  (Pre-School uses the national country calendar on each term instead)
   themes         Pre-School extra themes
   A pathway with no termPence is not on sale. */
const DEFAULT_PRICING = {
  preschool: {
    termPence: 400, bookPence: 500, rrpPence: 1000, bookName: 'Passport',
    clubFee: { bands: [{ max: null, fullPence: 40000, foundingPence: 20000 }] },
    medal: { pricePence: 200, rrpPence: 400, fromCalendar: true },
    themes: { included: 10, extraPence: 2500 }
  },
  schools: { termPence: 400, bookPence: 500, rrpPence: 1000 },
  recreational: {
    termPence: 400, bookPence: 500, rrpPence: 1000,
    clubFee: { bands: [
      { max: 199,  fullPence: 100000, foundingPence: 50000 },
      { max: 499,  fullPence: 150000, foundingPence: 100000 },
      { max: null, fullPence: 200000, foundingPence: 150000 }
    ] },
    medal: { pricePence: 250, rrpPence: 500, perTerm: 1 }
  },
  general:     { termPence: 400, bookPence: 500, rrpPence: 1000 },
  performance: { termPence: 400, bookPence: 500, rrpPence: 1000 }
  // university, masters: on sale once a Gymnast Licence price and book price are set in the admin tab
};
const DEFAULT_FOUNDING_UNTIL = '2027-08-31';

/* Default term calendar (NGL admin edits this each year).
   regOpens = registration for the term opens (the holiday before it); the term's start closes it.
   countries = the Pre-School country medals for that term, in order (one per 4-week block). */
const DEFAULT_TERMS = [
  { id: '2026-aut', label: 'Autumn 2026', start: '2026-09-01', end: '2026-12-18', regOpens: '2026-07-20',
    countries: ['France', 'Japan', 'Brazil', 'Kenya'] },
  { id: '2027-spr', label: 'Spring 2027', start: '2027-01-04', end: '2027-03-26', regOpens: '2026-12-01',
    countries: ['Australia', 'Canada', 'India'] },
  { id: '2027-sum', label: 'Summer 2027', start: '2027-04-12', end: '2027-07-21', regOpens: '2027-03-15',
    countries: ['Egypt', 'Mexico', 'Norway'] },
  { id: '2027-aut', label: 'Autumn 2027', start: '2027-09-01', end: '2027-12-17', regOpens: '2027-07-19',
    countries: ['France', 'Japan', 'Brazil', 'Kenya'] }
];

function pricingFor(settings, pathway) {
  const saved = (settings && settings.pathways && settings.pathways[pathway]) || {};
  const p = { ...(DEFAULT_PRICING[pathway] || {}), ...saved };
  const ok = Number.isInteger(p.termPence) && p.termPence > 0 && Number.isInteger(p.bookPence) && p.bookPence >= 0;
  return ok ? p : null;
}

/* ---------- dates and terms ---------- */
function ukDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
}
function termsFrom(settings) {
  const t = (settings && Array.isArray(settings.terms) && settings.terms.length) ? settings.terms : DEFAULT_TERMS;
  return [...t].sort((a, b) => a.start.localeCompare(b.start));
}
function termById(settings, id) { return termsFrom(settings).find(t => t.id === id) || null; }
/* The term running today (from its start until the next term starts). */
function currentTerm(settings, now = new Date()) {
  const d = ukDate(now);
  let cur = null;
  termsFrom(settings).forEach(t => { if (t.start <= d) cur = t; });
  return cur;
}
function nextTerm(settings, now = new Date()) {
  const d = ukDate(now);
  return termsFrom(settings).find(t => t.start > d) || null;
}
/* Registration for a term is open from regOpens until the day before it starts. */
function registrationOpen(term, now = new Date()) {
  const d = ukDate(now);
  return !!term && d >= term.regOpens && d < term.start;
}
/* Position of a term in its school year (Sept–Aug): 0 autumn, 1 spring, 2 summer. */
function termIndex(term) {
  const m = Number(term.start.slice(5, 7));
  return m >= 8 ? 0 : m <= 2 ? 1 : 2;
}
/* Last day of the school year a term belongs to. */
function yearEnd(term) {
  const y = Number(term.start.slice(0, 4)), m = Number(term.start.slice(5, 7));
  return `${m >= 8 ? y + 1 : y}-08-31`;
}

function foundingOpen(settings, now = new Date()) {
  return ukDate(now) <= ((settings && settings.foundingUntil) || DEFAULT_FOUNDING_UNTIL);
}

/* ---------- Club Licence ---------- */
function clubFeeFor(price, gymnasts, { founding = false } = {}) {
  const bands = price && price.clubFee && price.clubFee.bands;
  if (!Array.isArray(bands) || !bands.length) return null;
  const band = bands.find(b => b.max == null || gymnasts <= b.max) || bands[bands.length - 1];
  const i = bands.indexOf(band);
  const lo = i === 0 ? 1 : bands[i - 1].max + 1;
  return {
    band: band.max == null ? `${lo}+ gymnasts` : `${lo}–${band.max} gymnasts`,
    fullPence: band.fullPence, foundingPence: band.foundingPence,
    pence: founding ? band.foundingPence : band.fullPence, founding
  };
}

/* Club Licence due on a term's bill, or null if already covered for this school year.
   paidUntil = 'YYYY-MM-DD' the Club Licence currently covers (null if never paid).
   First year is pro-rata by term, rounded to the nearest £5; renewals are the full year. */
function clubLicenceDue(price, term, gymnasts, { paidUntil = null, founding = false, summerTaster = false } = {}) {
  const fee = clubFeeFor(price, gymnasts, { founding });
  if (!fee) return null;
  if (paidUntil && paidUntil >= term.start) return null;
  const firstYear = !paidUntil;
  const idx = termIndex(term);
  let share = firstYear ? (3 - idx) / 3 : 1;
  if (firstYear && idx === 2 && summerTaster) share = 0;
  const pence = share === 1 ? fee.pence : Math.round(fee.pence * share / 500) * 500;
  return {
    ...fee, pence, share, until: yearEnd(term), taster: share === 0,
    label: share === 1 ? 'Club Licence, full year'
      : share === 0 ? 'Club Licence: summer taster, first payment in September'
      : `Club Licence, ${idx === 1 ? 'spring and summer' : 'summer'} (pro-rata)`
  };
}

/* ---------- termly bill ---------- */
function medalsPerTerm(price, term) {
  if (!price || !price.medal) return 0;
  if (price.medal.fromCalendar) return (term && Array.isArray(term.countries)) ? term.countries.length : 0;
  return price.medal.perTerm || 0;
}

function checkGymnasts(n, { allowZero = false } = {}) {
  if (!Number.isInteger(n)) return 'Enter a whole number of gymnasts.';
  if (n < (allowZero ? 0 : 1)) return allowZero ? 'Number of gymnasts cannot be negative.' : 'Enter at least 1 gymnast.';
  if (n > MAX_GYMNASTS) return `For more than ${MAX_GYMNASTS} gymnasts please contact NGL.`;
  return null;
}

/* Lines for a term's bill. gymnasts = gymnasts billed on this bill (all of them for a registration,
   just the added ones for a mid-term increase). books 0..gymnasts. spares 0..25% of gymnasts. */
function termBill({ price, pathway, term, gymnasts, books = 0, spares = 0, clubLicence = null }) {
  const err = checkGymnasts(gymnasts, { allowZero: true });
  if (err) return { error: err };
  if (!Number.isInteger(books) || books < 0 || books > gymnasts) return { error: `Books must be between 0 and ${gymnasts}.` };
  const maxSpare = Math.ceil(gymnasts * MAX_SPARE_PCT);
  if (!Number.isInteger(spares) || spares < 0 || spares > maxSpare) return { error: `Spare medals must be between 0 and ${maxSpare}.` };
  const name = PATHWAYS[pathway], bookName = price.bookName || 'Awards Book';
  const per = medalsPerTerm(price, term);
  const lines = [];
  if (clubLicence && clubLicence.pence > 0) lines.push({ id: 'club', name: `${name} ${clubLicence.label} (${clubLicence.band}${clubLicence.founding ? ', founding club price' : ''})`, qty: 1, unitPence: clubLicence.pence });
  if (gymnasts) lines.push({ id: 'licence', name: `${name} Gymnast Licence, ${term.label}`, qty: gymnasts, unitPence: price.termPence });
  if (gymnasts && per) lines.push({ id: 'medal', name: `${name} medals, ${term.label}${price.medal.fromCalendar ? ` (${term.countries.join(', ')})` : ''}`, qty: gymnasts * per, unitPence: price.medal.pricePence });
  if (spares && price.medal) lines.push({ id: 'spare', name: `${name} spare medals`, qty: spares, unitPence: price.medal.pricePence });
  if (books) lines.push({ id: 'book', name: `${name} ${bookName}s`, qty: books, unitPence: price.bookPence });
  const live = lines.filter(l => l.qty > 0 && l.unitPence > 0);
  return { lines: live, totalPence: live.reduce((a, l) => a + l.qty * l.unitPence, 0), medalsPerGymnast: per };
}

/* Extra Pre-School themes, replacement books and spare medals, ordered any time. */
function checkOrder(price, items, gymnasts) {
  if (!Array.isArray(items) || !items.length) return { error: 'Choose something to order.' };
  const lines = [];
  for (const it of items) {
    const qty = Number(it && it.qty);
    if (!Number.isInteger(qty) || qty < 0) return { error: 'Quantities must be whole numbers.' };
    if (!qty) continue;
    if (it.id === 'theme') {
      if (!price.themes || !price.themes.extraPence) return { error: 'Extra themes are not available for this pathway.' };
      if (qty > 20) return { error: 'Up to 20 extra themes per order.' };
      lines.push({ id: 'theme', name: 'Extra theme', qty, unitPence: price.themes.extraPence });
    } else if (it.id === 'book') {
      if (qty > gymnasts) return { error: `Up to ${gymnasts} books for ${gymnasts} licensed gymnasts.` };
      lines.push({ id: 'book', name: price.bookName || 'Awards Book', qty, unitPence: price.bookPence });
    } else if (it.id === 'medal') {
      if (!price.medal) return { error: 'This pathway has no medals.' };
      const cap = Math.ceil(gymnasts * MAX_SPARE_PCT);
      if (qty > cap) return { error: `Up to ${cap} spare medals per order.` };
      lines.push({ id: 'medal', name: 'Spare medal', qty, unitPence: price.medal.pricePence });
    } else return { error: 'Unknown item.' };
  }
  if (!lines.length) return { error: 'Choose something to order.' };
  return { lines, totalPence: lines.reduce((a, l) => a + l.qty * l.unitPence, 0) };
}

/* An active or payment-due licence still gives access; Stripe is retrying a failed payment. */
function givesAccess(status) {
  return status === 'active' || status === 'past_due';
}

module.exports = {
  PATHWAYS, MAX_GYMNASTS, MAX_SPARE_PCT, DEFAULT_PRICING, DEFAULT_FOUNDING_UNTIL, DEFAULT_TERMS,
  pricingFor, ukDate, termsFrom, termById, currentTerm, nextTerm, registrationOpen, termIndex, yearEnd,
  foundingOpen, clubFeeFor, clubLicenceDue, medalsPerTerm, checkGymnasts, termBill, checkOrder, givesAccess
};
