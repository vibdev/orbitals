# Orbitals dev tools

Tools for measuring the music, since the assistant working on this can't hear it.

## Listening rig

```
cd tools && npm install        # once
node listen.js                 # 45 s of a full six-voice garden, seed 7
```

Plays a repeatable garden in headless Chrome (muted on your speakers), records the master mix and one
stem per voice, logs every note, and writes to `tools/out/<name>/`:

- `report.png` / `report.html`: loudness per voice, frequency balance, harmony and density stats,
  a piano roll, a spectrogram, and a screenshot. Start here.
- `report.json`: the same numbers, for comparing runs.
- `mix.webm`, `<voice>.webm`: the recordings. `notes.json`: every note (time, beat, voice, pitch, velocity, mood).

Options:

| flag | meaning |
| --- | --- |
| `--name run1` | output folder name |
| `--seed 7` | which garden (same seed = same machines) |
| `--seconds 45` | recording length |
| `--preset "Groove"` | load one of the app's ready-made gardens (Trio, Full band, Ambient, Groove, Music box, Mirrors, Night) |
| `--band full\|trio` | all six voices, or just the starter kalimba, bass and pad |
| `--ring 96` | force every machine's ring (sets the mood) |
| `--bpm 76` | tempo |
| `--journey` | leave seeds and blooms on (off by default so the key stays put) |
| `--mix "drums=150 bass=80"` | mixer levels in percent |
| `--js "D.sym = 3"` | run any JavaScript in the page before recording |
| `--file other.html` | measure a different copy of the app (for before/after) |

Needs Google Chrome (override the path with `CHROME=...`) and `ffmpeg` on the PATH.

The machines are identical for a given seed. Note timing still varies slightly between runs, because
echoes and frame timing draw on the same random stream, so compare runs by their statistics, not note by note.

Stem loudness is each voice's dry signal; reverb and delay are only in the master.

## Hooks in the app

- `index.html?seed=N`: repeatable gardens.
- `index.html?dev`: every note is pushed to `NOTELOG`.
- **Mixer** button (bottom bar): per-voice volume by ear. Levels that should stick get baked into `MIX` in the code.
- `index.html#g=...`: the whole garden (machines, positions, tempo, settings) lives in the address bar; "Copy link" copies it.
