"""
NEON HOLISTIC TRACKER
Full body pose + both hands (21 finger joints each) + face mesh + eyes/iris,
rendered with a glowing cyberpunk look.

Install:   pip install mediapipe opencv-python numpy
Run:       python neon_holistic.py

Keys:  q = quit   g = glow on/off   m = face mesh dots on/off
       b = dim background on/off    s = save screenshot
Models (~30 MB total) are downloaded automatically on first run.
"""
import math
import os
import time
import urllib.request
from collections import deque

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# ----------------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------------
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
BASE = "https://storage.googleapis.com/mediapipe-models"
MODELS = {
    "pose": (f"{BASE}/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
             "pose_landmarker_full.task"),
    "hand": (f"{BASE}/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
             "hand_landmarker.task"),
    "face": (f"{BASE}/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
             "face_landmarker.task"),
}


def get_model(key):
    url, name = MODELS[key]
    os.makedirs(MODEL_DIR, exist_ok=True)
    path = os.path.join(MODEL_DIR, name)
    if not os.path.exists(path):
        print(f"Downloading {name} ...")
        urllib.request.urlretrieve(url, path)
    return path


# ----------------------------------------------------------------------------
# Topology (BGR colors)
# ----------------------------------------------------------------------------
CYAN = (255, 255, 0)
MAGENTA = (255, 0, 255)
LIME = (120, 255, 80)
YELLOW = (0, 255, 255)
ORANGE = (0, 150, 255)
WHITE = (255, 255, 255)
RED = (80, 80, 255)
BLUE = (255, 120, 40)

POSE_LINES = [
    (11, 12), (11, 13), (13, 15), (15, 17), (15, 19), (15, 21), (17, 19),
    (12, 14), (14, 16), (16, 18), (16, 20), (16, 22), (18, 20),
    (11, 23), (12, 24), (23, 24), (23, 25), (24, 26), (25, 27), (26, 28),
    (27, 29), (28, 30), (29, 31), (30, 32), (27, 31), (28, 32),
]
# left side of body (odd indices) magenta, right side cyan, torso white-ish
POSE_ANGLES = {13: (11, 13, 15), 14: (12, 14, 16), 25: (23, 25, 27), 26: (24, 26, 28)}

FINGERS = {
    "thumb": ([0, 1, 2, 3, 4], ORANGE),
    "index": ([0, 5, 6, 7, 8], YELLOW),
    "middle": ([0, 9, 10, 11, 12], LIME),
    "ring": ([0, 13, 14, 15, 16], CYAN),
    "pinky": ([0, 17, 18, 19, 20], MAGENTA),
}
PALM = [(5, 9), (9, 13), (13, 17)]
TIPS = [4, 8, 12, 16, 20]

FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
             400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
             54, 103, 67, 109]
L_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
R_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
LIPS_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]
BROWS = [[276, 283, 282, 295, 285], [300, 293, 334, 296, 336],
         [46, 53, 52, 65, 55], [70, 63, 105, 66, 107]]
NOSE = [168, 6, 197, 195, 5, 4]
R_IRIS, R_IRIS_C = [469, 470, 471, 472], 468
L_IRIS, L_IRIS_C = [474, 475, 476, 477], 473


# ----------------------------------------------------------------------------
# Drawing helpers
# ----------------------------------------------------------------------------
def px(lm, w, h):
    return int(lm.x * w), int(lm.y * h)


def poly(layer, pts, color, closed=True, t=1):
    cv2.polylines(layer, [np.array(pts, np.int32)], closed, color, t, cv2.LINE_AA)


def angle(a, b, c):
    ba = np.array(a) - np.array(b)
    bc = np.array(c) - np.array(b)
    den = np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6
    return math.degrees(math.acos(np.clip(np.dot(ba, bc) / den, -1, 1)))


