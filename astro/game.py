"""Points, companions and the shop. State is one JSON blob per astronaut."""
from __future__ import annotations

import json

from .health import EXERCISES

HOUR = 3600.0
DAY = 86400.0

CATALOG = {
    # companions: 3D characters drawn in the browser (static/js/pets3d.js)
    "kitten":  {"type": "pet", "name": "Kitten", "price": 0, "blurb": "Curious and cuddly, with a swishy tail."},
    "bunny":   {"type": "pet", "name": "Bunny", "price": 180, "blurb": "Soft, bouncy and always twitching its ears."},
    "puppy":   {"type": "pet", "name": "Puppy", "price": 200, "blurb": "Wags everything, especially its tail."},
    "panda":   {"type": "pet", "name": "Panda", "price": 220, "blurb": "Round, fluffy and very good at sitting."},
    "koala":   {"type": "pet", "name": "Koala bear", "price": 240, "blurb": "Sleepy hugger with giant fluffy ears."},
    "giraffe": {"type": "pet", "name": "Giraffe", "price": 260, "blurb": "Tall and gentle, with a wobbly neck."},
    # outfits
    "bubble_helmet": {"type": "outfit", "name": "Bubble helmet", "price": 80},
    "scarf":         {"type": "outfit", "name": "Knitted scarf", "price": 60},
    "bowtie":        {"type": "outfit", "name": "Bow tie", "price": 50},
    "antenna_cap":   {"type": "outfit", "name": "Antenna cap", "price": 70},
    # toys
    "star_ball":   {"type": "toy", "name": "Star ball", "price": 60},
    "mini_rocket": {"type": "toy", "name": "Mini rocket", "price": 90},
    "yarn_comet":  {"type": "toy", "name": "Yarn comet", "price": 50},
    # snacks (consumed when fed)
    "space_berry": {"type": "snack", "name": "Space berry", "price": 15, "happiness": 10},
    "freeze_dried_icecream": {"type": "snack", "name": "Freeze-dried ice cream", "price": 25, "happiness": 18},
    "stardust_cookie": {"type": "snack", "name": "Stardust cookie", "price": 20, "happiness": 14},
}

MAX_PETS = 6                          # the page lays them out in a grid at the bottom right
PET_NAMES = {"kitten": "Selene", "puppy": "Pepper", "panda": "Bao", "bunny": "Anna",
             "giraffe": "Jolene", "koala": "Abi"}
# Default names companions had before they were renamed; a save that still has one gets today's name.
# (The puppy was "Biscuit", then "Anna"; "Anna" now belongs to the bunny, which was "Clover".)
OLD_DEFAULT_NAMES = {"kitten": {"Mochi"}, "puppy": {"Biscuit", "Anna"}, "giraffe": {"Noodle"},
                     "koala": {"Eucy"}, "bunny": {"Clover"}}
# Saves made before the 3D companions: the old 2D species become the nearest new one, and a pet
# that still has its old default name gets the new default name.
LEGACY_SPECIES = {"comet_cat": "kitten", "moon_pup": "puppy", "orbit_bot": "panda",
                  "nebula_jelly": "bunny", "axolotl": "koala"}
LEGACY_NAMES = {"Pixel": PET_NAMES["kitten"], "Crater": PET_NAMES["puppy"], "Bolt": PET_NAMES["panda"],
                "Wisp": PET_NAMES["bunny"], "Frill": PET_NAMES["koala"]}
HAPPINESS_DECAY_PER_HOUR = 1.0        # per mission hour
PET_POINTS, PET_COOLDOWN = 5, 2 * HOUR
CHECKIN_POINTS = 10
EXERCISE_COOLDOWN = 4 * HOUR          # the same exercise pays out again after this


class GameError(ValueError):
    pass


def default_state(now):
    return {
        "points": 150,
        "pets": [{"uid": "p1", "species": "kitten", "name": "Selene", "happiness": 60.0,
                  "outfit": None, "toy": None, "updated_met": now,
                  "last_pet_reward_met": None}],
        "inventory": {"outfit": [], "toy": [], "snack": {"space_berry": 2}},
        "log": [],
        "exercise_done": {},
        "last_checkin_day": None,
    }


def load(conn, aid, now):
    row = conn.execute("SELECT state_json FROM game WHERE astronaut_id=?", (aid,)).fetchone()
    st = json.loads(row["state_json"]) if row else default_state(now)
    for p in st["pets"]:
        if p.get("species") in LEGACY_SPECIES:
            p["species"] = LEGACY_SPECIES[p["species"]]
            p["name"] = LEGACY_NAMES.get(p.get("name"), p.get("name"))
    for p in st["pets"]:
        if p.get("name") in OLD_DEFAULT_NAMES.get(p.get("species"), ()):
            p["name"] = PET_NAMES[p["species"]]            # renamed companions: update a save that has the old default name
    for p in st["pets"]:                      # happiness drifts down over time
        dt = max(0.0, now - p.get("updated_met", now))
        p["happiness"] = max(0.0, p["happiness"] - HAPPINESS_DECAY_PER_HOUR * dt / HOUR)
        p["updated_met"] = now
    return st


