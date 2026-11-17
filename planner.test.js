const test = require('node:test');
const assert = require('node:assert');
const { parseSilences, planCuts, totalFrames } = require('./planner.js');

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
