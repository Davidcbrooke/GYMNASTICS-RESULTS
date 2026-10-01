/* =====================================================================
   NGL CLUB ACCOUNT - Cloud Functions
   ---------------------------------------------------------------------
   Everything that touches money or licence status runs here, never in
   the browser. The Club Account page calls these functions; Stripe
   calls stripeWebhook. Firestore rules stop clubs writing licences.

   TERMLY MODEL (rules in licensing.js)
   - startLicence: first bill through Stripe Checkout (card or Direct Debit),
     which also saves the payment method for later termly bills.
   - registerTerm: in the registration window before a term, the club
     confirms its number of gymnasts; the term's bill is charged to the
     saved payment method. 0 gymnasts ends the licence at that term.
   - addGymnasts: during a term, added gymnasts are billed for the term.
   - termRollover (daily): a club that did not register is rolled over at
     its current number when the term starts. The Club Licence renews with
     the autumn bill.

   Secrets (set once):  firebase functions:secrets:set STRIPE_SECRET_KEY
                        firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   Param (asked on first deploy, stored in functions/.env):
     APP_URL   https://.../ngl-club-account.html
   Prices live in Firestore settings/licensing.pathways (NGL admin tab), with
   defaults in licensing.js. No price objects need creating in Stripe.
   ===================================================================== */

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const Stripe = require('stripe');
const L = require('./licensing');

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'europe-west2', maxInstances: 10 });

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const APP_URL = defineString('APP_URL');

let stripeClient = null;
const stripe = () => (stripeClient ||= new Stripe(STRIPE_SECRET_KEY.value()));

const DEFAULT_SETTINGS = { pathways: {} };

/* ---------- helpers ---------- */

async function getSettings() {
  const snap = await db.doc('settings/licensing').get();
  return { ...DEFAULT_SETTINGS, ...(snap.exists ? snap.data() : {}) };
}

async function clubFor(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  const user = await db.doc(`users/${request.auth.uid}`).get();
  if (!user.exists) throw new HttpsError('failed-precondition', 'This login is not linked to a club yet.');
  const clubId = user.get('clubId');
  const club = await db.doc(`clubs/${clubId}`).get();
  if (!club.exists) throw new HttpsError('not-found', 'Club not found.');
  return { clubId, club: club.data() };
}

function pathwayFrom(data) {
  const p = String(data?.pathway || '');
  if (!L.PATHWAYS[p]) throw new HttpsError('invalid-argument', 'Unknown pathway.');
  return p;
}

function gymnastsFrom(data, opts) {
  const n = Number(data?.gymnasts);
  const problem = L.checkGymnasts(n, opts);
  if (problem) throw new HttpsError('invalid-argument', problem);
  return n;
}

const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);

async function logHistory(clubId, entry) {
  await db.collection(`clubs/${clubId}/history`).add({ ...entry, at: FieldValue.serverTimestamp() });
}

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newAccessCode(clubName) {   // same format as the Schools parent hub, e.g. SAADI-7K4P
  const words = String(clubName).toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/)
    .filter(w => w && !['GYMNASTICS', 'GYMNASTIC', 'GYM', 'CLUB', 'THE', 'ACADEMY', 'OF', 'AND'].includes(w));
  const prefix = (words[0] || 'NGL').slice(0, 10).padEnd(2, 'X');
  const bytes = require('crypto').randomBytes(4);
  return prefix + '-' + Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/* ---------- registerClub ----------
   Called straight after the club creates its Firebase Auth login. */
