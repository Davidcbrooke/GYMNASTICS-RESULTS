/* Give a login the NGL admin role (run once per admin).
   Usage (from the ngl-accounts folder, after `gcloud auth application-default login`):
     node scripts/make-admin.js you@example.com
   The person must sign out and back in for the role to apply. */
const { initializeApp } = require('../functions/node_modules/firebase-admin/lib/app');
const { getAuth } = require('../functions/node_modules/firebase-admin/lib/auth');
initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'ngl-accounts' });
const email = process.argv[2];
if (!email) { console.error('Usage: node scripts/make-admin.js email'); process.exit(1); }
getAuth().getUserByEmail(email)
  .then(u => getAuth().setCustomUserClaims(u.uid, { ...(u.customClaims || {}), admin: true }))
  .then(() => console.log(`${email} is now an NGL admin. Sign out and back in.`))
  .catch(e => { console.error(e.message); process.exit(1); });
