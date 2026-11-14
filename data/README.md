# Data

No public dataset of continuous astronaut vitals exists, so the app mixes real data with simulation:

- **Real pre-flight baselines** for each crew member's resting heart rate, stress and mood come from healthy-volunteer recordings (**PhysioNet MMASH**, ODbL v1.0).
- **Real NASA data:** Inspiration4 blood panels, ISS radiation, ISS cabin air.
- **In-flight values are simulated** (`astro/synth.py`). They start from those baselines and follow the expected spaceflight changes in `reference/expected_trajectory.csv` (published research, incl. NASA HRP work; some rows are team assumptions). Each person's medical story ("drifts" in `astro/crew.py`) is layered on top, and it is made up.
- **Team estimates, not real data:** baselines for sleep (see below), blood pressure, SpO₂, core temperature, fitness (ARED, T2, CEVIS) and ultrasound. MMASH doesn't measure most of these. Blood glucose comes from the real Inspiration4 panels.
- **Live sensor:** the optional Arduino pulse sensor (`astro/pulse.py`) is real data from whoever wears it.

| File | What | Source | Used by |
|---|---|---|---|
| `i4_blood.json` | Inspiration4 blood panels, subjects C001–C004 | NASA OSDR OSD-569 (CBC), OSD-575 (CMP) | rHEALTH One readings |
| `real/iss_dostel_radiation_daily.csv` | ISS radiation, daily, 2024-02-01 to 2024-11-04 | NASA OSDR RadLab API, DOSTEL1 + DOSTEL2 | Radiation dosimeter readings |
| `real/iss_cabin_environment_daily.csv` | ISS cabin CO₂ / temperature / humidity, 340 days | NASA OSDR Environmental Data App API, 7 Rodent Research missions (2014–2020) | Cabin sensor readings |
| `real/mmash_baselines.json` | Pre-flight baselines from 22 healthy adults, ~24 h each | PhysioNet MMASH v1.0.0, ODbL v1.0 | Crew baselines in `astro/crew.py` |
| `reference/expected_trajectory.csv` | Published spaceflight values with citations | see the `source` column | Expected in-flight change per mission day (`astro/nasa.py` → `astro/health.py`, `astro/synth.py`) |

Rebuild:

```bash
python tools/osdr_i4_import.py --download   # blood
python tools/fetch_nasa_data.py             # radiation + cabin (~2 min, needs internet)
python tools/mmash_import.py --download     # MMASH baselines (24 MB zip, open access)
# or: python tools/mmash_import.py --path path/to/MMASH/DataPaper
```
After rebuilding, delete `instance/astro_health.db` so the mission history is re-simulated from the new data.

## Pre-flight baselines (PhysioNet MMASH)
- **Source:** Rossi A et al., *Multilevel Monitoring of Activity and Sleep in Healthy People* (v1.0.0), PhysioNet 2020, https://doi.org/10.13026/cerq-fc86. Data paper: Rossi A et al., *Data* 2020, 5(4):91. Licence: Open Data Commons ODbL v1.0. The full citation is in the JSON's `source` field.
- **What it is:** 22 healthy young adults, each recorded for about 24 hours with a Polar H7 chest strap (beat-to-beat intervals), an ActiGraph wrist actigraph and questionnaires.
- **Crew mapping** (`mmash_participant` in `astro/crew.py`):

  | Crew | MMASH | Resting HR | Stress | Mood |
  |---|---|---|---|---|
  | Okafor | User_20 | 50.5 bpm | 2.6/5 | 3.5/5 |
  | Brandt | User_14 | 55.5 bpm | 2.9/5 | 3.6/5 |
  | Menon | User_3 | 53.9 bpm | 1.5/5 | 5.0/5 |
  | Ruiz | User_5 | 59.1 bpm | 3.3/5 | 4.1/5 |

  These four have complete, clean recordings and distinct profiles. User_11 has no sleep record. User_8 and User_9 have broken day numbers, so their actigraphy spans ~31 days.
- **How each value is derived** (`tools/mmash_import.py`):
  - **Resting heart rate:** the 10th percentile of 1-minute median heart rate while in bed. Beats outside 0.3–1.5 s, or more than 20% off their neighbours, are dropped first.
  - **Sleep hours and efficiency:** summed over that night's in-bed bouts. These are **not used as baselines** (see below).
  - **Stress:** from STAI-Y1 state anxiety, as 1 + 4 × (STAI − 20) / 60.
  - **Mood:** from PANAS, as 3 + (positive − negative) / 10, using the mean of the day's 5 ratings.
  - Both stress and mood mappings onto the app's 1–5 check-in scale are **team assumptions**. The raw scores are kept in the JSON.
