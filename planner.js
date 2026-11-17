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

// Sorted peak level (dB) of each 50 ms window of mono s16le PCM (a Buffer).
// Peak, not RMS: silencedetect compares every sample, so noise peaks decide what counts as silence.
function sortedPeaks(pcm, sampleRate) {
  var win = Math.max(1, Math.round(sampleRate * 0.05));
  var count = Math.floor(pcm.length / 2), levels = [];
  for (var w = 0; w + win <= count; w += win) {
    var peak = 0;
    for (var i = w; i < w + win; i++) { var v = Math.abs(pcm.readInt16LE(i * 2)); if (v > peak) peak = v; }
    peak /= 32768;
    levels.push(peak > 0 ? Math.max(-100, 20 * Math.log10(peak)) : -100);
  }
  return levels.sort(function (a, b) { return a - b; });
}

function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; }

// Speech track: noise floor = 10th percentile, speech = 95th percentile (high, because gaming chat
// can be mostly silence); the threshold sits 35% of the way up from the floor.
function suggestThreshold(pcm, sampleRate) {
  var levels = sortedPeaks(pcm, sampleRate);
  if (!levels.length) return null;
  var floor = percentile(levels, 0.10), speech = percentile(levels, 0.95);
  return Math.round(Math.min(-20, Math.max(-70, floor + 0.35 * (speech - floor))));
}

// Game track: "loud" = the loudest 5% of the recording.
function suggestLoud(pcm, sampleRate) {
  var levels = sortedPeaks(pcm, sampleRate);
  if (!levels.length) return null;
  return Math.round(Math.min(-3, Math.max(-40, percentile(levels, 0.95))));
}

// --- interval helpers; every list is ascending, non-overlapping [{start, end}] in seconds ---

function intersect(a, b) {
  var out = [], i = 0, j = 0;
  while (i < a.length && j < b.length) {
    var s = Math.max(a[i].start, b[j].start), e = Math.min(a[i].end, b[j].end);
    if (e > s) out.push({ start: s, end: e });
    if (a[i].end < b[j].end) i++; else j++;
  }
  return out;
}

// Complement of `a` inside [0, endSec].
function invert(a, endSec) {
  var out = [], t = 0;
  for (var i = 0; i < a.length; i++) {
    if (a[i].start > t) out.push({ start: t, end: a[i].start });
    t = Math.max(t, a[i].end);
  }
  if (endSec > t) out.push({ start: t, end: endSec });
  return out;
}

function subtract(a, b, endSec) { return intersect(a, invert(b, endSec)); }

// Pauses to remove, in seconds, before padding.
// tracks: [{role: 'speech' | 'game', silences}] where silences come from silencedetect with a tiny d.
// opts: endSec, minPause, minSpeech, range ({start, end} or null), protectMargin.
function findPauses(tracks, opts) {
  var pauses = null, loud = [];
  for (var i = 0; i < tracks.length; i++) {
    if (tracks[i].role === 'speech') pauses = pauses ? intersect(pauses, tracks[i].silences) : tracks[i].silences;
    else if (tracks[i].role === 'game') {
      var m = opts.protectMargin;
      // shortcut: fixed margin around loud game moments, make it a setting if it cuts too close.
      loud = loud.concat(invert(tracks[i].silences, opts.endSec).map(function (r) {
        return { start: Math.max(0, r.start - m), end: Math.min(opts.endSec, r.end + m) };
      }));
    }
  }
  if (!pauses) return [];
  loud.sort(function (x, y) { return x.start - y.start; });
  pauses = subtract(pauses, loud, opts.endSec); // invert() tolerates overlapping loud ranges
  if (opts.range) pauses = intersect(pauses, [opts.range]);

  var long = pauses.filter(function (p) { return p.end - p.start >= opts.minPause; });
  // A short sound between two real pauses (cough, click) goes with them.
  var out = [];
  for (var k = 0; k < long.length; k++) {
    var last = out[out.length - 1];
    if (last && long[k].start - last.end < opts.minSpeech) last.end = long[k].end;
    else out.push({ start: long[k].start, end: long[k].end });
  }
  return out;
}

// --- loudness balancing ---

// Integrated loudness (LUFS) from ffmpeg ebur128 stderr; null when there was nothing to measure.
function parseLoudness(stderr) {
  var m = String(stderr).match(/Integrated loudness:\s*I:\s*(-?[\d.]+|-inf) LUFS/);
  if (!m || m[1] === '-inf') return null;
  var v = parseFloat(m[1]);
  return v > -70 ? v : null; // -70 is ebur128's absolute gate: silence
}

// ffmpeg aselect expression that keeps only the given [[start, end], ...] seconds.
function selectExpr(ranges) {
  return ranges.map(function (r) { return 'between(t,' + r[0].toFixed(3) + ',' + r[1].toFixed(3) + ')'; }).join('+');
}

// Gain in dB that brings a track to its target: speech -> voice, game -> voice - gameBelow.
function balanceDelta(measured, role, opts) {
  var target = role === 'game' ? opts.voice - opts.gameBelow : opts.voice;
  return Math.round((target - measured) * 10) / 10;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSilences: parseSilences, planCuts: planCuts, totalFrames: totalFrames, suggestThreshold: suggestThreshold,
    suggestLoud: suggestLoud, intersect: intersect, invert: invert, findPauses: findPauses,
    parseLoudness: parseLoudness, selectExpr: selectExpr, balanceDelta: balanceDelta };
}