def save(conn, aid, st):
    st["log"] = st["log"][-40:]
    conn.execute("INSERT INTO game(astronaut_id, state_json) VALUES(?,?) "
                 "ON CONFLICT(astronaut_id) DO UPDATE SET state_json=excluded.state_json",
                 (aid, json.dumps(st)))
    conn.commit()


def _log(st, now, text, points=0):
    st["log"].append({"met": now, "text": text, "points": points})


def _pet(st, uid):
    for p in st["pets"]:
        if p["uid"] == uid:
            return p
    raise GameError("That companion isn't in your crew quarters.")


def done_exercises(st, now):
    return {k for k, t in st.get("exercise_done", {}).items() if now - t < EXERCISE_COOLDOWN}


def complete_exercise(st, now, exercise_id, reps=None):
    ex = EXERCISES.get(exercise_id)
    if not ex:
        raise GameError("Unknown exercise.")
    last = st["exercise_done"].get(exercise_id)
    earned = 0 if (last is not None and now - last < EXERCISE_COOLDOWN) else ex["points"]
    st["exercise_done"][exercise_id] = now
    st["points"] += earned
    _log(st, now, f"Finished {ex['name'].lower()}" + (f" ({reps} reps)" if reps else ""), earned)
    return earned


def buy(st, now, item_id):
    item = CATALOG.get(item_id)
    if not item:
        raise GameError("That item isn't in the shop.")
    if item["type"] in ("outfit", "toy") and item_id in st["inventory"][item["type"]]:
        raise GameError(f"You already have the {item['name'].lower()}.")
    if item["type"] == "pet":
        if any(p["species"] == item_id for p in st["pets"]):
            raise GameError(f"You already have a {item['name'].lower()}.")
        if len(st["pets"]) >= MAX_PETS:
            raise GameError("Your companion corner is full. It holds six companions.")
    if st["points"] < item["price"]:
        raise GameError(f"You need {item['price'] - st['points']} more points for the {item['name'].lower()}.")
    st["points"] -= item["price"]
    if item["type"] == "pet":
        st["pets"].append({"uid": f"p{len(st['pets']) + 1}_{item_id}", "species": item_id,
                           "name": PET_NAMES.get(item_id, item["name"]), "happiness": 70.0,
                           "outfit": None, "toy": None, "updated_met": now,
                           "last_pet_reward_met": None})
    elif item["type"] == "snack":
        st["inventory"]["snack"][item_id] = st["inventory"]["snack"].get(item_id, 0) + 1
    else:
        st["inventory"][item["type"]].append(item_id)
    _log(st, now, f"Bought {item['name'].lower()}", -item["price"])


def equip(st, now, uid, item_id, slot=None):
    """Give a companion an outfit or toy. With item_id None, `slot` ("outfit" or "toy") says which to take off."""
    pet = _pet(st, uid)
    if item_id is None:
        pet[slot if slot in ("outfit", "toy") else "outfit"] = None
        return
    item = CATALOG.get(item_id)
    if not item or item["type"] not in ("outfit", "toy"):
        raise GameError("Only outfits and toys can be given to a companion.")
    if item_id not in st["inventory"][item["type"]]:
        raise GameError(f"Buy the {item['name'].lower()} first.")
    for other in st["pets"]:                      # one of each item, so move it
        if other[item["type"]] == item_id:
            other[item["type"]] = None
    pet[item["type"]] = item_id


def feed(st, now, uid, snack_id):
    pet = _pet(st, uid)
    item = CATALOG.get(snack_id)
    if not item or item["type"] != "snack":
        raise GameError("That isn't a snack.")
    if st["inventory"]["snack"].get(snack_id, 0) <= 0:
        raise GameError(f"You're out of {item['name'].lower()}. Get more in the shop.")
    st["inventory"]["snack"][snack_id] -= 1
    pet["happiness"] = min(100.0, pet["happiness"] + item["happiness"])
    _log(st, now, f"Fed {pet['name']} a {item['name'].lower()}")


def pet_stroke(st, now, uid, seconds):
    pet = _pet(st, uid)
    pet["happiness"] = min(100.0, pet["happiness"] + 3.0 * max(0.0, min(seconds, 10.0)))
    earned = 0
    last = pet.get("last_pet_reward_met")
    if last is None or now - last >= PET_COOLDOWN:
        earned = PET_POINTS
        pet["last_pet_reward_met"] = now
        st["points"] += earned
    _log(st, now, f"Petted {pet['name']}", earned)
    return earned


def checkin_reward(st, now):
    day = int(now // DAY)
    if st.get("last_checkin_day") == day:
        return 0
    st["last_checkin_day"] = day
    st["points"] += CHECKIN_POINTS
    _log(st, now, "Daily check-in", CHECKIN_POINTS)
    return CHECKIN_POINTS
