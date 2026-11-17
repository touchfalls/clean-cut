const test = require('node:test');
const assert = require('node:assert');
const { parseSilences, planCuts, totalFrames, suggestThreshold } = require('./planner.js');

// Mono s16le: `parts` = [[seconds, amplitude 0..1, kind]] where kind 'sine' or 'noise'.
function pcm(parts, rate = 8000) {
  const total = parts.reduce((n, p) => n + Math.round(p[0] * rate), 0);
  const buf = Buffer.alloc(total * 2);
  let i = 0, seed = 1;
  for (const [sec, amp, kind] of parts) {
    for (let k = 0; k < Math.round(sec * rate); k++, i++) {
      seed = (seed * 16807) % 2147483647;
      const x = kind === 'sine' ? Math.sin(2 * Math.PI * 220 * k / rate) : (seed / 2147483647) * 2 - 1;
      buf.writeInt16LE(Math.round(x * amp * 32767), i * 2);
    }
  }
  return buf;
}
const dB = (d) => Math.pow(10, d / 20);

const STDERR = `
[silencedetect @ 0x600] silence_start: 0
[silencedetect @ 0x600] silence_end: 2.5 | silence_duration: 2.5
size=N/A time=00:00:10.00
[silencedetect @ 0x600] silence_start: 4.2
[silencedetect @ 0x600] silence_end: 6.2 | silence_duration: 2
[silencedetect @ 0x600] silence_start: 8.75
`;

test('parses pairs and clamps an open silence to the end', () => {
  assert.deepStrictEqual(parseSilences(STDERR, 10), [
    { start: 0, end: 2.5 },
    { start: 4.2, end: 6.2 },
    { start: 8.75, end: 10 },
  ]);
});

test('no silence -> empty', () => {
  assert.deepStrictEqual(parseSilences('size=N/A time=00:00:10.00', 10), []);
});

test('padding shrinks inward and snaps to frames', () => {
  const cuts = planCuts(parseSilences(STDERR, 10), { padding: 0.2, fps: 30 });
  // 0.2..2.3 -> 6..69, 4.4..6.0 -> 132..180, 8.95..9.8 -> ceil(268.5)=269..294
  assert.deepStrictEqual(cuts, [
    { startFrame: 6, endFrame: 69 },
    { startFrame: 132, endFrame: 180 },
    { startFrame: 269, endFrame: 294 },
  ]);
  assert.strictEqual(totalFrames(cuts), 63 + 48 + 25);
});

test('padding larger than the pause drops it', () => {
  assert.deepStrictEqual(planCuts([{ start: 1, end: 1.3 }], { padding: 0.2, fps: 30 }), []);
});

test('float noise does not lose a frame', () => {
  // 1.0+0.2 = 1.2 -> 1.2*30 = 35.99999... must be frame 36, not 35
  assert.deepStrictEqual(planCuts([{ start: 1.0, end: 2.4 }], { padding: 0.2, fps: 30 }), [
    { startFrame: 36, endFrame: 66 },
  ]);
});

test('non-integer fps', () => {
  const [c] = planCuts([{ start: 10, end: 12 }], { padding: 0, fps: 30000 / 1001 });
  assert.deepStrictEqual(c, { startFrame: 300, endFrame: 359 });
});

test('threshold lands between mic hiss and speech', () => {
  // 60% hiss at about -60 dB, 40% speech at about -20 dB
  const t = suggestThreshold(pcm([[6, dB(-55), 'noise'], [4, dB(-17), 'sine']]), 8000);
  assert.ok(t > -55 && t < -25, `got ${t}`);
});

test('noise-gated audio (digital silence) gives a low but clamped threshold', () => {
  const t = suggestThreshold(pcm([[7, 0, 'noise'], [3, dB(-17), 'sine']]), 8000);
  assert.ok(t >= -70 && t < -40, `got ${t}`);
});

test('empty audio -> null', () => {
  assert.strictEqual(suggestThreshold(Buffer.alloc(0), 8000), null);
});

const { intersect, invert, findPauses, suggestLoud } = require('./planner.js');
const iv = (...p) => p.map(([start, end]) => ({ start, end }));
const base = { endSec: 20, minPause: 1, minSpeech: 0.3, range: null, protectMargin: 0.5 };

test('intersect and invert', () => {
  assert.deepStrictEqual(intersect(iv([0, 5], [8, 12]), iv([3, 9], [11, 20])), iv([3, 5], [8, 9], [11, 12]));
  assert.deepStrictEqual(invert(iv([2, 4], [3, 6], [8, 10]), 10), iv([0, 2], [6, 8]));
});

