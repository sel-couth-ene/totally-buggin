# Crew health check: Space Apps 2026 demo

A camera-first health check for astronauts. MediaPipe tracks your face, body and hands. A see-through anatomical 3D body (skin, skeleton, organs and a beating heart) sits over you like a filter and is coloured by your health status. Point at a part of your body and hold to zoom in on its stats. When something drifts from your pre-flight baseline, the app suggests an exercise that targets it. Suggestions collect in a tray at the bottom of the screen; open it with the button there. Finishing an exercise earns points, which you can spend on 3D animal companions that gather at the bottom right of the camera view. You pet them with your hand, feed them, give them toys and dress them up. An optional Arduino pulse sensor adds a live pulse card at the top right; it moves into the chest details when you point at your heart.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open **http://localhost:5000** in Chrome or Edge and allow the camera. The first run creates `instance/astro_health.db` with about 4.5 months of mission data. It takes about a second.

The app runs **fully offline**. The tracking library, its WASM runtime and the Archivo font are bundled in `static/vendor`, and the page never loads anything from the internet. The three tracking model files (about 21 MB) must be in `static/models/`. If they're missing, fetch them once:

```bash
python tools/download_models.py      # saves to static/models/ (the only step that needs internet)
```

If the models are missing, the page says so and switches to the simulated person.

### Demo modes (no camera needed)

| URL | What it does |
|---|---|
| `/?sim=script` | A simulated person points at their chest, turns the model with an open hand, closes it with a fist, pets the companion, then pinches it between thumb and index finger, carries it to the middle of the screen and lets go. Loops every 32 s. Good for judging and for testing. |
| `/?sim=idle` | A simulated person stands still. Use the mouse: click a body part, drag to turn the model, click and drag a companion to carry it, click it to pat it. |
| `/?astronaut=brandt` | Opens on a different crew member (`okafor`, `brandt`, `menon`, `ruiz`). |
| `/?lines=1` | Also draws the thin pose and hand skeleton (off by default, so the hologram body stays clean). Press **T** to toggle it and **F** to toggle the face mesh. `/?face=1` starts with the face mesh on. |
| `PULSE=sim python app.py` | Uses a made-up pulse sensor, so you can see the live pulse card and everything it feeds without any hardware. |

Keys: **1–6** open the body regions, **Esc** closes, **F** face mesh, **T** thin skeleton.

## Gestures

| Gesture | Action |
|---|---|
| Index finger out, other fingers curled (either hand) | Points. Hold for 0.8 s over a body part to open it, or over any button to press it. |
| Open hand, all five fingers out | When a body part is open, move your hand to turn the 3D model. |
| Fist, raised above the hips, held 0.7 s | Closes the body part. |
| Open hand moving over a companion | Pets it. |
| Thumb tip and index tip pinched together over a companion, then move your hand | Picks it up and carries it. Open your fingers to put it down. A fist is not a pinch. |

The overlay body also turns with you, because it's posed live from your joints.

If thumbs are misread on your camera, set `pointRequiresThumbTucked: false` in `static/js/gestures.js`.

## The 3D body

Built from procedural shapes in `static/js/body3d.js` (no model files, so it works offline) and posed live from your joints. Layers, from the outside in:

* **Skin:** a glowing low-poly hologram: a V-shaped torso with a narrow waist, a sloping neck, and arms and legs with muscle profiles (deltoid, biceps, quadriceps, calf), drawn with their triangle edges and vertex dots. Its colour shows the region's status.
* **Face:** the 3D head (low-poly skin) is drawn over your face like the rest of the body, placed by the ears and nose from the body tracker. The skull and brain appear in the zoomed model. Optional: **F** (or `/?face=1`) also runs MediaPipe's face tracker and draws its white face mesh under the hologram head, as in a face scan. It is off by default, and the face model only runs while it is on.
* **Hands:** the fingers follow MediaPipe's 21 hand landmarks, so when you move a finger the 3D finger moves with it (skin, bone and joint for each segment). A hand that is not tracked (down at your side) is drawn as a fixed hand.
* **Bones:** skull and jaw, spine, ribs and breastbone, collar bones, pelvis, and the arm and leg bones. Translucent, so the organs show through.
* **Organs:** brain and cerebellum; lungs (three lobes right, two left), windpipe with cartilage rings, and bronchi; liver, gall bladder, stomach, spleen, kidneys, and small and large intestine. The organs of a region that needs attention take on a soft glow in its status colour.
* **Heart:** four chambers, the aorta with its arch and branches, the pulmonary arteries, the venae cavae and the coronary arteries. It beats in time with your pulse (live sensor or simulated): the atria squeeze, then the ventricles, then the big vessels swell. The lungs breathe at your breathing rate.
* Point at your chest and the zoomed model shows the heart close up. Picking works on any layer: clicking an organ selects its region.

