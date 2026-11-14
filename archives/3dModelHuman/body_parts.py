"""Anatomy information for every body part the 3D model and the tracker know about.

Keys match the part ids used in static/js (e.g. "upper_arm_l").
"Left" and "right" always mean the person's own left and right.
"""

BODY_PARTS = {}


def _add(key, name, region, summary, structures, function, fact, paired=False):
    def entry(label):
        return {
            "name": label,
            "region": region,
            "summary": summary,
            "structures": structures,
            "function": function,
            "fact": fact,
        }

    if paired:
        for side, word in (("l", "Left"), ("r", "Right")):
            BODY_PARTS[f"{key}_{side}"] = entry(f"{word} {name}")
    else:
        BODY_PARTS[key] = entry(name)


_add(
    "head", "Head", "Head and face",
    "The head houses the brain and the main sense organs. The skull protects the brain, "
    "while the face holds the eyes, nose and mouth.",
    ["Cranium (8 bones)", "Facial skeleton (14 bones)", "Mandible, the only movable skull bone",
     "Brain and cranial nerves", "Eyes, ears, nose and tongue"],
    "Thinking, sensing, speaking, eating and breathing in.",
    "The brain uses roughly 20% of the body's energy while making up about 2% of its weight.",
)
_add(
    "neck", "Neck", "Head and neck",
    "The neck carries the spinal cord, airway, food passage and the major blood vessels "
    "between the head and the trunk.",
    ["7 cervical vertebrae (C1 to C7)", "Sternocleidomastoid and trapezius muscles",
     "Carotid arteries and jugular veins", "Trachea and esophagus", "Thyroid gland"],
    "Supports and moves the head, and links the head to the rest of the body.",
    "The top two vertebrae, the atlas and the axis, allow nodding and turning of the head.",
)
_add(
    "chest", "Chest (thorax)", "Trunk",
    "The thorax is a bony cage that protects the heart and lungs and anchors the shoulders and arms.",
    ["12 pairs of ribs", "Sternum (breastbone)", "Heart and lungs",
     "Pectoralis major and intercostal muscles", "Diaphragm below the lungs"],
    "Protects the heart and lungs and powers breathing.",
    "A resting adult breathes about 12 to 20 times a minute, which adds up to over 10,000 litres of air a day.",
)
_add(
    "abdomen", "Abdomen", "Trunk",
    "The abdomen holds most of the digestive system. Layers of muscle, not bone, "
    "support and protect the organs in front.",
    ["Stomach, liver and pancreas", "Small and large intestine", "Kidneys and spleen",
     "Rectus abdominis, obliques, transversus abdominis", "5 lumbar vertebrae behind"],
    "Digests food, filters blood and stabilises the trunk.",
    "The small intestine is around 6 metres long, but its folded lining gives it a surface area "
    "of tens of square metres.",
)
_add(
    "pelvis", "Pelvis and hips", "Trunk and lower limb",
    "The pelvic girdle joins the spine to the legs and cradles the lower abdominal organs.",
    ["Hip bone (ilium, ischium, pubis)", "Sacrum and coccyx", "Hip joint sockets (acetabula)",
     "Gluteal muscles", "Bladder and reproductive organs"],
    "Transfers body weight from the spine to the legs and supports the organs above.",
    "The gluteus maximus is the largest muscle in the human body.",
)
_add(
    "shoulder", "shoulder", "Upper limb",
    "The shoulder is the most mobile joint in the body. A shallow socket lets the arm swing "
    "in nearly every direction, at the cost of stability.",
    ["Glenohumeral (ball-and-socket) joint", "Clavicle and scapula", "Deltoid muscle",
     "Rotator cuff: supraspinatus, infraspinatus, teres minor, subscapularis"],
    "Lifts, rotates and swings the arm.",
    "The rotator cuff does not move the arm much. Its main job is to hold the ball centred in the socket.",
    paired=True,
)
_add(
    "upper_arm", "upper arm", "Upper limb",
    "The upper arm has one long bone, the humerus, wrapped by the muscles that bend and straighten the elbow.",
    ["Humerus", "Biceps brachii and brachialis (flex the elbow)", "Triceps brachii (extends the elbow)",
     "Brachial artery", "Radial and musculocutaneous nerves"],
    "Positions the forearm and hand, and lifts and pushes loads.",
    "The biceps also turns the palm upward, which is why it works so hard when you use a screwdriver.",
    paired=True,
)
_add(
    "elbow", "elbow", "Upper limb",
    "The elbow is a hinge joint that bends and straightens the arm. A second joint lets the forearm rotate.",
    ["Humerus, ulna and radius meet here", "Olecranon (the point of the elbow)", "Collateral ligaments",
     "Ulnar nerve in the groove behind the joint"],
    "Bends and straightens the arm and turns the palm up or down.",
    "The 'funny bone' is not a bone. It is the ulnar nerve running close to the surface.",
    paired=True,
)
_add(
    "forearm", "forearm", "Upper limb",
    "The forearm has two parallel bones. The muscles that move the wrist and fingers sit here, "
    "and they pull on the hand through long tendons.",
    ["Radius and ulna", "Flexor muscles (palm side)", "Extensor muscles (back side)",
     "Brachioradialis", "Median, ulnar and radial nerves"],
    "Rotates the palm (pronation and supination) and drives the wrist and fingers.",
    "The fingers have almost no muscle of their own. Most of their power comes from the forearm.",
    paired=True,
)
_add(
    "hand", "hand", "Upper limb",
    "The hand has 27 bones and dozens of muscles, giving it a mix of strength and fine control.",
    ["8 carpal bones in the wrist", "5 metacarpals", "14 phalanges", "Thenar muscles at the thumb base",
     "Median nerve and carpal tunnel"],
    "Grips, pinches, feels and gestures.",
    "The opposable thumb lets the hand grip in ways few other animals can.",
    paired=True,
)
_add(
    "thigh", "thigh", "Lower limb",
    "The thigh contains the femur, the longest and strongest bone in the body, surrounded by large muscle groups.",
    ["Femur", "Quadriceps (front)", "Hamstrings (back)", "Adductors (inner thigh)", "Femoral artery and vein"],
    "Walks, runs, jumps and lifts the body.",
    "The femur can withstand loads of several times body weight during running.",
    paired=True,
)
_add(
    "knee", "knee", "Lower limb",
    "The knee is the largest joint in the body. It mainly bends and straightens, and a set of "
    "ligaments and cartilage pads keeps it stable.",
    ["Femur, tibia and patella (kneecap)", "ACL and PCL (cruciate ligaments)", "MCL and LCL (side ligaments)",
     "Medial and lateral menisci", "Quadriceps and patellar tendon"],
    "Bends and straightens the leg and absorbs shock.",
    "The patella is the largest sesamoid bone, a bone embedded within a tendon.",
    paired=True,
)
_add(
    "shin", "lower leg", "Lower limb",
    "The lower leg has two bones. The thick tibia carries nearly all the weight, and the calf muscles "
    "power the foot.",
    ["Tibia (shinbone)", "Fibula", "Tibialis anterior (front)", "Gastrocnemius and soleus (calf)",
     "Achilles tendon, the body's thickest tendon"],
    "Carries body weight and moves the ankle and foot.",
    "The soleus is often called the 'second heart' because its contractions help push blood back up the leg.",
    paired=True,
)
_add(
    "foot", "foot and ankle", "Lower limb",
    "The foot is a flexible arched platform with 26 bones. It absorbs impact and then stiffens to push off.",
    ["Talus and calcaneus (heel bone)", "7 tarsals, 5 metatarsals, 14 phalanges", "Medial and lateral arches",
     "Plantar fascia", "Ankle (talocrural) joint"],
    "Supports body weight, keeps balance and propels walking and running.",
    "Your two feet together hold about a quarter of all the bones in the body.",
    paired=True,
)