exports.registerClub = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  const uid = request.auth.uid;
  const d = request.data || {};
  const name = cleanText(d.name, 120);
  const bgNumber = cleanText(d.bgNumber, 20).toUpperCase();
  const contactName = cleanText(d.contactName, 120);
  const email = request.auth.token.email;
  if (!name || !bgNumber || !contactName) throw new HttpsError('invalid-argument', 'Club name, BG club number and contact name are required.');
  if (!d.acceptedTerms) throw new HttpsError('invalid-argument', 'Please accept the NGL licence terms.');

  if ((await db.doc(`users/${uid}`).get()).exists) throw new HttpsError('already-exists', 'This login already has a club account.');
  const dupe = await db.collection('clubs').where('bgNumber', '==', bgNumber).limit(1).get();
  if (!dupe.empty) throw new HttpsError('already-exists', 'A club with this BG number already has an NGL account. Ask its administrator, or contact NGL.');

  const clubRef = db.collection('clubs').doc();
  const customer = await stripe().customers.create({
    name, email, metadata: { clubId: clubRef.id, bgNumber }
  });
  const accessCode = newAccessCode(name);

  const batch = db.batch();
  batch.set(clubRef, {
    name, bgNumber, contactName, email,
    stripeCustomerId: customer.id,
    accessCode,
    termsAcceptedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp()
  });
  batch.set(db.doc(`users/${uid}`), { clubId: clubRef.id, role: 'club-admin', email });
  batch.set(db.doc(`accessCodes/${accessCode}`), { clubId: clubRef.id, clubName: name, status: 'inactive' });
  await batch.commit();
  await logHistory(clubRef.id, { type: 'registered', by: email });
  return { clubId: clubRef.id };
});

function priceFrom(settings, pathway) {
  const p = L.pricingFor(settings, pathway);
  if (!p) throw new HttpsError('failed-precondition', `${L.PATHWAYS[pathway]} licences are not on sale yet.`);
  return p;
}
const intFrom = (v, dflt = 0) => (v === undefined || v === null || v === '') ? dflt : Number(v);
const licRef = (clubId, pathway) => db.doc(`clubs/${clubId}/licences/${pathway}`);
const regRef = (clubId, pathway, termId) => db.doc(`clubs/${clubId}/licences/${pathway}/terms/${termId}`);

/* The term a new licence or a registration is billed for:
   the next term while its registration is open (the holidays before it), otherwise the term running now. */
function billingTerm(settings) {
  const next = L.nextTerm(settings);
  if (next && L.registrationOpen(next)) return next;
  const cur = L.currentTerm(settings);
  if (!cur) throw new HttpsError('failed-precondition', 'No term is set up yet. Please contact NGL.');
  return cur;
}

/* Charge lines to the club's saved card or Direct Debit as a Stripe invoice. */
async function chargeInvoice(club, lines, metadata, description) {
  const s = stripe();
  const inv = await s.invoices.create({
    customer: club.stripeCustomerId, collection_method: 'charge_automatically', auto_advance: true,
    pending_invoice_items_behavior: 'exclude', description, metadata
  });
  for (const l of lines) {
    await s.invoiceItems.create({
      customer: club.stripeCustomerId, invoice: inv.id, currency: 'gbp', amount: l.qty * l.unitPence,
      description: `${l.qty} × ${l.name} at £${(l.unitPence / 100).toFixed(2)}`
    });
  }
  return s.invoices.finalizeInvoice(inv.id);
}

/* ---------- startLicence ----------
   First bill for a pathway: Club Licence (pro-rata in the first year) + the term's Gymnast Licences,
   medals and books. Paid through Stripe Checkout, which saves the payment method for termly bills. */