def glow_dot(layer, p, r, color):
    cv2.circle(layer, p, r + 3, color, 1, cv2.LINE_AA)
    cv2.circle(layer, p, r, color, -1, cv2.LINE_AA)
    cv2.circle(layer, p, max(1, r // 2), WHITE, -1, cv2.LINE_AA)


def draw_pose(layer, lms, w, h):
    pts = {i: px(l, w, h) for i, l in enumerate(lms)}
    vis = {i: l.visibility for i, l in enumerate(lms)}
    for a, b in POSE_LINES:
        if vis[a] < 0.4 or vis[b] < 0.4:
            continue
        color = MAGENTA if (a % 2 == 1 and b % 2 == 1) else CYAN if (a % 2 == 0 and b % 2 == 0) else WHITE
        cv2.line(layer, pts[a], pts[b], color, 3, cv2.LINE_AA)
    for i in range(11, 33):
        if vis[i] > 0.4:
            glow_dot(layer, pts[i], 5, WHITE if i in (11, 12, 23, 24) else YELLOW)
    # joint angle read-outs
    for j, (a, b, c) in POSE_ANGLES.items():
        if min(vis[a], vis[b], vis[c]) > 0.5:
            ang = angle(pts[a], pts[b], pts[c])
            cv2.putText(layer, f"{int(ang)}", (pts[b][0] + 10, pts[b][1] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, LIME, 1, cv2.LINE_AA)
    # shoulder/hip bounding frame
    if min(vis[11], vis[12], vis[23], vis[24]) > 0.4:
        torso = [pts[11], pts[12], pts[24], pts[23]]
        poly(layer, torso, (255, 200, 0), True, 1)


def draw_hand(layer, lms, label, w, h, trails):
    pts = [px(l, w, h) for l in lms]
    for chain, color in FINGERS.values():
        for a, b in zip(chain[:-1], chain[1:]):
            cv2.line(layer, pts[a], pts[b], color, 3, cv2.LINE_AA)
    for a, b in PALM:
        cv2.line(layer, pts[a], pts[b], WHITE, 2, cv2.LINE_AA)
    for chain, color in FINGERS.values():
        for i in chain[1:]:
            r = 7 if i in TIPS else 4
            glow_dot(layer, pts[i], r, color)
    glow_dot(layer, pts[0], 7, WHITE)

    # bounding box + label
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, y0, x1, y1 = min(xs) - 20, min(ys) - 20, max(xs) + 20, max(ys) + 20
    corner = 18
    for (cx, cy, dx, dy) in [(x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)]:
        cv2.line(layer, (cx, cy), (cx + dx * corner, cy), CYAN, 2, cv2.LINE_AA)
        cv2.line(layer, (cx, cy), (cx, cy + dy * corner), CYAN, 2, cv2.LINE_AA)

    # fingers extended count (tip farther from wrist than the PIP joint)
    wrist = np.array(pts[0])
    up = 0
    for tip, pip in [(8, 6), (12, 10), (16, 14), (20, 18)]:
        if np.linalg.norm(np.array(pts[tip]) - wrist) > np.linalg.norm(np.array(pts[pip]) - wrist) * 1.1:
            up += 1
    if np.linalg.norm(np.array(pts[4]) - np.array(pts[17])) > np.linalg.norm(np.array(pts[3]) - np.array(pts[17])):
        up += 1
    cv2.putText(layer, f"{label.upper()} HAND  [{up}]", (x0, y0 - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, WHITE, 1, cv2.LINE_AA)

    # pinch line (thumb tip <-> index tip)
    d = np.linalg.norm(np.array(pts[4]) - np.array(pts[8]))
    if d < 0.35 * np.linalg.norm(np.array(pts[0]) - np.array(pts[9])):
        mid = ((pts[4][0] + pts[8][0]) // 2, (pts[4][1] + pts[8][1]) // 2)
        cv2.line(layer, pts[4], pts[8], RED, 3, cv2.LINE_AA)
        cv2.circle(layer, mid, 14, RED, 2, cv2.LINE_AA)
        cv2.putText(layer, "PINCH", (mid[0] + 18, mid[1]), cv2.FONT_HERSHEY_SIMPLEX, 0.5, RED, 1, cv2.LINE_AA)

    # index fingertip trail
    trails[label].append(pts[8])


def draw_trails(layer, trails):
    for label, dq in trails.items():
        n = len(dq)
        for i in range(1, n):
            a = i / n
            color = tuple(int(c * a) for c in YELLOW)
            cv2.line(layer, dq[i - 1], dq[i], color, max(1, int(5 * a)), cv2.LINE_AA)


def draw_face(layer, lms, w, h, show_mesh):
    pts = [px(l, w, h) for l in lms]
    if show_mesh:
        for p in pts[:468]:
            cv2.circle(layer, p, 1, (120, 160, 0), -1, cv2.LINE_AA)
    poly(layer, [pts[i] for i in FACE_OVAL], CYAN, True, 2)
    poly(layer, [pts[i] for i in LIPS_OUT], MAGENTA, True, 2)
    poly(layer, [pts[i] for i in LIPS_IN], (200, 0, 200), True, 1)
    for br in BROWS:
        poly(layer, [pts[i] for i in br], ORANGE, False, 2)
    poly(layer, [pts[i] for i in NOSE], (200, 200, 200), False, 1)

    for eye, iris, ic in [(R_EYE, R_IRIS, R_IRIS_C), (L_EYE, L_IRIS, L_IRIS_C)]:
        poly(layer, [pts[i] for i in eye], YELLOW, True, 2)
        center = pts[ic]
        radius = int(np.mean([np.linalg.norm(np.array(pts[i]) - np.array(center)) for i in iris]))
        cv2.circle(layer, center, radius + 2, LIME, 2, cv2.LINE_AA)
        cv2.circle(layer, center, max(2, radius // 3), WHITE, -1, cv2.LINE_AA)
        # crosshair
        r2 = radius + 10
        cv2.line(layer, (center[0] - r2, center[1]), (center[0] + r2, center[1]), LIME, 1, cv2.LINE_AA)
        cv2.line(layer, (center[0], center[1] - r2), (center[0], center[1] + r2), LIME, 1, cv2.LINE_AA)

    # blink detection (eyelid gap / eye width)
    def ear(top, bot, outer, inner):
        return np.linalg.norm(np.array(pts[top]) - np.array(pts[bot])) / (
            np.linalg.norm(np.array(pts[outer]) - np.array(pts[inner])) + 1e-6)

    e = (ear(159, 145, 33, 133) + ear(386, 374, 362, 263)) / 2
    xs, ys = [p[0] for p in pts[:468]], [p[1] for p in pts[:468]]
    x0, y0, x1 = min(xs), min(ys), max(xs)
    state = "EYES CLOSED" if e < 0.14 else "EYES OPEN"
    mouth = np.linalg.norm(np.array(pts[13]) - np.array(pts[14])) / (
        np.linalg.norm(np.array(pts[61]) - np.array(pts[291])) + 1e-6)
    cv2.putText(layer, f"FACE | {state} | MOUTH {'OPEN' if mouth > 0.25 else 'CLOSED'}",
                (x0, y0 - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.55, WHITE, 1, cv2.LINE_AA)


def draw_hud(img, fps, n_pose, n_hands, n_faces, glow, mesh):
    h, w = img.shape[:2]
    cv2.rectangle(img, (0, 0), (w, 34), (20, 10, 20), -1)
    cv2.putText(img, "NEON HOLISTIC TRACKER", (12, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.65, CYAN, 2, cv2.LINE_AA)
    info = f"FPS {fps:4.1f}  BODY {n_pose}  HANDS {n_hands}  FACE {n_faces}  GLOW {'ON' if glow else 'OFF'}  MESH {'ON' if mesh else 'OFF'}"
    cv2.putText(img, info, (w - 640, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.5, LIME, 1, cv2.LINE_AA)
    cv2.putText(img, "q quit | g glow | m mesh | b dim | s save", (12, h - 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1, cv2.LINE_AA)
    # scanline vignette
    img[::4] = (img[::4] * 0.88).astype(np.uint8)


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=get_model("pose")),
        running_mode=vision.RunningMode.VIDEO, num_poses=1))
    hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=get_model("hand")),
        running_mode=vision.RunningMode.VIDEO, num_hands=2))
    face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=get_model("face")),
        running_mode=vision.RunningMode.VIDEO, num_faces=2))

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    if not cap.isOpened():
        raise SystemExit("Could not open webcam.")

    glow_on, mesh_on, dim_on = True, True, True
    trails = {"Left": deque(maxlen=25), "Right": deque(maxlen=25)}
    prev, fps, t0 = time.time(), 0.0, time.time()

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)  # mirror so left/right labels match the viewer
        h, w = frame.shape[:2]
        ts = int((time.time() - t0) * 1000)

        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        pose_res = pose.detect_for_video(mp_img, ts)
        hand_res = hands.detect_for_video(mp_img, ts)
        face_res = face.detect_for_video(mp_img, ts)

        layer = np.zeros_like(frame)
        for lms in pose_res.pose_landmarks:
            draw_pose(layer, lms, w, h)
        seen = set()
        for lms, handed in zip(hand_res.hand_landmarks, hand_res.handedness):
            label = handed[0].category_name
            seen.add(label)
            draw_hand(layer, lms, label, w, h, trails)
        for label in trails:
            if label not in seen:
                trails[label].clear()
        draw_trails(layer, trails)
        for lms in face_res.face_landmarks:
            draw_face(layer, lms, w, h, mesh_on)

        base = (frame * 0.45).astype(np.uint8) if dim_on else frame
        if glow_on:
            bloom = cv2.GaussianBlur(layer, (0, 0), 9)
            out = cv2.add(base, cv2.addWeighted(bloom, 1.6, bloom, 0, 0))
        else:
            out = base
        out = cv2.add(out, layer)

        now = time.time()
        fps = 0.9 * fps + 0.1 * (1 / max(now - prev, 1e-6))
        prev = now
        draw_hud(out, fps, len(pose_res.pose_landmarks), len(hand_res.hand_landmarks),
                 len(face_res.face_landmarks), glow_on, mesh_on)

        cv2.imshow("Neon Holistic Tracker", out)
        k = cv2.waitKey(1) & 0xFF
        if k == ord("q"):
            break
        elif k == ord("g"):
            glow_on = not glow_on
        elif k == ord("m"):
            mesh_on = not mesh_on
        elif k == ord("b"):
            dim_on = not dim_on
        elif k == ord("s"):
            name = f"neon_{int(time.time())}.png"
            cv2.imwrite(name, out)
            print("Saved", name)

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()