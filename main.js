/* global CSInterface, parseSilences, planCuts, totalFrames */
var cs = new CSInterface();
var nodeRequire = window.cep_node ? window.cep_node.require : require;
var fs = nodeRequire('fs'), os = nodeRequire('os'), path = nodeRequire('path'), cp = nodeRequire('child_process');

var STRINGS = {
  en: {
    listen: 'Detect silence on', listenHint: 'Silence = all checked tracks are quiet. All tracks get cut.',
    settings: 'Settings', threshold: 'Threshold, dB', minPause: 'Min pause, s', padding: 'Padding, ms',
    refresh: 'Refresh tracks', analyze: 'Analyze', cut: 'Cut silence',
    exporting: 'Rendering audio…', detecting: 'Detecting silence…', cutting: 'Backing up and cutting…',
    found: 'Pauses found: {n}\nWill remove: {t} of {total}', none: 'No pauses found with these settings.',
    done: 'Done: {n} cuts, removed {t}.\nBackup: "{b}"', changed: 'Sequence changed — press Analyze again.',
    noTracks: 'Check at least one track.', backupSuffix: ' (before cut)',
    NO_SEQUENCE: 'Open a sequence first.', LOCKED: 'Unlock all tracks first, otherwise they go out of sync.',
    NO_PRESET: 'WAV export preset not found.', EXPORT_FAILED: 'Premiere did not render the audio.',
    NO_FFMPEG: 'ffmpeg not found. Install it: brew install ffmpeg', BACKUP_FAILED: 'Could not create a backup, nothing was cut.',
    SEQUENCE_CHANGED: 'Active sequence changed — press Analyze again.', NO_QE: 'This Premiere version has no QE extract.',
    NO_FRAME_FORMAT: 'Could not switch the timeline to frames.',
    IN_OUT_MISMATCH: 'In/out points did not land on the cut; stopped. The backup is intact.',
    NOT_SHRUNK: 'Timeline did not shrink as expected; stopped. The backup is intact.'
  },
  ru: {
    listen: 'Искать тишину на', listenHint: 'Тишина — когда молчат все отмеченные дорожки. Режутся все дорожки.',
    settings: 'Настройки', threshold: 'Порог, дБ', minPause: 'Мин. пауза, с', padding: 'Отступ, мс',
    refresh: 'Обновить дорожки', analyze: 'Анализ', cut: 'Вырезать тишину',
    exporting: 'Рендер звука…', detecting: 'Поиск тишины…', cutting: 'Бэкап и вырезка…',
    found: 'Найдено пауз: {n}\nБудет вырезано: {t} из {total}', none: 'С такими настройками пауз не найдено.',
    done: 'Готово: {n} вырезов, убрано {t}.\nБэкап: «{b}»', changed: 'Секвенция изменилась — нажми «Анализ» ещё раз.',
    noTracks: 'Отметь хотя бы одну дорожку.', backupSuffix: ' (до вырезки)',
    NO_SEQUENCE: 'Сначала открой секвенцию.', LOCKED: 'Разблокируй все дорожки, иначе они разъедутся.',
    NO_PRESET: 'Не найден пресет экспорта WAV.', EXPORT_FAILED: 'Premiere не отрендерил звук.',
    NO_FFMPEG: 'ffmpeg не найден. Установи: brew install ffmpeg', BACKUP_FAILED: 'Не удалось создать бэкап, ничего не вырезано.',
    SEQUENCE_CHANGED: 'Активная секвенция сменилась — нажми «Анализ» ещё раз.', NO_QE: 'В этой версии Premiere нет QE extract.',
    NO_FRAME_FORMAT: 'Не удалось переключить таймлайн в кадры.',
    IN_OUT_MISMATCH: 'Точки in/out не встали на вырез, остановлено. Бэкап цел.',
    NOT_SHRUNK: 'Таймлайн укоротился не так, как ожидалось, остановлено. Бэкап цел.'
  }
};
var L = STRINGS[/^ru/i.test(cs.hostEnvironment.appUILocale || '') ? 'ru' : 'en'];

function $(id) { return document.getElementById(id); }
function fmt(s, vars) { return s.replace(/\{(\w+)\}/g, function (_, k) { return vars[k]; }); }
function clock(sec) { sec = Math.round(sec); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
function say(text, isError) { $('status').textContent = text; $('status').className = isError ? 'error' : ''; }
function sayError(code) { var key = String(code).split(' ')[0]; say(L[key] || String(code), true); }
// ExtendScript string literal, non-ASCII escaped so Cyrillic survives evalScript.
function lit(s) { return JSON.stringify(String(s)).replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); }); }

function host(call) {
  return new Promise(function (resolve, reject) {
    cs.evalScript(call, function (raw) {
      var res;
      try { res = JSON.parse(raw); } catch (e) { return reject(String(raw)); }
      if (res.error) reject(res.error); else resolve(res);
    });
  });
}

