# Clean Cut

A free, open-source Adobe Premiere Pro panel that finds silence on the audio tracks you choose and cuts it from the whole timeline. Video and every audio track stay in sync.

It was made for recordings of games played with friends over Discord, with three audio tracks: mic, game, Discord. Clean Cut listens only to the mic and Discord tracks, so a pause is removed when everyone is quiet, even if the game is still making noise.

[Русская версия ниже](#по-русски)

## How it works

1. Premiere renders the checked audio tracks of the active sequence to a temporary WAV. Every other track is muted for the render and unmuted afterwards.
2. `ffmpeg silencedetect` finds stretches below the threshold that are longer than the minimum pause.
3. Each pause is shrunk by the padding on both sides and snapped to whole frames.
4. **Analyze** shows how many pauses were found and how much time will go.
5. **Cut silence** first duplicates the sequence as a backup named "… (before cut)". Then it extracts each pause, right to left, on all tracks at once. After every cut it checks that the timeline shrank by exactly the expected length, and stops if it didn't.

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
| Detect silence on | A1 + A3 | Tracks to listen to. A pause counts only when all of them are quiet. |
| Threshold | −40 dB | Anything quieter than this counts as silence. Try −45…−50 if quiet words get cut. **Auto** measures the noise floor and speech level of the checked tracks, sets the threshold between them (−70…−20 dB), then runs the analysis. |
| Min pause | 1 s | Shorter pauses are left alone. |
| Padding | 200 ms | Space kept before and after speech so words aren't clipped. |

## Limitations

- Every track is cut, including the ones that weren't analyzed. That keeps sync, but game sound inside a pause goes too.
- Each cut is its own undo step. The backup sequence is the easy way back.
- Sequence In/Out points are cleared by the cut.
- Cutting goes through Premiere's undocumented QE DOM (`setInOutPoints` + `extract`). A Premiere update could break it. A port to UXP will be possible once its split API leaves beta.
- Locked tracks are refused, because they would drift out of sync.

## Development

```bash
node --test planner.test.js
```

| File | Purpose |
|---|---|
| `host.jsx` | ExtendScript: track info, analysis render, backup, cuts |
| `main.js`, `index.html` | Panel UI, ffmpeg call, translations |
| `planner.js` | Pure logic: parse silencedetect output, plan frame ranges |

## Credits

The approach of rendering tracks through Premiere and cutting with QE extract comes from [open-silences](https://github.com/nicremo/open-silences) (MIT). Also studied: [auto-cut-agent](https://github.com/rafcopy/auto-cut-agent) and [deadair-premiere](https://github.com/nzalexgarciagil-ctrl/deadair-premiere).

`lib/CSInterface.js` is Adobe's CEP library. It ships under Adobe's own license, not MIT.

## License

MIT, see [LICENSE](LICENSE).

---

## По-русски

Бесплатная панель для Adobe Premiere Pro с открытым кодом. Находит тишину на выбранных аудиодорожках и вырезает её из всего таймлайна, видео и все дорожки остаются синхронными.

Сделана для записей игр с друзьями в Discord, где звук разложен на три дорожки: микрофон, игра, Discord. Clean Cut слушает только микрофон и Discord, поэтому пауза вырезается, когда молчат все, даже если в игре что-то шумит.

### Как работает

1. Premiere рендерит отмеченные дорожки активной секвенции во временный WAV. Остальные дорожки на время рендера глушатся, потом включаются обратно.
2. `ffmpeg silencedetect` ищет места тише порога и длиннее минимальной паузы.
3. От каждой паузы с обеих сторон оставляется отступ, границы округляются до целых кадров.
4. **Анализ** показывает, сколько пауз найдено и сколько времени уйдёт.
5. **Вырезать тишину** сначала делает копию секвенции «… (до вырезки)». Потом вырезает паузы справа налево сразу на всех дорожках. После каждого выреза проверяет, что таймлайн укоротился ровно на нужную длину, иначе останавливается.

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
| Искать тишину на | A1 + A3 | Какие дорожки слушать. Пауза засчитывается, только когда молчат все. |
| Порог | −40 дБ | Всё тише считается тишиной. Если режутся тихие слова, попробуй −45…−50. Кнопка **Авто** измеряет уровень шума и речи на отмеченных дорожках, ставит порог между ними (−70…−20 дБ) и сразу делает анализ. |
| Мин. пауза | 1 с | Паузы короче не трогаются. |
| Отступ | 200 мс | Сколько «воздуха» оставить до и после речи. |

### Ограничения

- Режутся все дорожки, включая те, что не анализировались. Так сохраняется синхронность, но звук игры в паузах тоже уходит.
- Каждый вырез — отдельный шаг отмены. Проще вернуться через копию секвенции.
- Метки In/Out после вырезки сбрасываются.
- Вырезка идёт через недокументированный QE DOM Premiere. Обновление Premiere может её сломать.
- Заблокированные дорожки не поддерживаются: они разъехались бы.