- **Sleep stays a team estimate.** MMASH has one study night per person (median ~5.6 h), which is too short to stand for habitual sleep. The app expects sleep to drop in flight, so these short nights pushed healthy crew under the 5 h "Act now" limit on 6–14% of nights. The sleep hours and efficiency baselines in `astro/crew.py` (7.0–7.4 h, 89–92%) are therefore used instead.
- **Also extracted, but not used by the simulator:** HRV (RMSSD while in bed), steps per day and the MMASH night's sleep. They are stored as `hrv_rmssd_ms`, `steps_per_day`, `mmash_night_sleep_h` and `mmash_night_sleep_eff` in each crew profile, for reference.
- **Fallback:** if the JSON is missing or a value is null, the written numbers in `astro/crew.py` are used. `baseline_source` in each profile records which source was used for each value.
- **Caveats:**
  - MMASH has **one night** per person, recorded in a study setting that started around midnight. That's why sleep isn't taken from it.
  - The volunteers are healthy young students, not astronauts.
  - A single 24 h recording is a thin baseline. Real crew have months of pre-flight data.

## Radiation (RadLab DOSTEL)
- **Field:** `absorbed_dose_rate` in µGy/h, from the two DOSTEL silicon telescopes on the ISS.
- **Time weighting:** DOSTEL samples about every 68 s inside the South Atlantic Anomaly (SAA) and about every 100 s elsewhere, so a plain mean overweights the SAA by about 2.5×. Daily values are therefore weighted by time. The result, about 8 µGy/h or 0.19 mGy/day, matches published ISS figures.
- **Orbit zones:** each sample is tagged `saa`, `high_lat` (|latitude| > 45°) or `low_lat`. High latitude is where the station is least shielded, so solar particle events show up there.
  - On **2024-05-11** the high-latitude rate was 2.1× its 27-day median, with a peak of 156 µGy/h.
  - The whole-orbit daily average barely moved, because the magnetosphere shields the ISS and the storm also suppressed galactic cosmic rays (a Forbush decrease).
- **In the app** (`astro/nasa.py`): mission day *d* uses the real day 2024-02-01 + *d*, so the event is on **mission day 100**. The readings are:
  - `rad_spe_index`: today's high-latitude rate ÷ median of the previous 27 days. Watch at 1.3; "go to shelter" at 1.6.
  - `rad_dose_msv`: absorbed dose × 2.5, an approximate effective dose. **The 2.5 is a team assumption**, chosen to match NASA's 80–160 mSv per 6-month ISS increment.
  - `rad_cumulative_msv`: the running total, compared with the 600 mSv career limit (NASA-STD-3001 Vol 1 Rev B).

## Cabin air (EDA telemetry)
- **Processing:** daily mean and maximum CO₂, mean temperature and mean humidity. Humidity readings above 100% (a sensor glitch) are dropped.
- **Stitching:** the 7 missions are joined in this order: **RR-5, RR-12, RR-3, RR-6, RR-1, RR-9, RR-19.** That order puts the real May 2016 CO₂ rise (RR-3, daily mean up to 6,206 ppm) on mission days 140–155. On the demo day (141) cabin CO₂ is elevated (about 4,100–4,200 ppm) but below the 4 mmHg flight rule. Every reading's panel note gives the source mission and date.
- **Limits:**
  - **Watch at 3,950 ppm (≈3 mmHg).** Law et al. 2014, *J Occup Environ Med* 56:477, found headache odds roughly double per mmHg.
  - **Act now at 5,260 ppm (4 mmHg),** the ISS flight rule limit.

## Notes for the team
- The radiation and cabin values are the same for every crew member, because it's one shared cabin. Cabin CO₂ therefore adds a "Watch" to every head region on the demo day.
- The pre-flight history in the database is still simulated around the MMASH values (baseline + daily rhythm + noise). It isn't the MMASH recordings themselves.
- **Not migrated from the old prototype:** its 3-astronaut synthetic vitals (the files in the folder above this one). This app simulates its own crew and devices, so those files aren't needed here.
- Before presenting, check the cited rows in `reference/expected_trajectory.csv` against their papers.