exports.startLicence = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const { clubId, club } = await clubFor(request);
  const pathway = pathwayFrom(request.data);
  const gymnasts = gymnastsFrom(request.data);
  const settings = await getSettings();
  const price = priceFrom(settings, pathway);
  const term = billingTerm(settings);

  const existing = (await licRef(clubId, pathway).get()).data() || {};
  if (L.givesAccess(existing.status) && !existing.endsAt) throw new HttpsError('already-exists', 'This pathway already has a licence.');

  const founding = L.foundingOpen(settings) || existing.foundingClub === true;
  const clubLicence = L.clubLicenceDue(price, term, gymnasts, {
    paidUntil: existing.clubLicence && existing.clubLicence.paidUntil, founding, summerTaster: settings.summerTaster === true });
  const bill = L.termBill({ price, pathway, term, gymnasts,
    books: intFrom(request.data.books, gymnasts), spares: intFrom(request.data.spares), clubLicence });
  if (bill.error) throw new HttpsError('invalid-argument', bill.error);

  const reg = regRef(clubId, pathway, term.id);
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer: club.stripeCustomerId,
    payment_method_types: ['card', 'bacs_debit'],
    payment_intent_data: { setup_future_usage: 'off_session', metadata: { type: 'registration', clubId, pathway, termId: term.id } },
    line_items: bill.lines.map(l => ({ quantity: l.qty, price_data: { currency: 'gbp', unit_amount: l.unitPence, product_data: { name: l.name } } })),
    invoice_creation: { enabled: true },
    metadata: { type: 'registration', kind: 'start', clubId, pathway, termId: term.id },
    success_url: `${APP_URL.value()}?licence=started&pathway=${pathway}`,
    cancel_url: `${APP_URL.value()}?licence=cancelled&pathway=${pathway}`
  });
  await reg.set({
    termId: term.id, kind: 'start', gymnasts, books: intFrom(request.data.books, gymnasts), spares: intFrom(request.data.spares),
    lines: bill.lines, totalPence: bill.totalPence, status: 'pending', checkoutSessionId: session.id,
    clubLicence: clubLicence ? { pence: clubLicence.pence, until: clubLicence.until, founding: clubLicence.founding, taster: clubLicence.taster } : null,
    createdAt: FieldValue.serverTimestamp()
  });
  await licRef(clubId, pathway).set({ pathway, status: existing.status && L.givesAccess(existing.status) ? existing.status : 'pending',
    pendingTermId: term.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { url: session.url };
});

/* ---------- registerTerm ----------
   In the registration window before a term. gymnasts 0 ends the licence when that term starts. */
