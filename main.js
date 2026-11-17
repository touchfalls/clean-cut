/* global CSInterface, parseSilences, planCuts, totalFrames, suggestThreshold, suggestLoud, findPauses, clipSegments, loudPeak, selectExpr, balanceDelta */
var cs = new CSInterface();
var nodeRequire = window.cep_node ? window.cep_node.require : require;
var fs = nodeRequire('fs'), os = nodeRequire('os'), path = nodeRequire('path'), cp = nodeRequire('child_process');

var STRINGS = {
  en: {
    tracksTitle: 'Tracks', roleSpeech: 'Speech', roleGame: 'Game', roleOff: 'Ignore',
    tracksHint: 'Speech: a pause is when all speech tracks are below their threshold. Game: moments louder than its threshold are never cut. All tracks get cut.',
    dbTitle: 'Speech: silence below, dB. Game: loud above, dB.',
    settings: 'Settings', preset: 'Pace', presetSoft: 'Soft', presetStandard: 'Standard', presetTight: 'Tight', presetCustom: 'Custom',
    minPause: 'Min pause, s', padding: 'Padding, ms', minSpeech: 'Join sounds shorter than, s', scope: 'Only between In/Out', keepJoins: 'Keep gaps and joins between clips',
    refresh: 'Refresh tracks', analyze: 'Analyze', auto: 'Auto thresholds + analyze',
    markers: 'Show as markers', clearMarkers: 'Remove markers', cut: 'Cut silence',
    measuring: 'Measuring {t}…', suggested: 'Thresholds, dB: {list}', exporting: 'Rendering {t}…', detecting: 'Detecting silence…',
    cutting: 'Backing up and cutting…',
    found: 'Pauses found: {n}\nWill remove: {t} of {total}', none: 'No pauses found with these settings.',
    done: 'Done: {n} cuts, removed {t}.\nBackup: "{b}"', changed: 'Sequence changed — press Analyze again.',
    markersAdded: 'Markers added: {n}. Check them on the timeline, then cut.', markersRemoved: 'Markers removed: {n}.',
    noSpeech: 'Set at least one track to Speech.', backupSuffix: ' (before cut)',
    NO_SEQUENCE: 'Open a sequence first.', LOCKED: 'Unlock all tracks first, otherwise they go out of sync.',
    NO_PRESET: 'WAV export preset not found.', EXPORT_FAILED: 'Premiere did not render the audio.',
    NO_FFMPEG: 'ffmpeg not found. Install it: brew install ffmpeg', BACKUP_FAILED: 'Could not create a backup, nothing was cut.',
    SEQUENCE_CHANGED: 'Active sequence changed — press Analyze again.', NO_QE: 'This Premiere version has no QE extract.',
    NO_FRAME_FORMAT: 'Could not switch the timeline to frames.',
    IN_OUT_MISMATCH: 'In/out points did not land on the cut; stopped. The backup is intact.',
    NOT_SHRUNK: 'Timeline did not shrink as expected; stopped. The backup is intact.',
    balanceTitle: 'Loudness balance', voice: 'Voice peaks, dB', gameBelow: 'Game quieter by, dB', balance: 'Balance volume',
    balanceHint: 'Select audio clips with the mouse or set In/Out. Loud speech peaks go to the voice level (−6 dB on the Premiere meter), Game below it. Adds Amplify for the gain and a Hard Limiter at −1 dB so nothing clips.',
    measuringLoud: 'Measuring peaks {t}…', applying: 'Applying gain…',
    balanceLine: '{t}: peaks {m} dB (max {x}) → {d} dB ({n} clips)', balanceSilent: '{t}: nothing to measure, skipped',
    balanceDone: 'Done: {n} clips changed.', balanceClamped: 'Clips at the +48 dB Amplify limit: {n}.', balanceKeyframed: 'Skipped (Amplify keyframes or effects in a different order): {n}.',
    balanceInOut: 'Range: In/Out', balanceSelection: 'Range: selected clips',
    NO_SELECTION: 'Select audio clips or set In/Out first.'
  },
  ru: {
    tracksTitle: 'Дорожки', roleSpeech: 'Речь', roleGame: 'Игра', roleOff: 'Не слушать',
    tracksHint: 'Речь: пауза — когда все речевые дорожки тише своего порога. Игра: моменты громче её порога не режутся. Режутся все дорожки.',
    dbTitle: 'Речь: тишина ниже, дБ. Игра: громко выше, дБ.',
    settings: 'Настройки', preset: 'Темп', presetSoft: 'Мягко', presetStandard: 'Стандарт', presetTight: 'Плотно', presetCustom: 'Своё',
    minPause: 'Мин. пауза, с', padding: 'Отступ, мс', minSpeech: 'Склеивать звуки короче, с', scope: 'Только между In/Out', keepJoins: 'Не трогать промежутки и стыки между клипами',
    refresh: 'Обновить дорожки', analyze: 'Анализ', auto: 'Авто-пороги + анализ',
    markers: 'Показать маркерами', clearMarkers: 'Убрать маркеры', cut: 'Вырезать тишину',
    measuring: 'Измеряю {t}…', suggested: 'Пороги, дБ: {list}', exporting: 'Рендер {t}…', detecting: 'Поиск тишины…',
    cutting: 'Бэкап и вырезка…',
    found: 'Найдено пауз: {n}\nБудет вырезано: {t} из {total}', none: 'С такими настройками пауз не найдено.',
    done: 'Готово: {n} вырезов, убрано {t}.\nБэкап: «{b}»', changed: 'Секвенция изменилась — нажми «Анализ» ещё раз.',
    markersAdded: 'Поставлено маркеров: {n}. Проверь их на таймлайне, потом режь.', markersRemoved: 'Убрано маркеров: {n}.',
    noSpeech: 'Поставь хотя бы одной дорожке роль «Речь».', backupSuffix: ' (до вырезки)',
    NO_SEQUENCE: 'Сначала открой секвенцию.', LOCKED: 'Разблокируй все дорожки, иначе они разъедутся.',
    NO_PRESET: 'Не найден пресет экспорта WAV.', EXPORT_FAILED: 'Premiere не отрендерил звук.',
    NO_FFMPEG: 'ffmpeg не найден. Установи: brew install ffmpeg', BACKUP_FAILED: 'Не удалось создать бэкап, ничего не вырезано.',
    SEQUENCE_CHANGED: 'Активная секвенция сменилась — нажми «Анализ» ещё раз.', NO_QE: 'В этой версии Premiere нет QE extract.',
    NO_FRAME_FORMAT: 'Не удалось переключить таймлайн в кадры.',
    IN_OUT_MISMATCH: 'Точки in/out не встали на вырез, остановлено. Бэкап цел.',
    NOT_SHRUNK: 'Таймлайн укоротился не так, как ожидалось, остановлено. Бэкап цел.',
    balanceTitle: 'Баланс громкости', voice: 'Пики голоса, дБ', gameBelow: 'Игра тише на, дБ', balance: 'Сбалансировать громкость',
    balanceHint: 'Выдели аудиоклипы мышкой или поставь In/Out. Громкая речь выводится на уровень пиков голоса (−6 дБ на индикаторе Premiere), «Игра» — ниже. На клипы вешается Amplify с поправкой и Hard Limiter на −1 дБ, чтобы ничего не хрипело.',
    measuringLoud: 'Измеряю пики {t}…', applying: 'Применяю…',
    balanceLine: '{t}: пики {m} дБ (макс. {x}) → {d} дБ ({n} клипов)', balanceSilent: '{t}: нечего мерить, пропущено',
    balanceDone: 'Готово: изменено клипов: {n}.', balanceClamped: 'Упёрлись в предел Amplify +48 дБ: {n}.', balanceKeyframed: 'Пропущено (ключевые кадры Amplify или эффекты в другом порядке): {n}.',
    balanceInOut: 'Диапазон: In/Out', balanceSelection: 'Диапазон: выделенные клипы',
    NO_SELECTION: 'Сначала выдели аудиоклипы или поставь In/Out.'
  }
};
var L = STRINGS[/^ru/i.test(cs.hostEnvironment.appUILocale || '') ? 'ru' : 'en'];

