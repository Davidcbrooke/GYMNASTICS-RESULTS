# NGL Club Account — setup guide

One account per club, one licence per pathway, paid per gymnast (weekly or monthly, by pathway) through Stripe.

```
ngl-club-account.html   The club portal (runs in preview mode until you add the Firebase config)
functions/              Cloud Functions: registerClub, startLicence, changeGymnasts, billingPortal, stripeWebhook
functions/licensing.js  The licence rules (holiday lock, book fees) — tested by `npm test`
firestore.rules         Security rules: clubs see only their own records; only functions write licences
scripts/make-admin.js   Gives a login the NGL admin role
```

## 1. Try the preview

Open `ngl-club-account.html` in a browser. Sign in with any email and password. Use **Pretend today is** to test the holiday lock.

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
3. **Settings → Billing → Customer portal:** allow updating payment methods and viewing invoices. **Turn off** "customers can update quantities" and "customers can cancel". Number changes must go through the Club Account so the holiday lock applies.
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

Sign out and back in. The **NGL admin** tab appears. Enter this year's holiday windows and check the prices for each pathway.

## 6. Test end to end (still test mode)

- Register SAADI, start a Schools licence with test card `4242 4242 4242 4242`, or Direct Debit sort code `10-88-00` / account `00012345`.
- Check the licence turns **Active** and the Schools club code is active.
- Start a Pre-School licence: the first payment includes the £200 club fee. Order medals and an extra theme from the card.
- Add gymnasts (say 3 of them need a book), and check the book fee for 3 appears on the next invoice in Stripe.
- Try reducing numbers outside a window (blocked), then add a window covering today and try again (allowed).
- Use test card `4000 0000 0000 0341` to see a failed payment move the licence to **Payment due**.

## 7. Go live

Repeat step 3 in Stripe live mode. Update both secrets with the live values. Redeploy, and re-create the webhook in live mode.

## Starting prices (change in the NGL admin tab)

| Pathway | Club fee per year (founding / full) | Licence | Book fee | Medals to club |
|---|---|---|---|---|
| Pre-School | £200 / £400 (10 themes; extra themes £25) | £1 a month | £10 | £2 (up to 10 a year) |
| Schools | — | £1 a month | £8 | — |
| Recreational | under 200: £500 / £1,000 · 200–499: £1,000 / £1,500 · 500+: £1,500 / £2,000 | £1 a month | £5 | £2.50 (up to 3 a year) |
| General League | — | £1 a month | £10 | — |
| Performance League | — | £1 a month | £10 | — |
| University, Masters | — | £1 a month | — | Off sale until a book fee is set |

Founding club prices apply to clubs that start by the date set in the admin tab (default 31 Aug 2027) and are kept at renewal.
Club fees renew yearly: the `renewClubFees` function adds them to the next payment on each anniversary.
The first time it runs, Firestore may log a link to create a collection-group index on `licences.clubFeeRenewsAt` — open the link once to create it.

## Rules at a glance

| | |
|---|---|
| Book fee | Only for gymnasts who need a new book: on the first payment, or added to the next payment when gymnasts are added |
| Licence fee | Per gymnast, weekly or monthly depending on the pathway |
| Add gymnasts | Any time; new amount from the next payment, no part-period charges |
| Reduce or cancel | Only inside an NGL holiday window; takes effect from the next payment |
| Failed payment | Stripe retries and emails the club; access continues as "Payment due" until Stripe gives up, then the licence lapses |
