/* =====================================================================
   NGL CLUB ACCOUNT - Cloud Functions
   ---------------------------------------------------------------------
   Everything that touches money or licence status runs here, never in
   the browser. The Club Account page calls these functions; Stripe
   calls stripeWebhook. Firestore rules stop clubs writing licences.

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

const DEFAULT_SETTINGS = { pathways: {}, windows: [] };
const YEAR_MS = 365 * 24 * 3600 * 1000;

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

/* ---------- startLicence ----------
   Returns a Stripe Checkout URL.
   First payment = book fee x gymnasts needing a book + first week/month x gymnasts, at this pathway's prices.
   Gymnasts who already own the book pay no book fee. */
exports.startLicence = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const { clubId, club } = await clubFor(request);
  const pathway = pathwayFrom(request.data);
  const gymnasts = gymnastsFrom(request.data);
  const settings = await getSettings();
  const price = priceFrom(settings, pathway);
  const bookCheck = L.checkBooks(request.data?.books === undefined ? undefined : Number(request.data.books), gymnasts);
  if (bookCheck.error) throw new HttpsError('invalid-argument', bookCheck.error);
  const books = bookCheck.books;

  const existing = await db.doc(`clubs/${clubId}/licences/${pathway}`).get();
  if (existing.exists && L.givesAccess(existing.get('status'))) {
    throw new HttpsError('already-exists', 'This pathway already has a licence. Use Change gymnasts instead.');
  }

  // Yearly club fee for the plans. Founding pricing while it is open; a founding club keeps it when restarting.
  const founding = L.foundingOpen(settings) || (existing.exists && existing.get('foundingClub') === true);
  const clubFee = L.clubFeeFor(price, gymnasts, { founding });

  const pathwayName = L.PATHWAYS[pathway];
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: club.stripeCustomerId,
    payment_method_types: ['card', 'bacs_debit'],
    line_items: [
      {
        quantity: gymnasts,
        price_data: {
          currency: 'gbp',
          unit_amount: price.unitPence,
          recurring: { interval: price.interval },
          product_data: { name: `NGL ${pathwayName} licence (per gymnast, per ${price.interval})` }
        }
      },
      {
        quantity: books,
        price_data: {
          currency: 'gbp',
          unit_amount: price.bookPence,
          product_data: { name: `NGL ${pathwayName} book fee (per gymnast needing a book)` }
        }
      },
      ...(clubFee ? [{
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: clubFee.pence,
          product_data: { name: `NGL ${pathwayName} club fee, 12 months of plans (${clubFee.band}${clubFee.founding ? ', founding club price' : ''})` }
        }
      }] : [])
    ].filter(li => li.quantity > 0 && li.price_data.unit_amount > 0),
    subscription_data: {
      description: `NGL ${pathwayName} licence`,
      metadata: { clubId, pathway }
    },
    metadata: { clubId, pathway, clubFeePence: String(clubFee ? clubFee.pence : 0), founding: String(!!(clubFee && clubFee.founding)) },
    success_url: `${APP_URL.value()}?licence=started&pathway=${pathway}`,
    cancel_url: `${APP_URL.value()}?licence=cancelled&pathway=${pathway}`
  });

  await db.doc(`clubs/${clubId}/licences/${pathway}`).set({
    pathway, status: 'pending', gymnasts, booksOrdered: books, checkoutSessionId: session.id,
    foundingClub: !!(clubFee && clubFee.founding),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { url: session.url };
});

/* ---------- changeGymnasts ----------
   Up: any time; book fee for added gymnasts who need a book goes on the next invoice.
   Down or 0 (cancel): only inside an admin-set holiday window. No part-month charges. */
