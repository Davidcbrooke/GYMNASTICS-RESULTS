/* NGL Power League: challenges, stats and ratings, shared by the Power League page
   (ngl-power-league.html) and the General League Hub (ngl-general-league-hub-demo.html). */
(function(){
"use strict";
const LEVELS = ['1','2','3','4'], AGES = ['6-8','9-11','12-14','15+'], HRS = ['2-5','6-10'];
/* Challenges. dir: 1 = higher is better, -1 = lower is better. off: added before rating (pike reach can be below the toes). */
const CH = [
  {k:'sprint', n:'10m Sprint', stat:'SPD', unit:'s', dir:-1, step:0.01,
   ok:['Standing start behind the line, no rocking start','Time from first movement to chest crossing the 10m line'],
   no:['False or flying start','Start or finish line out of shot']},
  {k:'jump', n:'Standing Long Jump', stat:'POW', unit:'cm', dir:1, step:1,
   ok:['Both feet behind the line, two-foot take-off, no step','Must stick the landing and hold for 2 seconds','Measured from the line to the back of the nearest heel'],
   no:['Step, hop, fall or hand down on landing','Any run-up']},
  {k:'tuck', n:'Tuck Jumps in 30s', stat:'POW', unit:'reps', dir:1, step:1,
   ok:['Knees come up to at least hip height','Two-foot take-off and landing'],
   no:['Knees below hip height: that jump doesn’t count, but the count carries on']},
  {k:'push', n:'Push-ups in 30s', stat:'STR', unit:'reps', dir:1, step:1,
   ok:['Straight body from head to heels','Chest down to a fist height off the floor, arms fully straight at the top'],
   no:['Hips sagging or piking','Half reps or knees on the floor']},
  {k:'pull', n:'Pull-ups', nLow:'Chin-up Hold', stat:'STR', unit:'reps', unitLow:'s', dir:1, step:1,
   ok:['Levels 3–4: from a straight-arm hang, chin over the bar, back to straight arms','Levels 1–2 (chin-up hold): chin held above the bar, time stops when it drops'],
   no:['Kipping or swinging','Chin not clearing the bar, or not returning to straight arms']},
  {k:'dips', n:'Max Dips', stat:'STR', unit:'reps', dir:1, step:1,
   ok:['From straight-arm support, lower until the upper arms are parallel to the floor','Push back to straight arms'],
   no:['Not low enough or not locking out at the top','Feet touching the floor']},
  {k:'balance', n:'Single-Leg Balance (eyes closed)', stat:'BAL', unit:'s', dir:1, step:1,
   ok:['Stand on one leg (either leg), hands on hips, eyes closed','Free foot lifted and resting against the standing knee','Time runs from eyes closing until the shape breaks'],
   no:['Hands leaving the hips, the standing foot moving or hopping','The free foot touching down, or eyes opening']},
  {k:'pike', n:'Pike Fold Reach', stat:'FLX', unit:'cm', dir:1, step:1, off:20,
   ok:['Legs straight and together, toes pointing up','Both hands level, held for 2 seconds','Measured in cm past the toes (minus if short of them)'],
   no:['Bent knees or bouncing','One hand ahead of the other']},
  {k:'hand', n:'Handstand Hold', stat:'CTL', unit:'s', dir:1, step:1,
   ok:['Arms straight, legs together, straight body','Time starts when the feet come together at the top','Wall allowed at Levels 1–2, freestanding at Levels 3–4'],
   no:['Walking on the hands, legs apart or bent arms','Time stops when he moves or comes down']}
];
const STATS = ['SPD','POW','STR','FLX','BAL','CTL'];
const chName = (c, lvl) => (c.nLow && +lvl <= 2) ? c.nLow : c.n;
const chUnit = (c, lvl) => (c.unitLow && +lvl <= 2) ? c.unitLow : c.unit;

const fmt = (v, c) => v == null ? '—' : (c.k === 'sprint' ? (+v).toFixed(2) : String(+v));
const group = g => `${g.level}|${g.age}|${g.hrs}`;

/* ---------- Ratings ----------
   Per challenge, the best valid result in the gymnast's group (same level, age group, hours) rates 99;
   everyone else is rated in proportion to it. A missing challenge rates 0. A stat is the average of its
   challenges; OVR is the average of the six stats. */
function rate(list){
  const best = {};
  list.forEach(g => CH.forEach(c => {
    const r = g.results && g.results[c.k]; if(!r || r.best == null) return;
    const key = group(g) + '|' + c.k, v = +r.best + (c.off || 0);
    if(c.dir < 0 ? v <= 0 : v < 0) return;
    if(best[key] == null || (c.dir > 0 ? v > best[key] : v < best[key])) best[key] = v;
  }));
  list.forEach(g => {
    g.ch = {}; g.stats = {};
    CH.forEach(c => {
      const r = g.results && g.results[c.k], b = best[group(g) + '|' + c.k];
      if(!r || r.best == null || !b){ g.ch[c.k] = 0; return; }
      const v = +r.best + (c.off || 0);
      g.ch[c.k] = Math.max(1, Math.min(99, Math.round(c.dir > 0 ? 99 * v / b : 99 * b / v)));
    });
    STATS.forEach(s => { const cs = CH.filter(c => c.stat === s); g.stats[s] = Math.round(cs.reduce((a, c) => a + g.ch[c.k], 0) / cs.length); });
    g.ovr = Math.round(STATS.reduce((a, s) => a + g.stats[s], 0) / STATS.length);
    g.done = CH.filter(c => g.results && g.results[c.k] && g.results[c.k].best != null).length;
  });
}
const nameOf = g => `${g.first} ${g.init}.`;


/* Tier of the player card from the overall rating */
const tierOf = ovr => ovr >= 80 ? 'gold' : ovr >= 65 ? 'silver' : 'bronze';
/* A card object in the shape ngl-player-card.js draws */
function cardFor(g){
  return {name: nameOf(g), club: g.club || '', level: g.level, discipline: 'MAG', overall: g.ovr || 0,
    attrs: Object.assign({}, g.stats), tier: tierOf(g.ovr || 0), season: 'POWER LEAGUE'};
}
/* Position in his own league (same level, age group and hours) by OVR */
function leaguePos(list, g){
  const peers = list.filter(x => x.done && group(x) === group(g)).sort((a, b) => b.ovr - a.ovr);
  return {pos: peers.indexOf(g) + 1, of: peers.length};
}
window.NGLPowerLeague = {LEVELS, AGES, HRS, CH, STATS, chName, chUnit, fmt, group, rate, nameOf, tierOf, cardFor, leaguePos};
})();
