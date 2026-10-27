/* NGL Training League: challenges, stats and ratings, shared by the Training League page
   (ngl-training-league.html) and the General League Hub (ngl-general-league-hub-demo.html). */
(function(){
"use strict";
const AGES = ['6-8','9-11','12-14','15+'], HRS = ['2-5','6-10'];
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
  {k:'pull', n:'Pull-ups', stat:'STR', unit:'reps', dir:1, step:1,
   ok:['Overhand grip (palms facing away)','From a straight-arm hang, chin over the bar, back to straight arms'],
   no:['Kipping or swinging','Chin not clearing the bar, or not returning to straight arms']},
  {k:'chin', n:'Chin-ups', stat:'STR', unit:'reps', dir:1, step:1,
   ok:['Underhand grip (palms facing you)','From a straight-arm hang, chin over the bar, back to straight arms'],
   no:['Kipping or swinging','Chin not clearing the bar, or not returning to straight arms']},
  {k:'dips', n:'Max Dips', stat:'STR', unit:'reps', dir:1, step:1,
   ok:['From straight-arm support, lower until the upper arms are parallel to the floor','Push back to straight arms'],
   no:['Not low enough or not locking out at the top','Feet touching the floor']},
  {k:'muscle', n:'Muscle-ups on Rings in 1 min', stat:'STR', unit:'reps', dir:1, step:1,
   ok:['From a straight-arm hang below the rings, pull through to straight-arm support above them','Return to a straight-arm hang between reps'],
   no:['Big kip or swing to get through','Not reaching straight-arm support, or feet touching the floor']},
  {k:'rope', n:'5m Straddle Rope Climb', stat:'STR', unit:'s', dir:-1, step:0.01,
   ok:['Feet off the floor, legs held in straddle the whole climb','Arms only','Time from leaving the floor to a hand touching the 5m mark'],
   no:['Legs touching or wrapping the rope','Legs dropping out of straddle']},
  {k:'splits', n:'Oversplit Blocks', stat:'FLX', unit:'cm', dir:1, step:1,
   ok:['Front heel on a stack of blocks, back leg straight behind','Hips square and down on the floor, held for 2 seconds','Left or right leg, whichever is better: measure the total height of the blocks in cm'],
   no:['Bent front or back knee','Hips lifted off the floor or turned out']},
  {k:'mush', n:'Mushroom Circles in 30s', stat:'CTL', unit:'reps', dir:1, step:1,
   ok:['Hands on the mushroom, legs straight and together','Every full circle counts'],
   no:['Feet or legs touching the mushroom or floor: that circle doesn’t count']},
  {k:'vsit', n:'V-Sit Hold on Beam', stat:'BAL', unit:'s', dir:1, step:1,
   ok:['On a low beam for safety','Legs straight and together, lifted into a V with the chest towards the knees','No hands: hands off the beam','Time runs until the shape breaks'],
   no:['Bent knees, legs dropping or chest moving away from the knees','A hand or foot touching the beam, or coming off']},
  {k:'hand', n:'Handstand Hold', stat:'CTL', unit:'s', dir:1, step:1,
   ok:['Arms straight, legs together, straight body','Freestanding: no wall','Time starts when the feet come together at the top'],
   no:['Walking on the hands, legs apart or bent arms','Time stops when he moves or comes down']}
];
const STATS = ['SPD','POW','STR','FLX','BAL','CTL'];
/* Line icons (48x48, stroke = currentColor) and short labels for each challenge. */
const SHORT = {overall:'Overall', sprint:'Sprint', jump:'Long Jump', tuck:'Tuck Jumps', push:'Push-ups', pull:'Pull-ups', chin:'Chin-ups', dips:'Dips', muscle:'Muscle-ups', rope:'Rope Climb', splits:'Splits', mush:'Mushroom', vsit:'V-Sit', hand:'Handstand'};
const P = d => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  overall: P('<path d="M16 8h16v9a8 8 0 0 1-16 0z"/><path d="M16 11h-5a5 5 0 0 0 6 8M32 11h5a5 5 0 0 1-6 8"/><path d="M24 25v7M18 40h12M20 40l1-8h6l1 8"/>'),
  sprint: P('<circle cx="31" cy="8" r="3.5"/><path d="M29 14l-6 11 8 5-2 11"/><path d="M27 17l7 5M25 18l-7 3"/><path d="M23 25l-8 5"/><path d="M4 22h8M6 29h6"/>'),
  jump: P('<path d="M7 38c4-18 12-26 17-26s13 8 17 26" stroke-dasharray="3 5"/><circle cx="24" cy="18" r="3.5"/><path d="M24 22v8M24 25l-6-4M24 25l6-4M24 30l-5 5M24 30l5 5"/><path d="M4 43h40"/>'),
  tuck: P('<circle cx="26" cy="7" r="3.5"/><path d="M26 11v11M26 15l-7 3M26 15l7 3M26 22l-6 2 4 6M26 22l6 2-4 6"/><path d="M9 32V20M6 23l3-3 3 3"/><path d="M8 42h32"/>'),
  push: P('<circle cx="9" cy="23" r="3.5"/><path d="M13 25l28 6"/><path d="M17 26v9"/><path d="M41 31l1 5"/><path d="M4 38h42"/>'),
  pull: P('<path d="M6 7h36"/><path d="M17 7l4 11M31 7l-4 11"/><circle cx="24" cy="18" r="3.5"/><path d="M24 22v12M24 34l-3 9M24 34l3 9"/>'),
  dips: P('<path d="M6 24h12M30 24h12M10 24v18M38 24v18"/><path d="M16 24l5-8M32 24l-5-8"/><circle cx="24" cy="9" r="3.5"/><path d="M24 13v14M24 27l-4 8 3 5"/>'),
  chin: P('<path d="M6 7h36"/><path d="M19 7c-3 5-2 9 2 11M29 7c3 5 2 9-2 11"/><circle cx="24" cy="18" r="3.5"/><path d="M24 22v12M24 34l-3 9M24 34l3 9"/>'),
  muscle: P('<path d="M16 3v10M32 3v10"/><circle cx="16" cy="16" r="3"/><circle cx="32" cy="16" r="3"/><circle cx="24" cy="9" r="3.5"/><path d="M16 19v6h16v-6"/><path d="M24 13v18M24 31l-4 11M24 31l4 11"/>'),
  rope: P('<path d="M24 3v42" stroke-dasharray="2 3"/><circle cx="24" cy="11" r="3.5"/><path d="M24 15v12"/><path d="M24 17l-3-4M24 17l3-4"/><path d="M24 27l-14 4M24 27l14 4"/><path d="M38 6h6M38 6v6" stroke-width="2.5"/>'),
  splits: P('<path d="M4 42h40"/><path d="M32 42v-8h12v8M32 38h12"/><circle cx="20" cy="22" r="3.5"/><path d="M20 26v10"/><path d="M20 36l18-2M20 36L5 41"/><path d="M20 29l-6-5M20 29l6-5"/>'),
  mush: P('<path d="M12 36c0-6 5-9 12-9s12 3 12 9z"/><path d="M20 36v6h8v-6"/><path d="M14 42h20"/><circle cx="24" cy="16" r="3.5"/><path d="M24 20v7"/><path d="M27 22c8-2 14 0 16 2"/><path d="M8 16a17 9 0 0 1 32 0" stroke-dasharray="3 4"/><path d="M37 13l3 3-4 1"/>'),
  vsit: P('<path d="M4 34h40"/><path d="M14 34v10M34 34v10"/><circle cx="16" cy="12" r="3.5"/><path d="M17 16l7 16"/><path d="M24 32l16-14"/><path d="M19 21l-7 4M20 22l7-1"/>'),
  hand: P('<path d="M24 5v24"/><circle cx="24" cy="32" r="3.5"/><path d="M24 26l-6 14M24 26l6 14"/><path d="M8 42h32"/>')
};

