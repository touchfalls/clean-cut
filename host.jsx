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
  return '{"id":"' + cc_esc(seq.sequenceID) + '","name":"' + cc_esc(seq.name) + '","fps":' + (CC_TPS / cc_tpf(seq)) +
    ',"endSec":' + (Number(seq.end) / CC_TPS) + ',"tracks":[' + names.join(',') + '],"locked":' + locked + '}';
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
