# ZipFit Logic Guide — Auto-synced snapshot
<!-- Last synced from Google Doc: 2026-06-18T16:25:07.584Z -->

ZipFit Fit Quiz — Plain Language Logic Guide
Last updated: June 2026 | Source: EMcgill-71/Fit-Quiz-3.0 (data.js, variant1.jsx)

Overview
The ZipFit Fit Quiz takes a skier through 9 questions and recommends one of 7 ZipFit liners. The quiz collects information about the skier’s boot shell, foot measurements, anatomy, fit problems, skiing terrain, and ability level. It then runs a scoring algorithm to rank all 7 liners and output a primary recommendation plus up to 2 alternates.

Section 1: The 9 Quiz Questions
The quiz is divided into three sections: Your Shell, Your Foot, and Your Skiing.

Q1 — Boot Shell (Section: Your Shell)
Question: “What ski boot shell are you fitting?”
Type: Boot selector (brand + model dropdown)
Scored: Yes — the chosen shell’s last width (in mm) drives the entire scoring engine.
Note: The user first selects a brand, then filters by flex index to narrow the model list. The quiz knows the shell’s last width (e.g. 96mm, 100mm, 104mm+), volume category (LV, MV, HV, Race), and whether the boot has a walk mode.

Q2 — Foot Length (Section: Your Foot)
Question: “How long is your foot?”
Type: Number input (centimetres, range 18–35 cm)
Scored: Yes — used to calculate the recommended shell size and liner size.
Note: User is instructed to stand on paper against a wall and measure their longest foot. The quiz calculates shell size from foot length (foot length x 10 = mondo point starting point).

Q3 — Forefoot Width (Section: Your Foot)
Question: “How wide is your forefoot?”
Type: 4-option choice (anatomy, not scored)
Scored: No — informational only (all ZipFit liners accommodate full forefoot width range)
Options: Narrow (shoes feel too wide) | Medium (standard width fits right) | Wide (standard shoes feel snug) | Very Wide (always need wide sizing)

Q4 — Instep Height (Section: Your Foot)
Question: “How high is your instep?”
Type: 3-option choice (anatomy, not scored)
Scored: No — informational only
Options: Low / Flat | Medium | High
Note: Instep = the top of the foot from toes to ankle. Affects how a liner wraps the top of the foot but does not change the liner recommendation.

Q5 — Ankle Volume (Section: Your Foot)
Question: “How much volume does your ankle have?”
Type: 3-option choice (anatomy, SCORED)
Scored: Yes — ankle volume affects which liner volumes are a good fit
Options:
Lean (prominent bones, lean profile) → value: “low”
  • Average (moderate tissue around ankle) → value: “medium”
  • Full (lots of soft tissue at ankle) → value: “high”
Measurement tip: Measure around the back of the heel. Less than foot length = lean; equal = average; more = full.
Q6 — Calf and Lower Leg (Section: Your Foot)
Question: “How would you describe your calf and lower leg?”
Type: 3-option choice (anatomy, SCORED)
Scored: Yes — calf size is a major driver of the Freeride and Workhorse recommendations
Options:
Lean (slim lower leg) → value: “low”
  • Medium (average calf muscle) → value: “medium”
  • Muscular (developed calf, strong lower leg) → value: “high”
Measurement tip: Foot length in cm + 10cm = your average calf benchmark. Measure calf circumference at widest point. Within 2cm = medium; more than 2cm above = muscular; more than 2cm below = lean.
Q7 — Fit Challenges (Section: Your Foot)
Question: “Do you have any common fit problems?”
Type: Single-select choice (NOT scored)
Scored: No — does NOT change the liner recommendation. It triggers informational messaging about how ZipFit liners address that problem.
Options:
Heel lift — heel rises inside the boot when flexing forward
  • Shin bang — sharp bruising pain on the shin during or after skiing
  • Toe bang — toes hitting the front of the boot
  • Navicular / instep pain — pain on the top of the foot or arch
  • Cold feet — chronically cold feet in the boot
  • Wide forefoot pressure — pain or pressure across the ball of the foot
  • Ankle bite — pain on the sides of the ankles
  • No major issues — generally comfortable fit
Q8 — Terrain / Where You Ski (Section: Your Skiing)
Question: “Where do you spend most of your time on the mountain?”
Type: Multi-select choice (NOT directly scored, but triggers follow-up)
Scored: Indirectly — selecting “Touring” triggers a follow-up question (Q8b). The touring answer IS scored.
Options (select all that apply):
All Mountain — mix of groomers, off-piste, variable conditions
  • Carving — mostly groomed runs, edge-to-edge performance
  • Park — freestyle, features, terrain park
  • Touring — backcountry touring or sidecountry
Q8b — Touring Focus (conditional follow-up, Section: Your Skiing)
Question: “Do you spend most of your ski days touring?”
Only shown if: User selected “Touring” in Q8
Type: 2-option choice (SCORED)
Scored: Yes — this is one of the most important scoring signals
Options:
Yes — mainly touring (majority of ski days involve skinning up)
  • No — touring occasionally (tours some days but mostly resort)