var PRESETS = {
  soft: { min: 1.5, pad: 300, speech: 0.2 },
  standard: { min: 1, pad: 200, speech: 0.3 },
  tight: { min: 0.5, pad: 120, speech: 0.4 }
};
var DEFAULT_DB = { speech: -40, game: -10 };
var PROTECT_MARGIN = 0.5; // seconds kept around a loud game moment
var LIMITER_CEILING = -1; // dB, Hard Limiter put after the balancing gain

function $(id) { return document.getElementById(id); }
function fmt(s, vars) { return s.replace(/\{(\w+)\}/g, function (_, k) { return vars[k]; }); }
function clock(sec) { sec = Math.round(sec); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
function say(text, isError) { $('status').textContent = text; $('status').className = isError ? 'error' : ''; }
function sayError(code) { var key = String(code).split(' ')[0]; say(L[key] || String(code), true); }
// ExtendScript string literal, non-ASCII escaped so Cyrillic survives evalScript.
function lit(s) { return JSON.stringify(String(s)).replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); }); }
// Empty field -> 0 dB would mark everything as silence, so every number is clamped.
function num(raw, lo, hi, d) { var v = Number(raw); return raw !== '' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; }

function host(call) {
  return new Promise(function (resolve, reject) {
    cs.evalScript(call, function (raw) {
      var res;
      try { res = JSON.parse(raw); } catch (e) { return reject(String(raw)); }
      if (res.error) reject(res.error); else resolve(res);
    });
  });
}

