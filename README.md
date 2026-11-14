**Live demo (nothing to install): https://totally-buggin-astro-not-okay.vercel.app/**

Open it in Chrome or Edge on a computer and allow the camera. No camera? Use the simulated person: [`/?sim=script`](https://totally-buggin-astro-not-okay.vercel.app/?sim=script) plays a scripted demo and [`/?sim=idle`](https://totally-buggin-astro-not-okay.vercel.app/?sim=idle) lets you use the mouse. More in [Try it online](#try-it-online) below.

# Crew health check: Space Apps 2026 demo

A camera-first health check for astronauts. Stand in front of the camera and a see-through 3D body (skin, skeleton, organs and a beating heart) follows you like a filter, coloured by how each part of you is doing. Point at a body part and hold to see what's going on, in plain words, with what to do about it. Finishing the suggested exercises earns points for 3D animal companions that live at the bottom of the screen; you pet them, pick them up, feed them and give them toys.

You can run it yourself **fully offline** on one laptop, and it is also deployed online as a demo (link above). This is a hackathon prototype, not a medical device.

## Try it online

The demo at **https://totally-buggin-astro-not-okay.vercel.app/** is the same app, hosted on Vercel.

* Use **Chrome or Edge on a computer**. The site is served over HTTPS, so the camera works without any setup; allow it when asked.
* The first load downloads the tracking models (about 21 MB) from the same site, so give it a few seconds. Tracking runs **in your browser**: your camera video is not uploaded, the page only sends the app's small data requests.
* No camera, or want a hands-off demo? Add `?sim=script` or `?sim=idle` to the address, and see *Demo modes* below for the other options (`?astronaut=brandt`, and so on).
* What is different from running it yourself:
  * **No live pulse sensor.** The Arduino plugs into the computer that runs the server, so the pulse card does not appear online.
  * **Temporary data.** A serverless host only lets the app write to temporary storage, so the database lives there (`astro/db.py` switches to it automatically when it sees `VERCEL` or `AWS_LAMBDA_FUNCTION_NAME`; set `ASTRO_DB` to choose a path). The mission clock, points and companions can reset when the server restarts, and everyone who opens the demo shares the same data, so another visitor's check-in or points may show up.
  * **No background thread.** Device data is brought up to date each time the page asks for updates (every 5 s), which is what keeps the online demo live.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000** in Chrome or Edge and allow the camera.

* On a Mac, use `127.0.0.1`, not `localhost`: macOS's AirPlay Receiver also listens on port 5000 and answers `localhost` with "403 Forbidden".
* The first run creates `instance/astro_health.db` with about 4.5 months of mission history (about a second); on a serverless host it goes to temporary storage instead. Delete that file after changing a simulator or baseline, so it is rebuilt.
* When you run it yourself, nothing is loaded from the internet. The tracking library, its WASM runtime and the font are in `static/vendor`; the three tracking models (about 21 MB) must be in `static/models/`. If they're missing, the page says so and switches to the simulated person. Fetch them once with:

```bash
python tools/download_models.py      # the only step that needs internet
```

### Demo in 60 seconds

1. **Stand back** so your whole body is in view. The overlay appears on you. Red "!" badges sit beside any part that needs action.
2. **Point at a red part and hold** (0.8 s). The whole body zooms out to fit the screen, that part pulses red, and the panel tells you what to do.
3. **Open hand** to turn the model. **Raise a fist** to close it.
4. Open the **things to do** tray at the bottom and start an exercise. Points go up.
5. **Stroke your companion** with an open hand, or **pinch** it to pick it up. Feed it or give it a toy in the **Shop**.

### Demo modes (no camera needed)

| URL or command | What it does |
|---|---|
| `/?sim=script` | A simulated person points at their chest, turns the model, closes it with a fist, pets the companion, then pinches it and carries it across the screen. Loops every 32 s. |
| `/?sim=idle` | A simulated person stands still. Use the mouse: click a body part or badge, drag to turn the model, drag a companion to carry it, click it to pat it. |
| `/?astronaut=brandt` | Opens on another crew member: `okafor`, `brandt`, `menon` or `ruiz`. |
| `/?lines=1` | Also draws the thin pose and hand skeleton (press **T**). |
| `/?face=1` | Also runs the face tracker and draws its white face mesh under the hologram head (press **F**). Off by default. |
| `PULSE=sim python app.py` | A made-up pulse sensor, to show the live pulse card without hardware. |

Keys: **1–6** open the body regions, **Esc** closes, **T** skeleton lines, **F** face mesh.

## Gestures

| Gesture | Action |
|---|---|
| Index finger out, other fingers curled | Points. Hold 0.8 s over a body part, a red badge or any button to open or press it. |
| Open hand | With a body part open, move your hand to turn the 3D model. Over a companion, strokes it. |
| Fist raised above the hips, held 0.7 s | Closes the body part. |
| Thumb tip and index tip pinched over a companion | Picks it up; move your hand to carry it, open your fingers to put it down. A fist is not a pinch. |

If thumbs are misread on your camera, set `pointRequiresThumbTucked: false` in `static/js/gestures.js`.

## What's on screen

* **Body check** (left): one outlined box per region: red for *Act now* or *Urgent*, yellow for *Watch*, green for *On track*, grey dashed for *No data*. Tap a box to open it. **Gesture tips** folds open below.
* **Warning badges:** a red circle with a white "!" beside every *Act now* or *Urgent* part, never on top of it (by the ear for the head; one per side for arms and legs). They follow you as you move, show on the zoomed model too, and open the part when you point at them.
* **Focus view:** opening a part shows the **whole** standing body sized to fit between the side list and the details panel, with the chosen part pulsing red. *Watch* areas keep their amber colour.
* **Details panel:** each reading has a plain name ("Eye scan", "Leg strength"), one plain line with a simple comparison and an action ("Heart rate is high for you: 62, usually 52. Try slow breathing."), a trend chart, and small print **for the medical officer** with the technical name and exact numbers. All the wording lives in `astro/wording.py`.
* **Things to do** (bottom tray): each card leads with the action ("Do 12 squats today"), then the reason. Flags a person must review become "Tell your medical officer today".
* **Top bar:** mission clock, a **LIVE** indicator with "last update N s ago", the latest device batch, points, **Daily check-in**, **Shop**, **Devices**, **Skip 6 h**.
* **Daily check-in:** mood, stress and a note, once per mission day (a mission day is 24 real minutes). The button shows **Checked in ✓** once done; checking in again the same day replaces that day's answers.
* **Live updates:** the page asks the server what changed every 5 s. New points extend the charts, colours re-evaluate, and a short toast announces the first sync (then at most one a minute). If a region gets **worse**, a tappable alert appears ("Chest status changed to Act now. Tap to view."). Updates pause while a dialog or exercise is open or the tab is hidden; alerts held back appear afterwards.
* Text is 14 px or larger everywhere.

## The 3D body

Built from procedural shapes in `static/js/body3d.js` (no model files) and posed live from your joints.

* **Skin:** a glowing low-poly hologram with muscle profiles, drawn with triangle edges and vertex dots, coloured by each region's status.
* **Head:** the low-poly head sits over your face, placed by the ears and nose. The skull and brain appear in the zoomed model.
* **Hands:** each finger follows MediaPipe's 21 hand points. An untracked hand is drawn as a fixed hand.
* **Bones and organs:** skull, spine, ribs, pelvis and limb bones; brain, lungs, windpipe, liver, stomach, spleen, kidneys and intestines. Organs of a flagged region glow in its colour.
* **Heart:** four chambers and the great vessels. It beats at your pulse (live sensor, or simulated) and the lungs breathe at your breathing rate.

## Companions

Six 3D animals built in `static/js/pets3d.js`: **Kitten** (Selene, free), **Bunny** (Anna), **Puppy** (Pepper), **Panda** (Bao), **Koala** (Abi) and **Giraffe** (Jolene). Buy more in the **Shop** with points from exercises, the daily check-in and petting.

* **Moving:** they sit at the bottom right and now and then stroll along the floor, avoiding each other and the details panel.
* **Picking up:** pinch or mouse-drag. While carried they look shocked and confused and dangle; put down, they settle or drop to the floor. A click is a pat.
* **Mood follows happiness:** cry below 30, sad below 50, smile above 50, and above 90 they beam and wave. Confetti falls the first time one reaches 100. Happiness drains about 1 point per mission hour.
* **Feeding and toys:** feeding or giving a toy **closes the shop** so you can watch. The snack flies to its mouth and it chews; toys (star ball, yarn comet, mini rocket) are played with, and you can knock a toy away with a sweep of your hand.
* **Outfits:** scarf, bow tie, antenna cap and bubble helmet, fitted to each animal.
* Old saves are upgraded automatically: earlier species and default names are converted; names you chose are kept.

## Live pulse sensor (optional)

Plug in the Arduino and pulse sensor from `heart_rate_sensor_code/` and run `python app.py`. It is found automatically (set `PULSE_PORT` if not; `PULSE=0` turns the search off). Without a sensor nothing changes.

* **Live pulse card** (top right): your BPM and pulse wave. **Restart** reboots the Arduino; **Stop reading** frees the USB port. Open the chest and the card moves into the panel with resting heart rate, heart-rate variability, breathing rate and signal quality (`astro/pulse_analysis.py`; breathing is an estimate from how your heart rate rises and falls).
* **When it is used:** only while it is **actually reading a pulse**: lines arriving, a heart rate above 0, and real beats found in the wave (quality good or fair). Then the chest's resting heart rate and breathing rate use your live values ("Pulse sensor, live") and the 3D heart beats at your pulse. The moment that stops (finger off, unplugged, stopped), the app goes straight back to the simulated data.
* **Heads-up:** the crew's resting heart rates are about 50–59 bpm, so a real person at 80 bpm shows as *Act now*. That's the comparison working.

## How the data flows

```
device simulators ──batches──▶ SQLite ──▶ health engine ──/api/live every 5 s──▶ page: colours, badges, panels, cards
                                  ▲
        live pulse sensor ────────┘  (only while it is reading a pulse)
```

* **Devices** (`astro/devices.py`, `astro/synth.py`): each real device is stood in for by a simulator with the same data shape and rhythm. A background thread writes each device's batch when its interval is up, on a mission clock running **60× real time**. **Skip 6 h** jumps ahead.
* **Health engine** (`astro/health.py`): compares each reading with what is **expected for that astronaut on that mission day**: their own pre-flight baseline, shifted along normal spaceflight adaptation (`data/reference/expected_trajectory.csv`, e.g. blood pressure falls about 8 mmHg, core temperature rises about 1 °C). Indicators without a trajectory use the plain pre-flight baseline. Fixed safety limits sit on top. Each flag maps to an exercise, an action, or the medical officer.

| Device | How it measures | Batch interval (mission time) |
|---|---|---|
| Bio-Monitor (Astroskin) | Automatic, in 48 h wear sessions | 15 min |
| Thermo-Mini | Automatic, in 36 h wear sessions | 1 h |
| Actiwatch Spectrum | Automatic, all mission | 6 h |
| Tempus Pro | Weekly exam | 2 h |
| rHEALTH One | Finger-prick blood test | 6 h |
| Portable ultrasound | Monthly scan | 6 h |
| ARED / T2 / CEVIS | Logged each workout | 1 h |
| Radiation dosimeter (ISS DOSTEL) | **Real NASA data**, daily summary | 6 h |
| Cabin environment sensors | **Real NASA data**: CO₂, temperature, humidity | 6 h |
| Pulse sensor (USB) | **Real hardware**, if plugged in | streams; stored every ~5 s |
| Daily check-in, medical kit | Entered in the app | when entered |

## What's real and what's simulated

No public dataset of continuous astronaut vitals exists, so the app mixes real data with simulation. Details and rebuild steps are in [`data/README.md`](data/README.md).

* **Real blood panels:** each crew member is linked to an Inspiration4 crew member (C001–C004) from **NASA OSDR** (OSD-569, OSD-575).
* **Real radiation:** ISS DOSTEL dose rates from **NASA OSDR RadLab**, 2024. The real May 2024 solar storm lands on mission day 100.
* **Real cabin air:** ISS CO₂, temperature and humidity from the **NASA OSDR Environmental Data App**. On the demo day CO₂ is high enough to show *Watch* for everyone.
* **Real pre-flight baselines:** resting heart rate, stress and mood come from healthy volunteers in **PhysioNet MMASH** (ODbL). Sleep, blood pressure, SpO₂, core temperature, fitness and scan baselines are team estimates.
* **Real pulse**, if you plug the sensor in.
* **Simulated:** all in-flight vitals, with a story per crew member:
  * **Okafor:** sleep, resting heart rate and mood slipping over the last week.
  * **Brandt:** leg strength falling, bike workouts getting harder.
  * **Menon:** eye scan and neck vein changing; this goes to the medical officer, not an exercise.
  * **Ruiz:** mostly on track, with weaker arms.
* **Thresholds** are demo values, not clinical guidance.

## Project layout

```
app.py                  Flask routes, /api/live, background device sync
astro/crew.py           crew profiles, MMASH baselines, drift stories
astro/devices.py        device registry (kind, sync interval)
astro/synth.py          device simulators (swap for real device adapters)
astro/nasa.py           real NASA radiation + cabin data; expected-trajectory model
astro/pulse.py          Arduino pulse sensor: serial reader, stop/start, "is it reading?"
astro/pulse_analysis.py beats, resting heart rate, HRV and breathing from the raw wave
astro/ingest.py         mission clock, first-run seeding, batched sync
astro/health.py         indicators, baselines, status, regions, exercises, suggestions
astro/wording.py        every plain sentence the crew sees, plus the medical-officer small print
astro/game.py           points, companions, shop, daily check-in
static/js/main.js       camera loop, gestures, live loop, badges, toasts, UI wiring
static/js/ui.js         side list, details panel, cards, dialogs
static/js/body3d.js     Three.js body: overlay + focus model, badges, red focus pulse
static/js/tracking.js   MediaPipe pose + hands (+ face when switched on)
static/js/gestures.js   point / open / fist / pinch, dwell timer
static/js/pets.js       companion behaviour (no drawing; runs in Node for tests)
static/js/pets3d.js     the 3D companions, outfits, toys, snacks, shop previews
static/js/pulse.js      live pulse card
static/js/sim.js        simulated person for demo and test modes
static/js/api.js        fetch wrappers for the server routes
static/js/exercises.js  rep counting for the suggested exercises
static/js/geometry.js   landmark indices, smoothing and shared geometry helpers
static/js/regions.js    body regions in screen space, for pointing at your own body
static/js/trend.js      small trend charts with the person's usual range
static/css/app.css      the crew-procedure-card styling
templates/index.html    the single page
heart_rate_sensor_code/ Arduino sketch for the pulse sensor (wiring in its README)
tools/                  NASA OSDR, MMASH and model download scripts
data/                   real data (see data/README.md)
tests/                  backend and front-end logic tests
```

To connect a real device, write a function that returns `(readings, events)` for a time window, like those in `astro/synth.py`, and register it in `GENERATORS`.

## Tests

```bash
python tests/test_backend.py      # API, sync, live updates, daily check-in, game, pulse analysis and use (24 tests, nothing extra to install)
node tests/js/logic.test.mjs      # gestures, hit testing, rep counters, companion behaviour (28 tests)
```

If you have pytest installed, `python -m pytest tests` runs the backend tests too.

## Known limits

* The camera needs `127.0.0.1`, `localhost` or HTTPS, and works best in Chrome or Edge with a GPU. On a slow laptop, switch `pose_landmarker_full` to `pose_landmarker_lite` in `static/js/tracking.js` and `tools/download_models.py`.
* Squats and knee lifts need your knees in view, so step back.
* Most chest charts are daily summaries, so during a demo today's point moves rather than new points appearing.
* On narrow windows (about 1024 px) the companions can overlap the focus model's feet.
* The pulse analysis was checked against made-up waves and `PULSE=sim`, not against a clinical device.
* The online demo has no pulse sensor and keeps its data in temporary storage that is shared between visitors and can reset (see *Try it online*).
