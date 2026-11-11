#!/usr/bin/env node
// Orbitals listening rig. Plays a repeatable garden in headless Chrome, records the mix and one stem per voice,
// logs every note, then measures it all and writes a report (report.png / report.html / report.json).
//   node tools/listen.js [--name run1] [--seed 7] [--seconds 45] [--band full|trio] [--ring 96] [--bpm 76]
//                        [--preset "Full band"] [--journey] [--mix "drums=150 bass=120"] [--js "D.sym=3"] [--file path/to/index.html]
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const ROOT = path.resolve(__dirname, '..'), FILE = path.resolve(arg('file', path.join(ROOT, 'index.html')));
const SEED = +arg('seed', 7), SECONDS = +arg('seconds', 45), BAND = arg('band', 'full'), PRESET = arg('preset', ''), NAME = arg('name', PRESET ? PRESET.toLowerCase().replace(/\W+/g, '-') : `seed${SEED}-${BAND}`);
const OUT = path.join(__dirname, 'out', NAME), sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VOICES = ['kalimba', 'bell', 'keys', 'bass', 'pad', 'drums', 'fx'];
const NN = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], nn = m => NN[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const MODES = { ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10] };

async function record() {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'] });
  const page = await browser.newPage(), errors = [];
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`file://${FILE}?dev&seed=${SEED}`);
  await page.evaluate((band, journey, ring, bpm, mix, js, preset) => {
    S.journey = journey; hud();
    if (bpm) { setBpm(bpm); $('#tempo').value = bpm; }
    if (ring) { for (const e of ENG) { e.cfg.ring = ring; e.G = geometry(e.cfg, shapeOf(e.voice)); e.setPal(); e.fit(); e.measure(); } D.ring = ring; syncTop(); voteMood(true); }
    if (preset) loadGarden(GARDENS.find(g => g.name.toLowerCase() === preset.toLowerCase()));
    else if (band === 'full') for (let i = 0; i < 3; i++) { const [x, y] = bestSpot(); plant(x, y, D, true); roll(false); }
    for (const kv of (mix || '').split(/\s+/).filter(Boolean)) { const [k, v] = kv.split('='); if (k in LEVEL) setLevel(k, v / 100); }
    if (js) (0, eval)(js);
  }, BAND, arg('journey', false) === true, +arg('ring', 0), +arg('bpm', 0), arg('mix', ''), arg('js', ''), PRESET);
  await page.mouse.click(640, 400);                              // "click to begin": starts the audio
  await page.evaluate(() => new Promise(res => {
    const R = window.__R = {}; let left = 0;
    const tap = (name, node) => {
      const dest = AC.createMediaStreamDestination(); node.connect(dest);
      const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 }), chunks = [];
      rec.ondataavailable = e => chunks.push(e.data); left++;
      rec.onstart = () => { if (!--left) res(); };
      R[name] = { rec, chunks }; rec.start(500);
    };
    tap('mix', master); for (const k of Object.keys(DRY)) tap(k, DRY[k]);
    NOTELOG.length = 0; window.__t0 = AC.currentTime;
  }));
  process.stdout.write(`recording ${SECONDS}s `);
  for (let t = 0; t < SECONDS; t += 5) { await sleep(Math.min(5, SECONDS - t) * 1000); process.stdout.write('.'); }
  console.log();
  const shot = path.join(OUT, 'screen.png'); await page.screenshot({ path: shot });
  const data = await page.evaluate(async () => {
    const out = {};
    for (const [name, r] of Object.entries(window.__R)) {
      await new Promise(res => { r.rec.onstop = res; r.rec.stop(); });
      const buf = new Uint8Array(await new Blob(r.chunks).arrayBuffer()); let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      out[name] = btoa(s);
    }
    return { audio: out, notes: NOTELOG.map(n => ({ ...n, t: +(n.t - window.__t0).toFixed(4) })), meta: { bpm: S.bpm, mood: M.name, key: M.key, mode: M.mode, level: { ...LEVEL }, mix: MIX,
      machines: ENG.filter(e => !e.dying).map(e => ({ ...e.design(), rate: +e.rate.toFixed(2), oct: e.oct, links: e.links.length })) } };
  });
  await browser.close();
  for (const [k, b64] of Object.entries(data.audio)) fs.writeFileSync(path.join(OUT, k + '.webm'), Buffer.from(b64, 'base64'));
  fs.writeFileSync(path.join(OUT, 'notes.json'), JSON.stringify(data.notes));
  return { notes: data.notes, meta: { ...data.meta, seed: SEED, seconds: SECONDS, band: BAND, errors } };
}