Effect: “Yes” (touring primary = true) boosts the Espresso and GFT, and heavily penalises the Corsa and Gara LV.
Q9 — Ability Level (Section: Your Skiing)
Question: “How would you describe your skiing ability?”
Type: 4-option choice (SCORED)
Scored: Yes — ability is a tie-breaker (max 20 pts) and a hard gate for the Workhorse
Options:
Beginner (learning the basics) → value: 1
  • Intermediate (comfortable on most trails) → value: 2
  • Advanced (confident in all conditions) → value: 3
  • Expert (aggressive, max performance) → value: 4
Note: The Workhorse liner is only available to Advanced and Expert skiers (ability >= 3). Beginners and Intermediates get a -999 score for the Workhorse, removing it from results.
Section 2: The 7 ZipFit Liners
Each liner has a warmth rating (w: 1-5), performance rating (p: 1-5), and a volume category. Liners are matched to shells based on shell last width in mm.

Corsa
Tagline: Race-only precision.
Volume: Low | Warmth: ⅖ | Performance: 5/5
Best for: Race shells and ultra-low-volume shells (<= ~94mm last) demanding maximum control.
Key features: Cork fill system, race-specific construction, maximum energy transfer, precision narrow last.
Hard rules: Only recommended for race/LV shell categories. Penalised if touring is the primary use. Never recommended for walk-mode boots used mainly for touring.
2. GFT (Great For Touring)
Tagline: The precision all-rounder.
Volume: Medium | Warmth: ⅗ | Performance: ⅘
Best for: Low-volume downhill, touring, and crossover shells. The most versatile ZipFit liner.
Key features: Cork fill system, all-mountain performance, balanced volume, versatile fit.
Shell range: MV, LV, MV-Wide categories.
Boosts: +50 pts for walk-mode boots; +70 pts if touring is primary use AND shell is wider than 98mm.
Common fit issues addressed: Heel lift, control problems.

3. Espresso
Tagline: Ultralight LV touring precision.
Volume: Low-Medium | Warmth: ⅖ | Performance: ⅘
Best for: The lightest, most dedicated AT shells. Built for uphill performance.
Key features: Ultralight construction, optimised for ascending, low bulk.
Shell range: LV, Race, Race/LV categories.
Hard rule: Only recommended when touring is the primary use. Penalised (score = -999) if touring is NOT selected as primary. It is exclusively a touring liner.
Common fit issues addressed: Heel lift, control, instep pressure.

4. Gara LV
Tagline: Precision power transfer for low-volume shells.
Volume: Medium | Warmth: ⅘ | Performance: ⅘
Best for: Maximum energy from foot to ski for lean ankles and low-volume boots.
Key features: Cork fill system, precision fit for narrow lasts, maximum ankle lockdown.
Shell range: LV, Race, Race/LV categories. Ideal for shells in the ~96–100mm range.
Penalties: Score reduced if touring is the primary use OR if the user has a muscular calf.
Common fit issues addressed: Heel lift, control.

5. Gara HV
Tagline: Maximum cork fill for larger shells.
Volume: Medium-High | Warmth: ⅘ | Performance: ⅘
Best for: Best-in-class volume reduction and heel lock for lean ankles in high-volume boots.
Key features: Generous cork fill volume, heel-hold focus, designed for shells with more internal space.
Shell range: HV, MV, MV-Wide categories. Ideal for shells in the ~100–104mm range.
Penalties: Score reduced if touring is the primary use OR if the user has a muscular calf.
Common fit issues addressed: Heel lift, cold feet.

6. Freeride
Tagline: The all-mountain comfort liner.
Volume: Medium-High | Warmth: ⅘ | Performance: ⅗
Best for: Higher-volume shells and fuller lower legs. Excellent for skiers with muscular calves.
Key features: More forgiving fit, comfort-forward, accommodates larger lower leg volume.
Shell range: HV, MV, MV-Wide categories. Ideal for shells in the ~100–106mm range.
Boosts: +50 pts for muscular calf; +30 pts for walk-mode boots; +20 pts if park terrain selected; +30 pts if touring is primary.
Common fit issues addressed: Cold feet, heel discomfort.

Workhorse
Tagline: Maximum warmth for higher-volume shells.
Volume: Medium-High | Warmth: 5/5 | Performance: ⅘
Best for: Experts who live in their boots and need maximum warmth without sacrificing performance.
Key features: Maximum warmth construction, high-volume fill, built for daily expert use.
Shell range: HV, MV, MV-Wide categories.
Hard gate: ONLY available to Advanced or Expert skiers (ability level 3 or 4). Beginners and Intermediates receive a score of -999, completely removing this liner from their results.
Common fit issues addressed: Cold feet, pain.
Section 3: The Scoring Algorithm (How the Recommendation Works)
The scoring function (scoreLiners) runs all 7 liners through 4 tiers of scoring simultaneously. Every liner gets a numeric score. The liner with the highest score wins. The next 1–2 liners become alternates. Any liner with a score of -999 is excluded entirely.