function run(file, args, opts) {
  return new Promise(function (resolve, reject) {
    cp.execFile(file, args, opts, function (err, out, stderr) {
      if (err) reject('ffmpeg: ' + String(stderr).slice(-300)); else resolve({ out: out, err: stderr });
    });
  });
}

var store = {
  get: function (k, d) { try { var v = localStorage.getItem('cc.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem('cc.' + k, JSON.stringify(v)); } catch (e) {} }
};

var info = null, plan = null;

function invalidate() { plan = null; }

function findFfmpeg() {
  var c = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (var i = 0; i < c.length; i++) if (fs.existsSync(c[i])) return c[i];
  return null;
}

function trackLabel(i) { return 'A' + (i + 1); }

// [{role, db}] per audio track, read from the rows.
function readTracks() {
  var rows = [];
  document.querySelectorAll('#tracks .track').forEach(function (row) {
    var role = row.querySelector('select').value, input = row.querySelector('input');
    var db = role === 'game' ? num(input.value, -60, 0, DEFAULT_DB.game) : num(input.value, -90, -1, DEFAULT_DB.speech);
    input.value = db;
    rows.push({ role: role, db: db });
  });
  store.set('trackRoles', rows);
  return rows;
}

function renderTracks() {
  var saved = store.get('trackRoles', []);
  var box = $('tracks');
  box.innerHTML = '';
  info.tracks.forEach(function (name, i) {
    // Default for the mic / game / Discord layout.
    var def = info.tracks.length >= 3 ? ['speech', 'game', 'speech'][i] || 'off' : (i === 0 ? 'speech' : 'off');
    var cfg = saved[i] || { role: def, db: DEFAULT_DB[def] || DEFAULT_DB.speech };
    var row = document.createElement('div');
    row.className = 'track';
    var label = document.createElement('label');
    label.textContent = trackLabel(i) + (name ? ' — ' + name : '');
    label.htmlFor = 'role' + i;
    var sel = document.createElement('select');
    sel.id = 'role' + i;
    [['speech', L.roleSpeech], ['game', L.roleGame], ['off', L.roleOff]].forEach(function (o) {
      var opt = document.createElement('option'); opt.value = o[0]; opt.textContent = o[1]; sel.appendChild(opt);
    });
    sel.value = cfg.role;
    var input = document.createElement('input');
    input.type = 'number'; input.step = '1'; input.value = cfg.db; input.title = L.dbTitle;
    input.setAttribute('aria-label', trackLabel(i) + ', dB');
    input.disabled = cfg.role === 'off';
    sel.onchange = function () {
      input.disabled = sel.value === 'off';
      if (sel.value !== 'off') input.value = DEFAULT_DB[sel.value];
      readTracks(); invalidate(); sync();
    };
    input.onchange = function () { readTracks(); invalidate(); sync(); };
    row.appendChild(label); row.appendChild(sel); row.appendChild(input);
    box.appendChild(row);
  });
}

function hasRange() {
  return info && ((info.inSec !== null && info.inSec > 0) || (info.outSec !== null && info.outSec < info.endSec));
}

function refresh() {
  invalidate();
  return host('cc_info()').then(function (res) {
    info = res; renderTracks();
    $('scope').disabled = !hasRange();
    if (info.locked) sayError('LOCKED'); else say(info.name);
  }, function (e) { info = null; $('tracks').innerHTML = ''; sayError(e); });
}

function readSettings() {
  var s = { min: num($('min').value, 0.1, 60, 1), pad: num($('pad').value, 0, 5000, 200), speech: num($('speech').value, 0, 5, 0.3) };
  $('min').value = s.min; $('pad').value = s.pad; $('speech').value = s.speech;
  store.set('settings', s);
  return s;
}

function matchPreset() {
  var s = readSettings();
  $('preset').value = 'custom';
  Object.keys(PRESETS).forEach(function (k) {
    var p = PRESETS[k];
    if (p.min === s.min && p.pad === s.pad && p.speech === s.speech) $('preset').value = k;
  });
}

// Renders one track to WAV, optionally auto-picks its threshold, returns its silences.
function analyzeTrack(ffmpeg, i, cfg, auto, suggested) {
  var wav = path.join(os.tmpdir(), 'clean-cut-' + Date.now() + '-' + i + '.wav');
  var cleanup = function () { try { fs.unlinkSync(wav); } catch (e) {} };
  say(fmt(L.exporting, { t: trackLabel(i) }));
  return host('cc_exportAnalysis([' + i + '],' + lit(wav) + ')').then(function () {
    if (!auto) return;
    say(fmt(L.measuring, { t: trackLabel(i) }));
    return run(ffmpeg, ['-hide_banner', '-nostats', '-v', 'error', '-i', wav, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
      { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 }).then(function (r) {
      var db = cfg.role === 'game' ? suggestLoud(r.out, 8000) : suggestThreshold(r.out, 8000);
      if (db === null) throw 'EXPORT_FAILED';
      cfg.db = db;
      suggested.push(trackLabel(i) + ' ' + db);
    });
  }).then(function () {
    say(L.detecting);
    // Tiny d: the min pause is applied after the tracks are combined.
    return run(ffmpeg, ['-hide_banner', '-nostats', '-i', wav, '-af', 'silencedetect=n=' + cfg.db + 'dB:d=0.1', '-f', 'null', '-'],
      { maxBuffer: 64 * 1024 * 1024 });
  }).then(function (r) {
    cleanup();
    return { role: cfg.role, silences: parseSilences(String(r.err), info.endSec) };
  }, function (e) { cleanup(); throw e; });
}

function analyze(auto) {
  var ffmpeg = findFfmpeg();
  if (!ffmpeg) return Promise.resolve(sayError('NO_FFMPEG'));
  var tracks = readTracks(), s = readSettings(), suggested = [];
  if (!tracks.some(function (t) { return t.role === 'speech'; })) return Promise.resolve(say(L.noSpeech, true));
  invalidate();
  var results = [];
  return host('cc_info()').then(function (res) {
    info = res;
    if (info.locked) throw 'LOCKED';
    // One render per track, one after another: Premiere blocks while exporting anyway.
    var chain = Promise.resolve();
    tracks.forEach(function (cfg, i) {
      if (cfg.role === 'off') return;
      chain = chain.then(function () { return analyzeTrack(ffmpeg, i, cfg, auto, suggested); })
        .then(function (r) { results.push(r); });
    });
    return chain;
  }).then(function () {
    if (auto) { renderTracksValues(tracks); store.set('trackRoles', tracks); }
    var range = $('scope').checked && hasRange()
      ? { start: info.inSec !== null ? info.inSec : 0, end: info.outSec !== null ? Math.min(info.outSec, info.endSec) : info.endSec }
      : null;
    var segments = $('keepJoins').checked ? clipSegments(info.spans) : null;
    var pauses = findPauses(results, { endSec: info.endSec, minPause: s.min, minSpeech: s.speech, range: range, protectMargin: PROTECT_MARGIN, segments: segments });
    var cuts = planCuts(pauses, { padding: s.pad / 1000, fps: info.fps });
    var prefix = auto ? fmt(L.suggested, { list: suggested.join(', ') }) + '\n' : '';
    if (!cuts.length) return say(prefix + L.none);
    plan = { cuts: cuts, id: info.id, endSec: info.endSec, fps: info.fps };
    say(prefix + fmt(L.found, { n: cuts.length, t: clock(totalFrames(cuts) / info.fps), total: clock(info.endSec) }));
  }).catch(sayError);
}

function renderTracksValues(tracks) {
  document.querySelectorAll('#tracks .track input').forEach(function (input, i) { input.value = tracks[i].db; });
}

function sameSequence(p) {
  return host('cc_info()').then(function (res) { if (res.id !== p.id || res.endSec !== p.endSec) throw 'changed'; });
}

function addMarkers() {
  if (!plan) return Promise.resolve();
  var p = plan;
  return sameSequence(p).then(function () {
    var arr = p.cuts.map(function (c) { return [c.startFrame / p.fps, c.endFrame / p.fps]; });
    return host('cc_addMarkers(' + JSON.stringify(arr) + ')');
  }).then(function (res) { say(fmt(L.markersAdded, { n: res.added })); })
    .catch(function (e) { e === 'changed' ? say(L.changed, true) : sayError(e); });
}

function clearMarkers() {
  return host('cc_clearMarkers()').then(function (res) { say(fmt(L.markersRemoved, { n: res.removed })); }, sayError);
}

function cut() {
  if (!plan) return Promise.resolve();
  var p = plan, backupName;
  invalidate();
  return sameSequence(p).then(function () {
    say(L.cutting);
    return host('cc_backup(' + lit(L.backupSuffix) + ')');
  }).then(function (res) {
    backupName = res.backup;
    var arr = p.cuts.map(function (c) { return [c.startFrame, c.endFrame]; });
    return host('cc_applyCuts(' + JSON.stringify(arr) + ',' + lit(p.id) + ')');
  }).then(function (res) {
    say(fmt(L.done, { n: res.applied, t: clock(totalFrames(p.cuts) / p.fps), b: backupName }));
  }).catch(function (e) { e === 'changed' ? say(L.changed, true) : sayError(e); });
}

function signed(x) { return (x > 0 ? '+' : '') + x; }

function readBalance() {
  var b = { voice: num($('voice').value, -30, -1, -6), gameBelow: num($('gameBelow').value, 0, 40, 10) };
  $('voice').value = b.voice; $('gameBelow').value = b.gameBelow;
  store.set('balancePeak', b);
  return b;
}

// Renders one track and measures the loud peaks of just the given time ranges.
function measureTrack(ffmpeg, t, ranges) {
  var wav = path.join(os.tmpdir(), 'clean-cut-loud-' + Date.now() + '-' + t + '.wav');
  var cleanup = function () { try { fs.unlinkSync(wav); } catch (e) {} };
  say(fmt(L.measuringLoud, { t: trackLabel(t) }));
  // shortcut: renders the whole sequence even for a short selection; render only In/Out if it gets slow.
  return host('cc_exportAnalysis([' + t + '],' + lit(wav) + ')').then(function () {
    // Stereo 16 kHz s16: about 115 MB for 30 minutes, small enough to keep in memory.
    return run(ffmpeg, ['-hide_banner', '-nostats', '-v', 'error', '-i', wav, '-af', "aselect='" + selectExpr(ranges) + "'",
      '-ac', '2', '-ar', '16000', '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  }).then(function (r) { cleanup(); return loudPeak(r.out, 16000 * 2); }, function (e) { cleanup(); throw e; });
}

function balance() {
  var ffmpeg = findFfmpeg();
  if (!ffmpeg) return Promise.resolve(sayError('NO_FFMPEG'));
  var roles = readTracks(), b = readBalance(), lines = [], changes = [], skipped = 0, targets;
  return host('cc_balanceTargets()').then(function (res) {
    targets = res;
    lines.push(res.mode === 'inout' ? L.balanceInOut : L.balanceSelection);
    var chain = Promise.resolve();
    res.tracks.forEach(function (tr) {
      var role = roles[tr.track] ? roles[tr.track].role : 'off';
      if (role === 'off' || !tr.ranges.length) { skipped += tr.clips.length; return; }
      chain = chain.then(function () { return measureTrack(ffmpeg, tr.track, tr.ranges); }).then(function (peak) {
        if (peak === null) { lines.push(fmt(L.balanceSilent, { t: trackLabel(tr.track) })); return; }
        var d = balanceDelta(peak.loud, role, b);
        lines.push(fmt(L.balanceLine, { t: trackLabel(tr.track), m: peak.loud, x: peak.max, d: signed(d), n: tr.clips.length }));
        tr.clips.forEach(function (c) { changes.push([tr.track, c, d]); });
      });
    });
    return chain;
  }).then(function () {
    if (!changes.length) return { applied: 0, clamped: 0, skipped: 0 };
    say(L.applying);
    return host('cc_applyGain(' + JSON.stringify(changes) + ',' + lit(targets.id) + ',' + LIMITER_CEILING + ')');
  }).then(function (res) {
    lines.push(fmt(L.balanceDone, { n: res.applied }));
    if (res.clamped) lines.push(fmt(L.balanceClamped, { n: res.clamped }));
    if (skipped + res.skipped) lines.push(fmt(L.balanceKeyframed, { n: skipped + res.skipped }));
    say(lines.join('\n'));
  }).catch(sayError);
}

// --- wiring ---

document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = L[el.getAttribute('data-t')]; });
var saved = store.get('settings', PRESETS.standard);
$('min').value = saved.min; $('pad').value = saved.pad; $('speech').value = saved.speech !== undefined ? saved.speech : 0.3;
matchPreset();
$('preset').onchange = function () {
  var p = PRESETS[$('preset').value];
  if (p) { $('min').value = p.min; $('pad').value = p.pad; $('speech').value = p.speech; readSettings(); }
  invalidate(); sync();
};
['min', 'pad', 'speech'].forEach(function (id) { $(id).onchange = function () { matchPreset(); invalidate(); sync(); }; });
var savedBalance = store.get('balancePeak', { voice: -6, gameBelow: 10 });
$('voice').value = savedBalance.voice; $('gameBelow').value = savedBalance.gameBelow;
$('scope').checked = store.get('scope', false);
$('scope').onchange = function () { store.set('scope', $('scope').checked); invalidate(); sync(); };
$('keepJoins').checked = store.get('keepJoins', false);
$('keepJoins').onchange = function () { store.set('keepJoins', $('keepJoins').checked); invalidate(); sync(); };

var ACTIONS = ['refresh', 'analyze', 'auto', 'markers', 'clearMarkers', 'cut', 'balance'];
function sync() { $('markers').disabled = !plan; $('cut').disabled = !plan; }
// Each action disables the buttons while it runs, so a double click can't start two exports.
function busy(fn) {
  return function () {
    ACTIONS.forEach(function (id) { $(id).disabled = true; });
    fn().then(function () { ACTIONS.forEach(function (id) { $(id).disabled = false; }); sync(); });
  };
}
$('refresh').onclick = busy(refresh);
$('analyze').onclick = busy(function () { return analyze(false); });
$('auto').onclick = busy(function () { return analyze(true); });
$('markers').onclick = busy(addMarkers);
$('clearMarkers').onclick = busy(clearMarkers);
$('cut').onclick = busy(cut);
$('balance').onclick = busy(balance);
sync();
refresh();