const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr;
function loudness(file) {
  const m = ff(['-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']).match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!m) return { lufs: null, peak: null, lra: null };
  const j = JSON.parse(m[0]), n = v => (isFinite(+v) ? +v : null);
  return { lufs: n(j.input_i), peak: n(j.input_tp), lra: n(j.input_lra) };
}
const BANDS = [['sub', 20, 60], ['bass', 60, 250], ['low-mid', 250, 500], ['mid', 500, 2000], ['high-mid', 2000, 6000], ['air', 6000, 16000]];
function bands(file) {
  return BANDS.map(([name, lo, hi]) => {
    const m = ff(['-i', file, '-af', `highpass=f=${lo}:poles=2,highpass=f=${lo}:poles=2,lowpass=f=${hi}:poles=2,lowpass=f=${hi}:poles=2,volumedetect`, '-f', 'null', '-']).match(/mean_volume: (-?[\d.]+|-inf)/);
    return { name, lo, hi, db: m && m[1] !== '-inf' ? +m[1] : null };
  });
}

function analyse(notes, meta) {
  const spb = 60 / meta.bpm, beats = meta.seconds / spb, R = { voices: {}, flags: [] };
  for (const v of VOICES) {
    const ns = notes.filter(n => n.voice === v), p = ns.filter(n => n.midi != null).map(n => n.midi);
    const l = loudness(path.join(OUT, v + '.webm'));
    const grid = new Array(16).fill(0); for (const n of ns) grid[((Math.round(n.beat * 4) % 16) + 16) % 16]++;
    R.voices[v] = { ...l, notes: ns.length, perBeat: +(ns.length / beats).toFixed(2), lo: p.length ? Math.min(...p) : null, hi: p.length ? Math.max(...p) : null,
      vel: ns.length ? +(ns.reduce((a, n) => a + n.vel, 0) / ns.length).toFixed(2) : null, grid };
  }
  R.master = { ...loudness(path.join(OUT, 'mix.webm')), bands: bands(path.join(OUT, 'mix.webm')) };
  // harmony: notes that start together
  const pitched = notes.filter(n => n.midi != null).sort((a, b) => a.t - b.t);
  let pairs = 0, semis = 0, tritones = 0, outOfMode = 0; const clashList = [];
  for (const n of pitched) if (!MODES[n.mode].includes((((n.midi - n.key) % 12) + 12) % 12)) outOfMode++;
  for (let i = 0; i < pitched.length; i++) for (let j = i + 1; j < pitched.length && pitched[j].t - pitched[i].t < 0.06; j++) {
    const d = Math.abs(pitched[i].midi - pitched[j].midi) % 12; pairs++;
    if (d === 1 || d === 11) { semis++; if (clashList.length < 8) clashList.push(`${pitched[i].voice} ${nn(pitched[i].midi)} + ${pitched[j].voice} ${nn(pitched[j].midi)} @ beat ${pitched[i].beat.toFixed(1)}`); }
    if (d === 6) tritones++;
  }
  const perBar = {}; for (const n of notes) { const b = Math.floor(n.beat / 4); perBar[b] = (perBar[b] || 0) + 1; }
  const bars = Object.values(perBar);
  R.harmony = { pitched: pitched.length, pairs, semitoneClashes: semis, semitonePct: pairs ? +(100 * semis / pairs).toFixed(1) : 0, tritones, outOfMode, clashList };
  R.density = { total: notes.length, perBeat: +(notes.length / beats).toFixed(2), busiestBar: bars.length ? Math.max(...bars) : 0, quietestBar: bars.length ? Math.min(...bars) : 0 };
  // flags: things worth a look
  const act = VOICES.filter(v => v !== 'fx' && R.voices[v].lufs != null && R.voices[v].lufs > -60), med = act.map(v => R.voices[v].lufs).sort((a, b) => a - b)[act.length >> 1];
  for (const v of act) { const d = R.voices[v].lufs - med; if (Math.abs(d) >= 6) R.flags.push(`${v} is ${Math.abs(d).toFixed(1)} LU ${d > 0 ? 'louder' : 'quieter'} than the median voice`); }
  for (const v of VOICES) if (R.voices[v].perBeat > 4) R.flags.push(`${v} is busy: ${R.voices[v].perBeat} notes per beat`);
  if (R.master.peak != null && R.master.peak > -1) R.flags.push(`master peaks at ${R.master.peak} dBTP (risk of clipping)`);
  if (R.master.lufs != null && R.master.lufs < -26) R.flags.push(`master is quiet: ${R.master.lufs} LUFS`);
  if (R.harmony.semitonePct > 3) R.flags.push(`${R.harmony.semitonePct}% of simultaneous note pairs are a semitone apart`);
  if (outOfMode) R.flags.push(`${outOfMode} notes fall outside the mood's mode`);
  if (meta.errors.length) R.flags.push(`page errors: ${meta.errors.join('; ')}`);
  return R;
}