exports.registerTerm = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const { clubId, club } = await clubFor(request);
  const pathway = pathwayFrom(request.data);
  const gymnasts = gymnastsFrom(request.data, { allowZero: true });
  const settings = await getSettings();
  const price = priceFrom(settings, pathway);
  const term = L.nextTerm(settings);
  if (!term || !L.registrationOpen(term)) throw new HttpsError('failed-precondition', 'Registration for the next term is not open yet.');

  const lic = (await licRef(clubId, pathway).get()).data();
  if (!lic || !L.givesAccess(lic.status)) throw new HttpsError('failed-precondition', 'There is no active licence for this pathway. Start a licence instead.');
  if (!club.defaultPaymentMethod) throw new HttpsError('failed-precondition', 'No saved payment method. Please update your payment details.');
  const reg = regRef(clubId, pathway, term.id);
  if ((await reg.get()).exists) throw new HttpsError('already-exists', `You have already registered for ${term.label}. Once it starts you can add gymnasts.`);

  if (gymnasts === 0) {
    await reg.set({ termId: term.id, kind: 'end', gymnasts: 0, status: 'ending', createdAt: FieldValue.serverTimestamp() });
    await licRef(clubId, pathway).set({ endsAt: term.start, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await logHistory(clubId, { type: 'ending', pathway, termId: term.id, by: request.auth.token.email });
    return { ok: true, ending: true };
  }

  const clubLicence = L.clubLicenceDue(price, term, gymnasts, {
    paidUntil: lic.clubLicence && lic.clubLicence.paidUntil, founding: lic.foundingClub === true, summerTaster: settings.summerTaster === true });
  const bill = L.termBill({ price, pathway, term, gymnasts,
    books: intFrom(request.data.books), spares: intFrom(request.data.spares), clubLicence });
  if (bill.error) throw new HttpsError('invalid-argument', bill.error);

  const inv = await chargeInvoice(club, bill.lines, { type: 'registration', kind: 'register', clubId, pathway, termId: term.id }, `NGL ${L.PATHWAYS[pathway]}: ${term.label}`);
  await reg.set({
    termId: term.id, kind: 'register', gymnasts, books: intFrom(request.data.books), spares: intFrom(request.data.spares),
    lines: bill.lines, totalPence: bill.totalPence, status: 'invoiced', invoiceId: inv.id,
    clubLicence: clubLicence ? { pence: clubLicence.pence, until: clubLicence.until, founding: clubLicence.founding } : null,
    by: request.auth.token.email, createdAt: FieldValue.serverTimestamp()
  });
  await licRef(clubId, pathway).set({ endsAt: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await logHistory(clubId, { type: 'registered-term', pathway, termId: term.id, gymnasts, amountPence: bill.totalPence });
  return { ok: true, totalPence: bill.totalPence };
});

/* ---------- addGymnasts ----------
   During a term: added gymnasts are billed for the current term (licence + this term's medals + books). */
exports.addGymnasts = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const { clubId, club } = await clubFor(request);
  const pathway = pathwayFrom(request.data);
  const added = Number(request.data?.added);
  if (!Number.isInteger(added) || added < 1) throw new HttpsError('invalid-argument', 'Enter how many gymnasts you are adding.');
  const settings = await getSettings();
  const price = priceFrom(settings, pathway);
  const lic = (await licRef(clubId, pathway).get()).data();
  if (!lic || !L.givesAccess(lic.status)) throw new HttpsError('failed-precondition', 'There is no active licence for this pathway.');
  if (!club.defaultPaymentMethod) throw new HttpsError('failed-precondition', 'No saved payment method. Please update your payment details.');
  const term = L.termById(settings, lic.currentTermId) || L.currentTerm(settings);
  if (L.checkGymnasts(lic.gymnasts + added)) throw new HttpsError('invalid-argument', L.checkGymnasts(lic.gymnasts + added));

  const bill = L.termBill({ price, pathway, term, gymnasts: added, books: intFrom(request.data.books, added), spares: 0 });
  if (bill.error) throw new HttpsError('invalid-argument', bill.error);
  const inv = await chargeInvoice(club, bill.lines, { type: 'increase', clubId, pathway, termId: term.id, added: String(added) }, `NGL ${L.PATHWAYS[pathway]}: ${added} more gymnasts, ${term.label}`);
  await regRef(clubId, pathway, term.id).set({ increases: FieldValue.arrayUnion({ added, invoiceId: inv.id, totalPence: bill.totalPence }) }, { merge: true });
  await licRef(clubId, pathway).set({ gymnasts: FieldValue.increment(added), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await logHistory(clubId, { type: 'increase', pathway, termId: term.id, added, amountPence: bill.totalPence, by: request.auth.token.email });
  return { ok: true, totalPence: bill.totalPence };
});

/* ---------- orderProducts ----------
   Extra Pre-School themes, replacement books and spare medals, any time, by card. */
exports.orderProducts = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const { clubId, club } = await clubFor(request);
  const pathway = pathwayFrom(request.data);
  const settings = await getSettings();
  const price = priceFrom(settings, pathway);
  const lic = (await licRef(clubId, pathway).get()).data();
  if (!lic || !L.givesAccess(lic.status)) throw new HttpsError('failed-precondition', 'Orders need an active licence for this pathway.');
  const check = L.checkOrder(price, request.data?.items, lic.gymnasts);
  if (check.error) throw new HttpsError('invalid-argument', check.error);
  const orderRef = db.collection(`clubs/${clubId}/orders`).doc();
  const name = L.PATHWAYS[pathway];
  const session = await stripe().checkout.sessions.create({
    mode: 'payment', customer: club.stripeCustomerId, payment_method_types: ['card'],
    line_items: check.lines.map(l => ({ quantity: l.qty, price_data: { currency: 'gbp', unit_amount: l.unitPence, product_data: { name: `NGL ${name}: ${l.name}` } } })),
    invoice_creation: { enabled: true },
    metadata: { type: 'order', clubId, pathway, orderId: orderRef.id },
    success_url: `${APP_URL.value()}?order=paid&pathway=${pathway}`,
    cancel_url: `${APP_URL.value()}?order=cancelled&pathway=${pathway}`
  });
  await orderRef.set({ pathway, lines: check.lines, totalPence: check.totalPence, status: 'pending',
    checkoutSessionId: session.id, by: request.auth.token.email, createdAt: FieldValue.serverTimestamp() });
  return { url: session.url };
});