test('pause counts only when every speech track is silent', () => {
  const tracks = [
    { role: 'speech', silences: iv([0, 6], [10, 20]) }, // mic
    { role: 'speech', silences: iv([2, 12]) },          // Discord
  ];
  assert.deepStrictEqual(findPauses(tracks, base), iv([2, 6], [10, 12]));
});

test('loud game moments are protected with a margin', () => {
  const tracks = [
    { role: 'speech', silences: iv([0, 20]) },
    { role: 'game', silences: iv([0, 9], [10, 20]) }, // explosion at 9..10
  ];
  assert.deepStrictEqual(findPauses(tracks, base), iv([0, 8.5], [10.5, 20]));
});

test('min pause filters, then short sounds between pauses join them', () => {
  const tracks = [{ role: 'speech', silences: iv([0, 2], [2.2, 4], [4.5, 4.9], [6, 8]) }];
  // 2..2.2 cough joins; 4.5..4.9 is too short to be a pause; 4..6 has real speech
  assert.deepStrictEqual(findPauses(tracks, base), iv([0, 4], [6, 8]));
});

test('In/Out range limits the pauses', () => {
  const tracks = [{ role: 'speech', silences: iv([0, 5], [8, 12]) }];
  assert.deepStrictEqual(findPauses(tracks, { ...base, range: { start: 3, end: 10 } }), iv([3, 5], [8, 10]));
});

test('no speech track -> nothing to cut', () => {
  assert.deepStrictEqual(findPauses([{ role: 'game', silences: [] }], base), []);
});

test('loud threshold picks the loudest moments', () => {
  const t = suggestLoud(pcm([[9, dB(-25), 'sine'], [1, dB(-6), 'sine']]), 8000);
  assert.ok(t > -25 && t <= -6, `got ${t}`);
});

const { loudPeak, selectExpr, balanceDelta } = require('./planner.js');

test('loud peak ignores one spike and the silence', () => {
  // 6 s of speech peaking at -30 dB, 0.1 s scream at -10 dB, 4 s of silence
  const r = loudPeak(pcm([[6, dB(-30), 'sine'], [0.1, dB(-10), 'sine'], [4, 0, 'noise']]), 8000);
  assert.ok(Math.abs(r.loud - -30) < 1, `loud ${r.loud}`);
  assert.ok(Math.abs(r.max - -10) < 1, `max ${r.max}`);
});

test('silence -> null', () => {
  assert.strictEqual(loudPeak(pcm([[2, 0, 'noise']]), 8000), null);
});

test('aselect expression', () => {
  assert.strictEqual(selectExpr([[1, 2.5], [10.25, 12]]), 'between(t,1.000,2.500)+between(t,10.250,12.000)');
});

test('speech goes to voice target, game sits below it', () => {
  const o = { voice: -6, gameBelow: 10 };
  assert.strictEqual(balanceDelta(-30.33, 'speech', o), 24.3);
  assert.strictEqual(balanceDelta(-3, 'speech', o), -3);
  assert.strictEqual(balanceDelta(-10, 'game', o), -6);
});

const { clipSegments } = require('./planner.js');

test('clip segments split at every edge and skip gaps', () => {
  // A1: [0,10] [10,20]; gap 20..25; [25,30]; V1 has an edit at 5
  assert.deepStrictEqual(clipSegments([[0, 10], [10, 20], [25, 30], [0, 5], [5, 20]]), iv([0, 5], [5, 10], [10, 20], [25, 30]));
});

test('kept joins: pauses stop at clip edges and never cut gaps', () => {
  const segments = clipSegments([[0, 10], [10, 20], [25, 40]]);
  const tracks = [{ role: 'speech', silences: iv([7, 14], [18, 28], [30, 31.1], [31.3, 34]) }];
  // 7..14 splits at the join; 18..28 loses the 20..25 gap (and 25..28 stays); 30..31.1 + 31.3..34 still join
  assert.deepStrictEqual(findPauses(tracks, { ...base, endSec: 40, segments }), iv([7, 10], [10, 14], [18, 20], [25, 28], [30, 34]));
});

test('short sound across a join is not merged', () => {
  const segments = clipSegments([[0, 10], [10, 20]]);
  const tracks = [{ role: 'speech', silences: iv([5, 9.9], [10.1, 15]) }];
  assert.deepStrictEqual(findPauses(tracks, { ...base, segments }), iv([5, 9.9], [10.1, 15]));
});
