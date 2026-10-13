/* NGL #ItsAllConnected emblem + pop-up
   Inline:   <div class="ngl-connected"></div><script src="https://davidcbrooke.github.io/GYMNASTICS-RESULTS/ngl-connected-badge.js"></script>
   Floating: <script src="https://davidcbrooke.github.io/GYMNASTICS-RESULTS/ngl-connected-badge.js" data-floating="true"></script> */
(function(){
  if (window.__nglConnected) return; window.__nglConnected = true;
  var me = document.currentScript;
  var base = me && me.src ? me.src.replace(/[^\/]*$/, '') : 'https://davidcbrooke.github.io/GYMNASTICS-RESULTS/';
  var SRC = base + 'ngl-its-all-connected.html';
  var floating = me && me.getAttribute('data-floating') === 'true';
  var COLS = ['#E8559A','#F8D438','#E88230','#0071B3','#01AFB8','#3BAA4A','#7A4C9E'];

  var f = document.createElement('link'); f.rel = 'stylesheet';
  f.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@700&display=swap';
  document.head.appendChild(f);

  var css = ''
  + '.nglc-b{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;flex-direction:column;align-items:center;gap:8px;padding:14px 22px 12px;border-radius:999px;'
  + 'background:linear-gradient(180deg,#2a2560,#1b1745);box-shadow:0 0 0 2px rgba(255,255,255,.14),0 10px 26px rgba(20,16,60,.35);transition:transform .25s,box-shadow .25s;-webkit-tap-highlight-color:transparent}'
  + '.nglc-b:hover,.nglc-b:focus-visible{transform:translateY(-2px);box-shadow:0 0 0 2px #01AFB8,0 14px 32px rgba(1,175,184,.35)}'
  + '.nglc-d{position:relative;display:flex;gap:10px;padding:0 2px}'
  + '.nglc-d:before{content:"";position:absolute;left:8px;right:8px;top:50%;height:3px;margin-top:-1.5px;border-radius:2px;background:linear-gradient(90deg,' + COLS.join(',') + ')}'
  + '.nglc-d i{position:relative;width:14px;height:14px;border-radius:50%;box-shadow:0 0 0 3px #221e52;animation:nglc-p 3.2s ease-in-out infinite}'
  + '@keyframes nglc-p{0%,70%,100%{transform:scale(1)}78%{transform:scale(1.35)}}'
  + '.nglc-t{font-family:Anton,Impact,sans-serif;font-size:24px;line-height:1;letter-spacing:.5px;color:#fff;white-space:nowrap}'
  + '.nglc-t span{color:#01AFB8}'
  + '.nglc-s{font-family:"Barlow Condensed",Arial Narrow,sans-serif;font-weight:700;font-size:12px;letter-spacing:3px;color:#c9cbee;text-transform:uppercase}'
  + '.nglc-wrap{text-align:center;padding:8px 0}'
  + '.nglc-float{position:fixed;left:18px;bottom:18px;z-index:9998;transform-origin:left bottom;scale:.82}'
  + '@media(max-width:600px){.nglc-float{scale:.68;left:10px;bottom:10px}}'
  + '.nglc-m{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(10,8,34,.82);backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity .3s}'
  + '.nglc-m.on{opacity:1;pointer-events:auto}'
  + '.nglc-f{position:relative;width:min(92vw,calc(88vh*0.8));aspect-ratio:4/5;transform:scale(.94);transition:transform .35s cubic-bezier(.2,.8,.2,1)}'
  + '.nglc-m.on .nglc-f{transform:none}'
  + '.nglc-f iframe{width:100%;height:100%;border:0;display:block;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6)}'
  + '.nglc-x{all:unset;cursor:pointer;position:absolute;top:-14px;right:-14px;width:40px;height:40px;border-radius:50%;background:#fff;color:#1b1745;font:700 22px/40px Arial,sans-serif;text-align:center;box-shadow:0 6px 18px rgba(0,0,0,.4)}'
  + '@media(prefers-reduced-motion:reduce){.nglc-d i{animation:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function badge(){
    var b = document.createElement('button'); b.type = 'button'; b.className = 'nglc-b';
    b.setAttribute('aria-label', 'See how the NGL pathways connect: #ItsAllConnected');
    var dots = COLS.map(function(c,i){ return '<i style="background:' + c + ';animation-delay:' + (i*0.12) + 's"></i>'; }).join('');
    b.innerHTML = '<span class="nglc-d">' + dots + '</span><span class="nglc-t">#ItsAll<span>Connected</span></span><span class="nglc-s">See how it connects &#9656;</span>';
    b.addEventListener('click', open);
    return b;
  }

  var modal, frame, last;
  function build(){
    modal = document.createElement('div'); modal.className = 'nglc-m'; modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-label','NGL – It\'s All Connected');
    modal.innerHTML = '<div class="nglc-f"><button class="nglc-x" type="button" aria-label="Close">&times;</button><iframe title="NGL – It\'s All Connected" allow="autoplay"></iframe></div>';
    frame = modal.querySelector('iframe');
    modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
    modal.querySelector('.nglc-x').addEventListener('click', close);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && modal.classList.contains('on')) close(); });
    document.body.appendChild(modal);
  }
  function open(){
    if (!modal) build();
    last = document.activeElement;
    frame.src = SRC + '?t=' + Date.now();
    modal.classList.add('on'); document.documentElement.style.overflow = 'hidden';
    modal.querySelector('.nglc-x').focus();
  }
  function close(){
    modal.classList.remove('on'); document.documentElement.style.overflow = '';
    setTimeout(function(){ frame.src = 'about:blank'; }, 300);
    if (last) last.focus();
  }

  function mount(){
    var slots = document.querySelectorAll('.ngl-connected');
    for (var i = 0; i < slots.length; i++){ if (!slots[i].firstChild){ slots[i].classList.add('nglc-wrap'); slots[i].appendChild(badge()); } }
    if (floating){ var fb = badge(); fb.classList.add('nglc-float'); document.body.appendChild(fb); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
