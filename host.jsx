// ExtendScript side (ES3). Every function returns a JSON string; errors are {"error":"CODE ..."}.
// Approach follows nicremo/open-silences (MIT): mute -> exportAsMediaDirect for analysis,
// QE setInOutPoints + extract for ripple cuts on all tracks at once.

var CC_TPS = 254016000000; // Premiere ticks per second
var CC_DISPLAY_FRAMES = 109; // sequence.videoDisplayFormat value for plain frame numbers

function cc_esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]/g, ' '); }
function cc_err(code, detail) { return '{"error":"' + cc_esc(code + (detail ? ' ' + detail : '')) + '"}'; }
function cc_tpf(seq) { return Number(seq.getSettings().videoFrameRate.ticks); }

function cc_allTracks(seq) {
  var list = [], groups = [seq.videoTracks, seq.audioTracks];
  for (var g = 0; g < groups.length; g++)
    for (var i = 0; i < groups[g].numTracks; i++) list.push(groups[g][i]);
  return list;
}

function cc_info() {
  var seq = app.project.activeSequence;
  if (!seq) return cc_err('NO_SEQUENCE');
  var names = [], locked = false, all = cc_allTracks(seq);
  for (var i = 0; i < seq.audioTracks.numTracks; i++) names.push('"' + cc_esc(seq.audioTracks[i].name) + '"');
  for (var j = 0; j < all.length; j++) if (all[j].isLocked()) locked = true;
  // Unset In/Out read back as negative times.
  var inSec = seq.getInPointAsTime().seconds, outSec = seq.getOutPointAsTime().seconds;
  var spans = []; // every clip on every track, for "keep joins between clips"
  for (var k = 0; k < all.length; k++)
    for (var c = 0; c < all[k].clips.numItems; c++) spans.push('[' + all[k].clips[c].start.seconds + ',' + all[k].clips[c].end.seconds + ']');
  return '{"id":"' + cc_esc(seq.sequenceID) + '","name":"' + cc_esc(seq.name) + '","fps":' + (CC_TPS / cc_tpf(seq)) +
    ',"endSec":' + (Number(seq.end) / CC_TPS) + ',"tracks":[' + names.join(',') + '],"locked":' + locked +
    ',"inSec":' + (inSec >= 0 ? inSec : 'null') + ',"outSec":' + (outSec >= 0 ? outSec : 'null') + ',"spans":[' + spans.join(',') + ']}';
}

var CC_MARKER = 'Clean Cut';

// ranges: [[startSec, endSec], ...]
function cc_addMarkers(ranges) {
  var seq = app.project.activeSequence;
  if (!seq) return cc_err('NO_SEQUENCE');
  cc_clearMarkers();
  for (var i = 0; i < ranges.length; i++) {
    var m = seq.markers.createMarker(ranges[i][0]);
    m.name = CC_MARKER;
    m.end = ranges[i][1];
  }
  return '{"added":' + ranges.length + '}';
}

function cc_clearMarkers() {
  var seq = app.project.activeSequence;
  if (!seq) return cc_err('NO_SEQUENCE');
  var ours = [], m = seq.markers.getFirstMarker();
  while (m) { if (m.name === CC_MARKER) ours.push(m); m = seq.markers.getNextMarker(m); }
  for (var i = 0; i < ours.length; i++) seq.markers.deleteMarker(ours[i]);
  return '{"removed":' + ours.length + '}';
}

// Renders only the audio tracks in `keep` (indexes) of the whole sequence to a WAV file.
function cc_exportAnalysis(keep, outPath) {
  var seq = app.project.activeSequence;
  if (!seq) return cc_err('NO_SEQUENCE');
  var preset = String(app.path).replace(/[\\\/]$/, '') + '/Contents/MediaIO/systempresets/3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr';
  if (!new File(preset).exists) return cc_err('NO_PRESET', preset);
  var tracks = seq.audioTracks, saved = [];
  try {
    for (var i = 0; i < tracks.numTracks; i++) {
      saved.push(Boolean(tracks[i].isMuted()));
      var mute = true;
      for (var k = 0; k < keep.length; k++) if (keep[k] === i) mute = false;
      tracks[i].setMute(mute ? 1 : 0);
    }
    seq.exportAsMediaDirect(outPath, preset, 0); // 0 = entire sequence
  } finally {
    for (var r = 0; r < saved.length; r++) tracks[r].setMute(saved[r] ? 1 : 0);
  }
  var f = new File(outPath);
  if (!f.exists || f.length < 44) return cc_err('EXPORT_FAILED');
  return '{"ok":true}';
}

