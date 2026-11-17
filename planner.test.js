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
