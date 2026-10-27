/* NGL Player Card
   Adds an "NGL Player Card" button to the gymnast profile pop-up on any page
   that defines openProfile(memberId) and a global `competitions` array
   (ngl-live-league-2027.html, ngl-live-league-performance-2027.html, RESULTS-VIEWER.HTML).

   How the ratings work
   - Each piece gets a rating (50–99) from where the gymnast's BEST score on that piece
     sits among gymnasts of the same gender and level in the loaded competitions
     (falls back to same gender, then to the raw score, when there are too few to compare).
   - Each piece feeds the six attributes below in fixed proportions (PIECE_WEIGHTS).
   - Overall = average of the piece ratings.
   Photos chosen on the card stay in the browser; nothing is uploaded or saved. */
(function(){
  "use strict";

  var ATTRS = [
    {key:"SPD", label:"Speed"},
    {key:"POW", label:"Power"},
    {key:"STR", label:"Strength"},
    {key:"FLX", label:"Flexibility"},
    {key:"BAL", label:"Balance"},
    {key:"CTL", label:"Control"}
  ];

  // Which qualities each piece shows most. Each row adds up to 1.
  var PIECE_WEIGHTS = [
    {match:/vault/i,              short:"VT",  w:{SPD:.5, POW:.4, CTL:.1}},
    {match:/floor/i,              short:"FX",  w:{POW:.35, FLX:.35, CTL:.15, BAL:.15}},
    {match:/beam/i,               short:"BB",  w:{BAL:.55, CTL:.25, FLX:.2}},
    {match:/uneven|^bars$/i,      short:"UB",  w:{STR:.45, CTL:.3, FLX:.1, SPD:.15}},
    {match:/pommel/i,             short:"PH",  w:{CTL:.45, STR:.3, BAL:.25}},
    {match:/rings/i,              short:"SR",  w:{STR:.7, CTL:.3}},
    {match:/parallel/i,           short:"PB",  w:{STR:.45, BAL:.3, CTL:.25}},
    {match:/high bar/i,           short:"HB",  w:{STR:.4, POW:.3, SPD:.15, CTL:.15}}
  ];
  var PATHWAY = ["#E8559A","#F8D438","#E88230","#0071B3","#01AFB8","#3BAA4A","#7A4C9E"];
  var MIN_PEERS = 4;

  function pieceFor(apparatus){
    for(var i=0;i<PIECE_WEIGHTS.length;i++) if(PIECE_WEIGHTS[i].match.test(apparatus)) return PIECE_WEIGHTS[i];
    return null;
  }

  /* ── Data ── */
  function bestScoresByGymnast(){
    var out = {}; // memberId -> {gender, level, club, best:{apparatus:score}}
    (window.competitions||[]).forEach(function(comp){
      (comp.sheets||[]).forEach(function(sh){
        (sh.entries||[]).forEach(function(e){
          var s = parseFloat(e.score); if(isNaN(s) || !e.memberId) return;
          var g = out[e.memberId] || (out[e.memberId] = {gender:"", level:"", club:"", best:{}});
          if(e.gender) g.gender = e.gender; if(e.level) g.level = e.level; if(e.club) g.club = e.club;
          if(!(sh.apparatus in g.best) || s > g.best[sh.apparatus]) g.best[sh.apparatus] = s;
        });
      });
    });
    return out;
  }

  function percentile(value, list){
    var below = 0, equal = 0;
    list.forEach(function(v){ if(v < value) below++; else if(v === value) equal++; });
    return (below + 0.5*equal) / list.length;
  }

  function buildCard(memberId){
    var all = bestScoresByGymnast(), me = all[memberId];
    if(!me) return null;
    var pieces = [];
    Object.keys(me.best).forEach(function(app){
      var p = pieceFor(app); if(!p) return;
      var score = me.best[app];
      var same = [], gender = [];
      Object.keys(all).forEach(function(id){
        var o = all[id]; if(!(app in o.best) || o.gender !== me.gender) return;
        gender.push(o.best[app]);
        if(o.level === me.level) same.push(o.best[app]);
      });
      var pct, basis;
      if(same.length >= MIN_PEERS){ pct = percentile(score, same); basis = "level"; }
      else if(gender.length >= MIN_PEERS){ pct = percentile(score, gender); basis = "gender"; }
      else { pct = Math.max(0, Math.min(1, (score - 6) / 8)); basis = "score"; }
      pieces.push({apparatus:app, short:p.short, score:score, rating:Math.round(50 + 49*pct), weights:p.w, basis:basis});
    });
    if(!pieces.length) return null;
    var attrs = {};
    ATTRS.forEach(function(a){
      var sum = 0, wt = 0;
      pieces.forEach(function(p){ var w = p.weights[a.key] || 0; sum += w*p.rating; wt += w; });
      attrs[a.key] = wt ? Math.round(sum/wt) : null;
    });
    var overall = Math.round(pieces.reduce(function(t,p){return t+p.rating;},0) / pieces.length);
    var discipline = /boy|male|^m/i.test(me.gender) ? "MAG" : (/girl|female|^w|^f/i.test(me.gender) ? "WAG" : "");
    var name = (typeof window.getName === "function" ? window.getName(memberId) : "") || "";
    return {
      memberId:memberId, name:name, club:cleanClub(me.club), level:me.level, discipline:discipline,
      overall:overall, attrs:attrs, pieces:pieces,
      tier: overall >= 80 ? "gold" : overall >= 65 ? "silver" : "bronze",
      basis: pieces.some(function(p){return p.basis==="level";}) ? "level" : pieces[0].basis
    };
  }

  function cleanClub(c){
    return String(c||"").split(",")[0].replace(/\s*\(\d+\)\s*$/,"").replace(/\s+(Ltd|Limited)$/i,"").trim();
  }

  /* ── Drawing ── */
  var W = 600, H = 860;
  var TIERS = {
    gold:   {a:"#fff4c9", b:"#e9c25a", c:"#b88a1d", ink:"#3b2a05", edge:["#fff1b8","#c9971f","#f7da7c","#9c7413"]},
    silver: {a:"#f6f8fb", b:"#c9d0da", c:"#8d97a6", ink:"#1f2733", edge:["#ffffff","#9aa4b2","#e3e8ef","#6f7a8a"]},
    bronze: {a:"#f7dcc6", b:"#d39a6a", c:"#9a5f34", ink:"#3a1f0c", edge:["#f9d9bd","#a8693b","#e5b48b","#7c4a24"]}
  };
  var logoImg = null;
  function loadLogo(){
    if(logoImg) return Promise.resolve(logoImg);
    return new Promise(function(res){
      var i = new Image(); i.crossOrigin = "anonymous";
      i.onload = function(){ logoImg = i; res(i); };
      i.onerror = function(){ res(null); };
      i.src = "brand/ngl-logo-full.png";
    });
  }
  function fontsReady(){
    if(!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load("400 40px Anton"),
      document.fonts.load("700 30px 'Barlow Condensed'"),
      document.fonts.load("600 30px 'Barlow Condensed'")
    ]).catch(function(){});
  }

  function cardPath(ctx){
    // Shield shape: rounded top corners, pointed curved bottom.
    var r = 40;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(W-r, 0); ctx.quadraticCurveTo(W, 0, W, r);
    ctx.lineTo(W, H-170);
    ctx.quadraticCurveTo(W, H-90, W/2, H);
    ctx.quadraticCurveTo(0, H-90, 0, H-170);
    ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.closePath();
  }

  function fitText(ctx, text, maxW, size, weightFamily){
    var s = size;
    do { ctx.font = weightFamily.replace("{s}", s); s -= 2; } while(ctx.measureText(text).width > maxW && s > 16);
  }

  function draw(canvas, card, photo){
    var t = TIERS[card.tier];
    var ctx = canvas.getContext("2d");
    ctx.setTransform(canvas.width/W, 0, 0, canvas.height/H, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Metallic edge
    ctx.save(); cardPath(ctx);
    var eg = ctx.createLinearGradient(0, 0, W, H);
    eg.addColorStop(0, t.edge[0]); eg.addColorStop(.35, t.edge[1]); eg.addColorStop(.6, t.edge[2]); eg.addColorStop(1, t.edge[3]);
    ctx.fillStyle = eg; ctx.fill(); ctx.restore();

    // Inner face
    ctx.save(); ctx.translate(12, 12); ctx.scale((W-24)/W, (H-24)/H); cardPath(ctx); ctx.restore();
    ctx.save();
    var fg = ctx.createLinearGradient(0, 0, 0, H);
    fg.addColorStop(0, t.a); fg.addColorStop(.55, t.b); fg.addColorStop(1, t.c);
    ctx.fillStyle = fg; ctx.fill();
    ctx.clip();
    // diagonal sheen
    ctx.globalAlpha = .18; ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(W*.55, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H*.35); ctx.lineTo(W*.2, H); ctx.lineTo(0, H); ctx.lineTo(0, H*.8); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;

    // Pathway colour strip
    var sw = (W-24)/7;
    PATHWAY.forEach(function(c, i){ ctx.fillStyle = c; ctx.fillRect(12 + i*sw, 12, sw+1, 12); });

    // Photo (or blank silhouette)
    var px = 220, py = 50, pw = 330, ph = 360;
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    if(photo){
      var s = Math.max(pw/photo.width, ph/photo.height);
      var dw = photo.width*s, dh = photo.height*s;
      ctx.drawImage(photo, px + (pw-dw)/2, py + (ph-dh)/2, dw, dh);
      var fade = ctx.createLinearGradient(0, py+ph-90, 0, py+ph);
      fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, t.b);
      ctx.fillStyle = fade; ctx.fillRect(px, py+ph-90, pw, 90);
    } else {
      ctx.fillStyle = "rgba(0,0,0,.07)"; ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = "rgba(0,0,0,.18)";
      ctx.beginPath(); ctx.arc(px+pw/2, py+135, 72, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(px+pw/2, py+ph+40, 150, 170, 0, Math.PI, 0); ctx.fill();
    }
    ctx.restore();

    // Overall + discipline + level
    ctx.fillStyle = t.ink; ctx.textAlign = "center";
    ctx.font = "400 128px Anton"; ctx.fillText(String(card.overall), 120, 175);
    ctx.font = "700 44px 'Barlow Condensed'"; ctx.fillText(card.discipline || "NGL", 120, 230);
    ctx.fillRect(80, 248, 80, 4);
    if(card.level){ ctx.font = "700 30px 'Barlow Condensed'"; ctx.fillText("LEVEL", 120, 290); ctx.font = "400 46px Anton"; ctx.fillText(card.level, 120, 340); }
    if(logoImg){ var lw = 150, lh = lw*logoImg.height/logoImg.width; ctx.drawImage(logoImg, 120-lw/2, 365, lw, lh); }

    // Name
    var name = (card.name || "Gymnast").toUpperCase();
    ctx.fillStyle = t.ink;
    fitText(ctx, name, W-110, 62, "400 {s}px Anton");
    ctx.fillText(name, W/2, 480);
    ctx.font = "600 28px 'Barlow Condensed'"; ctx.globalAlpha = .8;
    fitText(ctx, card.club, W-140, 28, "600 {s}px 'Barlow Condensed'");
    ctx.fillText(card.club, W/2, 515); ctx.globalAlpha = 1;
    ctx.globalAlpha = .35; ctx.fillRect(80, 535, W-160, 2); ctx.globalAlpha = 1;

    // Attributes: two columns of three
    var colX = [120, 345], rowY = [600, 660, 720];
    ATTRS.forEach(function(a, i){
      var x = colX[i < 3 ? 0 : 1], y = rowY[i % 3], v = card.attrs[a.key];
      ctx.textAlign = "right"; ctx.font = "400 50px Anton"; ctx.fillText(v == null ? "–" : String(v), x + 60, y);
      ctx.textAlign = "left"; ctx.font = "700 40px 'Barlow Condensed'"; ctx.fillText(a.key, x + 78, y - 2);
    });
    ctx.globalAlpha = .35; ctx.fillRect(W/2 - 1, 560, 2, 180); ctx.globalAlpha = 1;

    // Footer
    ctx.textAlign = "center"; ctx.font = "700 24px 'Barlow Condensed'"; ctx.globalAlpha = .75;
    var season = String(card.season || new Date().getFullYear());
    ctx.fillText(/^\d+$/.test(season) ? "NGL PROFILE CARD · " + season : "NGL · " + season, W/2, 790);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ── UI ── */
  var css = ""
    + ".npc-open{display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:7px 14px;border:none;border-radius:20px;background:#0071B3;color:#fff;font-weight:700;font-size:12px;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}"
    + ".npc-open:hover{background:#005a8f}"
    + ".npc-overlay{position:fixed;inset:0;z-index:1100;background:rgba(21,18,58,.82);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto}"
    + ".npc-box{display:flex;flex-direction:column;align-items:center;gap:14px;max-width:420px;width:100%}"
    + ".npc-canvas{width:min(300px,78vw);height:auto;filter:drop-shadow(0 18px 40px rgba(0,0,0,.45))}"
    + ".npc-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}"
    + ".npc-btn{padding:9px 16px;border-radius:22px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;font-weight:700;font-size:13px;cursor:pointer}"
    + ".npc-btn.primary{background:#D30E33;border-color:#D30E33}"
    + ".npc-note{color:#c9cbee;font-size:12px;line-height:1.45;text-align:center}"
    + ".npc-key{display:grid;grid-template-columns:repeat(3,auto);gap:4px 14px;color:#fff;font-size:12px;justify-content:center}"
    + ".npc-key b{color:#01AFB8}"
    + ".npc-pieces{color:#c9cbee;font-size:12px;text-align:center}";

  function injectAssets(){
    if(document.getElementById("npc-style")) return;
    var st = document.createElement("style"); st.id = "npc-style"; st.textContent = css; document.head.appendChild(st);
    var lk = document.createElement("link"); lk.rel = "stylesheet";
    lk.href = "https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@600;700&display=swap";
    document.head.appendChild(lk);
  }

  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  function openCard(memberId){
    var card = buildCard(memberId);
    if(!card){ alert("No scores yet for this gymnast, so there's no card to show."); return; }
    var photo = null;
    var ov = document.createElement("div"); ov.className = "npc-overlay";
    ov.innerHTML =
      '<div class="npc-box">'
      + '<canvas class="npc-canvas" width="1200" height="1720"></canvas>'
      + '<div class="npc-actions">'
      +   '<button class="npc-btn" data-act="photo">Add photo</button>'
      +   '<button class="npc-btn primary" data-act="save">Save card</button>'
      +   '<button class="npc-btn" data-act="close">Close</button>'
      + '</div>'
      + '<input type="file" accept="image/*" style="display:none">'
      + '<div class="npc-key">' + ATTRS.map(function(a){ return '<span><b>'+a.key+'</b> '+a.label+'</span>'; }).join("") + '</div>'
      + '<div class="npc-pieces">' + card.pieces.map(function(p){ return esc(p.apparatus)+' '+p.score.toFixed(3)+' → '+p.rating; }).join(" · ") + '</div>'
      + '<div class="npc-note">Ratings compare this gymnast\'s best score on each piece with '
      +   (card.basis === "level" ? 'other ' + esc(card.discipline||"") + ' gymnasts at the same level' : 'other gymnasts in the league')
      +   ' this season. Photos stay on this device and are never uploaded.</div>'
      + '</div>';
    document.body.appendChild(ov);
    var canvas = ov.querySelector("canvas"), input = ov.querySelector("input");
    function render(){ draw(canvas, card, photo); }
    Promise.all([fontsReady(), loadLogo()]).then(render);
    render();

    ov.addEventListener("click", function(e){
      if(e.target === ov){ ov.remove(); return; }
      var act = e.target.getAttribute && e.target.getAttribute("data-act");
      if(act === "close") ov.remove();
      if(act === "photo") input.click();
      if(act === "save"){
        try{
          var a = document.createElement("a");
          a.download = "NGL_Profile_Card_" + (card.name || card.memberId).replace(/[^A-Za-z0-9]+/g, "_") + ".png";
          a.href = canvas.toDataURL("image/png"); document.body.appendChild(a); a.click(); a.remove();
        }catch(err){ alert("Couldn't save the card on this page. Try a screenshot instead."); }
      }
    });
    input.addEventListener("change", function(){
      var f = input.files && input.files[0]; if(!f) return;
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function(){ photo = img; render(); };
      img.src = url;
    });
  }

  function addButton(memberId){
    var head = document.querySelector("#profile-modal .profile-header > div");
    if(!head || head.querySelector(".npc-open")) return;
    var b = document.createElement("button");
    b.className = "npc-open"; b.type = "button"; b.textContent = "NGL Profile Card";
    b.addEventListener("click", function(){ openCard(memberId); });
    head.appendChild(b);
  }

  function hook(){
    if(typeof window.openProfile !== "function" || window.openProfile.__npc) return false;
    var orig = window.openProfile;
    var wrapped = function(memberId){ var r = orig.apply(this, arguments); try{ addButton(memberId); }catch(e){ console.warn("Player card:", e); } return r; };
    wrapped.__npc = true;
    window.openProfile = wrapped;
    return true;
  }

  injectAssets();
  if(!hook()) document.addEventListener("DOMContentLoaded", hook);
  window.NGLPlayerCard = {open:openCard, build:buildCard, draw:draw, ready:function(){ return Promise.all([fontsReady(), loadLogo()]); }, attrs:ATTRS};
})();