## Companions

Six 3D animals, each with a head, arms and legs, built from simple shapes in `static/js/pets3d.js`: **Kitten** (Selene, free), **Bunny** (Anna), **Puppy** (Pepper), **Panda** (Bao), **Koala bear** (Abi) and **Giraffe** (Jolene). You can own all six; they sit in a grid at the bottom right, and step left when the details panel is open.

* **Moving:** a companion sits with its legs out in front. Every so often it gets up and strolls, swinging its legs and arms, **along the floor at the bottom of the screen**, from the left edge to the right edge (and left of the details panel while that is open). It never wanders up the screen. Strolls are mostly 150 to 380 px long with a good rest between them, they avoid other companions, and a crying companion walks slowly.
* **Picking one up:** click and drag a companion with the mouse, or pinch it between thumb and index finger and move your hand. While it is carried it is **shocked and confused** (wide eyes with tiny pupils, one brow up and one down, a gaping mouth, a "?!" bubble), dangling and flailing. Put it down and it goes back to its usual face: on the floor it stays put; above the floor it drops back down with a small bounce and carries on. A click without dragging is a pat. A companion that is eating cannot be picked up.
* **Face follows happiness** (`moodOf` in `static/js/pets.js`): below 30 it cries, below 50 it is sad, exactly 50 is neutral, above 50 it smiles, and **above 90 it beams**: eyes closed, a wide open smile, and it **sits and waves both hands**. A beaming companion does not stroll or start playing by itself; it still reacts when something sets it off (you hit its toy, feed it, or stroke it). **Confetti** falls for about 4.5 seconds only when a companion first reaches 100 (if it was fed up to 100, once it has finished eating), then it goes back to sitting and waving. Happiness drains about 1 point per mission hour (about a minute of real time).
* **Toys** (give one in the shop; **Put away** takes it back; a toy can be anywhere along the floor, and a companion that wandered far from it brings it out beside itself): the kitten kicks the *star ball* and chases it as it bounces, the *yarn comet* is batted and leaves a trail, and the *mini rocket* is picked up and flown around. Sweep your hand (or drag the mouse) through a toy to knock it away; the companion goes after it. A crying companion does not play. A hand on a companion pauses its play.
* **Feeding:** the snack flies to its mouth, it holds it in its paws and chews, bite by bite, then cheers. The shop's *Your companions* list shows each one live, so you can watch it chew with the shop open.
* **Outfits** are 3D and fit each animal: scarf, bow tie, antenna cap and bubble helmet (the scarf and bow tie sit on the giraffe's long neck).
* **Old saves:** earlier 2D companions are converted when the game loads (comet cat to kitten, moon pup to puppy, orbit bot to panda, nebula jelly to bunny, axolotl to koala); a companion that still had its old default name gets the new one, a custom name is kept.

## Live pulse sensor (optional)

Plug in the Arduino + pulse sensor from `heart_rate_sensor_code/` and run `python app.py`. The app finds it by itself (set `PULSE_PORT` if it doesn't; `PULSE=0` turns the search off). With no sensor, nothing changes on screen.

* **Top right:** a *Live pulse* card with your BPM and the pulse wave. **Restart** reboots the Arduino. **Stop reading** releases the sensor (the USB port is closed, so the Arduino IDE can use it) and the app goes back to the simulated numbers straight away. **Start reading** takes it up again. While any other details panel is open, the card steps to the left of it.
* **Chest details:** point at your heart (or click Chest) and the same card moves into the chest panel, bigger, with the vitals below. It moves back when you close the panel.
* **What it works out** (`astro/pulse_analysis.py`, from the raw wave, no extra hardware): resting heart rate (steady for about 30 s), heart-rate variability (RMSSD), breathing rate and signal quality. Breathing rate is an *estimate* from how your heart rate rises and falls with each breath, and needs about a minute of steady pulse. A pulse sensor cannot measure SpO₂ or blood pressure, so those stay with the other devices.
* **What it changes:** while the sensor is reading, **Resting heart rate** and **Breathing rate** in the chest panel use your live values (source "Pulse sensor, live") and are judged against the crew member's own baseline like any other reading, so the chest colour and suggestions react. The 3D heart beats at your pulse and the lungs breathe at your breathing rate. Numbers are stored for the crew member shown on screen every few seconds as readings from the `pulse_sensor` device.
* **Heads-up for demos:** the crew are fictional, with baselines around 58–62 bpm. A real person at 80 bpm will show as "Act now" for resting heart rate. That is the comparison working as designed, not a bug.

## How the data flows

```
devices (simulated) ──batches──▶ SQLite ──per-device fetch──▶ web page ──▶ health engine ──▶ body colours, panels, exercises
```

* **Devices** (`astro/devices.py`, `astro/synth.py`). Each device is replaced by a simulator that produces data in the same shape and rhythm the real device would. A background thread in `app.py` saves each device's batch when its sync interval is up.
* **Batches the page fetches** (`static/js/main.js`, `restartFeeds`). The page calls `/api/readings?device=…&since=…` on a separate timer for each device. You can watch them arrive in the top bar and under **Devices**.
* **Health engine** (`astro/health.py`). Compares each indicator with *that astronaut's* pre-flight baseline. Spaceflight shifts what's normal for each person, so population averages aren't used. Fixed safety limits sit on top of the baseline check. Each indicator maps to a body region, and each flag maps to an exercise, or to "talk to your crew medical officer" for things a person must review.
* **Mission clock**. Runs 60× faster than real time, so 15 mission minutes pass in 15 s, and devices visibly sync during a demo. **Skip 6 h** jumps ahead, for example to bring in the overnight Actiwatch sleep score.

| Device | How it measures | Batch interval (mission time) |
|---|---|---|
| Bio-Monitor (Astroskin) | Automatic, during 48 h wear sessions | 15 min |
| Actiwatch Spectrum | Automatic, all mission | 6 h |
| Thermo-Mini | Automatic, during 36 h wear sessions | 1 h |
| Tempus Pro | Weekly exam the astronaut runs | 2 h |
| rHEALTH One | Finger-prick blood test the astronaut runs | 6 h |
| Portable ultrasound | Monthly scan the astronaut runs | 6 h |
| ARED / T2 / CEVIS | Logged during each workout | 1 h |
| Pulse sensor (USB, live) | **Real hardware**: an Arduino with a finger pulse sensor | streams continuously; stored every ~5 s |
| Radiation dosimeter (ISS DOSTEL) | **Real NASA data**, one daily summary | 6 h |
| Cabin environment sensors | **Real NASA data**: CO₂, temperature, humidity | 6 h |
| Check-ins, medical kit | Entered in the app | when entered |
| CMO-DA | Reads data only; not connected | — |

## What's real and what's simulated

* **Real:** blood panels. Each crew member is linked to one de-identified Inspiration4 crew member (C001–C004) from **NASA OSDR**: OSD-569 complete blood count and OSD-575 metabolic panel. The three pre-flight draws are your baseline, and the R+1 draw is shown as the latest in-flight rHEALTH panel. Rebuild `data/i4_blood.json` straight from OSDR with `python tools/osdr_i4_import.py --download`.
* **Real:** radiation. ISS DOSTEL dose rates from **NASA OSDR RadLab**, Feb–Nov 2024, replayed with launch = 2024-02-01. The real May 2024 solar particle event falls on **mission day 100**, and you can see it in the chest region's radiation charts.
* **Real:** cabin air. ISS CO₂, temperature and humidity from the **NASA OSDR Environmental Data App**: 340 days of telemetry logged during 7 Rodent Research missions. On the demo day cabin CO₂ is 4,100–4,200 ppm, above the 3 mmHg headache level. That's shared air, so it shows for every crew member.
* Rebuild the radiation and cabin CSVs with `python tools/fetch_nasa_data.py`. See [`data/README.md`](data/README.md) for how each file is processed and mapped onto the mission clock.
* **Real (if you plug it in):** pulse. Heart rate, resting heart rate, variability and breathing rate come from the Arduino pulse sensor, not a simulator.
* **Simulated:** everything else. OSDR doesn't openly publish continuous vitals for individual ISS astronauts; that data is protected and released only on request. Each crew member has a built-in story so the demo has something to find:
  * **Okafor:** sleep, resting heart rate, blood pressure and mood have slipped over the past week.
  * **Brandt:** ARED leg strength is falling and the bone-loss estimate is rising.
  * **Menon:** the optic nerve sheath is widening on ultrasound. This points to a medical officer, not to an exercise.
  * **Ruiz:** mostly on track, with a dip in upper-body strength.
* **Thresholds** are demo values for a prototype, not clinical guidance. Before you present, check the health text in `astro/health.py` (`REGIONS`) against NASA Human Research Program sources.

## Project layout

```
app.py                  Flask routes + background device sync
astro/crew.py           crew profiles and their drift stories
astro/devices.py        device registry (kind, sync interval, what it measures)
astro/synth.py          device simulators (swap these for real device adapters)
astro/nasa.py           real NASA radiation + cabin data, replayed as two "devices"
astro/pulse.py          live Arduino pulse sensor: serial reader, stop/start, stores readings
astro/pulse_analysis.py beats, resting heart rate, HRV and breathing rate from the raw pulse wave
astro/ingest.py         mission clock, first-run seeding, batched sync
astro/health.py         indicators, baselines, status, region info, exercises
astro/game.py           points, companions, shop
static/js/main.js       camera loop, gestures, device feeds, UI wiring
static/js/tracking.js   MediaPipe pose + hands + face
static/js/body3d.js     Three.js anatomical body: skin, skeleton, organs, beating heart (overlay + inspect model)
static/js/gestures.js   point / open / fist classification, pinch (pick-up), dwell timer
static/js/regions.js    body-part hit testing in camera space
static/js/exercises.js  rep counters (squats, arm raises, march), timers
static/js/pulse.js      live pulse card: top right, docks into the chest panel, stop/start reading
static/js/pets.js       companion behaviour: floor spots, sit / walk / play / eat, carrying, toy physics, moods (no drawing, runs in Node)
static/js/pets3d.js     the 3D companions, outfits, toys, snacks, confetti and the shop previews (Three.js)
static/js/sim.js        simulated tracking for demo/test modes
tools/                  OSDR import, NASA radiation/cabin download, model download
data/                   real NASA data (see data/README.md)
tests/                  backend + gesture/rep-counter tests
```

To connect a real device, write a function that returns `(readings, events)` for a time window, in the same format as the functions in `astro/synth.py`, and register it in `GENERATORS`. Nothing else needs to change.

## Tests

```bash
python tests/test_backend.py      # API, sync batches, game rules, live pulse analysis and health use
node tests/js/logic.test.mjs      # gestures, hit testing, rep counters, companion layout, moods, toys, feeding
```

## Known limits

* The camera needs `localhost` or HTTPS, and works best in Chrome or Edge with a GPU. On a slow laptop, change `pose_landmarker_full` to `pose_landmarker_lite` in `static/js/tracking.js` and `tools/download_models.py`.
* Squats and marching need your knees in view, so step back from the camera.
* The pulse analysis was checked against made-up waves with known heart rate, variability and breathing (`tests/test_backend.py`) and by running the app with `PULSE=sim`. It has not been calibrated against a clinical device. The beats are found from the 50 Hz wave, so variability is coarser than from an ECG.
* The 3D body has no long red vessel lines (they read as skeleton lines); the only vessels are the short ones at the heart. It is about 100,000 triangles per frame, which any GPU handles, but it is heavier than the old blob body; if a laptop struggles, lower the sphere detail at the top of `static/js/body3d.js` (`SPH`, `organicSphere`).
* This is a hackathon prototype, not a medical device.
