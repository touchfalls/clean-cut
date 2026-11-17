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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSilences: parseSilences, planCuts: planCuts, totalFrames: totalFrames };
}
