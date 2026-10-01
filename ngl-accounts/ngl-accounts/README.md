# NGL Club Account — setup guide

One account per club, one licence per pathway: a yearly Club Licence plus termly gymnast registration, paid through Stripe.

```
ngl-club-account.html   The club portal (runs in preview mode until you add the Firebase config)
functions/              Cloud Functions: registerClub, startLicence, changeGymnasts, billingPortal, stripeWebhook
functions/licensing.js  The licence rules (terms, termly bills, Club Licence pro-rata) — tested by `npm test`
firestore.rules         Security rules: clubs see only their own records; only functions write licences
scripts/make-admin.js   Gives a login the NGL admin role
```

## 1. Try the preview

Open `ngl-club-account.html` in a browser. Sign in with any email and password. Use **Pretend today is** to move between terms and registration windows (e.g. 10 Dec 2026 opens Spring registration).

## 2. Firebase (about 20 minutes)

1. In the Firebase console, create a new project called **ngl-accounts**. Keep it separate from saadi-rotation.
2. **Firestore:** create a database in location **europe-west2 (London)**.
3. **Authentication:** turn on **Email/Password**.
4. **Billing:** upgrade to the **Blaze** (pay-as-you-go) plan. Cloud Functions need it; at NGL's volumes the cost should be little or nothing. Set a budget alert of £5.
5. **Project settings → Your apps → Web app:** copy the config object. Paste it into `ngl-club-account.html` as `FIREBASE_CONFIG`.
6. **Authentication → Settings → Authorised domains:** add `davidcbrooke.github.io` (and any Squarespace domain the page is embedded on).

## 3. Stripe (test mode first)

1. No products or prices to create: each licence is created with its pathway's price from the NGL admin tab.
2. **Settings → Payment methods:** turn on **Bacs Direct Debit** (card is on by default).
3. **Settings → Billing → Customer portal:** allow updating payment methods and viewing invoices.
4. Copy the **secret key** (`sk_test_…`) from Developers → API keys.

## 4. Deploy

```bash
npm install -g firebase-tools
firebase login
cd ngl-accounts/functions && npm install && npm test && cd ..
firebase functions:secrets:set STRIPE_SECRET_KEY        # paste sk_test_…
firebase deploy --only functions,firestore:rules
#   first deploy asks for APP_URL
#   APP_URL = https://davidcbrooke.github.io/GYMNASTICS-RESULTS/ngl-club-account.html
```

Then, in Stripe → Developers → **Webhooks → Add endpoint**:

- URL: `https://europe-west2-ngl-accounts.cloudfunctions.net/stripeWebhook`
- Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`

Copy the signing secret (`whsec_…`), then:

```bash
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET    # paste whsec_…
firebase deploy --only functions
```

## 5. Make yourself NGL admin

Register your own login through the page first, then:

```bash
gcloud auth application-default login
node scripts/make-admin.js you@example.com
```

Sign out and back in. The **NGL admin** tab appears. Check this year's term calendar (registration dates and Pre-School countries) and the prices.

## 6. Test end to end (still test mode)

- Register SAADI, start a Schools licence with test card `4242 4242 4242 4242`, or Direct Debit sort code `10-88-00` / account `00012345`.
- Check the licence turns **Active** and the Schools club code is active.
- Start a Pre-School licence: the first bill includes the Club Licence (pro-rata if mid-year), the term's Gymnast Licences, country medals and passports. Then use the admin tab to open registration for the next term and register.
- Add gymnasts mid-term and check a Stripe invoice is charged to the saved card.
- Register 0 for next term and check the licence ends when the term starts (or run `termRollover` by hand from the Firebase console).
- Save test card `4000 0000 0000 0341` as the payment method, register for a term, and check the licence moves to **Payment due**.

## 7. Go live

Repeat step 3 in Stripe live mode. Update both secrets with the live values. Redeploy, and re-create the webhook in live mode.

## Starting prices (change in the NGL admin tab)

| Pathway | Club Licence per year (founding / full) | Gymnast Licence | Medals to club | Book to club |
|---|---|---|---|---|
| Pre-School | £200 / £400 (10 themes; extra £25) | £4 a term | £2 each, that term's countries (≈4/3/3) | £5 passport |
| Schools | — | £4 a term | — | £5 |
| Recreational | <200: £500 / £1,000 · 200–499: £1,000 / £1,500 · 500+: £1,500 / £2,000 | £4 a term | £2.50, 1 a term | £5 |
| General League | — | £4 a term | — | £5 |
| Performance League | — | £4 a term | — | £5 |

- Club Licence renews each September with the autumn bill; first year pro-rata by term (summer taster switch in admin).
- Each term the club registers its gymnasts in the registration window; unregistered clubs roll over at their current number when the term starts (`termRollover`, daily 06:00). The first time it runs, Firestore may log a link to create a collection-group index on `licences.status` — open it once.
- The term calendar (dates, registration opening, Pre-School countries) is set in the admin tab each year.

## Rules at a glance

| | |
|---|---|
| Club Licence | Yearly, renews in September; first year pro-rata by term |
| Each term | Register gymnast numbers; bill = £4 Gymnast Licence + that term's medals + books for those who need one |
| Add gymnasts | Any time; billed for the current term |
| Reduce or end | Register a lower number (or 0) for the next term before it starts |
| Not registered | Rolled over at the current number |
| Failed payment | Stripe retries and emails the club; access continues as "Payment due" until Stripe gives up, then the licence lapses |
