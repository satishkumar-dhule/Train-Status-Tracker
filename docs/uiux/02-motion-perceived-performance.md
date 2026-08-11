# 02 — Motion, Micro-Interactions & Perceived Performance in Live-Data Interfaces

**Purpose.** Decide how motion should be used (and not used) in a live-train-status UI: loading states, live auto-refresh/status polling, and a station-tick route progress line. The core tension: animation improves perceived performance and communicates state, but repeated animation in polling UIs taxes attention and violates reduced-motion expectations.

**Method.** Literature sweep of peer-reviewed HCI (CHI, IJHCS, HCI journal, TVCG, VLDB, JCR), 2021–2026 with pre-2021 canonical foundations flagged; plus design-system and W3C guidance. Evidence is grouped into five questions, each ending in an application decision for this app.

---

## 1. Skeleton screens vs. spinners: which wins?

**Sources.**
- Mejtoft, T., Långström, A., & Söderström, U. (2018). *The effect of skeleton screens: Users' perception of speed and ease of navigation.* ECCE '18. DOI: 10.1145/3232078.3232086. [researchgate.net/publication/325830470](https://www.researchgate.net/publication/325830470). *(foundational)*
- NN/g (2023). *Skeleton Screens 101.* [nngroup.com/articles/skeleton-screens](https://www.nngroup.com/articles/skeleton-screens). *(foundational)*
- Khuc, Q. T., & Finamore, T. (2024). *Investigating the effects of different feedback combinations on perceived online wait time.* Drexel University (M.Sc.). DOI: 10.17918/00010606. *(thesis — non-peer-reviewed)*
- Kim, D. W., & Choe, J. H. (2025). *A Comparative Study on User Perception of Loading Microinteraction by Service Purpose: Focusing on the Progress Bar, Spinner, and Skeleton Screen.* Asia-Pacific Journal of Convergent Research Interchange (APJCRI), 11(10). DOI: 10.47116/apjcri.2025.10.28.
- Wang, Y., Huang, Y., Li, J., & Zhang, J. (2021). *The effect of mobile applications' initial loading pages on users' mental state and behavior.* Displays, 68, 102007. DOI: 10.1016/j.displa.2021.102007.
- Cheng, A., Ma, D., Qian, H., & Pan, Y. (2024). *The effects of mobile applications' passive and interactive loading screen types on waiting experience.* Behaviour & Information Technology, 43(8), 1652–1663. DOI: 10.1080/0144929X.2023.2224901.
- Li, W. (2025). *Enhancing User Experience during the Waiting Process: A Systematic Review of Loading Indicator Designs.* International Journal of Human–Computer Interaction. DOI: 10.1080/10447318.2025.2573834.
- Viget (2017). *A Bone to Pick with Skeleton Screens.* [viget.com/articles/a-bone-to-pick-with-skeleton-screens](https://www.viget.com/articles/a-bone-to-pick-with-skeleton-screens). *(foundational, industry)*

**Evidence.**
- The canonical study (Mejtoft et al., 2018) found users perceive skeleton screens as faster and report higher ease-of-navigation than progress bars; even though response times are actually equal. NN/g (2023) likewise reports skeleton screens are experienced as faster because they preview the destination layout, easing orientation — but warns they break on slow networks and offer no progress information.
- Skeletons are not a universal win. Wang et al. (2021) found the skeleton (static and animated) outperformed a spinner on perceived loading time and positive affect; Viget's critique — skeleton screens waste perception "credits" and provide little comfort on real slow loads — is echoed in the warning that a skeleton with no progress signal feels stuck on genuinely slow connections.
- The strongest 2021–2026 evidence is *combinations*. The Drexel study (Khuc & Finamore, 2024) found **skeleton + a looped animation** was the most effective combination for perceived load time; a **static skeleton** performed worse than expected, indicating the skeleton alone is not enough — it needs motion or a determinate element to signal liveness. This mirrors Material Design's guidance to use skeleton transitions with built-in motion, and the M3 rule that a static placeholder reads as frozen/broken.
- Cheng et al. (2024) show *interactive* loading screens (playful/participatory) beat passive ones on perceived waiting time and enjoyment, but they trade off against the "system status" honesty requirement — the app is waiting on the server, and interaction can over-promise.
- Kim & Choe (2025) found perception of the three indicator types varies by **service purpose** (content/information vs. utility), reinforcing that the "right" indicator depends on the waiting context.
- Li's 2025 systematic review of loading-indicator designs confirms that **progress-based and content-skeleton indicators generally outperform indeterminate spinners**, and that motion/sensory richness helps perceived duration but must be calibrated.

**Application.** For the run-date tab switch, load station tables with a **skeleton that mirrors the table layout (rows, station names, times) plus a quiet shimmer/looped sweep** — not a centered spinner, not a static skeleton. If a request stalls, transition the skeleton to an explicit determinate/error state after a threshold (~2–3 s) so users aren't left guessing. Reserve a plain spinner for very short in-place operations where re-layout would itself be noise.

---

## 2. Motion as a state communicator (loading vs. refreshing vs. stale vs. error)

**Sources.**
- García García, P., Costanza, E., Verame, J. K. M., Nowacka, D., & Ramchurn, S. D. (2021). *Seeing (Movement) is Believing: The Effect of Motion on Perception of Automatic Systems Performance.* Human–Computer Interaction, 36(1), 1–51. DOI: 10.1080/07370024.2018.1453815.
- Boyd, K., & Bond, R. (2021). *Can micro interactions in user interfaces affect their perceived usability?* ECCE '21, Siena, Article 40. DOI: 10.1145/3452853.3452865.
- Esmaeili, S., Kabir, S., Colas, A. M., Linder, R. P., & Ragan, E. D. (2022). *Evaluating Graphical Perception of Visual Motion for Quantitative Data Encoding.* IEEE Transactions on Visualization and Computer Graphics (VIS '22).
- Google. *Material Design 3 — Motion overview*, *Transitions: Skeleton loaders*, *Loading indicator guidelines*. [m3.material.io/foundations/motion](https://m3.material.io/foundations/motion).
- NN/g (2020). *The Role of Animation and Motion in UX.* [nngroup.com/articles/animation-purpose-ux](https://www.nngroup.com/articles/animation-purpose-ux). *(foundational)*
- Apple. *Human Interface Guidelines — Motion.* [developer.apple.com/design/human-interface-guidelines/motion](https://developer.apple.com/design/human-interface-guidelines/motion).

**Evidence.**
- García García et al. (2021) directly measure this: in a system-behaviour experiment, **motion signalling an automatic system's behaviour changed how competent and trustworthy participants judged it**. Motion is not decoration — it is a legibility channel for what an autonomous/system process is doing.
- Boyd & Bond (2021) A/B tested an app with vs. without micro-animations: overall SUS difference was not significant, but animated micro-interactions scored higher on integration (Q5), ease-of-use/cumbersomeness (Q8), learnability (Q10), and were rated more **interesting, likeable and pleasant** (UEQ). Conclusion: micro-interactions are "greater than the sum of their parts" — best used to communicate system status, confirm input, and guide, not as pure delight.
- NN/g (2020) is explicit: the only good reason to animate is to help users **understand the state of the interface**, especially transitions and causality. Material Design 3 and Apple HIG both prescribe distinct motion languages for loading, refreshing, and transitions; M3's loading indicators require that any loading indicator include **on-delay (200 ms min)** and **exit (off-screen) transitions**, and differentiate indeterminate vs. determinate.
- Esmaeili et al. (2022) caution that motion used to *encode data* (e.g., moving dots for quantities) can be misread and raises target-interpretation errors — motion should signal state, not carry precise numbers.

**Application.** Build one small motion vocabulary, reused everywhere:
- **Loading** = indeterminate shimmer/sweep inside the skeleton (with on-delay so flashes never appear).
- **Refreshing** = a subtle sweep across the table or a subdued refresh glyph rotation, always paired with a **LAST UPDATED timestamp** so liveness is stated, not just shown.
- **Fresh** = no motion at all; static data plus timestamp.
- **Stale/error** = a gentle, non-alarming indication (dimmed banner, warning tint) — avoid shake/red-flash in a low-criticality rail app.
- **Changed data** = a brief, one-time highlight (e.g., background tint fade on a new station time) to draw attention to *what* changed, not to the fact that a poll happened.
Do not encode values in motion (speed/distance) — Esmaeili et al. (2022).

---

## 3. Attention cost of repeated animation in polling / auto-refreshing UIs

**Sources.**
- McCrickard, S., Chewar, C., & McCreary, J. (2003). *A cost-benefit model of secondary task display use.* International Journal of Human-Computer Studies, 58(5), 499–545. DOI: 10.1016/S1071-5819(03)00022-3. *(foundational)*
- Tasse, D., Ankolekar, A., & Hailpern, J. (2016). *Getting Users' Attention in Web Apps in Likely-Unwanted Ways.* CHI '16, 2966–2974. DOI: 10.1145/2858036.2858174. *(foundational)*
- Apple. *HIG — Motion* (guidance to avoid motion on frequent interactions). [developer.apple.com/design/human-interface-guidelines/motion](https://developer.apple.com/design/human-interface-guidelines/motion).
- Ding, Y., & Kyung, N. (2025). *Standstill Bothers Me More Than Slow Movement: The Effect of the Speed of UI Animations on Perceived Waiting Time.* Journal of Consumer Research. DOI: 10.1093/jcr/ucae075.
- Tang, N., Fekete, J.-D., Gupta, N., & Parameswaran, A. (2023). *Transactional Panorama: A Conceptual Framework for User Interfaces for Live Data.* Proceedings of the VLDB Endowment, 16(8), 1494–1507. DOI: 10.14778/3587136.3587141.
- Wu, X., et al. (2020). *Predicting and Diagnosing User Engagement with Mobile UI Animation via a Data-Driven Approach.* CHI '20. DOI: 10.1145/3379337.3415752. *(foundational)*
- *In-Situ Adaptive Interfaces for Online Browsing: Design Dimensions for Intent-Responsive Automation and User Control.* (2026). IUI '26. DOI: 10.1145/3742413.3789092.
- W3C. *Understanding SC 2.2.2 Pause, Stop, Hide.* [w3.org/WAI/WCAG22/Understanding/pause-stop-hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide).

**Evidence.**
- McCrickard et al. (2003) is the canonical cost–benefit model of secondary displays: notification/glanceable UIs trade off attention against comprehension, and the design must pick a point on the spectrum — information you push repeatedly into peripheral vision is intrusive. Tasse et al. (2016, n=1505) measured which attention-grabbing techniques users find annoying in web apps: **motion/flashing is a consistent trigger of perceived annoyance**, especially when it recurs.
- Apple's guidance is blunt: avoid motion on frequent interactions — the more often an animation runs, the more it must be subordinated to the content.
- Ding & Kyung (2025) showed speed effects on perceived waiting time are **convex**: moderate speeds shorten perceived waits, but *extreme* speeds backfire — consistent with the idea that aggressive, repetitive motion reads as noise.
- Tang et al. (2023) frame live-data UIs (Transactional Panorama): users need **visibility** (what just changed, clearly), **consistency**, and **monotonicity** (never moving backward without an explicit signal). A live-updating table that animates every poll violates all three at once: it changes layout under the eye, muddies what changed, and can appear to "un-change" as data settles.
- Wu et al. (2020) found mobile UI animation drives engagement and "addiction"-like revisit patterns for marketing, but that same salience is a **cost** when the animation is ambient rather than user-initiated. The IUI '26 work on adaptive browsing interfaces reaches the same design position: automation that updates content must offer **user control** and intent-responsiveness — the user, not the loop, decides salience.

**Application.** For the live polling loop: **do not animate every poll**. Silent background refresh; show freshness only via the LAST UPDATED timestamp. Reserve motion for the rare consequential events — a station time that actually changed, a delay tag that appeared, a train status flip — using a single fade-tint highlight, not a pulse or bounce. Never let a poll cause layout shift; keep the table stable (Tang et al., 2023). Surface the staleness/error state statically so users can decide when to act. This is both a UX call (attention budget) and a WCAG 2.2.2 call (auto-updating content must be pauseable/hideable).

---

## 4. prefers-reduced-motion obligations (WCAG 2.2 & WCAG 3.0)

**Sources.**
- W3C. *Understanding SC 2.2.2 Pause, Stop, Hide* (Level A). [w3.org/WAI/WCAG22/Understanding/pause-stop-hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide).
- W3C. *Understanding SC 2.3.3 Animation from Interactions* (Level AAA). [w3.org/WAI/WCAG22/Understanding/animation-from-interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions).
- W3C. *WCAG 3.0 (W3C Working Draft)* — successor to WCAG 2.x, with a dedicated motion-accessibility workstream. [w3.org/TR/wcag-3.0](https://www.w3.org/TR/wcag-3.0).
- Apple. *HIG — Accessibility: Motion.* [developer.apple.com/design/human-interface-guidelines/accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).
- Google. *Material Design 3 — Motion for accessibility (Reduce motion, no large-motion patterns).* [m3.material.io/foundations/motion/accessibility](https://m3.material.io/foundations/motion/accessibility).
- MDN. *prefers-reduced-motion.* [developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).

**Evidence.**
- WCAG 2.2 **SC 2.2.2 Pause, Stop, Hide** (Level A) applies to *any* auto-updating, moving, blinking or scrolling content that starts automatically, lasts more than five seconds, and is presented in parallel with other content: the user must be able to pause, stop, or hide it (or control frequency). A live train table that refreshes itself with visible movement is squarely in scope, as is a repeating pulse or tick animation.
- WCAG 2.2 **SC 2.3.3 Animation from Interactions** (Level AAA): motion triggered by interaction must be suppressible unless it is essential. Essential = conveys the meaning of the action (e.g., a status change) — but even then, WCAG 3.0's working drafts are pushing motion toward a stronger requirement tied to vestibular safety, so the safer 2026 design posture is: no decorative/ambient motion at all, motion only to convey state.
- Every major design system now ships the mechanism: `@media (prefers-reduced-motion: reduce)` must switch animations off (or to fade-only) at the OS level. Apple HIG: "Respect the Reduce Motion setting" and "use animation to communicate, not to decorate." Material 3: motion must be reduced-able and must never be large-scale or essential to understanding.

**Application.** Ship `prefers-reduced-motion` handling from day one (media query around all animation, fades preserved where they carry state). Make the live tick, refresh sweep, skeleton shimmer, and status-pulse all collapse to static (timestamp + text) under reduced motion. Provide the user a manual **pause/refresh control** for the polling loop (satisfies SC 2.2.2's pause/frequency-control requirement, not just OS-level suppression). Plan for WCAG 3.0's stronger motion posture by keeping every animation *essential-or-absent*.

---

## 5. The animation-duration sweet spot

**Sources.**
- NN/g (2020). *Animation-Duration.* [nngroup.com/articles/animation-duration](https://www.nngroup.com/articles/animation-duration). *(foundational)*
- NN/g (2020). *The Role of Animation and Motion in UX.* [nngroup.com/articles/animation-purpose-ux](https://www.nngroup.com/articles/animation-purpose-ux). *(foundational)*
- Ding, Y., & Kyung, N. (2025). *Standstill Bothers Me More Than Slow Movement.* Journal of Consumer Research. DOI: 10.1093/jcr/ucae075.
- Khuc, Q. T., & Finamore, T. (2024). *Investigating the effects of different feedback combinations on perceived online wait time.* Drexel University. DOI: 10.17918/00010606.
- Cheng, A., et al. (2024). *The effects of mobile applications' passive and interactive loading screen types on waiting experience.* BIT 43(8). DOI: 10.1080/0144929X.2023.2224901.
- Esmaeili, S., et al. (2022). *Evaluating Graphical Perception of Visual Motion for Quantitative Data Encoding.* IEEE TVCG (VIS '22).
- Google. *Material Design 3 — Loading indicator guidelines* (200 ms on-delay; exit transitions). [m3.material.io/foundations/motion](https://m3.material.io/foundations/motion).

**Evidence.**
- The NN/g benchmark that governs most design systems: **100–500 ms** is the perceptual sweet spot for meaningful animation; 500–1000 ms feels slow; under 100 ms is imperceptible. It is the cited basis for M3's 200 ms minimum on-delay before any loading indicator appears (so fast loads never flash a loader).
- Ding & Kyung (2025) make it empirical: waiting-time perception follows a **U/convex curve** — slow-but-moving beats standing still, and extremely fast animation reduces the benefit. Users dislike stasis more than they dislike moderate slowness.
- Khuc & Finamore (2024) measured a **~230 ms** threshold for users to perceive a loading feedback as responsive — i.e., sub-200 ms states read as instant, and skeleton loops shorter than that are invisible. Cheng et al. (2024) find the perceived-wait benefit of rich loading states is real but saturates — longer, fancier loading can *increase* perceived wait.
- Esmaeili et al. (2022): when motion carries information, duration/speed of motion are interpreted inaccurately and slow-motion encoding increases error — duration is for feedback feel, not for data.

**Application.** Standardize three durations: **fast transitions ≤ 200 ms** (tab switch layout settle), **standard micro-interactions 200–400 ms** (refresh sweep, row-highlight fade), and **loading shimmer loop ~1 s** with a 200 ms on-delay (never show a loader for loads under ~200 ms). Avoid any ambient loop > 1 s (Ding & Kyung: extreme/perpetual motion backfires). Timestamps for liveness instead of perpetual motion.

---

## Top 5 transferable principles (for the live train-status app)

1. **Skeleton + looped sweep beats spinner for table loads; add a 200 ms on-delay and an explicit stale/error state.** Strongest direct evidence for the run-date tab switch and station-table loads (Mejtoft 2018; Khuc & Finamore 2024; Wang 2021; Li 2025; M3).
2. **Use motion to communicate state only — loading, refreshing, changed, stale — and never as decoration.** State machine for motion, one vocabulary everywhere (García García 2021; Boyd & Bond 2021; NN/g 2020; Apple; M3).
3. **Keep the polling loop silent.** No per-poll animation, no layout shift, no pulse; show freshness via LAST UPDATED timestamp and animate only consequential diffs. Give users pause/frequency control (McCrickard 2003; Tasse 2016; Tang 2023; IUI 2026; WCAG 2.2.2).
4. **Honor `prefers-reduced-motion` + WCAG 2.2 from day one**, with static equivalents for every animated state; design so no animation is ever essential to understanding (WCAG 2.2 SC 2.2.2/2.3.3; WCAG 3.0 draft trajectory; Apple; M3).
5. **Stay inside 100–500 ms for feedback motion, ~230 ms perceived-liveness floor, and never use perpetual ambient motion** — moderate, brief, purposeful (NN/g 2020; Ding & Kyung 2025; Khuc & Finamore 2024; Esmaeili 2022).

Research only — no code changes.
