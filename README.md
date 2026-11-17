# Clean Cut

A free, open-source Adobe Premiere Pro panel that finds silence on the audio tracks you choose and cuts it from the whole timeline. Video and every audio track stay in sync.

It was made for recordings of games played with friends over Discord, with three audio tracks: mic, game, Discord. Clean Cut listens to the mic and Discord tracks, each with its own threshold, so a pause is removed only when everyone is quiet. Loud game moments (explosions, cutscenes) inside a pause are kept.

[Русская версия ниже](#по-русски)

## How it works

1. Each audio track gets a role: **Speech**, **Game** or **Ignore**. Premiere renders every Speech and Game track to its own temporary WAV, muting the others for the render.
2. `ffmpeg silencedetect` finds quiet stretches on each track with that track's threshold.
3. A pause is where every Speech track is quiet. Moments where a Game track is louder than its threshold, plus 0.5 s on each side, are taken out of the pauses.
4. Pauses shorter than the minimum are dropped. A short sound between two pauses (a cough, a click) is joined into them.
5. Each pause is shrunk by the padding on both sides and snapped to whole frames.
6. **Analyze** shows how many pauses were found and how much time will go. **Show as markers** puts them on the timeline for review, **Remove markers** clears them.
7. **Cut silence** first duplicates the sequence as a backup named "… (before cut)". Then it extracts each pause, right to left, on all tracks at once. After every cut it checks that the timeline shrank by exactly the expected length, and stops if it didn't.

### Loudness balance

Select audio clips with the mouse, or set In/Out, and press **Balance volume**. Each selected Speech track gets one gain change that brings its loud speech peaks to −6 dB on Premiere's meter; each Game track goes the set number of dB below that (10 dB by default). Both numbers are in the panel.

Peaks are measured with ffmpeg on Premiere's own render of that track, over just the selected clips (or the part inside In/Out). "Loud speech" is the level that 95% of the loud moments stay under, so one scream doesn't hold the whole track down.

Premiere doesn't let scripts set **Audio Gain**, and Volume → Level stops at +15 dB. So Clean Cut adds an **Amplify** effect to each clip for the gain (−96…+48 dB) and a **Hard Limiter** at −1 dB after it, so rare loud moments don't clip. Running the balance again adjusts the same Amplify instead of stacking new ones.

The UI is in English or Russian, following Premiere's language.

## Requirements

- macOS (Windows is untested)
- Premiere Pro 25 or later. Tested on 26.5.2.
- ffmpeg: `brew install ffmpeg`

## Install

```bash
git clone https://github.com/touchfalls/clean-cut.git
```

```bash
cd clean-cut && ./install.sh
```

The script symlinks the folder into `~/Library/Application Support/Adobe/CEP/extensions/clean-cut` and turns on `PlayerDebugMode`, which Premiere needs to load an unsigned panel. Restart Premiere, then open **Window → Extensions → Clean Cut**.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Track role | A1, A3 Speech; A2 Game | Speech: listened to for silence. Game: its loud moments are protected. Ignore: not listened to, still cut. |
| Track threshold | Speech −40 dB, Game −10 dB | Speech: quieter than this is silence (try −45…−50 if quiet words get cut). Game: louder than this is protected. **Auto thresholds + analyze** measures each track: Speech goes between noise floor and speech level (−70…−20 dB), Game goes to the loudest 5% (−40…−3 dB). |
| Pace | Standard | Sets the next three values at once. Soft: 1.5 s / 300 ms / 0.2 s. Standard: 1 s / 200 ms / 0.3 s. Tight: 0.5 s / 120 ms / 0.4 s. |
| Min pause | 1 s | Shorter pauses are left alone. |
| Padding | 200 ms | Space kept before and after speech so words aren't clipped. |
| Join sounds shorter than | 0.3 s | A sound this short between two pauses is cut together with them. 0 turns it off. |
| Only between In/Out | off | Cut only between the sequence In and Out marks. |
| Keep gaps and joins between clips | off | Pauses are cut only inside clips: empty space between clips stays, and a cut never spans the join of two clips, so separate recordings don't get glued together. |

## Limitations

- Every track is cut, including the ones that weren't analyzed. That keeps sync, but game sound inside a pause goes too.
- Each cut is its own undo step. The backup sequence is the easy way back.
- Sequence In/Out points and Clean Cut markers are cleared by the cut.
- Cutting goes through Premiere's undocumented QE DOM (`setInOutPoints` + `extract`). A Premiere update could break it. A port to UXP will be possible once its split API leaves beta.
- Locked tracks are refused, because they would drift out of sync.
- Balancing renders the whole sequence once per track, even for a short selection.
- Amplify and Hard Limiter are added through the undocumented QE DOM; their parameter scales were calibrated on Premiere 26.5.

## Development

```bash
node --test planner.test.js
```

| File | Purpose |
|---|---|
| `host.jsx` | ExtendScript: track info, analysis render, markers, backup, cuts, Amplify/Limiter |
| `main.js`, `index.html` | Panel UI, ffmpeg call, translations |
| `planner.js` | Pure logic: parse silencedetect output, combine tracks, plan frame ranges, suggest thresholds, peak math |

## Credits

The approach of rendering tracks through Premiere and cutting with QE extract comes from [open-silences](https://github.com/nicremo/open-silences) (MIT). Also studied: [auto-cut-agent](https://github.com/rafcopy/auto-cut-agent) and [deadair-premiere](https://github.com/nzalexgarciagil-ctrl/deadair-premiere).

`lib/CSInterface.js` is Adobe's CEP library. It ships under Adobe's own license, not MIT.

## License

MIT, see [LICENSE](LICENSE).

---

## По-русски

Бесплатная панель для Adobe Premiere Pro с открытым кодом. Находит тишину на выбранных аудиодорожках и вырезает её из всего таймлайна, видео и все дорожки остаются синхронными.

Сделана для записей игр с друзьями в Discord, где звук разложен на три дорожки: микрофон, игра, Discord. Clean Cut слушает микрофон и Discord, у каждой дорожки свой порог, поэтому пауза вырезается, только когда молчат все. Громкие моменты игры (взрывы, катсцены) внутри паузы остаются.

### Как работает

1. У каждой аудиодорожки есть роль: **Речь**, **Игра** или **Не слушать**. Premiere рендерит каждую дорожку «Речь» и «Игра» в свой временный WAV, остальные на время рендера глушатся.
2. `ffmpeg silencedetect` ищет тихие места на каждой дорожке с её порогом.
3. Пауза — там, где тихо на всех дорожках «Речь». Моменты, где дорожка «Игра» громче своего порога, плюс по 0,5 с с каждой стороны, из пауз исключаются.
4. Паузы короче минимальной отбрасываются. Короткий звук между двумя паузами (кашель, щелчок) склеивается с ними.
5. От каждой паузы с обеих сторон оставляется отступ, границы округляются до целых кадров.
6. **Анализ** показывает, сколько пауз найдено и сколько времени уйдёт. **Показать маркерами** ставит их на таймлайн для проверки, **Убрать маркеры** их снимает.
7. **Вырезать тишину** сначала делает копию секвенции «… (до вырезки)». Потом вырезает паузы справа налево сразу на всех дорожках. После каждого выреза проверяет, что таймлайн укоротился ровно на нужную длину, иначе останавливается.

### Баланс громкости

Выдели аудиоклипы мышкой или поставь In/Out и нажми **Сбалансировать громкость**. Каждая выделенная дорожка «Речь» получает одну поправку, которая выводит пики громкой речи на −6 дБ индикатора Premiere. Дорожка «Игра» ставится на заданное число дБ ниже (по умолчанию на 10). Обе цифры меняются в панели.

Пики мерятся через ffmpeg по рендеру этой дорожки из Premiere, только по выделенным клипам (или по части внутри In/Out). «Громкая речь» — уровень, ниже которого остаются 95% громких моментов, поэтому один крик не держит всю дорожку тихой.

Менять **Audio Gain** скриптам Premiere не даёт, а Volume → Level поднимает максимум на +15 дБ. Поэтому Clean Cut вешает на каждый клип эффект **Amplify** с поправкой (−96…+48 дБ) и после него **Hard Limiter** на −1 дБ, чтобы редкие громкие моменты не хрипели. Повторный баланс подправляет тот же Amplify, а не добавляет новый.

Язык интерфейса — русский или английский, по языку Premiere.

### Установка

Нужны macOS, Premiere Pro 25+ (проверено на 26.5.2) и ffmpeg (`brew install ffmpeg`).

```bash
git clone https://github.com/touchfalls/clean-cut.git
```

```bash
cd clean-cut && ./install.sh
```

Перезапусти Premiere и открой **Window → Extensions → Clean Cut**.

### Настройки

| Настройка | По умолчанию | Что значит |
|---|---|---|
| Роль дорожки | A1, A3 Речь; A2 Игра | Речь: слушается на тишину. Игра: её громкие моменты не режутся. Не слушать: не анализируется, но режется. |
| Порог дорожки | Речь −40 дБ, Игра −10 дБ | Речь: тише — тишина (если режутся тихие слова, попробуй −45…−50). Игра: громче — не резать. **Авто-пороги + анализ** меряет каждую дорожку: для речи порог между шумом и голосом (−70…−20 дБ), для игры — самые громкие 5% (−40…−3 дБ). |
| Темп | Стандарт | Ставит три следующих значения разом. Мягко: 1,5 с / 300 мс / 0,2 с. Стандарт: 1 с / 200 мс / 0,3 с. Плотно: 0,5 с / 120 мс / 0,4 с. |
| Мин. пауза | 1 с | Паузы короче не трогаются. |
| Отступ | 200 мс | Сколько «воздуха» оставить до и после речи. |
| Склеивать звуки короче | 0,3 с | Такой короткий звук между двумя паузами вырезается вместе с ними. 0 — выключено. |
| Только между In/Out | выкл. | Резать только между метками In и Out секвенции. |
| Не трогать промежутки и стыки между клипами | выкл. | Паузы режутся только внутри клипов: пустое место между клипами остаётся, и вырез никогда не захватывает стык двух клипов, поэтому отдельные записи не слипаются. |

### Ограничения

- Режутся все дорожки, включая те, что не анализировались. Так сохраняется синхронность, но звук игры в паузах тоже уходит.
- Каждый вырез — отдельный шаг отмены. Проще вернуться через копию секвенции.
- Метки In/Out и маркеры Clean Cut после вырезки сбрасываются.
- Вырезка идёт через недокументированный QE DOM Premiere. Обновление Premiere может её сломать.
- Заблокированные дорожки не поддерживаются: они разъехались бы.
- Для баланса весь таймлайн рендерится по разу на дорожку, даже если выделен короткий кусок.
- Amplify и Hard Limiter вешаются через недокументированный QE DOM; шкалы их параметров откалиброваны на Premiere 26.5.
