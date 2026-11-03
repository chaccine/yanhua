const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL0 = 'file:///workspace/yanhua/index.html';
const OUT = '/workspace/yanhua/shots/';
const tag = process.argv[2] || 'r';
async function setup(b, vp, mobile) {
  const p = await b.newPage();
  const logs = []; p.__logs = logs;
  p.on('console', x => { if (['error', 'warning'].includes(x.type())) logs.push(x.type() + ': ' + x.text()); });
  p.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await p.setViewport(Object.assign({}, vp, mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}));
  await p.evaluateOnNewDocument(() => {
    window.__vib = [];
    navigator.vibrate = (v) => { window.__vib.push(v); return true; };
    window.__audio = { ctx: 0, osc: 0, buf: 0, resumed: 0 };
    const AC = window.AudioContext;
    if (AC) {
      window.AudioContext = window.webkitAudioContext = class extends AC {
        constructor(...a) { super(...a); window.__audio.ctx++; }
        createOscillator() { window.__audio.osc++; return super.createOscillator(); }
        createBufferSource() { window.__audio.buf++; return super.createBufferSource(); }
        resume() { window.__audio.resumed++; return super.resume(); }
      };
    }
  });
  return p;
}
async function phaseWatch(p, name, delays) {
  const t0 = Date.now(); let phases = {};
  let textAt = null;
  while (Date.now() - t0 < 40000) {
    const ph = await p.evaluate(() => document.body.dataset.phase);
    if (ph && !(ph in phases)) phases[ph] = ((Date.now() - t0) / 1000).toFixed(1);
    if (ph === 'text' && textAt === null) { textAt = Date.now(); }
    if (textAt !== null) {
      const e = Date.now() - textAt;
      while (delays.length && e >= delays[0]) {
        const d = delays.shift();
        await p.screenshot({ path: OUT + `${tag}-${name}-text${(d / 1000).toFixed(1)}.png` });
      }
      if (!delays.length) break;
    }
    await sleep(100);
  }
  return phases;
}
async function fps(p, ms) {
  return p.evaluate((ms) => new Promise(res => { let n = 0; const t0 = performance.now(); function f(t) { n++; if (t - t0 < ms) requestAnimationFrame(f); else res(n / ((t - t0) / 1000)); } requestAnimationFrame(f); }), ms);
}
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--user-data-dir=/tmp/yanhua-prof-' + Date.now()] });
  const res = {};
  const cfgs = [
    ['desktop', { width: 1280, height: 800 }, false, ''],
    ['mobile', { width: 390, height: 844 }, true, ''],
    ['msg-mobile', { width: 390, height: 844 }, true, '?msg=' + encodeURIComponent('生日快乐')],
    ['msg-desktop', { width: 1280, height: 800 }, false, '?msg=' + encodeURIComponent('生日快乐')],
    ['msg-long', { width: 390, height: 844 }, true, '?msg=' + encodeURIComponent('<img src=x onerror=alert(1)>很长很长很长的文字')],
  ];
  for (const [name, vp, mob, q] of cfgs) {
    const p = await setup(b, vp, mob);
    await p.goto(URL0 + q);
    const t0 = Date.now();
    await sleep(1500);
    await p.screenshot({ path: OUT + `${tag}-${name}-intro.png` });
    const phases = await phaseWatch(p, name, [3000, 4000, 5000, 6000]);
    const f = await fps(p, 2000);
    res[name] = { phases, fps: Math.round(f) };
    res[name].audioBeforeGesture = await p.evaluate(() => JSON.stringify(window.__audio));
    res[name].title = await p.title();
    res[name].xss = await p.evaluate(() => document.body.innerHTML.includes('onerror=alert'));
    res[name].logsRef = p.__logs; if (name !== 'mobile' && name !== 'desktop') await p.close(); else { res[name]._p = p; }
  }
  // interactions on mobile
  {
    const p = res['mobile']._p; await p.bringToFront();
    await sleep(1000);
    // wait free phase
    for (let i = 0; i < 100; i++) { if (await p.evaluate(() => document.body.dataset.phase) === 'free') break; await sleep(200); }
    const cdp = await p.createCDPSession();
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await p.evaluate(() => { window.__vib.length = 0; });
    await touch('touchStart', 195, 400); await touch('touchEnd');
    await sleep(300);
    const vibTap = await p.evaluate(() => window.__vib.slice());
    await p.evaluate(() => { window.__vib.length = 0; });
    await touch('touchStart', 100, 500);
    await sleep(500);
    for (let i = 0; i < 10; i++) { await touch('touchMove', 100 + i * 20, 500 - i * 10); await sleep(100); }
    await p.screenshot({ path: OUT + `${tag}-mobile-longpress.png` });
    await touch('touchEnd');
    const vibLong = await p.evaluate(() => window.__vib.slice());
    const audio = await p.evaluate(() => JSON.stringify(window.__audio));
    const state = await p.evaluate(() => ({ scrollY: window.scrollY, hint: [...document.querySelectorAll('*')].filter(e => /开启声音/.test(e.textContent) && e.children.length === 0).map(e => getComputedStyle(e).opacity + '/' + getComputedStyle(e).display) }));
    await sleep(2500);
    const after = await p.evaluate(() => [...document.querySelectorAll('*')].filter(e => /开启声音/.test(e.textContent) && e.children.length === 0).map(e => getComputedStyle(e).opacity + '/' + getComputedStyle(e).display));
    await p.screenshot({ path: OUT + `${tag}-mobile-play.png` });
    const logs = [];
    res.interaction = { vibTapCount: vibTap.length, vibLongCount: vibLong.length, audio, state, hintAfterUnlock: after };
    // buttons
    const btns = await p.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim()));
    res.interaction.buttons = btns;
  }
  // desktop interactions: click, mute, replay
  {
    const p = res['desktop']._p; await p.bringToFront();
    await p.mouse.click(640, 300); await sleep(300);
    const btns = await p.$$('button');
    for (const x of btns) { const t = await x.evaluate(e => e.textContent); if (/声音|静音/.test(t)) { await x.click(); res.muteLabel = await x.evaluate(e => e.textContent); await x.click(); res.unmuteLabel = await x.evaluate(e => e.textContent); } }
    for (const x of btns) { const t = await x.evaluate(e => e.textContent); if (/再看一次/.test(t)) { await x.click(); await sleep(300); res.replayPhase = await p.evaluate(() => document.body.dataset.phase); } }
    res.desktopAudio = await p.evaluate(() => JSON.stringify(window.__audio));
    res.muted = await p.evaluate(() => localStorage.getItem('yanhua-muted'));
    await sleep(2000);
    await p.screenshot({ path: OUT + `${tag}-desktop-play.png` });
    res.desktopFps = Math.round(await fps(p, 3000));
  }
  for (const k of Object.keys(res)) if (res[k] && res[k].logsRef) { res[k].logs = res[k].logsRef.slice(); delete res[k].logsRef; }
  for (const k of Object.keys(res)) if (res[k] && res[k]._p) { delete res[k]._p; }
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
