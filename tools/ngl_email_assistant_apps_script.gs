/**
 * NGL Email Assistant: lets the NGL Admin Hub show and send the replies that the
 * Claude email agent drafts in admin@nationalgymnasticsleague.co.uk.
 *
 * Deploy as its own Apps Script project, signed in as admin@nationalgymnasticsleague.co.uk:
 *   Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
 * Only signed-in NGL admins (ngl_admin_users in saadi-rotation) who are the owner or have the
 * "email" section can use it, and it only ever touches threads the agent has labelled Agent/Ready
 * or Agent/Needs Dave, so it can't be used to send anything else.
 *
 * The agent writes each draft as:
 *   [NOTE FOR DAVE: one-line summary | Needs you: reason]   <- never sent
 *   (blank line)
 *   the reply text
 */
var FIREBASE_API_KEY = 'AIzaSyDV7BuYhSjji9DQDjih5a6Ms7G-SVZpKw4';
var PROJECT = 'saadi-rotation';
var ME = 'admin@nationalgymnasticsleague.co.uk';
var L = { ready: 'Agent/Ready', dave: 'Agent/Needs Dave', sent: 'Agent/Sent', done: 'Agent/Done', skipped: 'Agent/Skipped' };
var NOTE_RE = /^\s*\[NOTE FOR DAVE:([\s\S]*?)\]\s*/i;

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var who = checkAdmin(req.idToken);
    if (req.action === 'list') out = { ok: true, items: listItems() };
    else if (req.action === 'send') out = sendReply(req.threadId, req.body, who);
    else if (req.action === 'skip') out = finish(req.threadId, L.skipped, false, who);
    else if (req.action === 'done') out = finish(req.threadId, L.done, true, who);
    else throw new Error('Unknown action.');
  } catch (err) {
    out = { ok: false, error: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'NGL Email Assistant' })).setMimeType(ContentService.MimeType.JSON);
}

function label(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }
function isMine(m) { return String(m.getFrom()).toLowerCase().indexOf(ME) > -1; }
function lastIncoming(thread) { var ms = thread.getMessages(); for (var i = ms.length - 1; i >= 0; i--) if (!isMine(ms[i])) return ms[i]; return null; }
function draftFor(threadId) {
  var ds = GmailApp.getDrafts();
  for (var i = 0; i < ds.length; i++) { var m = ds[i].getMessage(); if (m && m.getThread().getId() === threadId) return ds[i]; }
  return null;
}
/** Agent threads only: the Hub can never act on anything else. */
function agentThread(threadId) {
  var t = GmailApp.getThreadById(String(threadId || ''));
  if (!t) throw new Error('That email has gone (deleted or moved).');
  var names = t.getLabels().map(function (l) { return l.getName(); });
  if (names.indexOf(L.ready) < 0 && names.indexOf(L.dave) < 0) throw new Error('That email is no longer waiting in the Email assistant.');
  return t;
}
/** Draft body without the note and without the quoted original ("On ... wrote:"). */
function splitDraft(text) {
  text = String(text || '').replace(/\r/g, '');
  var note = '', m = text.match(NOTE_RE);
  if (m) { note = m[1].trim(); text = text.slice(m[0].length); }
  var q = text.search(/\n\s*On .{5,200}wrote:\s*\n/);
  if (q > -1) text = text.slice(0, q);
  return { note: note, body: text.replace(/\s+$/, '') };
}