exports.changeGymnasts = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const { clubId, club } = await clubFor(request);
  const pathway = pathwayFrom(request.data);
  const requested = gymnastsFrom(request.data, { allowZero: true });
  const settings = await getSettings();
  const price = priceFrom(settings, pathway);

  const licRef = db.doc(`clubs/${clubId}/licences/${pathway}`);
  const lic = (await licRef.get()).data();
  if (!lic || !lic.subscriptionId || !L.givesAccess(lic.status)) {
    throw new HttpsError('failed-precondition', 'There is no active licence for this pathway.');
  }

  const current = lic.gymnasts;
  const unitPence = lic.unitPence || price.unitPence;   // the club keeps the price it signed up at
  let plan;
  if (lic.cancelAtPeriodEnd && requested > 0) {
    // Undoing a cancellation: always allowed; book fee only for extra gymnasts who need a book
    const added = Math.max(requested - current, 0);
    const b = request.data?.books === undefined ? added : Number(request.data.books);
    if (!Number.isInteger(b) || b < 0 || b > added) throw new HttpsError('invalid-argument', `Books must be between 0 and ${added}.`);
    plan = {
      kind: 'undo-cancel', allowed: true, books: b,
      bookFeePence: b * price.bookPence,
      periodToPence: requested * unitPence
    };
  } else {
    plan = L.planChange({
      current, requested,
      bookPence: price.bookPence, unitPence,
      books: request.data?.books === undefined ? undefined : Number(request.data.books),
      windows: settings.windows
    });
  }
  if (!plan.allowed) throw new HttpsError('failed-precondition', plan.reason);

  const s = stripe();
  const sub = await s.subscriptions.retrieve(lic.subscriptionId);
  const item = sub.items.data.find(i => i.price.recurring) || sub.items.data[0];
  const pathwayName = L.PATHWAYS[pathway];

  if (plan.kind === 'cancel') {
    await s.subscriptions.update(sub.id, { cancel_at_period_end: true });
  } else {
    if (plan.bookFeePence > 0) {
      const added = plan.books;
      // Book fee for added gymnasts who need a book, collected with the next payment
      await s.invoiceItems.create({
        customer: club.stripeCustomerId,
        subscription: sub.id,
        currency: 'gbp',
        amount: plan.bookFeePence,
        description: `NGL ${pathwayName} book fee: ${added} book${added === 1 ? '' : 's'}`
      });
    }
    await s.subscriptions.update(sub.id, {
      cancel_at_period_end: false,
      proration_behavior: 'none',
      items: [{ id: item.id, quantity: requested }]
    });
  }

  await licRef.set({
    gymnasts: plan.kind === 'cancel' ? lic.gymnasts : requested,
    cancelAtPeriodEnd: plan.kind === 'cancel',
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await logHistory(clubId, {
    type: plan.kind, pathway, from: lic.gymnasts, to: requested,
    books: plan.books || 0, bookFeePence: plan.bookFeePence, by: request.auth.token.email
  });
  return { ok: true, kind: plan.kind, bookFeePence: plan.bookFeePence, periodToPence: plan.periodToPence };
});

/* ---------- orderProducts ----------
   One-off purchases for a licensed pathway: medals, replacement books, extra Pre-School themes.
   Medals and books are capped per licensed gymnast per year (the head-count check). */
exports.orderProducts = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const { clubId, club } = await clubFor(request);
  const pathway = pathwayFrom(request.data);
  const settings = await getSettings();
  const price = priceFrom(settings, pathway);
  const lic = (await db.doc(`clubs/${clubId}/licences/${pathway}`).get()).data();
  if (!lic || !L.givesAccess(lic.status)) throw new HttpsError('failed-precondition', 'Orders need an active licence for this pathway.');

  const since = Timestamp.fromMillis(Date.now() - YEAR_MS);
  const past = await db.collection(`clubs/${clubId}/orders`)
    .where('pathway', '==', pathway).where('status', '==', 'paid').where('paidAt', '>=', since).get();
  const ordered = {};
  past.forEach(d => (d.get('lines') || []).forEach(l => { ordered[l.id] = (ordered[l.id] || 0) + l.qty; }));

  const check = L.checkOrder(price, request.data?.items, lic.gymnasts, ordered);
  if (check.error) throw new HttpsError('invalid-argument', check.error);

  const orderRef = db.collection(`clubs/${clubId}/orders`).doc();
  const pathwayName = L.PATHWAYS[pathway];
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer: club.stripeCustomerId,
    payment_method_types: ['card'],
    line_items: check.lines.map(l => ({
      quantity: l.qty,
      price_data: { currency: 'gbp', unit_amount: l.unitPence, product_data: { name: `NGL ${pathwayName}: ${l.name}` } }
    })),
    invoice_creation: { enabled: true },
    metadata: { type: 'order', clubId, pathway, orderId: orderRef.id },
    success_url: `${APP_URL.value()}?order=paid&pathway=${pathway}`,
    cancel_url: `${APP_URL.value()}?order=cancelled&pathway=${pathway}`
  });
  await orderRef.set({
    pathway, lines: check.lines, totalPence: check.totalPence, status: 'pending',
    checkoutSessionId: session.id, by: request.auth.token.email, createdAt: FieldValue.serverTimestamp()
  });
  return { url: session.url };
});

/* ---------- renewClubFees (daily) ----------
   On each licence's anniversary the yearly club fee is added to its next payment,
   at the band for its current number of gymnasts. Founding clubs keep founding prices. */