/* One set of rules for every age. nLow/unitLow (an easier version for ages 6–11) are not used at present. */
const young = age => age === '6-8' || age === '9-11';
const chName = (c, age) => (c.nLow && young(age)) ? c.nLow : c.n;
const chUnit = (c, age) => (c.unitLow && young(age)) ? c.unitLow : c.unit;

const fmt = (v, c) => v == null ? '—' : (c.step < 1 ? (+v).toFixed(2) : String(+v));
const group = g => `${g.age}|${g.hrs}`;

/* ---------- Ratings ----------
   Per challenge, the best valid result in the gymnast's group (same age group and training hours) rates 99;
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
  return {name: nameOf(g), club: g.club || '', level: '', discipline: 'MAG', overall: g.ovr || 0,
    attrs: Object.assign({}, g.stats), tier: tierOf(g.ovr || 0), season: 'TRAINING LEAGUE'};
}
/* Position in his own league (same age group and training hours) by OVR */
function leaguePos(list, g){
  const peers = list.filter(x => x.done && group(x) === group(g)).sort((a, b) => b.ovr - a.ovr);
  return {pos: peers.indexOf(g) + 1, of: peers.length};
}
window.NGLPowerLeague = {ICON, SHORT, AGES, HRS, CH, STATS, chName, chUnit, fmt, group, rate, nameOf, tierOf, cardFor, leaguePos};
})();