const COL = { kalimba: '#00ffd0', bell: '#ff8ad8', keys: '#ffc371', bass: '#4f7cff', pad: '#b6ff6a', drums: '#cfcfe8', fx: '#fff3c4' };
function pianoRoll(notes, meta) {
  const spb = 60 / meta.bpm, beats = Math.ceil(meta.seconds / spb), W = 1360, L = 44, pw = (W - L) / beats, lo = 30, hi = 100, rh = 5, DR = ['kick', 'snare', 'hat', 'shaker', 'rim'];
  const H = (hi - lo) * rh, DH = DR.length * 12 + 8; let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + DH + 20}" style="background:#0b0a14">`;
  for (let m = lo; m <= hi; m++) if (m % 12 === 0) s += `<line x1="${L}" x2="${W}" y1="${(hi - m) * rh}" y2="${(hi - m) * rh}" stroke="#2a2840"/><text x="4" y="${(hi - m) * rh + 4}" fill="#8a86b0" font-size="10">${nn(m)}</text>`;
  for (let b = 0; b <= beats; b += 4) s += `<line x1="${L + b * pw}" x2="${L + b * pw}" y1="0" y2="${H + DH}" stroke="${b % 8 ? '#1c1a2c' : '#3a3760'}"/>` + (b % 8 ? '' : `<text x="${L + b * pw + 3}" y="${H + DH + 14}" fill="#8a86b0" font-size="10">beat ${b}</text>`);
  for (const n of notes) {
    const x = L + n.beat * pw; if (x < L || x > W) continue;
    if (n.midi == null) s += `<rect x="${x}" y="${H + 6 + DR.indexOf(n.sound) * 12}" width="${Math.max(2, pw * 0.2)}" height="9" fill="${COL.drums}" opacity="${0.35 + 0.65 * Math.min(1, n.vel)}"/>`;
    else s += `<rect x="${x}" y="${(hi - n.midi) * rh - rh / 2}" width="${Math.max(3, pw * (n.voice === 'pad' ? 1.5 : n.voice === 'bass' ? 0.8 : 0.45))}" height="${rh - 1}" rx="1" fill="${COL[n.voice]}" opacity="${0.3 + 0.7 * Math.min(1, n.vel * 1.3)}"/>`;
  }
  DR.forEach((d, i) => { s += `<text x="4" y="${H + 14 + i * 12}" fill="#8a86b0" font-size="9">${d}</text>`; });
  return s + '</svg>';
}