/* ---------- termRollover (daily) ----------
   When a term starts: clubs that registered 0 end; clubs that did not register are rolled over
   at their current number and billed (with the Club Licence renewal on the autumn bill). */
exports.termRollover = onSchedule({ schedule: 'every day 06:00', timeZone: 'Europe/London', secrets: [STRIPE_SECRET_KEY] }, async () => {
  const settings = await getSettings();
  const term = L.currentTerm(settings);
  if (!term) return;
  const live = await db.collectionGroup('licences').where('status', 'in', ['active', 'past_due']).get();
  for (const doc of live.docs) {
    const lic = doc.data(), clubId = doc.ref.parent.parent.id, pathway = doc.id;
    if (lic.currentTermId === term.id) continue;
    const reg = await regRef(clubId, pathway, term.id).get();
    try {
      if (reg.exists && reg.get('status') === 'ending') {
        await doc.ref.set({ status: 'ended', gymnasts: 0, endedAt: term.start }, { merge: true });
        await setAccessCode(clubId, pathway, 'ended');
        await logHistory(clubId, { type: 'ended', pathway, termId: term.id });
        continue;
      }
      if (reg.exists) {   // registered: becomes the current term
        await doc.ref.set({ currentTermId: term.id, gymnasts: reg.get('gymnasts') }, { merge: true });
        continue;
      }
      const club = (await db.doc(`clubs/${clubId}`).get()).data();
      const price = L.pricingFor(settings, pathway);
      if (!price || !club.defaultPaymentMethod) { await doc.ref.set({ status: 'past_due' }, { merge: true }); continue; }
      const clubLicence = L.clubLicenceDue(price, term, lic.gymnasts, {
        paidUntil: lic.clubLicence && lic.clubLicence.paidUntil, founding: lic.foundingClub === true, summerTaster: settings.summerTaster === true });
      const bill = L.termBill({ price, pathway, term, gymnasts: lic.gymnasts, books: 0, spares: 0, clubLicence });
      const inv = await chargeInvoice(club, bill.lines, { type: 'registration', kind: 'rollover', clubId, pathway, termId: term.id }, `NGL ${L.PATHWAYS[pathway]}: ${term.label} (rolled over)`);
      await regRef(clubId, pathway, term.id).set({
        termId: term.id, kind: 'rollover', gymnasts: lic.gymnasts, books: 0, spares: 0, lines: bill.lines, totalPence: bill.totalPence,
        status: 'invoiced', invoiceId: inv.id,
        clubLicence: clubLicence ? { pence: clubLicence.pence, until: clubLicence.until, founding: clubLicence.founding } : null,
        createdAt: FieldValue.serverTimestamp()
      });
      await doc.ref.set({ currentTermId: term.id }, { merge: true });
      await logHistory(clubId, { type: 'rollover', pathway, termId: term.id, gymnasts: lic.gymnasts, amountPence: bill.totalPence });
    } catch (err) {
      logger.error('Rollover failed', { clubId, pathway, err: err.message });
    }
  }
});

async function setAccessCode(clubId, pathway, status) {
  if (pathway !== 'schools') return;
  const club = await db.doc(`clubs/${clubId}`).get();
  const code = club.get('accessCode');
  if (code) await db.doc(`accessCodes/${code}`).set({ status: L.givesAccess(status) ? 'active' : 'inactive' }, { merge: true });
}

/* A registration's bill has been paid: the licence is active for that term. */
async function registrationPaid(m, amountPence) {
  const { clubId, pathway, termId } = m;
  const ref = regRef(clubId, pathway, termId);
  const reg = (await ref.get()).data() || {};
  await ref.set({ status: 'paid', paidAt: FieldValue.serverTimestamp() }, { merge: true });
  const settings = await getSettings();
  const cur = L.currentTerm(settings);
  const startedNow = !cur || termId === cur.id || reg.kind === 'start';
  const update = { status: 'active', updatedAt: FieldValue.serverTimestamp(), pendingTermId: null };
  if (startedNow) { update.currentTermId = termId; update.gymnasts = reg.gymnasts; }
  if (reg.clubLicence) {
    update.clubLicence = { paidUntil: reg.clubLicence.until, lastPaidPence: reg.clubLicence.pence };
    if (reg.clubLicence.founding) update.foundingClub = true;
  }
  await licRef(clubId, pathway).set(update, { merge: true });
  await setAccessCode(clubId, pathway, 'active');
  await logHistory(clubId, { type: 'payment', pathway, termId, amountPence });
}

