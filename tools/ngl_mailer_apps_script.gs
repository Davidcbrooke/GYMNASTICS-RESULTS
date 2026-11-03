/**
 * NGL Mailer: sends competition emails from admin@nationalgymnasticsleague.co.uk
 * for the NGL Bookings admin page. Only signed-in NGL admins (listed in
 * ngl_admin_users in the saadi-rotation Firebase project) can use it.
 */
var FIREBASE_API_KEY = 'AIzaSyDV7BuYhSjji9DQDjih5a6Ms7G-SVZpKw4';
var PROJECT = 'saadi-rotation';
var MAX_PER_REQUEST = 80;

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var who = checkAdmin(req.idToken);
    var msgs = req.messages || [];
    if (!msgs.length) throw new Error('No messages.');
    if (msgs.length > MAX_PER_REQUEST) throw new Error('Too many emails in one go (max ' + MAX_PER_REQUEST + ').');
    var sent = msgs.map(function (m) {
      var to = String(m.to || '').trim();
      if (!/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(to)) return { to: to, ok: false, error: 'Not a valid address' };
      try {
        MailApp.sendEmail({ to: to, subject: String(m.subject || 'National Gymnastics League'), body: String(m.text || ''),
          htmlBody: String(m.html || ''), name: 'National Gymnastics League', replyTo: 'admin@nationalgymnasticsleague.co.uk' });
        return { to: to, ok: true };
      } catch (err) { return { to: to, ok: false, error: String(err) }; }
    });
    console.log(who + ' sent ' + sent.filter(function (s) { return s.ok; }).length + ' emails');
    out = { ok: true, by: who, sent: sent, quotaLeft: MailApp.getRemainingDailyQuota() };
  } catch (err) {
    out = { ok: false, error: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'NGL Mailer' })).setMimeType(ContentService.MimeType.JSON);
}

/** Checks the Firebase sign-in token, then that the person is an NGL admin with Competitions access. */
function checkAdmin(idToken) {
  if (!idToken) throw new Error('Please sign in to NGL Admin.');
  var r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  var u = (JSON.parse(r.getContentText()).users || [])[0];
  if (r.getResponseCode() !== 200 || !u || !u.email) throw new Error('Your sign-in has expired. Refresh NGL Admin and try again.');
  var email = u.email.toLowerCase();
  var d = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/ngl_admin_users/' + encodeURIComponent(email), {
    headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
  if (d.getResponseCode() !== 200) throw new Error(email + ' is not an NGL admin.');
  var f = JSON.parse(d.getContentText()).fields || {};
  var owner = f.owner && f.owner.booleanValue;
  var sections = ((f.sections && f.sections.arrayValue && f.sections.arrayValue.values) || []).map(function (v) { return v.stringValue; });
  if (!owner && sections.indexOf('competitions') < 0) throw new Error(email + ' does not have Competitions access.');
  return email;
}

/** Run once from the editor to approve the permissions. */
function authorise() {
  console.log('Emails left today: ' + MailApp.getRemainingDailyQuota());
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
}
