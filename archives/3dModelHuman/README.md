# Body Atlas

Point at a part of your body in front of the camera and a 3D human model zooms to it and explains it.

- **Left:** a 3D body (Three.js). Drag to rotate, scroll to zoom, click a part to select it.
- **Right:** your camera with every MediaPipe detection drawn on it: 33 body joints, 21 joints per hand, and the face mesh with eyes, brows, lips and irises.
- **Flask** serves the page, the anatomy data (`/api/parts`) and the MediaPipe model files. All tracking runs in the browser, so no video is uploaded.

## Run it

```bash
cd body-atlas
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open <http://localhost:5000> and press **Start camera**.

The first run downloads three MediaPipe model files (about 30 MB) into `static/models/`. To fetch them in advance: `python download_models.py`.

Camera access only works on `localhost` or over HTTPS.

## Gestures

| Gesture | What happens |
|---|---|
| **Point**: index finger out, middle, ring and little fingers curled (thumb is ignored). Either hand. | The model rotates and zooms to the body part you point at. Touch the part with your fingertip, or aim along your finger. |
| **Pinch and drag** (thumb touches index) | Rotates the model. |
| **Pinch with both hands**, move apart or together | Zooms in or out. |

Stand far enough back that your upper body (ideally your whole body) is in view. Leaving the camera closed is fine: **Close camera** gives the model the full width, and the mouse controls work the same.

## How pointing is detected

1. **Pointing pose** (`static/js/gestures.js`, `analyzeHand`): for each finger, the distance from wrist to fingertip is compared with the distance from wrist to its knuckle, in 3D. A ratio above `EXTENDED` is straight, below `CURLED` is curled. Pointing means the index is straight and the other three are curled. Because this uses distances, not "finger points up", it works at any hand angle.
2. **Which hand is it?** Each hand is matched to the nearest pose wrist, so left and right are reliable even though the video is mirrored for display.
3. **What is it pointing at?** `buildRegions` turns the 33 pose landmarks into capsules for the head, neck, chest, abdomen, pelvis, and shoulder, upper arm, elbow, forearm, hand, thigh, knee, shin and foot on both sides. A ray runs from the fingertip along the finger, and the first region it touches wins. The pointing hand's own hand and forearm are skipped.
4. **Stability:** you must hold the same target for 5 frames before the model reacts, which stops flicker.

All thresholds are in the `CFG` object at the top of `gestures.js`.

## Project layout

```
app.py                 Flask server and model cache
body_parts.py          anatomy text for every part
templates/index.html   page
static/css/style.css   styling
static/js/main.js      wires everything together
static/js/body3d.js    3D mannequin, camera moves, mouse controls
static/js/tracking.js  camera, MediaPipe models, skeleton drawing
static/js/gestures.js  pointing / pinch recognition and body-part hit testing
```

## Tuning and extending

- **Pointing too strict or too loose?** Raise or lower `TOLERANCE` (size of the body regions), `CURLED` and `EXTENDED`.
- **Slow on your machine?** Switch off *Face mesh* (it is the heaviest model and then stops running), or change `pose_landmarker_full` to `pose_landmarker_lite` in `app.py` and `tracking.js`.
- **Use a real anatomical model:** replace the mannequin in `Body3D._build()` with a glTF loader. Keep one group per part id (for example `forearm_l`) so focusing, dimming and picking keep working.
- Three.js and MediaPipe load from the jsDelivr CDN. For offline use, download them into `static/` and update the import map and the `import` / `WASM` URLs.