Tier 1 — Shell Gates (Dominant / Eliminatory)
This tier applies hard rules and large bonuses to ensure the right liner wins for a given shell type. These scores dominate all other tiers.

Corsa: Gets a massive bonus for race/ultra-LV shells. Gets heavily penalised if touring is the primary use.

Espresso: Gets a massive bonus if touring is the primary use. Gets a -999 (eliminated) if touring is NOT the primary use — it never appears for non-primary tourers.

GFT: Base score of 70 points. +50 for walk-mode boots. +70 if touring is primary AND shell is wider than 98mm.

Gara LV: Targeted at 96–100mm shells. Gets penalised if touring is primary OR if the user has a muscular calf.

Gara HV: Targeted at 100–104mm shells. Gets penalised if touring is primary OR if the user has a muscular calf.

Freeride: Targeted at 100–106mm shells. +50 for muscular calf, +25 for walk-mode boot, +20 for park terrain, +12 if touring is primary.

Workhorse: Hard gate — if ability is below Advanced (< 3), score is set to -999 and liner is eliminated. Otherwise gets a base score plus bonus for walk-mode and muscular calf.

Tier 2 — Shell Volume Match (~30 points)
Each liner has a list of shell volume categories it works well with (e.g. MV, HV, LV, Race). If the user’s shell volume matches one of the liner’s compatible categories, the liner gets a points bonus (approximately 30 points). This reinforces shell-liner compatibility beyond the Tier 1 gates.

Tier 3 — Foot Shape Refinement (tie-breaker, max ~52 points)
Each liner has compatible ankle volume ranges and calf volume ranges. The quiz checks whether the user’s ankle volume (lean/medium/full) and calf volume (lean/medium/muscular) match the liner’s compatible ranges. Matching ankle = bonus points. Matching calf = bonus points. This acts as a fine-tuned tie-breaker when multiple liners are close in score after Tiers 1 and 2.

Tier 4 — Ability Level (max 20 points)
The user’s ability score (1–4) is multiplied by a small factor and added to all eligible liners’ scores. Higher ability generally tilts results toward more performance-oriented liners in edge cases. This is the weakest tier and only matters as a final tie-breaker.

Section 4: The Output (Results Page)
After completing the quiz, the results page (computeMatch) outputs:

Primary Recommendation
The liner with the highest score. Displayed prominently with:
Liner name and tagline
  • A “why” explanation written in plain language (e.g. “The GFT is the go-to ZipFit liner for…”) 
  • Recommended liner size (in half-size shell increments)
  • A fit problem callout if the user selected a fit issue (e.g. “Your liner helps with heel lift”)
  • A “Shop Now” button linking to the ZipFit product page
Alternate Recommendations
Up to 2 additional liners with the next highest scores. Shown in a smaller card format. Only liners with valid (non -999) scores appear. The alternates give the skier options if they want to explore further.

Section 5: Plain-Language Decision Summary (Who Gets What)
Here is a simplified guide to what drives each liner recommendation:

CORSA → You have a race or ultra-narrow shell. You are not a primary tourer.

ESPRESSO → You tour most of your ski days. You have a lightweight AT boot in a low-volume shell.

GFT → You have a walk-mode boot, OR you tour primarily with a wider shell (>98mm). You want a versatile, all-mountain liner.

GARA LV → You have a low-volume shell (narrow last), lean ankles, and you are not a primary tourer with a lean or average calf.

GARA HV → You have a high-volume shell, lean ankles, and are not a primary tourer. Your calf is lean or average.

FREERIDE → You have a medium or high-volume shell AND a muscular calf. OR you ski park. The most common recommendation for bigger-legged skiers.

WORKHORSE → You are an Advanced or Expert skier. You have a high-volume shell, muscular build, and want maximum warmth. Only available to ability level 3–4.

Section 6: Key Design Notes
Shell is the #1 signal. The boot model and its last width in mm is the single most important input. All other signals (foot shape, ability, terrain) are secondary and act as refinements.

Fit problems are informational only. The fit problem question does not change the liner recommendation — it only adds contextual messaging on the results page (e.g. “Your liner helps with shin bang”).

Forefoot width and instep height are not scored. These questions collect data for context but do not affect the recommendation. ZipFit liners work across all forefoot widths.

Touring is a hard split. The Espresso is entirely gated by touring-primary = true. The quiz first asks if the user tours, then asks if they tour primarily. Only if both are true does the Espresso appear as a recommendation.

The Workhorse has a hard ability gate. It is invisible to beginners and intermediates.

All scores are relative. A score of 200 vs 180 is what matters — there is no minimum score threshold. The algorithm always outputs a winner as long as at least one liner has a non -999 score.