var store = {
  get: function (k, d) { try { var v = localStorage.getItem('cc.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem('cc.' + k, JSON.stringify(v)); } catch (e) {} }
};

var info = null, plan = null;

function findFfmpeg() {
  var c = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (var i = 0; i < c.length; i++) if (fs.existsSync(c[i])) return c[i];
  return null;
}

function selectedTracks() {
  var out = [];
  document.querySelectorAll('#tracks input').forEach(function (el, i) { if (el.checked) out.push(i); });
  return out;
}

function renderTracks() {
  var saved = store.get('tracks', null);
  // Default for mic / game / Discord layout: listen to A1 and A3.
  var def = info.tracks.length >= 3 ? [0, 2] : [0];
  var box = $('tracks');
  box.innerHTML = '';
  info.tracks.forEach(function (name, i) {
    var label = document.createElement('label');
    label.className = 'track';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = (saved && saved.length ? saved : def).indexOf(i) !== -1;
    cb.onchange = function () { store.set('tracks', selectedTracks()); plan = null; $('cut').disabled = true; };
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' A' + (i + 1) + (name ? ' — ' + name : '')));
    box.appendChild(label);
  });
}

function refresh() {
  plan = null; $('cut').disabled = true;
  return host('cc_info()').then(function (res) {
    info = res; renderTracks();
    if (info.locked) sayError('LOCKED'); else say(info.name);
  }, function (e) { info = null; $('tracks').innerHTML = ''; sayError(e); });
}

function readSettings() {
  // Empty field -> 0 dB would mark everything as silence, so clamp to sane ranges.
  var clamp = function (raw, lo, hi, d) { var v = Number(raw); return raw !== '' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  var s = { db: clamp($('db').value, -90, -1, -40), min: clamp($('min').value, 0.1, 60, 1), pad: clamp($('pad').value, 0, 5000, 200) };
  $('db').value = s.db; $('min').value = s.min; $('pad').value = s.pad;
  store.set('settings', s);
  return s;
}

function analyze() {
  var ffmpeg = findFfmpeg();
  if (!ffmpeg) return Promise.resolve(sayError('NO_FFMPEG'));
  var keep = selectedTracks();
  if (!keep.length) return Promise.resolve(say(L.noTracks, true));
  var s = readSettings();
  var wav = path.join(os.tmpdir(), 'clean-cut-' + Date.now() + '.wav');
  var cleanup = function () { try { fs.unlinkSync(wav); } catch (e) {} };
  plan = null; $('cut').disabled = true;
  return host('cc_info()').then(function (res) {
    info = res;
    if (info.locked) throw 'LOCKED';
    say(L.exporting);
    return host('cc_exportAnalysis(' + JSON.stringify(keep) + ',' + lit(wav) + ')');
  }).then(function () {
    say(L.detecting);
    return new Promise(function (resolve, reject) {
      var args = ['-hide_banner', '-nostats', '-i', wav, '-af', 'silencedetect=n=' + s.db + 'dB:d=' + s.min, '-f', 'null', '-'];
      cp.execFile(ffmpeg, args, { maxBuffer: 64 * 1024 * 1024 }, function (err, _out, stderr) {
        if (err) reject('ffmpeg: ' + String(stderr).slice(-300)); else resolve(stderr);
      });
    });
  }).then(function (stderr) {
    cleanup();
    var cuts = planCuts(parseSilences(stderr, info.endSec), { padding: s.pad / 1000, fps: info.fps });
    if (!cuts.length) return say(L.none);
    plan = { cuts: cuts, id: info.id, endSec: info.endSec };
    say(fmt(L.found, { n: cuts.length, t: clock(totalFrames(cuts) / info.fps), total: clock(info.endSec) }));
    $('cut').disabled = false;
  }).catch(function (e) { cleanup(); sayError(e); });
}

function cut() {
  if (!plan) return Promise.resolve();
  var p = plan, backupName;
  plan = null; $('cut').disabled = true;
  return host('cc_info()').then(function (res) {
    if (res.id !== p.id || res.endSec !== p.endSec) throw 'changed';
    say(L.cutting);
    return host('cc_backup(' + lit(L.backupSuffix) + ')');
  }).then(function (res) {
    backupName = res.backup;
    var arr = p.cuts.map(function (c) { return [c.startFrame, c.endFrame]; });
    return host('cc_applyCuts(' + JSON.stringify(arr) + ',' + lit(p.id) + ')');
  }).then(function (res) {
    say(fmt(L.done, { n: res.applied, t: clock(totalFrames(p.cuts) / info.fps), b: backupName }));
  }).catch(function (e) { e === 'changed' ? say(L.changed, true) : sayError(e); });
}

document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = L[el.getAttribute('data-t')]; });
var saved = store.get('settings', { db: -40, min: 1, pad: 200 });
$('db').value = saved.db; $('min').value = saved.min; $('pad').value = saved.pad;
['db', 'min', 'pad'].forEach(function (id) { $(id).onchange = function () { plan = null; $('cut').disabled = true; }; });

// Each action disables the buttons while it runs, so a double click can't start two exports.
function busy(fn) {
  return function () {
    var btns = [$('refresh'), $('analyze')];
    btns.forEach(function (b) { b.disabled = true; });
    fn().then(function () { btns.forEach(function (b) { b.disabled = false; }); });
  };
}
$('refresh').onclick = busy(refresh);
$('analyze').onclick = busy(analyze);
$('cut').onclick = busy(cut);
refresh();
