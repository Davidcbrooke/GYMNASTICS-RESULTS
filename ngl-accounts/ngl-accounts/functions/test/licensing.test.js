const assert = require('assert');
const L = require('../licensing');
const at = s => new Date(s);
const S = {};   // default settings (default terms and prices)
const pre = L.pricingFor(S, 'preschool'), rec = L.pricingFor(S, 'recreational'), sch = L.pricingFor(S, 'schools');
const term = id => L.termById(S, id);

// ---- terms ----
assert.equal(L.currentTerm(S, at('2026-10-01T12:00:00Z')).id, '2026-aut');
assert.equal(L.currentTerm(S, at('2026-12-25T12:00:00Z')).id, '2026-aut');      // Christmas holidays: still autumn
assert.equal(L.nextTerm(S, at('2026-12-25T12:00:00Z')).id, '2027-spr');
assert.equal(L.currentTerm(S, at('2027-01-04T09:00:00Z')).id, '2027-spr');
assert.equal(L.registrationOpen(term('2027-spr'), at('2026-11-30T12:00:00Z')), false);
assert.equal(L.registrationOpen(term('2027-spr'), at('2026-12-01T12:00:00Z')), true);
assert.equal(L.registrationOpen(term('2027-spr'), at('2027-01-03T12:00:00Z')), true);
assert.equal(L.registrationOpen(term('2027-spr'), at('2027-01-04T12:00:00Z')), false);
assert.equal(L.termIndex(term('2026-aut')), 0); assert.equal(L.termIndex(term('2027-spr')), 1); assert.equal(L.termIndex(term('2027-sum')), 2);
assert.equal(L.yearEnd(term('2027-spr')), '2027-08-31'); assert.equal(L.yearEnd(term('2027-aut')), '2028-08-31');

// ---- Club Licence ----
let c = L.clubLicenceDue(rec, term('2026-aut'), 100, { founding: true });
assert.equal(c.pence, 50000); assert.equal(c.until, '2027-08-31');
c = L.clubLicenceDue(rec, term('2027-spr'), 100, { founding: true });            // join in spring: 2/3, nearest £5
assert.equal(c.pence, 33500);
c = L.clubLicenceDue(pre, term('2027-sum'), 20, { founding: true });             // join in summer: 1/3
assert.equal(c.pence, 6500);
c = L.clubLicenceDue(pre, term('2027-sum'), 20, { founding: true, summerTaster: true });
assert.equal(c.pence, 0); assert.equal(c.taster, true); assert.equal(c.until, '2027-08-31');
assert.equal(L.clubLicenceDue(rec, term('2027-spr'), 100, { paidUntil: '2027-08-31' }), null);     // already covered
c = L.clubLicenceDue(rec, term('2027-aut'), 250, { paidUntil: '2027-08-31', founding: true });     // renewal, new band
assert.equal(c.pence, 100000); assert.equal(c.share, 1);
assert.equal(L.clubLicenceDue(rec, term('2027-aut'), 250, { paidUntil: '2027-08-31' }).pence, 150000);
assert.equal(L.clubLicenceDue(sch, term('2026-aut'), 50, {}), null);              // Schools has no Club Licence

// ---- termly bill ----
assert.equal(L.medalsPerTerm(pre, term('2026-aut')), 4);
assert.equal(L.medalsPerTerm(pre, term('2027-spr')), 3);
assert.equal(L.medalsPerTerm(rec, term('2027-spr')), 1);
assert.equal(L.medalsPerTerm(sch, term('2027-spr')), 0);
// Pre-School autumn: 20 gymnasts, all new, founding club
let b = L.termBill({ price: pre, pathway: 'preschool', term: term('2026-aut'), gymnasts: 20, books: 20, spares: 2,
  clubLicence: L.clubLicenceDue(pre, term('2026-aut'), 20, { founding: true }) });
assert.equal(b.totalPence, 20000 + 20 * 400 + 80 * 200 + 2 * 200 + 20 * 500);
// Recreational spring, returning gymnasts (no books), licence already paid
b = L.termBill({ price: rec, pathway: 'recreational', term: term('2027-spr'), gymnasts: 100, books: 0 });
assert.equal(b.totalPence, 100 * 400 + 100 * 250);
// Schools: licence + books only
b = L.termBill({ price: sch, pathway: 'schools', term: term('2026-aut'), gymnasts: 30, books: 30 });
assert.equal(b.totalPence, 30 * 400 + 30 * 500);
assert.ok(L.termBill({ price: pre, pathway: 'preschool', term: term('2026-aut'), gymnasts: 10, books: 11 }).error);
assert.ok(L.termBill({ price: pre, pathway: 'preschool', term: term('2026-aut'), gymnasts: 10, spares: 4 }).error);
assert.equal(L.termBill({ price: pre, pathway: 'preschool', term: term('2026-aut'), gymnasts: 0 }).totalPence, 0);
// A year for one Pre-School gymnast who stays all year: licence £12 + 10 medals £20 + passport £5 = £37
const year = ['2026-aut', '2027-spr', '2027-sum'].reduce((a, id, i) =>
  a + L.termBill({ price: pre, pathway: 'preschool', term: term(id), gymnasts: 1, books: i === 0 ? 1 : 0 }).totalPence, 0);
assert.equal(year, 3700);

// ---- orders ----
let o = L.checkOrder(pre, [{ id: 'theme', qty: 2 }, { id: 'medal', qty: 5 }], 20);
assert.equal(o.totalPence, 2 * 2500 + 5 * 200);
assert.ok(L.checkOrder(pre, [{ id: 'medal', qty: 6 }], 20).error);
assert.ok(L.checkOrder(rec, [{ id: 'theme', qty: 1 }], 20).error);
assert.ok(L.checkOrder(rec, [{ id: 'book', qty: 21 }], 20).error);

// ---- misc ----
assert.equal(L.foundingOpen({ foundingUntil: '2027-08-31' }, at('2027-08-31T12:00:00Z')), true);
assert.equal(L.foundingOpen({ foundingUntil: '2027-08-31' }, at('2027-09-01T12:00:00Z')), false);
assert.equal(L.pricingFor(S, 'masters'), null);
assert.equal(L.checkGymnasts(0), 'Enter at least 1 gymnast.');
assert.equal(L.givesAccess('past_due'), true); assert.equal(L.givesAccess('lapsed'), false);

console.log('All licensing rule tests passed');
