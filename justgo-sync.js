/* NGL: sync ticket sales from JustGo (MyBG) into NGL Finance.
   Run from the "Sync NGL sales" bookmark while logged in to MyBG, on Event Management with
   "National Gymnastics League" selected. It reads each upcoming NGL event's tickets and bookings,
   adds them up (no names or emails leave the page), then opens NGL Finance, which saves the totals. */
(async () => {
  const FIN = 'https://davidcbrooke.github.io/GYMNASTICS-RESULTS/NGL_Finance.html?jgsync=1';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:340px;background:#1d1a55;color:#fff;font:15px/1.4 Roboto,Arial,sans-serif;padding:16px 18px;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.4);border-top:6px solid #c6152e';
  const say = (h, p = '') => { box.innerHTML = `<b style="font-size:17px">${h}</b><div style="margin-top:6px;color:#d9dcf5">${p}</div>`; };
  document.body.appendChild(box);
  const stop = (h, p) => { say(h, p + '<div style="margin-top:10px"><button style="background:#fff;color:#1d1a55;border:0;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer" onclick="this.closest(\'div\').parentNode.remove()">Close</button></div>'); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const call = async cmds => {
    const r = await fetch('/WidgetService.mvc/ExecuteWidgetCommandAlt', {method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json; charset=utf-8','X-Requested-With':'XMLHttpRequest'},
      body: JSON.stringify({payload:{commands:cmds}, paths:['commands']})});
    if(!r.ok) throw new Error('JustGo said ' + r.status);
    return r.json();
  };
  try{
    if(!/british-gymnastics\.org$/.test(location.hostname)) return stop('Open MyBG first', 'Log in to MyBG, open Event Management and choose National Gymnastics League, then press the bookmark again.');
    const head = document.body.innerText;
    if(!/Event Management/.test(head) || !/National Gymnastics League/.test(head)) return stop('Switch to National Gymnastics League', 'Open Event Management, use the club switcher at the top right to choose National Gymnastics League, then press the bookmark again.');
    // Open NGL Finance straight away, while the bookmark click still counts (browsers block pop-ups opened later)
    const w = window.open(FIN, 'nglfinance');
    if(!w) return stop('Allow pop-ups', 'Your browser blocked the NGL Finance tab. Allow pop-ups for mybg.british-gymnastics.org and press the bookmark again.');
    let ready = false, payload = null;
    const send = () => { if(ready && payload){ w.postMessage(payload, 'https://davidcbrooke.github.io'); payload = null; } };
    window.addEventListener('message', ev => {
      if(ev.origin !== 'https://davidcbrooke.github.io') return;
      if(ev.data === 'ngl-jg-ready'){ ready = true; send(); }
      if(ev.data && ev.data.type === 'ngl-jg-saved') stop('Sales synced ✓', `${ev.data.count} events saved to NGL Finance. ${ev.data.matched} matched to competitions.`);
    });
    window.focus();
    say('Reading NGL events…');
    const ov = [...document.querySelectorAll('a')].find(a => a.innerText.trim() === 'Events Overview'); if(ov){ ov.click(); await sleep(2500); }
    // Collect every event row across the pages of the overview: reference, date and JustGo's internal id
    const events = {}; let guard = 0, before = -1;
    const first = [...document.querySelectorAll('a[title="First"]')].find(a => a.offsetParent); if(first){ first.click(); await sleep(1500); }
    while(guard++ < 15){
      [...document.querySelectorAll('tr')].forEach(tr => {
        const t = tr.innerText.trim(), m = t.match(/^(EV\d{6})/); if(!m) return;
        const d = t.match(/(\d{2})\/(\d{2})\/(\d{4})/), id = (tr.outerHTML.match(/\b1\d{7}\b/) || [])[0];
        if(id && d) events[m[1]] = {ref:m[1], id:+id, date:`${d[3]}-${d[2]}-${d[1]}`};
      });
      if(Object.keys(events).length === before) break; before = Object.keys(events).length;
      const next = [...document.querySelectorAll('a[title="Next"]')].find(a => a.offsetParent && !/disabled/i.test(a.className));
      if(!next) break; next.click(); await sleep(1500);
    }
    const cutoff = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
    const list = Object.values(events).filter(e => e.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
    if(!list.length) return stop('No upcoming NGL events found', 'Make sure the Events Overview list is showing, then try again.');
    const out = [];
    for(const [i, e] of list.entries()){
      say(`Reading sales ${i + 1} of ${list.length}`, e.ref);
      const j = await call([{Id:1, Service:'Repo', Method:'SelectEvent', Arguments:[e.id, '']},
        {Id:2, Service:'Repo', Method:'SelectEventAttendees', Arguments:[e.id, 0, 2000, '0', '', '', '', {TicketName:'', Organization:'', TicketCategory:'', TicketType:'', Status:'', OccurenceRowId:''}]}]);
      const d = (j[0].Result || {}).eventDetails || {}, price = {};
      (d.Tickets || []).forEach(t => { price[t.Name] = +t.UnitPrice || 0; });
      const tickets = {}, bookers = {}; let cancelled = 0;
      ((j[1].Result || {}).attendees || []).forEach(a => {
        if(a.Status !== 'Booked'){ cancelled++; return; }
        const q = +a.Quantity || 1, t = tickets[a.Ticket] = tickets[a.Ticket] || {qty:0, price:price[a.Ticket] || 0};
        t.qty += q;
        if(/gymnast/i.test(a.Ticket)){ const b = String(a.BookedBy || '').trim() || 'Unknown'; bookers[b] = (bookers[b] || 0) + q; }
      });
      let gym = 0, spec = 0, gymInc = 0, specInc = 0, otherInc = 0;
      Object.entries(tickets).forEach(([n, t]) => { t.income = t.qty * t.price;
        if(/gymnast/i.test(n)){ gym += t.qty; gymInc += t.income; } else if(/spectator/i.test(n)){ spec += t.qty; specInc += t.income; } else otherInc += t.income; });
      out.push({ref:e.ref, jgId:e.id, name:d.EventName || '', date:e.date, status:d.Status || '', tickets, bookers, cancelled,
        gymnasts:gym, spectators:spec, gymInc, specInc, otherInc, income:gymInc + specInc + otherInc});
    }
    payload = {type:'ngl-jg-sales', at:new Date().toISOString(), events:out};
    say('Sending to NGL Finance…', 'Log in to NGL Admin in the NGL Finance tab if it asks. This box updates when the totals are saved.');
    send();
  }catch(err){ console.error(err); stop('Sync didn’t finish', String(err.message || err)); }
})();
