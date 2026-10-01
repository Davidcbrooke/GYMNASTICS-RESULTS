/*
  NGL admin guard
  ----------------
  Add to every admin page, AFTER the Firebase auth + firestore compat scripts
  and AFTER firebase.initializeApp(...):

    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
    <script src="ngl-admin-guard.js" data-section="staffing"></script>

  data-section must match a section id in NGL_Admin_Hub.html
  (competitions, staffing, judging, licensing, finance).

  The page stays hidden until the person is confirmed. If they aren't signed in
  they're sent to the hub; if they lack access they see a message.
  When access is confirmed it fires:
    document.addEventListener("ngl-admin-ready", e => { e.detail = {email, name, owner} })
  Use that in place of each page's old password prompt.

  ---------------------------------------------------------------
  Firestore rules (the part that actually enforces access).
  A page guard alone can be bypassed by anyone who reads the source,
  so lock the data too. Starting point:

  rules_version = '2';
  service cloud.firestore {
    match /databases/{db}/documents {
      function me() { return get(/databases/$(db)/documents/ngl_admin_users/$(request.auth.token.email.lower())).data; }
      function signedIn() { return request.auth != null; }
      function isOwner() { return signedIn() && me().owner == true; }
      function has(section) { return signedIn() && (me().owner == true || section in me().sections); }

      match /ngl_admin_users/{email} {
        allow read: if signedIn() && (request.auth.token.email.lower() == email || isOwner());
        allow write: if isOwner();
        // First-run: the verified admin address may create its own owner record once.
        allow create: if signedIn()
          && email == 'admin@nationalgymnasticsleague.co.uk'
          && request.auth.token.email.lower() == email
          && request.auth.token.email_verified == true;
      }
      match /ngl_staffing/{doc} { allow read, write: if has('staffing'); }

      // Collections that public pages also write to (club bookings, judge sign-ups)
      // need their public create kept open, with read/update/delete limited:
      // match /ngl_bookings/{doc} {
      //   allow create: if true;
      //   allow read, update, delete: if has('competitions');
      // }
    }
  }
  ---------------------------------------------------------------
*/
(function () {
  var HUB_URL = "NGL_Admin_Hub.html";
  var USERS = "ngl_admin_users";
  var section = document.currentScript && document.currentScript.dataset.section;

  var hide = document.createElement("style");
  hide.textContent = "body{visibility:hidden}";
  document.head.appendChild(hide);

  function block(msg) {
    document.body.innerHTML =
      '<div style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:24px;text-align:center">' +
      "<h2 style=\"color:#14254a\">No access</h2><p>" + msg + "</p>" +
      '<p><a href="' + HUB_URL + '" target="_top">Go to NGL admin</a></p></div>';
    hide.remove();
  }

  firebase.auth().onAuthStateChanged(function (u) {
    if (!u) {
      window.top.location.href = HUB_URL + (section ? "?section=" + section : "");
      return;
    }
    var email = u.email.toLowerCase();
    firebase.firestore().collection(USERS).doc(email).get().then(function (d) {
      var rec = d.exists ? d.data() : null;
      if (!rec || !(rec.owner || (rec.sections || []).indexOf(section) > -1)) {
        return block("Your account doesn't include this area. Ask Dave to add it.");
      }
      hide.remove();
      document.dispatchEvent(new CustomEvent("ngl-admin-ready", {
        detail: { email: email, name: rec.name || email, owner: !!rec.owner }
      }));
    }).catch(function () { block("Couldn't check your access. Refresh to try again."); });
  });
})();