async function report(R, notes, meta) {
  ff(['-y', '-i', path.join(OUT, 'mix.webm'), '-lavfi', 'showspectrumpic=s=1300x380:legend=1:scale=log:fscale=log:color=magma', path.join(OUT, 'spectrogram.png')]);
  const f = v => (v == null ? '–' : v), row = v => { const x = R.voices[v];
    return `<tr><td><i style="background:${COL[v]}"></i>${v}</td><td>${f(x.lufs)}</td><td>${f(x.peak)}</td><td>${x.notes}</td><td>${x.perBeat}</td><td>${x.lo == null ? '–' : nn(x.lo) + ' – ' + nn(x.hi)}</td><td>${f(x.vel)}</td><td class="g">${x.grid.map(g => `<u style="height:${Math.round(18 * g / Math.max(1, ...x.grid))}px"></u>`).join('')}</td></tr>`; };
  const bmax = Math.max(...R.master.bands.map(b => b.db ?? -90));
  const html = `<!doctype html><meta charset="utf-8"><title>Orbitals listen: ${NAME}</title><style>
  body{background:#07060d;color:#e9e6ff;font:13px/1.45 ui-sans-serif,system-ui;margin:20px;width:1380px} h1{font-weight:300;letter-spacing:.2em;font-size:20px;margin:0 0 4px} h2{font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.6;margin:20px 0 6px}
  table{border-collapse:collapse} td,th{padding:3px 14px 3px 0;text-align:left;font-variant-numeric:tabular-nums} th{opacity:.55;font-weight:500} i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}
  .g{white-space:nowrap} u{display:inline-block;width:7px;margin-right:1px;background:#8b7dff;vertical-align:bottom;min-height:1px} .flag{color:#ffc371} .ok{color:#7cffcb} .bar{display:inline-block;height:10px;background:#8b7dff;vertical-align:middle;margin-right:8px} small{opacity:.6}
  </style><h1>ORBITALS · LISTEN · ${NAME}</h1>
  <small>seed ${meta.seed} · ${meta.seconds}s · ${meta.bpm} bpm · ${meta.mood} (${NN[meta.key % 12]} ${meta.mode}) · ${meta.machines.length} machines: ${meta.machines.map(m => `${m.voice} ring ${m.ring}, ${m.count} gear${m.count > 1 ? 's' : ''}, mirror ${m.sym}, ${m.pace}/beat`).join(' | ')}</small>
  <h2>Flags</h2>${R.flags.length ? R.flags.map(x => `<div class="flag">⚠ ${x}</div>`).join('') : '<div class="ok">nothing flagged</div>'}
  <h2>Voices <small>(loudness of each voice's dry stem)</small></h2><table><tr><th>voice</th><th>LUFS</th><th>peak dB</th><th>notes</th><th>per beat</th><th>range</th><th>avg vel</th><th>where in the bar (16ths)</th></tr>${VOICES.map(row).join('')}</table>
  <h2>Master</h2><div>${f(R.master.lufs)} LUFS · true peak ${f(R.master.peak)} dB · loudness range ${f(R.master.lra)} LU</div>
  <table style="margin-top:6px">${R.master.bands.map(b => `<tr><td>${b.name}</td><td><small>${b.lo}–${b.hi} Hz</small></td><td><span class="bar" style="width:${b.db == null ? 0 : Math.max(2, 260 + (b.db - bmax) * 6)}px"></span>${f(b.db)} dB</td></tr>`).join('')}</table>
  <h2>Harmony &amp; density</h2><div>${R.harmony.pitched} pitched notes · ${R.harmony.pairs} simultaneous pairs · ${R.harmony.semitoneClashes} semitone clashes (${R.harmony.semitonePct}%) · ${R.harmony.tritones} tritones · ${R.harmony.outOfMode} out of mode</div>
  <div>${R.density.perBeat} notes per beat overall · busiest bar ${R.density.busiestBar} notes · quietest bar ${R.density.quietestBar}</div>${R.harmony.clashList.length ? `<small>${R.harmony.clashList.join(' · ')}</small>` : ''}
  <h2>Piano roll</h2>${pianoRoll(notes, meta)}
  <h2>Spectrogram (master)</h2><img src="spectrogram.png" width="1300">
  <h2>Screen at the end</h2><img src="screen.png" width="640">`;
  fs.writeFileSync(path.join(OUT, 'report.html'), html);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ meta, ...R }, null, 1));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage(); await page.setViewport({ width: 1420, height: 900, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(OUT, 'report.html')); await page.screenshot({ path: path.join(OUT, 'report.png'), fullPage: true });
  await browser.close();
}

(async () => {
  const { notes, meta } = await record();
  const R = analyse(notes, meta);
  await report(R, notes, meta);
  const pad = (s, n) => String(s ?? '–').padEnd(n);
  console.log(`\n${NAME}: ${meta.mood} (${NN[meta.key % 12]} ${meta.mode}), ${meta.bpm} bpm, ${meta.machines.length} machines`);
  console.log(pad('voice', 9) + pad('LUFS', 8) + pad('peak', 8) + pad('notes', 7) + pad('/beat', 7) + pad('range', 12) + 'vel');
  for (const v of VOICES) { const x = R.voices[v]; console.log(pad(v, 9) + pad(x.lufs, 8) + pad(x.peak, 8) + pad(x.notes, 7) + pad(x.perBeat, 7) + pad(x.lo == null ? '–' : nn(x.lo) + '-' + nn(x.hi), 12) + (x.vel ?? '–')); }
  console.log(`master   ${R.master.lufs} LUFS, peak ${R.master.peak} dB, range ${R.master.lra} LU | bands: ${R.master.bands.map(b => `${b.name} ${b.db}`).join(', ')}`);
  console.log(`harmony  ${R.harmony.semitoneClashes}/${R.harmony.pairs} semitone clashes (${R.harmony.semitonePct}%), ${R.harmony.tritones} tritones, ${R.harmony.outOfMode} out of mode | density ${R.density.perBeat}/beat, bars ${R.density.quietestBar}-${R.density.busiestBar} notes`);
  console.log(R.flags.length ? 'flags:\n  ' + R.flags.join('\n  ') : 'flags: none');
  console.log(`report: ${path.join(OUT, 'report.png')}`);
})().catch(e => { console.error(e); process.exit(1); });