function listItems() {
  var out = [];
  [[L.dave, true], [L.ready, false]].forEach(function (pair) {
    var lab = GmailApp.getUserLabelByName(pair[0]); if (!lab) return;
    lab.getThreads(0, 50).forEach(function (t) {
      if (pair[1] === false && t.getLabels().some(function (l) { return l.getName() === L.dave; })) return;
      var inc = lastIncoming(t); if (!inc) return;
      var d = draftFor(t.getId()), parts = splitDraft(d ? d.getMessage().getPlainBody() : '');
      var earlier = t.getMessages().filter(function (m) { return m.getId() !== inc.getId(); }).slice(-3).map(function (m) {
        return { from: m.getFrom(), date: m.getDate().getTime(), text: m.getPlainBody().slice(0, 1500) }; });
      out.push({ threadId: t.getId(), needsDave: pair[1], subject: t.getFirstMessageSubject(), from: inc.getFrom(), date: inc.getDate().getTime(),
        text: inc.getPlainBody().slice(0, 6000), attachments: inc.getAttachments().map(function (a) { return a.getName(); }),
        earlier: earlier, count: t.getMessageCount(), note: parts.note, draft: parts.body, hasDraft: !!d,
        link: 'https://mail.google.com/mail/u/?authuser=' + ME + '#all/' + t.getId() });
    });
  });
  return out.sort(function (a, b) { return (b.needsDave - a.needsDave) || (a.date - b.date); });
}

function htmlOf(text) {
  return '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</div>';
}

function sendReply(threadId, body, who) {
  var t = agentThread(threadId);
  body = String(body || '').replace(/\r/g, '').trim();
  if (!body) throw new Error('The reply is empty.');
  if (/\[NOTE FOR DAVE/i.test(body)) throw new Error('Take the note for Dave out of the reply before sending.');
  var inc = lastIncoming(t); if (!inc) throw new Error('There is no message to reply to.');
  inc.reply(body, { htmlBody: htmlOf(body), name: 'National Gymnastics League' });
  var d = draftFor(t.getId()); if (d) d.deleteDraft();
  t.removeLabel(label(L.ready)).removeLabel(label(L.dave)).addLabel(label(L.sent));
  t.markRead(); t.moveToArchive();
  console.log(who + ' sent a reply to ' + inc.getFrom() + ': ' + t.getFirstMessageSubject());
  return { ok: true };
}

/** Skip: leave it in the Gmail inbox (draft kept) for Dave to deal with there. Done: archive it and bin the draft. */
function finish(threadId, to, archive, who) {
  var t = agentThread(threadId);
  t.removeLabel(label(L.ready)).removeLabel(label(L.dave)).addLabel(label(to));
  if (archive) { var d = draftFor(t.getId()); if (d) d.deleteDraft(); t.markRead(); t.moveToArchive(); }
  console.log(who + ' marked "' + t.getFirstMessageSubject() + '" as ' + to);
  return { ok: true };
}

/** Checks the Firebase sign-in token, then that the person is the owner or has the Email assistant section. */
function checkAdmin(idToken) {
  if (!idToken) throw new Error('Please sign in to NGL Admin.');
  var r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  var u = (JSON.parse(r.getContentText()).users || [])[0];
  if (r.getResponseCode() !== 200 || !u || !u.email) throw new Error('Your sign-in has expired. Refresh NGL Admin and try again.');
  if (!u.emailVerified && !(u.providerUserInfo || []).some(function (p) { return p.providerId === 'google.com'; }))
    throw new Error('Please verify your email address first.');
  var email = u.email.toLowerCase();
  var d = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/ngl_admin_users/' + encodeURIComponent(email), {
    headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
  if (d.getResponseCode() !== 200) throw new Error(email + ' is not an NGL admin.');
  var f = JSON.parse(d.getContentText()).fields || {};
  var owner = f.owner && f.owner.booleanValue;
  var sections = ((f.sections && f.sections.arrayValue && f.sections.arrayValue.values) || []).map(function (v) { return v.stringValue; });
  if (!owner && sections.indexOf('email') < 0) throw new Error(email + ' does not have Email assistant access.');
  return email;
}

/** Run once from the editor (signed in as admin@) to approve the permissions and create the labels. */
function authorise() {
  [L.ready, L.dave, L.sent, L.done, L.skipped].forEach(label);
  console.log('Labels ready. Drafts in this account: ' + GmailApp.getDrafts().length);
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
}