// Clones the active sequence as a backup; the original stays active and is the one that gets cut.
function cc_backup(suffix) {
  var seq = app.project.activeSequence;
  if (!seq) return cc_err('NO_SEQUENCE');
  var before = {}, all = app.project.sequences;
  for (var i = 0; i < all.numSequences; i++) before[String(all[i].sequenceID)] = true;
  seq.clone();
  all = app.project.sequences;
  var copy = null;
  for (var j = 0; j < all.numSequences; j++) if (!before[String(all[j].sequenceID)]) copy = all[j];
  if (!copy) return cc_err('BACKUP_FAILED');
  copy.name = seq.name + suffix;
  if (String(app.project.activeSequence.sequenceID) !== String(seq.sequenceID)) app.project.openSequence(seq.sequenceID);
  return '{"ok":true,"backup":"' + cc_esc(copy.name) + '"}';
}

function cc_setDisplayFormat(seq, format) {
  try { seq.videoDisplayFormat = format; } catch (e) {}
  if (Number(seq.videoDisplayFormat) === format) return true;
  try { var s = seq.getSettings(); s.videoDisplayFormat = format; seq.setSettings(s); } catch (e2) { return false; }
  return Number(seq.videoDisplayFormat) === format;
}

// cuts: [[startFrame, endFrame], ...] ascending, end exclusive. Applied right to left so earlier frames stay valid.
function cc_applyCuts(cuts, expectedId) {
  var seq = app.project.activeSequence;
  if (!seq || String(seq.sequenceID) !== expectedId) return cc_err('SEQUENCE_CHANGED');
  var all = cc_allTracks(seq);
  for (var l = 0; l < all.length; l++) if (all[l].isLocked()) return cc_err('LOCKED'); // a locked track would drift out of sync
  app.enableQE();
  var q = qe.project.getActiveSequence();
  if (!q || typeof q.extract !== 'function' || typeof q.setInOutPoints !== 'function') return cc_err('NO_QE');
  cc_clearMarkers(); // review markers would be left at wrong places after the ripple

  var tpf = cc_tpf(seq), rate = seq.getSettings().videoFrameRate;
  var prevFormat = Number(seq.videoDisplayFormat), targeted = [], applied = 0;
  try {
    if (!cc_setDisplayFormat(seq, CC_DISPLAY_FRAMES)) return cc_err('NO_FRAME_FORMAT');
    for (var t = 0; t < all.length; t++) { targeted.push(Boolean(all[t].isTargeted())); all[t].setTargeted(true, true); }
    var tc = function (frame) { var time = new Time(); time.ticks = String(frame * tpf); return time.getFormatted(rate, CC_DISPLAY_FRAMES); };

    for (var i = cuts.length - 1; i >= 0; i--) {
      var s = cuts[i][0], e = cuts[i][1], endBefore = Number(seq.end);
      q.setInOutPoints(tc(s), tc(e));
      if (Number(seq.getInPointAsTime().ticks) !== s * tpf || Number(seq.getOutPointAsTime().ticks) !== e * tpf)
        return cc_err('IN_OUT_MISMATCH', 'applied=' + applied);
      q.extract();
      if (endBefore - Number(seq.end) !== (e - s) * tpf) return cc_err('NOT_SHRUNK', 'applied=' + applied);
      applied++;
    }
  } finally {
    for (var r = 0; r < targeted.length; r++) all[r].setTargeted(targeted[r], true);
    cc_setDisplayFormat(seq, prevFormat);
  }
  return '{"applied":' + applied + '}';
}

// --- Loudness balancing: an Amplify effect for the gain, then a Hard Limiter as a ceiling ---
// True Audio Gain can't be set from scripts (QE staticClipGain is read-only), and Volume > Level stops at +15 dB.
// Effects are added through the undocumented QE DOM. Parameter scales were calibrated by rendering in 26.5:
//   Amplify Left/Right: dB = (v - 2/3) * 144  (-96..+48 dB)
//   Hard Limiter Maximum Amplitude: dB = (v - 1) * 100

var CC_AMPLIFY = 'f14fee7d-fe5f-4202-b790-f53209e56411'; // matchNames don't depend on the UI language
var CC_LIMITER = 'e0b23f05-f1a7-4ef7-9b50-7ec3e3002058';

function cc_component(clip, matchName) {
  var comps = clip.components;
  for (var c = 0; c < comps.numItems; c++) if (String(comps[c].matchName) === matchName) return comps[c];
  return null;
}

