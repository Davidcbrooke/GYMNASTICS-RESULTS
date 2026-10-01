const assert = require('assert');
const L = require('../licensing');
const windows = [
  { label: 'Christmas holidays', start: '2026-12-19', end: '2027-01-04' },
  { label: 'Easter holidays', start: '2027-03-27', end: '2027-04-11' }
];
const at = s => new Date(s);
const base = { bookPence: 1000, unitPence: 200, windows };

// increase any time, book fee for the extra gymnasts only
let p = L.planChange({ ...base, current: 50, requested: 60, now: at('2026-10-10T12:00:00Z') });
assert.equal(p.kind, 'increase'); assert.equal(p.allowed, true);
assert.equal(p.bookFeePence, 10 * 1000); assert.equal(p.periodToPence, 60 * 200);

// decrease outside a window: locked, names next window
p = L.planChange({ ...base, current: 50, requested: 40, now: at('2026-10-10T12:00:00Z') });
assert.equal(p.allowed, false); assert.equal(p.nextWindow.label, 'Christmas holidays');

// decrease inside a window: allowed, no book fee
p = L.planChange({ ...base, current: 50, requested: 40, now: at('2026-12-20T12:00:00Z') });
assert.equal(p.allowed, true); assert.equal(p.kind, 'decrease'); assert.equal(p.bookFeePence, 0);

// window edges are inclusive in UK time (00:30 on 19 Dec UK = 00:30Z in winter)
assert.ok(L.currentWindow(windows, at('2026-12-19T00:30:00Z')));
assert.ok(L.currentWindow(windows, at('2027-01-04T23:30:00Z')));
assert.equal(L.currentWindow(windows, at('2027-01-05T00:30:00Z')), null);
// BST: 23:30Z on 26 Mar = 00:30 on 27 Mar in the UK (BST starts 28 Mar 2027, so still GMT) -> not yet
assert.equal(L.currentWindow(windows, at('2027-03-26T23:30:00Z')), null);

// cancel = 0, same lock
p = L.planChange({ ...base, current: 50, requested: 0, now: at('2027-02-01T12:00:00Z') });
assert.equal(p.kind, 'cancel'); assert.equal(p.allowed, false);
p = L.planChange({ ...base, current: 50, requested: 0, now: at('2027-04-01T12:00:00Z') });
assert.equal(p.allowed, true);

// no windows published
p = L.planChange({ ...base, windows: [], current: 5, requested: 4 });
assert.equal(p.allowed, false); assert.match(p.reason, /not published/);

// validation
assert.equal(L.checkGymnasts(0), 'Enter at least 1 gymnast.');
assert.equal(L.checkGymnasts(0, { allowZero: true }), null);
assert.ok(L.checkGymnasts(2.5)); assert.ok(L.checkGymnasts(9999));
assert.ok(L.validWindows(windows));
assert.equal(L.validWindows([{ label: 'x', start: '2027-01-05', end: '2027-01-01' }]), false);

// status mapping
assert.equal(L.licenceStatus('active'), 'active');
assert.equal(L.licenceStatus('past_due'), 'past_due');
assert.equal(L.licenceStatus('canceled'), 'lapsed');
assert.equal(L.givesAccess('past_due'), true); assert.equal(L.givesAccess('lapsed'), false);

// pricing per pathway
assert.deepEqual(L.pricingFor({}, 'schools'), { bookPence: 800, unitPence: 100, interval: 'month' });
assert.equal(L.pricingFor({}, 'general').interval, 'month');
assert.equal(L.pricingFor({}, 'masters'), null);                       // not on sale yet
assert.equal(L.pricingFor({ pathways: { masters: { bookPence: 500, unitPence: 150, interval: 'month' } } }, 'masters').unitPence, 150);
assert.equal(L.pricingFor({ pathways: { schools: { unitPence: 120 } } }, 'schools').unitPence, 120);   // admin override
assert.equal(L.monthlyEquivalentPence(100, 'week', 30), 13000);        // 30 x £1 x 52 / 12
assert.equal(L.monthlyEquivalentPence(100, 'month', 30), 3000);
// Dave's yearly figures
const year = (pw) => { const p = L.pricingFor({}, pw); return p.bookPence + p.unitPence * (p.interval === 'week' ? 52 : 12); };
assert.equal(year('preschool'), 2200); assert.equal(year('schools'), 2000); assert.equal(year('recreational'), 1700); assert.equal(year('general'), 2200); assert.equal(year('performance'), 2200);

// book fee only for gymnasts who need a new book
p = L.planChange({ ...base, current: 50, requested: 60, books: 4, now: at('2026-10-10T12:00:00Z') });
assert.equal(p.allowed, true); assert.equal(p.books, 4); assert.equal(p.bookFeePence, 4 * 1000);
p = L.planChange({ ...base, current: 50, requested: 60, books: 0 });
assert.equal(p.bookFeePence, 0);
p = L.planChange({ ...base, current: 50, requested: 60, books: 11 });
assert.equal(p.allowed, false);
assert.deepEqual(L.checkBooks(undefined, 20), { books: 20 });
assert.deepEqual(L.checkBooks(5, 20), { books: 5 });
assert.ok(L.checkBooks(21, 20).error); assert.ok(L.checkBooks(-1, 20).error);

// club fees: bands and founding price
const rec = L.pricingFor({}, 'recreational');
assert.equal(L.clubFeeFor(rec, 150, { founding: true }).pence, 50000);
assert.equal(L.clubFeeFor(rec, 199, { founding: true }).pence, 50000);
assert.equal(L.clubFeeFor(rec, 200, { founding: true }).pence, 100000);
assert.equal(L.clubFeeFor(rec, 499).pence, 150000);
assert.equal(L.clubFeeFor(rec, 800, { founding: true }).pence, 150000);
assert.equal(L.clubFeeFor(rec, 800).band, '500+ gymnasts');
assert.equal(L.clubFeeFor(L.pricingFor({}, 'preschool'), 40, { founding: true }).pence, 20000);
assert.equal(L.clubFeeFor(L.pricingFor({}, 'schools'), 40), null);
assert.equal(L.foundingOpen({ foundingUntil: '2027-08-31' }, at('2027-08-31T12:00:00Z')), true);
assert.equal(L.foundingOpen({ foundingUntil: '2027-08-31' }, at('2027-09-01T12:00:00Z')), false);
// orders: medals capped per licensed gymnast per year
let o = L.checkOrder(rec, [{ id: 'medal', qty: 60 }], 20);
assert.equal(o.totalPence, 60 * 250);
assert.ok(L.checkOrder(rec, [{ id: 'medal', qty: 61 }], 20).error);
assert.ok(L.checkOrder(rec, [{ id: 'medal', qty: 10 }], 20, { medal: 55 }).error);
o = L.checkOrder(L.pricingFor({}, 'preschool'), [{ id: 'theme', qty: 2 }, { id: 'medal', qty: 30 }], 10);
assert.equal(o.totalPence, 2 * 2500 + 30 * 200);
assert.ok(L.checkOrder(rec, [{ id: 'theme', qty: 1 }], 20).error);
assert.ok(L.checkOrder(rec, [{ id: 'medal', qty: 0 }], 20).error);

console.log('All licensing rule tests passed');
