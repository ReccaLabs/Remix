(() => {
const ic = (n, s = 18, c = 'currentColor') => `<span style="width:${s}px;height:${s}px;flex:none;background:${c};mask:url(https://cdn.jsdelivr.net/npm/lucide-static@0.300.0/icons/${n}.svg) center/contain no-repeat;"></span>`;
const B = 'var(--brand,#2B4BF2)';
const card = 'background:#fff; border:1px solid #E4E7EE; border-radius:12px;';
const badge = (t, k = 'grey') => {
  const m = { green: ['#E8F6EE', '#0B7A3B'], red: ['#FEE4E2', '#B42318'], amber: ['#FFF4E0', '#8A5200'], blue: ['#E6F3FC', '#0768AD'], grey: ['#F1F2F5', '#3A4357'], brand: ['color-mix(in oklch, var(--brand,#2B4BF2) 10%, white)', B] }[k];
  return `<span style="display:inline-flex; align-items:center; gap:5px; flex:none; font-size:12px; font-weight:600; line-height:22px; padding:0 8px; border-radius:6px; background:${m[0]}; color:${m[1]}; white-space:nowrap;">${t}</span>`;
};
const btn = (t, kind = 'primary', icon = '', extra = '') => {
  const s = { primary: `border:1px solid transparent; background:${B}; color:#fff;`, dark: 'border:1px solid #0E1525; background:#0E1525; color:#fff;', secondary: 'border:1px solid #D9DDE5; background:#fff; color:#0E1525;', danger: 'border:1px solid #F4B7B1; background:#fff; color:#B42318;', ghost: 'border:1px solid transparent; background:none; color:#3A4357;' }[kind];
  return `<button style="height:36px; padding:0 14px; display:inline-flex; align-items:center; justify-content:center; gap:8px; border-radius:10px; ${s} font:inherit; font-weight:600; cursor:pointer; white-space:nowrap; ${extra}">${icon ? ic(icon, 16) : ''}${t}</button>`;
};
const mbtn = (t, kind = 'primary', icon = '') => btn(t, kind, icon, 'height:50px; border-radius:12px; font-size:16px; width:100%;');
const field = (label, value, opt = {}) => `<label style="display:flex; flex-direction:column; gap:6px; ${opt.wrap || ''}"><span style="font-size:13px; font-weight:500; color:#3A4357;">${label}</span><span style="height:${opt.h || 40}px; display:flex; align-items:center; gap:8px; padding:0 12px; border:${opt.focus ? '2px solid ' + B : '1px solid #D9DDE5'}; border-radius:10px; background:#fff; color:${opt.muted ? '#8A92A3' : '#0E1525'}; font-variant-numeric:tabular-nums;"><span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${value}</span>${opt.icon ? ic(opt.icon, 16, '#5B6478') : ''}</span></label>`;
const head = (t, sub, right = '') => `<div style="display:flex; align-items:flex-end; justify-content:space-between; gap:24px;"><div style="display:flex; flex-direction:column; gap:4px;"><h2 style="margin:0; font-size:24px; line-height:32px; font-weight:600; letter-spacing:-0.015em;">${t}</h2>${sub ? `<span style="color:#5B6478;">${sub}</span>` : ''}</div>${right ? `<div style="display:flex; gap:8px;">${right}</div>` : ''}</div>`;
const panelHead = (t, right = '') => `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 18px; border-bottom:1px solid #E4E7EE;"><h3 style="margin:0; font-size:15px; line-height:20px; font-weight:600;">${t}</h3>${right}</div>`;
const tbl = (cols, rows) => `<table style="width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums;"><thead><tr style="font-size:12px; line-height:16px; color:#5B6478; text-align:left;">${cols.map((c, i) => `<th style="padding:10px ${i === 0 ? '18px' : '12px'}; font-weight:500; border-bottom:1px solid #E4E7EE; ${/^>/.test(c) ? 'text-align:right;' : ''}">${c.replace(/^>/, '')}</th>`).join('')}</tr></thead><tbody>${rows.map((r, ri) => `<tr style-hover="background:#FAFBFC;">${r.map((v, i) => `<td style="padding:12px ${i === 0 ? '18px' : '12px'}; ${ri < rows.length - 1 ? 'border-bottom:1px solid #EEF0F4;' : ''} ${/^>/.test(cols[i]) ? 'text-align:right;' : ''} ${i === 0 ? 'font-weight:500;' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const tabsRow = (items, act) => `<div style="display:flex; gap:4px; border-bottom:1px solid #E4E7EE;">${items.map(t => `<span style="height:40px; padding:0 14px; display:flex; align-items:center; gap:6px; font-weight:${t === act ? 600 : 500}; color:${t === act ? '#0E1525' : '#5B6478'}; border-bottom:2px solid ${t === act ? B : 'transparent'}; margin-bottom:-1px; white-space:nowrap;">${t}</span>`).join('')}</div>`;
const thumb = (label, h = 120, extra = '') => `<div style="height:${h}px; ${extra} background:repeating-linear-gradient(135deg,#E7E9EF 0 10px,#EEF0F4 10px 20px); position:relative;"><span style="position:absolute; left:10px; bottom:8px; font-family:'Geist Mono',monospace; font-size:11px; color:#5B6478;">${label}</span></div>`;
const logo = (s = 36, r = 10) => `<div style="width:${s}px; height:${s}px; flex:none; border-radius:${r}px; background:${B}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:${Math.round(s * 0.38)}px; letter-spacing:-0.02em;">KP</div>`;
const remix = (c = '#0E1525') => `<span style="font-weight:700; color:${c}; letter-spacing:-0.02em;">Re<span style="color:#D98A00;">M</span>ix</span>`;
const avatar = (t, s = 32) => `<div style="width:${s}px; height:${s}px; flex:none; border-radius:50%; background:#E7E9EF; color:#0E1525; display:flex; align-items:center; justify-content:center; font-size:${s > 36 ? 14 : 12}px; font-weight:600;">${t}</div>`;

const sbar = (time, color = '#0E1525') => `<div style="height:50px; flex:none; display:flex; align-items:center; justify-content:space-between; padding:0 30px; font-size:15px; font-weight:600; color:${color};"><span>${time}</span><span style="display:flex; gap:5px;">${ic('signal', 17)}${ic('wifi', 17)}${ic('battery-full', 20)}</span></div>`;
const label = (id, t) => `<div style="display:flex; align-items:center; gap:8px; font-size:13px; color:#3A4357; font-weight:500;"><span style="font-family:'Geist Mono',monospace; font-size:12px; padding:1px 6px; border-radius:6px; background:#0E1525; color:#fff;">${id}</span>${t}</div>`;
const phone = (id, t, inner, bg = '#F6F7FA') => `    <div id="${id}" style="display:flex; flex-direction:column; gap:12px;">
      ${label(id, t)}
      <div data-screen-label="${id} ${t}" style="width:390px; height:844px; border-radius:44px; background:${bg}; box-shadow:0 0 0 1px #D9DDE5, 0 24px 60px -24px rgba(14,21,37,.28); overflow:hidden; display:flex; flex-direction:column; position:relative; font-size:15px; line-height:22px;">
${inner}
        <div style="position:absolute; bottom:8px; left:50%; transform:translateX(-50%); width:134px; height:5px; border-radius:3px; background:#0E1525;"></div>
      </div>
    </div>
`;
const desk = (id, t, h, inner, bg = '#F6F7FA') => `    <div id="${id}" style="display:flex; flex-direction:column; gap:12px;">
      ${label(id, t)}
      <div data-screen-label="${id} ${t}" style="width:1440px; height:${h}px; border-radius:12px; overflow:hidden; box-shadow:0 0 0 1px #D9DDE5, 0 24px 60px -24px rgba(14,21,37,.28); display:flex; position:relative; background:${bg}; font-size:14px; line-height:20px;">
${inner}
      </div>
    </div>
`;
const mTop = (time, title, opt = {}) => `<div style="flex:none; background:#fff; border-bottom:1px solid #E4E7EE;">${sbar(time)}<div style="display:flex; align-items:center; gap:4px; padding:4px ${opt.right ? 8 : 20}px 12px ${opt.back ? 8 : 20}px;">${opt.back ? `<span style="width:44px; height:44px; display:flex; align-items:center; justify-content:center;">${ic('arrow-left', 22)}</span>` : ''}<h2 style="flex:1; margin:0; font-size:${opt.back ? 19 : 24}px; line-height:30px; font-weight:600; letter-spacing:-0.015em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</h2>${opt.right || ''}</div>${opt.below || ''}</div>`;
const mScroll = (inner, pad = '16px 16px 24px') => `<div style="flex:1; min-height:0; overflow-y:auto; padding:${pad}; display:flex; flex-direction:column; gap:14px;">${inner}</div>`;
const mTabs = (items, act) => `<nav style="flex:none; height:84px; padding:8px 8px 26px; background:#fff; border-top:1px solid #E4E7EE; display:grid; grid-template-columns:repeat(${items.length},1fr); font-size:11px; font-weight:500;">${items.map(([l, i, dot]) => `<span style="display:flex; flex-direction:column; align-items:center; gap:3px; color:${l === act ? B : '#5B6478'}; position:relative;">${ic(i, 24)}${l}${dot ? `<span style="position:absolute; top:-3px; left:calc(50% + 6px); min-width:16px; height:16px; padding:0 4px; border-radius:8px; background:#D92D20; color:#fff; font-size:10px; line-height:16px; text-align:center;">${dot}</span>` : ''}</span>`).join('')}</nav>`;
const stuTabs = act => mTabs([['Home', 'home'], ['Classes', 'book-open'], ['Pay', 'wallet'], ['Live', 'video'], ['Me', 'user']], act);
const admTabs = act => mTabs([['Home', 'layout-dashboard'], ['Students', 'users'], ['Fees', 'wallet', 18], ['Classes', 'book-open'], ['More', 'menu']], act);
const mCard = (inner, pad = 16) => `<div style="${card} border-radius:14px; padding:${pad}px; display:flex; flex-direction:column; gap:10px;">${inner}</div>`;
const mList = rows => `<div style="${card} border-radius:14px; overflow:hidden;">${rows.map((r, i) => `<div style="display:flex; align-items:center; gap:12px; padding:12px 14px; ${i < rows.length - 1 ? 'border-bottom:1px solid #EEF0F4;' : ''}">${r}</div>`).join('')}</div>`;
const two = (a, b) => `<div style="flex:1; min-width:0; display:flex; flex-direction:column;"><span style="font-weight:500;">${a}</span><span style="font-size:13px; line-height:18px; color:#5B6478;">${b}</span></div>`;
const sect = t => `<span style="font-size:12px; font-weight:600; color:#5B6478; letter-spacing:0.05em; margin-top:4px;">${t}</span>`;

const stuSB = act => `<aside style="width:240px; flex:none; background:#fff; border-right:1px solid #E4E7EE; display:flex; flex-direction:column; padding:16px 12px;"><div style="display:flex; align-items:center; gap:10px; padding:4px 8px 20px;">${logo()}<span style="font-weight:600;">Kamal Physics</span></div><nav style="display:flex; flex-direction:column; gap:2px;">${[['Home', 'home'], ['Classes', 'book-open'], ['Pay', 'wallet'], ['Live', 'video'], ['Me', 'user']].map(([l, i]) => navItem(l, i, l === act)).join('')}</nav><div style="margin-top:auto; display:flex; align-items:center; gap:10px; padding:10px 8px; border-top:1px solid #EEF0F4;">${avatar('NP')}<div style="display:flex; flex-direction:column;"><span style="font-weight:500;">Nimali Perera</span><span style="font-size:12px; color:#5B6478;">BR-1042</span></div></div></aside>`;
const navItem = (l, i, on, badgeN, dark) => dark
  ? `<span style="display:flex; align-items:center; gap:10px; height:36px; padding:0 10px; border-radius:8px; ${on ? 'background:rgba(255,255,255,.1); color:#fff; font-weight:500;' : 'color:#B8BECB;'}">${ic(i, 18)}<span style="flex:1;">${l}</span>${badgeN ? `<span style="font-size:12px; font-weight:600; line-height:18px; padding:0 6px; border-radius:6px; background:#D98A00; color:#0E1525;">${badgeN}</span>` : ''}</span>`
  : `<span style="display:flex; align-items:center; gap:10px; height:36px; padding:0 10px; border-radius:8px; ${on ? `background:color-mix(in oklch, var(--brand,#2B4BF2) 9%, white); color:${B}; font-weight:500;` : 'color:#3A4357;'}">${ic(i, 20)}<span style="flex:1;">${l}</span>${badgeN ? `<span style="font-size:12px; font-weight:600; line-height:18px; padding:0 6px; border-radius:6px; background:#FFF4E0; color:#8A5200;">${badgeN}</span>` : ''}</span>`;
const admNav = [['Dashboard', 'layout-dashboard'], ['Students', 'users'], ['Classes', 'book-open'], ['Lessons', 'play-circle'], ['Live classes', 'video'], ['Fees & payments', 'wallet', 18], ['Attendance', 'qr-code'], ['Website', 'globe'], ['Messages', 'message-square'], ['Reports', 'bar-chart-3'], ['Settings', 'settings']];
const admSB = act => `<aside style="width:248px; flex:none; background:#fff; border-right:1px solid #E4E7EE; display:flex; flex-direction:column; padding:16px 12px;"><div style="display:flex; align-items:center; gap:10px; padding:4px 8px 16px;">${logo()}<div style="display:flex; flex-direction:column;"><span style="font-weight:600;">Kamal Physics</span><span style="font-size:12px; line-height:16px; color:#5B6478;">kamalphysics.remix.lk</span></div></div><nav style="display:flex; flex-direction:column; gap:2px;">${admNav.map(([l, i, b]) => navItem(l.replace('&', '&amp;'), i, l === act, b)).join('')}</nav><div style="margin-top:auto; display:flex; align-items:center; gap:6px; padding:0 8px; font-size:12px; color:#5B6478;">Powered by ${remix()}</div></aside>`;
const admTop = () => `<header style="height:60px; flex:none; display:flex; align-items:center; gap:16px; padding:0 32px; background:#fff; border-bottom:1px solid #E4E7EE;"><div style="flex:1; max-width:440px; height:36px; display:flex; align-items:center; gap:8px; padding:0 10px; border:1px solid #E4E7EE; border-radius:8px; background:#F9FAFB; color:#5B6478;">${ic('search', 16)}<span style="flex:1;">Search students, classes…</span><span style="font-size:12px; line-height:18px; padding:0 6px; border:1px solid #E4E7EE; border-radius:6px; background:#fff; font-weight:500;">Ctrl K</span></div><div style="flex:1;"></div><span style="position:relative; width:36px; height:36px; border:1px solid #E4E7EE; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#3A4357;">${ic('bell', 18)}<span style="position:absolute; top:7px; right:8px; width:7px; height:7px; border-radius:50%; background:#D92D20; border:1.5px solid #fff;"></span></span><div style="display:flex; align-items:center; gap:10px; padding-left:8px; border-left:1px solid #E4E7EE;">${avatar('KJ')}<div style="display:flex; flex-direction:column;"><span style="font-size:13px; line-height:16px; font-weight:500;">Kamal Jayasinghe</span><span style="font-size:12px; line-height:16px; color:#5B6478;">Owner</span></div></div></header>`;
const admDesk = (id, t, h, act, main, overlay = '') => desk(id, t, h, `        ${admSB(act)}
        <div style="flex:1; min-width:0; display:flex; flex-direction:column;">${admTop()}<main style="flex:1; min-height:0; padding:28px 32px 32px; display:flex; flex-direction:column; gap:20px;">${main}</main></div>${overlay}`);
const scrim = (inner, w = 520) => `<div style="position:absolute; inset:0; background:rgba(14,21,37,.45); display:flex; align-items:center; justify-content:center;"><div style="width:${w}px; background:#fff; border-radius:16px; box-shadow:0 24px 60px -12px rgba(14,21,37,.4); display:flex; flex-direction:column;">${inner}</div></div>`;
const sheet = inner => `<div style="position:absolute; inset:0; background:rgba(14,21,37,.45);"></div><div style="position:absolute; left:0; right:0; bottom:0; background:#fff; border-radius:24px 24px 0 0; padding:10px 20px 40px; display:flex; flex-direction:column; gap:16px;"><span style="align-self:center; width:40px; height:5px; border-radius:3px; background:#D9DDE5;"></span>${inner}</div>`;

const HELMET = `<helmet>
<meta name="design_doc_mode" content="canvas">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Noto+Sans+Sinhala:wght@400;600&family=Noto+Sans+Tamil:wght@400;600&display=swap" rel="stylesheet">
<style>body{margin:0;font-family:'Geist',system-ui,sans-serif;color:#0E1525;-webkit-font-smoothing:antialiased}a{color:#2B4BF2;text-decoration:none}a:hover{text-decoration:underline}*{box-sizing:border-box}</style>
</helmet>`;
const PROPS = { brandColor: { editor: 'color', default: '#2B4BF2', options: ['#2B4BF2', '#0F766E', '#7C3AED', '#B42318'], tsType: 'string', section: 'Institute' } };
const doc = (path, title, frames, opt = {}) => {
  const tpl = `${HELMET}
<div style="--brand: {{ brand }}; min-height:100vh; background:#EDEEF2; padding:48px; display:flex; flex-direction:column; gap:32px; font-size:14px; line-height:20px;">
  <div style="display:flex; flex-direction:column; gap:6px;">
    <span style="font-family:'Geist Mono',monospace; font-size:13px; color:#5B6478;">${path}</span>
    <h1 style="margin:0; font-size:28px; line-height:36px; font-weight:600; letter-spacing:-0.02em;">${title}</h1>
  </div>
${frames.map(row => `  <section style="display:flex; flex-wrap:wrap; gap:48px; align-items:flex-start;">
${row}  </section>`).join('\n')}
</div>`;
  const js = opt.js || `class Component extends DCLogic {\n  renderVals() { return { brand: ${opt.fixedBrand ? `'${opt.fixedBrand}'` : `this.props.brandColor ?? '#2B4BF2'`} }; }\n}`;
  const props = opt.fixedBrand ? {} : PROPS;
  const pj = JSON.stringify(props).replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
${tpl}
</x-dc>
<script type="text/x-dc" data-dc-script data-props="${pj}">
${js}
</script>
</body>
</html>
`;
};
return { ic, B, card, badge, btn, mbtn, field, head, panelHead, tbl, tabsRow, thumb, logo, remix, avatar, sbar, phone, desk, mTop, mScroll, mTabs, stuTabs, admTabs, mCard, mList, two, sect, stuSB, navItem, admSB, admTop, admDesk, scrim, sheet, doc };
})()