// Component on the clip, adding the effect through QE when it's missing.
function cc_ensureEffect(clip, qeItem, matchName, name) {
  var comp = cc_component(clip, matchName);
  if (comp) return comp;
  var fx = qe.project.getAudioEffectByName(name);
  if (!fx || !qeItem || !qeItem.addAudioEffect(fx)) return null;
  return cc_component(clip, matchName);
}

// Audio clips to balance: the mouse selection if any, else clips overlapping In/Out.
// Returns {mode, tracks: [{track, ranges: [[start, end]], clips: [index...]}]} in seconds;
// with In/Out only the part inside is measured.
function cc_balanceTargets() {
  var seq = app.project.activeSequence;
  if (!seq) return cc_err('NO_SEQUENCE');
  var inSec = seq.getInPointAsTime().seconds, outSec = seq.getOutPointAsTime().seconds;
  var endSec = Number(seq.end) / CC_TPS;
  var hasIO = (inSec > 0) || (outSec >= 0 && outSec < endSec);
  if (inSec < 0) inSec = 0;
  if (outSec < 0 || outSec > endSec) outSec = endSec;
  var pick = function (useSelection) {
    var out = [];
    for (var t = 0; t < seq.audioTracks.numTracks; t++) {
      var clips = seq.audioTracks[t].clips, ranges = [], idx = [];
      for (var c = 0; c < clips.numItems; c++) {
        var clip = clips[c], s = clip.start.seconds, e = clip.end.seconds;
        if (useSelection ? !clip.isSelected() : (e <= inSec || s >= outSec)) continue;
        if (!useSelection) { s = Math.max(s, inSec); e = Math.min(e, outSec); }
        ranges.push('[' + s + ',' + e + ']'); idx.push(c);
      }
      if (ranges.length) out.push('{"track":' + t + ',"ranges":[' + ranges.join(',') + '],"clips":[' + idx.join(',') + ']}');
    }
    return out;
  };
  var mode = 'selection', found = pick(true);
  if (!found.length && hasIO) { mode = 'inout'; found = pick(false); }
  if (!found.length) return cc_err('NO_SELECTION');
  return '{"id":"' + cc_esc(seq.sequenceID) + '","mode":"' + mode + '","tracks":[' + found.join(',') + ']}';
}

// changes: [[track, clipIndex, deltaDb], ...]; deltas add to the clip's existing Amplify gain.
// ceilingDb: Hard Limiter ceiling put after Amplify on every changed clip.
function cc_applyGain(changes, expectedId, ceilingDb) {
  var seq = app.project.activeSequence;
  if (!seq || String(seq.sequenceID) !== expectedId) return cc_err('SEQUENCE_CHANGED');
  app.enableQE();
  var q = qe.project.getActiveSequence();
  if (!q) return cc_err('NO_QE');
  var qeByTrack = {}, applied = 0, clamped = 0, skipped = 0;
  for (var i = 0; i < changes.length; i++) {
    var t = changes[i][0], clip = seq.audioTracks[t].clips[changes[i][1]];
    if (!qeByTrack[t]) { // QE items include gaps, so DOM clips are matched by start time
      var map = {}, qt = q.getAudioTrackAt(t);
      for (var k = 0; k < qt.numItems; k++) { var it = qt.getItemAt(k); if (it.type === 'Clip') map[String(it.start.ticks)] = it; }
      qeByTrack[t] = map;
    }
    var qeItem = qeByTrack[t][String(clip.start.ticks)];
    // shortcut: Amplify added after an existing limiter would sit behind it; such clips are skipped.
    if (cc_component(clip, CC_LIMITER) && !cc_component(clip, CC_AMPLIFY)) { skipped++; continue; }
    var amp = cc_ensureEffect(clip, qeItem, CC_AMPLIFY, 'Amplify');
    if (!amp || amp.properties.numItems < 5 || amp.properties[3].isTimeVarying()) { skipped++; continue; }
    var db = (Number(amp.properties[3].getValue()) - 2 / 3) * 144 + changes[i][2];
    if (db > 48) { db = 48; clamped++; }
    if (db < -96) db = -96;
    var v = 2 / 3 + db / 144;
    amp.properties[3].setValue(v, true); // Left; Link Sliders is on, Right is set too to be sure
    amp.properties[4].setValue(v, true);
    var lim = cc_ensureEffect(clip, qeItem, CC_LIMITER, 'Hard Limiter');
    if (lim) { lim.properties[0].setValue(false, true); lim.properties[1].setValue(1 + ceilingDb / 100, true); }
    applied++;
  }
  return '{"applied":' + applied + ',"clamped":' + clamped + ',"skipped":' + skipped + '}';
}