/* ---------- billingPortal ----------
   Stripe-hosted page for payment details and invoices.
   Payment details and invoices only: numbers change through termly registration. */
exports.billingPortal = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const { club } = await clubFor(request);
  const session = await stripe().billingPortal.sessions.create({
    customer: club.stripeCustomerId,
    return_url: APP_URL.value()
  });
  return { url: session.url };
});

/* ---------- stripeWebhook ----------
   Stripe tells us what happened; this is the only place licence status is set. */
function invoiceMeta(inv) {
  return inv.metadata || (inv.parent && inv.parent.invoice_details && inv.parent.invoice_details.metadata) || {};
}

exports.stripeWebhook = onRequest({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  let event;
  try {
    event = stripe().webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET.value());
  } catch (err) {
    logger.warn('Bad webhook signature', err.message);
    res.status(400).send('Bad signature');
    return;
  }

  try {
    const o = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const m = o.metadata || {};
        if (o.payment_status !== 'paid') break;          // Direct Debit: wait for async_payment_succeeded
        if (m.type === 'order' && m.clubId && m.orderId) {
          await db.doc(`clubs/${m.clubId}/orders/${m.orderId}`).set({ status: 'paid', paidAt: FieldValue.serverTimestamp() }, { merge: true });
          await logHistory(m.clubId, { type: 'order', pathway: m.pathway, amountPence: o.amount_total, orderId: m.orderId });
        } else if (m.type === 'registration' && m.clubId) {
          // save the payment method so later termly bills are charged automatically
          if (o.payment_intent) {
            const pi = await stripe().paymentIntents.retrieve(o.payment_intent);
            if (pi.payment_method) {
              await stripe().customers.update(o.customer, { invoice_settings: { default_payment_method: pi.payment_method } });
              await db.doc(`clubs/${m.clubId}`).set({ defaultPaymentMethod: true }, { merge: true });
            }
          }
          await registrationPaid(m, o.amount_total);
        }
        break;
      }
      case 'checkout.session.async_payment_failed': {
        const m = o.metadata || {};
        if (m.type === 'registration' && m.clubId) {
          await regRef(m.clubId, m.pathway, m.termId).set({ status: 'failed' }, { merge: true });
          await licRef(m.clubId, m.pathway).set({ status: 'lapsed' }, { merge: true });
        }
        break;
      }
      case 'invoice.paid': {
        const m = invoiceMeta(o);
        if (m.type === 'registration' && m.clubId) await registrationPaid(m, o.amount_paid);
        if (m.type === 'increase' && m.clubId) {
          await licRef(m.clubId, m.pathway).set({ status: 'active' }, { merge: true });
          await logHistory(m.clubId, { type: 'payment', pathway: m.pathway, termId: m.termId, amountPence: o.amount_paid });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const m = invoiceMeta(o);
        if (m.clubId && m.pathway) {
          await licRef(m.clubId, m.pathway).set({ status: 'past_due' }, { merge: true });
          if (m.type === 'registration') await regRef(m.clubId, m.pathway, m.termId).set({ status: 'failed' }, { merge: true });
          await logHistory(m.clubId, { type: 'payment-failed', pathway: m.pathway, termId: m.termId, amountPence: o.amount_due });
        }
        break;
      }
      case 'invoice.marked_uncollectible':
      case 'invoice.voided': {
        const m = invoiceMeta(o);
        if (m.clubId && m.pathway) {
          await licRef(m.clubId, m.pathway).set({ status: 'lapsed' }, { merge: true });
          await setAccessCode(m.clubId, m.pathway, 'lapsed');
        }
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    logger.error('Webhook handling failed', { type: event.type, err: err.message });
    res.status(500).send('Webhook handler error');   // Stripe will retry
  }
});
