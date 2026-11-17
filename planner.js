// Pure planning logic: ffmpeg silencedetect output -> frame ranges to remove.
// Loaded as a plain <script> in the panel and via require() in tests.

// Returns [{start, end}] in seconds. A silence still open at the end of the file ends at endSec.
function parseSilences(stderr, endSec) {
  var out = [];
  var start = null;
  var re = /silence_(start|end):\s*(-?[\d.]+)/g;
  var m;
  while ((m = re.exec(stderr))) {
    var t = Math.max(0, parseFloat(m[2]));
    if (m[1] === 'start') start = t;
    else if (start !== null) { out.push({ start: start, end: t }); start = null; }
  }
  if (start !== null && endSec > start) out.push({ start: start, end: endSec });
  return out;
}

// Shrinks each silence by `padding` seconds on both sides and rounds inward to whole frames.
// Returns ascending [{startFrame, endFrame}] (end exclusive); ranges under 1 frame are dropped.
function planCuts(silences, opts) {
  var fps = opts.fps, pad = opts.padding;
  var eps = 1e-6; // float noise, e.g. 1.2*30 = 35.99999
  var cuts = [];
  for (var i = 0; i < silences.length; i++) {
    var s = Math.ceil((silences[i].start + pad) * fps - eps);
    var e = Math.floor((silences[i].end - pad) * fps + eps);
    if (e > s) cuts.push({ startFrame: s, endFrame: e });
  }
  return cuts;
}

function totalFrames(cuts) {
  var n = 0;
  for (var i = 0; i < cuts.length; i++) n += cuts[i].endFrame - cuts[i].startFrame;
  return n;
}

// Suggests a silence threshold in dB from mono s16le PCM (a Buffer).
// Peak level of each 50 ms window -> noise floor = 10th percentile, speech = 95th percentile
// (high, because gaming chat can be mostly silence); threshold sits 35% of the way up from the floor.
function suggestThreshold(pcm, sampleRate) {
  var win = Math.max(1, Math.round(sampleRate * 0.05));
  var count = Math.floor(pcm.length / 2), levels = [];
  for (var w = 0; w + win <= count; w += win) {
    // Peak, not RMS: silencedetect compares every sample, so noise peaks decide what counts as silence.
    var peak = 0;
    for (var i = w; i < w + win; i++) { var v = Math.abs(pcm.readInt16LE(i * 2)); if (v > peak) peak = v; }
    peak /= 32768;
    levels.push(peak > 0 ? Math.max(-100, 20 * Math.log10(peak)) : -100);
  }
  if (!levels.length) return null;
  levels.sort(function (a, b) { return a - b; });
  var pick = function (p) { return levels[Math.min(levels.length - 1, Math.floor(p * levels.length))]; };
  var floor = pick(0.10), speech = pick(0.95);
  return Math.round(Math.min(-20, Math.max(-70, floor + 0.35 * (speech - floor))));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSilences: parseSilences, planCuts: planCuts, totalFrames: totalFrames, suggestThreshold: suggestThreshold };
}