exports.renewClubFees = onSchedule({ schedule: 'every day 06:00', timeZone: 'Europe/London', secrets: [STRIPE_SECRET_KEY] }, async () => {
  const settings = await getSettings();
  const due = await db.collectionGroup('licences').where('clubFeeRenewsAt', '<=', Timestamp.now()).get();
  for (const doc of due.docs) {
    const lic = doc.data(), clubId = doc.ref.parent.parent.id, pathway = doc.id;
    if (!L.givesAccess(lic.status) || lic.cancelAtPeriodEnd || !lic.subscriptionId) continue;
    const price = L.pricingFor(settings, pathway);
    const fee = price && L.clubFeeFor(price, lic.gymnasts, { founding: lic.foundingClub === true });
    const next = Timestamp.fromMillis(lic.clubFeeRenewsAt.toMillis() + YEAR_MS);
    if (fee && fee.pence > 0) {
      const club = (await db.doc(`clubs/${clubId}`).get()).data();
      await stripe().invoiceItems.create({
        customer: club.stripeCustomerId, subscription: lic.subscriptionId, currency: 'gbp', amount: fee.pence,
        description: `NGL ${L.PATHWAYS[pathway]} club fee, next 12 months of plans (${fee.band}${fee.founding ? ', founding club price' : ''})`
      });
      await logHistory(clubId, { type: 'club-fee-renewal', pathway, amountPence: fee.pence });
    }
    await doc.ref.set({ clubFeeRenewsAt: next, clubFeePence: fee ? fee.pence : 0 }, { merge: true });
  }
});

/* ---------- billingPortal ----------
   Stripe-hosted page for payment details and invoices.
   In the Stripe dashboard, turn OFF "update quantity" and "cancel" for the portal,
   so number changes always go through changeGymnasts and its holiday lock. */
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
function periodEnd(sub) {
  // Newer Stripe API versions keep the period on the subscription item
  return sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null;
}

async function syncSubscription(sub) {
  const { clubId, pathway } = sub.metadata || {};
  if (!clubId || !L.PATHWAYS[pathway]) {
    logger.warn('Subscription without NGL metadata', { id: sub.id });
    return;
  }
  const item = sub.items.data.find(i => i.price.recurring) || sub.items.data[0];
  const status = L.licenceStatus(sub.status);
  const end = periodEnd(sub);
  const gymnasts = item?.quantity ?? 0;
  const unitPence = item?.price?.unit_amount ?? 0;
  const interval = item?.price?.recurring?.interval || 'month';
  await db.doc(`clubs/${clubId}/licences/${pathway}`).set({
    pathway,
    status,
    stripeStatus: sub.status,
    subscriptionId: sub.id,
    gymnasts,
    unitPence,
    interval,
    periodPence: gymnasts * unitPence,
    monthlyEquivalentPence: L.monthlyEquivalentPence(unitPence, interval, gymnasts),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    nextPaymentAt: end && status !== 'lapsed' ? Timestamp.fromMillis(end * 1000) : null,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  if (pathway === 'schools') {
    const club = await db.doc(`clubs/${clubId}`).get();
    const code = club.get('accessCode');
    if (code) await db.doc(`accessCodes/${code}`).set({ status: L.givesAccess(status) ? 'active' : 'inactive' }, { merge: true });
  }
}

function invoiceSubscriptionId(inv) {
  return inv.subscription || inv.parent?.subscription_details?.subscription || null;
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
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(o);
        break;

      case 'checkout.session.completed': {
        const m = o.metadata || {};
        if (m.type === 'order' && m.clubId && m.orderId) {
          await db.doc(`clubs/${m.clubId}/orders/${m.orderId}`).set({ status: 'paid', paidAt: FieldValue.serverTimestamp() }, { merge: true });
          await logHistory(m.clubId, { type: 'order', pathway: m.pathway, amountPence: o.amount_total, orderId: m.orderId });
        } else if (o.mode === 'subscription' && m.clubId && m.pathway) {
          // first year's club fee paid with the first payment; renews on the anniversary
          const fee = Number(m.clubFeePence || 0);
          await db.doc(`clubs/${m.clubId}/licences/${m.pathway}`).set({
            clubFeePence: fee,
            foundingClub: m.founding === 'true',
            clubFeeRenewsAt: fee > 0 ? Timestamp.fromMillis(Date.now() + YEAR_MS) : null
          }, { merge: true });
        }
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const subId = invoiceSubscriptionId(o);
        if (!subId) break;
        const sub = await stripe().subscriptions.retrieve(subId);
        await syncSubscription(sub);
        const { clubId, pathway } = sub.metadata || {};
        if (clubId) {
          await logHistory(clubId, {
            type: event.type === 'invoice.paid' ? 'payment' : 'payment-failed',
            pathway, amountPence: event.type === 'invoice.paid' ? o.amount_paid : o.amount_due,
            invoice: o.number || o.id
          });
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
