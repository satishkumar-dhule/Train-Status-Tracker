# 08 · IA, Cognitive Load, and Mobile Decision Interfaces

**Purpose.** Evidence for re-architecting the live Indian Railways train-status web app (home/search → journey → monitoring). Users are frequently on mobile, often in a hurry at a station. This note answers five questions:

- (a) Progressive disclosure — what to show vs. collapse behind "all stations"
- (b) Cognitive-load reduction and chunking
- (c) Mobile layout/reading patterns — F/Z scanning, thumb zone, one-handed reach
- (d) Search→result flow length — single-page vs. multi-step, is fewer steps better
- (e) Minimalism — reducing chrome vs. information-loss tradeoffs

**Source policy.** Peer-reviewed papers (ACM CHI, ACM TiiS, IJHCS, Management Science, Springer LNCS/ISEM proceedings, IEEE, arXiv), the NN/g research library, and official design guidance (UK GDS, USWDS, Google Material). Claims are cited inline and backed in the [Reference list](#reference-list). A few pre-2021 works are included explicitly as *foundational anchors* because the recent evidence chains back to them; the dated 2021–2026 sources carry the argument.

**Current IA being evaluated.**

| Page | Current structure |
|---|---|
| Home/search | Big centered search card + separate "recents" list |
| Journey | Run-date tabs → data-source gateway dropdown → stacked cards (identity, journey summary stats, next-stop, progress bar, station timeline) |
| Monitoring ops | Ops page (secondary audience) |

---

## (a) Progressive disclosure

### Findings

**Progressive disclosure = show only the most important options first; offer the rest on request.** Nielsen's foundational treatment frames it as satisfying two conflicting demands — power vs. simplicity — and claims measurable benefit on three of the five usability components: *learnability, efficiency of use, and error rate* (Nielsen, 2006, "Progressive Disclosure," NN/g). Two operational criteria matter for a redesign:

1. **Get the primary/secondary split right.** Everything users frequently need must be on the initial display; the initial display must not contain confusing features. Use frequency-of-use data + observation to pick the split (Nielsen, 2006).
2. **Make the progression obvious, with strong "information scent"** — a clearly labelled control that sets expectations for what is behind it. Designs that go beyond **two disclosure levels** typically have low usability because users get lost moving between levels (Nielsen, 2006).

**Controlled, peer-reviewed evidence exists, and it is nuanced.** Springer & Whittaker ran two studies on *incremental vs. global* transparency (IUI 2019; journal version in ACM TiiS, 2020). Users *anticipated* that a more transparent, incrementally-revealed system would perform better, but **retracted that judgement after using it** — incremental detail proved distracting and undermined the simple working heuristics users build. They conclude users benefit from "initially simplified feedback that hides potential system errors" and that disclosure principles must be empirically motivated. This is direct evidence that *hiding detail by default improves task performance* rather than harming comprehension (Springer & Whittaker, 2019; 2020).

Recent HCI work confirms the mechanism in a high-stakes domain. Muralidhar, Belloum & Ashok (2025, *International Journal of Human-Computer Studies*) built AI clinical-decision-support interfaces using progressive on-demand disclosure and found it **helped users manage information load and follow the system's reasoning** — but the right level of transparency differed between clinicians, trainees, and lay users. Disclosure must be *calibrated* to the user and context, not applied uniformly.

**Official design guidance agrees, and adds a strong caveat.** Both major government design systems ship progressive-disclosure components *only under conditions*:

- UK GDS (GOV.UK Design System, "Accordion"): "Accordions hide content from the user. **Not all users will notice them or understand how they work.** ... you should only use them in specific situations and if user research supports it. **Do not use an accordion for content that all users need to see.** Test your content without an accordion first."
- USWDS ("Accordion"): use it "If users will only need a few specific pieces of content within a page" and "If you have only a small space to display a lot of content." Otherwise: "If users need to see most or all of the information on a page. Use well-formatted text instead." And explicitly: "**Accordions increase cognitive load and interaction cost because users have to make decisions about what headers to click on.**"

The same guidance distinguishes disclosure components: *details* (short, one-off), *accordion* (several related sections, multiple open at once), *tabs* (switching between sections without page reflow) — and warns not to nest them (GDS, 2024).

### Concrete application to this app

**Collapse the *full* station timeline behind one clearly-scented disclosure control, but never the next stop, progress bar, or current ETA.** On a mobile journey page, the "next stop + delay" fact is *content all users need*; per GDS/USWDS it must not be hidden. The remainder of a 40-station timeline is "a few specific pieces of content within a page" — the exact case where disclosure is justified. Use **exactly one extra level** (Nielsen: beyond 2 levels users get lost), label it with strong scent ("All 38 stations →"), and keep the run-date tabs + source gateway off the initial view by defaulting them (see §b, §d). Do not stack nested disclosures inside the timeline.

---

## (b) Cognitive-load reduction and chunking

### Findings

**Working memory is the binding constraint.** Cognitive-load theory (CLT) distinguishes *intrinsic* load (complexity inherent to the task), *extraneous* load (effort wasted on poor design), and *germane* load (useful mental work building understanding); the design lever is to cut extraneous load (Sweller, 1988; Sweller, van Merriënboer & Paas, 1998 — foundational anchors). Miller's classic "7±2" and Cowan's refinement to ~4 chunks bound what a user can hold at once (Miller, 1956; Cowan, 2001 — foundational anchors). Chen, Paas & Sweller (2023, *Educational Psychology Review*) modernise the theory as **element interactivity**: task complexity is a function of how many interacting elements must be processed simultaneously — the direct justification for breaking a 40-station journey into grouped, low-interactivity views.

**Recent evidence ties this directly to mobile apps and web UIs.** A systematic review (Jailani, Omar, Sharudin, Faudzi & Cob, 2025, Springer/KMICe) covering 2019–2024 concludes cognitive load in mobile apps degrades **learnability, efficiency, memorability, and satisfaction**, and that designing for load — chunking, reduced choices, clear hierarchy — is a first-class usability factor. A controlled experiment (Liao, 2025, IEEE ICID; N=225, three levels of visual complexity × task difficulty) found significant main effects of visual complexity on reaction time and cognitive load (e.g., cognitive load F(2,216)=115.03, p<.001) and on task difficulty, with **peak load under high-complexity/high-difficulty combinations** — i.e., clutter hits hardest exactly when the task is already demanding. For a user sprinting to platform 7, the journey page is a high-difficulty context: every extraneous element compounds the load.

**Chunking also has a positive form.** Grouping related items into coherent chunks respects Miller/Cowan limits and the Gestalt grouping the NN/g eye-tracking data demonstrates (people read *structure*, not walls — see §c). NN/g's own guidance is to chunk content into sections and bulleted lists and let headings do the scanning work (Pernice, 2019, "Text Scanning Patterns").

### Concrete application to this app

**Restructure the journey page into three cohesive chunks — "Train", "Where it is now", "Timeline" — and defer the implementation details that only add extraneous load at the moment of peak intrinsic load.** The **data-source gateway dropdown is the clearest extraneous-load offender**: it asks the user to make an *implementation* decision (which backend, which aggregation) at exactly the moment their real decision (is my train late?) is maximal. Auto-select the best source / fail over server-side, and at most expose it as a tertiary control. Keep each visible chunk within the 4±1 working-memory band: identity block (2–3 facts), status block (next stop, ETA, delay, progress — ≤4 facts), timeline (scrollable, grouped). Split the timeline into meaningful segments (e.g., "Upcoming", "Past") so any single screenful is low-interactivity.

---

## (c) Mobile layout, reading patterns, thumb zone

### Findings

**Scanning patterns hold on mobile — and are cost-minimising.** NN/g's 2017 replication of the F-pattern (Pernice, 2017, "F-Shaped Pattern of Reading on the Web: Misunderstood, But Still Relevant (Even on Mobile)") found the pattern **alive on phones as well as desktop**, plus a **"marking" pattern that occurs more on mobile** (eyes stay fixed on one spot while the thumb scrolls). This has a concrete consequence: a mobile user swiping through a long timeline with their eyes parked mid-screen will literally not see the row at the top of the screen. Key facts must be visually anchored — bolded, inside bordered groups — not just present somewhere on the page (Pernice, 2017; 2019). The F/Z distinction matters less than the underlying rule: **on unformatted text, users scan in an F and skip the right side of the page; strong formatting (headings, bullets, bolding, first-2-paragraph front-loading) is the antidote** (Pernice, 2017).

**Above the fold still dominates — especially for status-like content.** NN/g eyetracking across 120 participants / 130k fixations found 57% of viewing time above the fold and **74% in the first two screenfuls**; on search-results pages 47% of time went to the top 20% of the page and >75% to the top 40% (Schade, 2018, "Scrolling and Attention"). The same study flags **"false floors"** — clean minimalist designs where the layout ends so tidily that users never realise there is content below. The fold effect argues for putting the *answer* (next stop, delay) in the first viewport and for explicit scroll affordances.

**Thumb reach constrains where actions can live.** The definitive model of one-handed thumb reach (Bergstrom-Lehtovirta & Oulasvirta, 2014, CHI — foundational anchor) maps a reachable area that excludes top corners and the top edge on large phones. Recent work confirms the practical stakes: CHI 2025's GazeSwipe (Cai, Hong, Wang & Lu) documents large-screen one-handed reachability as an active problem, and a controlled study of **action-bar adaptations** (Mehrotra, Das & Zanwar, 2022, arXiv) found that placing actions at the top forces grip changes while **bottom-adapted UI was perceived as faster, more comfortable, and grip-safe**. A comparative study of navigation patterns found the **bottom bar achieved 99% task completion vs. 98% for a hamburger menu** and concluded the bottom bar was more effective for task completion (Irawan et al., 2024, IEEE ICBIR). Google Material's own guidance likewise places top-level navigation in a bottom navigation bar for mobile, in the thumb zone (Google Material, "Bottom navigation").

### Concrete application to this app

**On mobile: put the primary action (the search card's submit / "check status") and the journey page's primary facts in the bottom two-thirds — the thumb zone — and put the answer in the first screenful.** Concretely: home should be a single thumb-reachable search entry (no tall hero pushing the input out of reach); the journey page's top card should be the **next-stop + ETA + delay card** (left-anchored, bolded facts that survive F-scanning and the marking pattern), and the progress bar directly beneath it in viewport one. Long text rows (station names, times) should be formatted so the left-anchored scan finds the key value; keep the timeline's active row near the top of the visible list or visually emphasised so a thumb-swiping "marking" reader catches it.

---

## (d) Search→result flow length: single-page vs. multi-step

### Findings

**Fewer clicks is not the goal; cheaper clicks is.** NN/g's "3-click rule" is false as stated: "an arbitrary rule of thumb that is not backed by data" (Laubheimer, 2019). What matters is *interaction cost* — the sum of difficulty across each step. The companion guidance: keep key tasks one strong, well-scented step from the home page, and give multi-step paths clear hubs/wayfinding rather than more menu levels (Laubheimer, 2019; Nielsen, 2006).

**Removing steps does measurably help, in a rigorous quasi-experiment.** Unal & Park (2023, *Management Science*, peer-reviewed) used 35 months of retailer clickstream data before/after the introduction of **one-click buying** and found the step reduction **lifted purchases, purchase frequency, and item count per purchase**, persistently, without dragging on browsing. Reducing decision steps in a task-critical flow moves the needle.

**But "one page vs. many" is a false dichotomy.** Nielsen's original progressive/staged disclosure analysis of 46 web applications includes the canonical case: a hotel site that squeezed *everything* (room choice + payment) onto one screen. It worked well for the exploratory phase — room types, prices, dates are used **together**, with back-and-forth, so co-locating them on one screen is right — and badly for the independent payment step, which should have been staged onto a second screen. The lesson: **split on task interdependence, not on page count** (Nielsen, 2006). "1 screen vs. 5 screens" was never the real choice; the right answer was 2 screens.

**For search-like tasks specifically, the top-of-page effect is decisive.** NN/g eyetracking shows that on SERPs users concentrate on the top result band (47% of viewing time in the top 20%; "be #1 or #2 on Google, or you hardly exist"), and users pick the first credible-looking result ("Google gullibility") (Schade, 2018). Information scent determines whether a user continues — the result page must immediately confirm they found the right train (Pirolli & Card, 1999, information foraging — foundational anchor).

### Concrete application to this app

**Make search→answer a single, high-scent step: the query submits to a journey view whose first screenful *is* the answer.** The current journey page front-loads two *decisions* before the answer — a run-date tab and a data-source gateway. Both are independent steps that add interaction cost before the user sees status. Default the run date to "today" when the train runs today (with a small "other dates" control), remove the gateway decision entirely (server-side failover), and render the result with the status fact dominant. Do not page the journey into separate "summary" and "details" screens — those two views are used *together* (status + next stop + progress are interdependent), so co-locate them per the hotel-room lesson (Nielsen, 2006); only the low-frequency material (full station list, source provenance) goes behind disclosure (§a).

---

## (e) Minimalism: reducing chrome vs. information-loss tradeoffs

### Findings

**Minimalism works when it removes what doesn't support the task — and fails when it hides what users need.** NN/g's analysis of 112 minimalist sites (Moran, 2015) defines minimalism as "simplify interfaces by removing unnecessary elements or content that does not support user tasks," and pairs it with a flat-design warning: flat elements "often fail to communicate ... which elements are selectable or clickable." The companion article traces the lineage to Carroll's task-oriented minimalism — *brevity in service of getting the job done*, "getting the interface out of the way" — and explicitly warns: "minimalism for minimalism's sake alone doesn't help users," citing Windows 8 as the cautionary tale where stripping affordances increased complexity (Moran, 2015b). In short, minimalism reduces *visual* complexity; it must not increase *interaction* cost.

**The tradeoff is now quantified.** Liao (2025, IEEE) measured cognitive load across three visual-complexity levels: higher complexity raises reaction time and load, and the effect is strongest when the task is already hard. The reverse direction also has a cost: hiding content behind accordions **adds** cognitive load and interaction cost (users must decide what to open) — the USWDS guidance quoted in §a (USWDS, 2024). NN/g's scrolling data adds the "false floor" risk: an over-tidy minimal page looks finished and users stop scrolling, so hidden content is genuinely lost (Schade, 2018).

**Balanced position from the guidance systems.** Remove chrome, keep affordances; never hide content all users need (GDS, 2024; USWDS, 2024). Deferring too much also backfires — "if you divide the task into too many steps, users get bogged down by excess navigation" (Nielsen, 2006).

### Concrete application to this app

**Strip non-task chrome from home (decorative hero, redundant recents framing) and from the journey page, but treat the status answer itself as untouchable "must-see" content.** The information you may collapse behind disclosure is the *long tail*: the full station list, source provenance, historical stats. The information you must keep visible is everything a user checks in 5 seconds at a station — identity, current position, delay, next stop, ETA. In the same move, keep flatness from destroying affordances: the "All stations →" disclosure and run-date controls need obvious clickability (borders/underlines, not ghost links), and the journey page needs a visible continuation cue (partial-row peek of the timeline below the fold) to avoid a false floor.

---

## Synthesis: mapping evidence to the current IA

| Current element | Evidence verdict | Recommended move |
|---|---|---|
| Home: big centered search card + separate recents list | Thumb-zone work puts primary action bottom-half; recents list is low-frequency (hide/progressive) (§c, §a) | Single thumb-reachable search entry; "recent trains" collapsed behind a scented control or shown below the fold |
| Journey: run-date tabs | Independent, high-cost decision *before* the answer (§d, §b) | Default to today; promote only when train isn't running today |
| Journey: data-source gateway dropdown | Pure extraneous load at peak intrinsic load (§b); implementation decision users don't want to make | Remove from flow; server-side auto-select/failover; at most a tertiary control |
| Journey: stacked cards (identity → stats → next-stop → progress → timeline) | Co-locate interdependent status facts (✓) but respect fold + F/marking scan (§c, §d); timeline = disclosure candidate (§a) | Keep status card + progress in viewport 1 (thumb zone, left-anchored); full timeline behind one-scented disclosure; chunk timeline into segments (§b) |
| Monitoring ops page | Secondary audience; not on the hurried mobile path | Keep out of the mobile user's path entirely; gate behind a bottom-nav destination, not the journey flow |

---

## Top 5 transferable principles

1. **Show the answer, not the machinery.** Put the status fact — current position, delay, next stop, ETA — in the first screenful, in the thumb zone, left-anchored, bolded. Everything else is subordinate. (Schade, 2018; Pernice, 2017; Cai et al., 2025)
2. **Defer decisions the user didn't ask to make.** Auto-select run date and data source; never place an implementation choice (backend/gateway) in front of the answer. Cut extraneous cognitive load exactly when intrinsic load peaks. (Jailani et al., 2025; Liao, 2025; Nielsen, 2006)
3. **Chunk to the working-memory budget.** Cohesive groups of ≤4±1 facts; split the 40-station timeline into segments and grouped views; one screenful should never require processing the whole journey at once. (Miller, 1956; Cowan, 2001; Chen, Paas & Sweller, 2023)
4. **One well-scented step beats three blind clicks — and beats one cluttered page.** Split on task interdependence, not page count: status facts stay together, independent/low-frequency material gets staged or hidden behind clearly labelled disclosure. (Laubheimer, 2019; Unal & Park, 2023; Nielsen, 2006)
5. **Hide with evidence and a visible handle.** Collapse only what users "only need a few specific pieces of" — never content all users need — keep disclosure to one level with strong scent, and never let the design end in a false floor. (GDS, 2024; USWDS, 2024; Schade, 2018)

---

## Reference list

**Peer-reviewed / arXiv**

1. Cai, Z., Hong, J., Wang, Z., & Lu, F. (2025). *GazeSwipe: Enhancing Mobile Touchscreen Reachability through Seamless Gaze and Finger-Swipe Integration.* CHI '25: Proceedings of the 2025 CHI Conference on Human Factors in Computing Systems. https://dl.acm.org/doi/full/10.1145/3706598.3713739
2. Chen, O., Paas, F., & Sweller, J. (2023). *A Cognitive Load Theory Approach to Defining and Measuring Task Complexity Through Element Interactivity.* Educational Psychology Review, 35. https://doi.org/10.1007/s10648-023-09782-w
3. Cowan, N. (2001). *The magical number 4 in short-term memory: A reconsideration of mental storage capacity.* Behavioral and Brain Sciences, 24(1), 87–114. (Foundational anchor.)
4. Irawan, B., et al. (2024). *Bottom Bar vs Hamburger Navigational Menu Design: A Comparative Analysis in Coffee Shop Mobile Application Using the SUS Methodology.* 2024 9th International Conference on Business and Industrial Research (ICBIR), IEEE. https://doi.org/10.1109/ICBIR61386.2024.10875908
5. Jailani, A. S. C., Omar, R., Sharudin, S. A., Faudzi, M. A., & Cob, Z. C. (2025). *Understanding Cognitive Load's Effect on Mobile Application Usability: A Review.* In: Digital Innovation in Knowledge Management (KMICe 2024), Information Systems Engineering and Management 49, Springer, 334–345. https://doi.org/10.1007/978-3-031-91485-0_26
6. Liao, Q. (2025). *Cognitive Load in Web Interface Design: A Study Based on Visual Complexity and Task Difficulty.* 2025 6th International Conference on Intelligent Design (ICID), IEEE. https://doi.org/10.1109/ICID67979.2025.11351397
7. Mehrotra, S., Das, S., & Zanwar, S. (2022). *Action Bar Adaptations for One-Handed Use of Smartphones.* arXiv:2208.08734. https://arxiv.org/abs/2208.08734
8. Miller, G. A. (1956). *The magical number seven, plus or minus two: Some limits on our capacity for processing information.* Psychological Review, 63(2), 81–97. (Foundational anchor.)
9. Muralidhar, D., Belloum, R., & Ashok, A. (2025). *Operationalizing selective transparency using progressive disclosure in artificial intelligence clinical diagnosis systems.* International Journal of Human-Computer Studies. https://www.sciencedirect.com/science/article/pii/S107158192500148X
10. Pirolli, P., & Card, S. (1999). *Information foraging.* Psychological Review, 106(4), 643–675. (Foundational anchor.)
11. Springer, A., & Whittaker, S. (2019). *Progressive Disclosure: Designing for Effective Transparency.* IUI '19: Proceedings of the 24th International Conference on Intelligent User Interfaces. https://dl.acm.org/doi/10.1145/3301275.3302322
12. Springer, A., & Whittaker, S. (2020). *Progressive Disclosure: When, Why, and How Do Users Want Algorithmic Transparency Information?* ACM Transactions on Interactive Intelligent Systems (TiiS), 10(4). https://dl.acm.org/doi/full/10.1145/3374218
13. Sweller, J. (1988). *Cognitive load during problem solving: Effects on learning.* Cognitive Science, 12(2), 257–285. (Foundational anchor.)
14. Sweller, J., van Merriënboer, J. J. G., & Paas, F. G. W. C. (1998). *Cognitive architecture and instructional design.* Educational Psychology Review, 10, 251–296. (Foundational anchor.)
15. Unal, M., & Park, Y.-H. (2023). *Fewer Clicks, More Purchases.* Management Science, 69(12). https://doi.org/10.1287/mnsc.2023.4716
16. Bergstrom-Lehtovirta, J., & Oulasvirta, A. (2014). *Modeling the functional area of the thumb on mobile touchscreen surfaces.* CHI '14: Proceedings of the SIGCHI Conference on Human Factors in Computing Systems, 1991–2000. (Foundational anchor.)

**NN/g research library**

17. Laubheimer, P. (2019). *The 3-Click Rule for Navigation Is False.* Nielsen Norman Group. https://www.nngroup.com/articles/3-click-rule/
18. Moran, K. (2015). *The Characteristics of Minimalism in Web Design.* Nielsen Norman Group. https://www.nngroup.com/articles/characteristics-minimalism
19. Moran, K. (2015b). *The Roots of Minimalism in Web Design.* Nielsen Norman Group. https://www.nngroup.com/articles/roots-minimalism-web-design/
20. Nielsen, J. (2006). *Progressive Disclosure.* Nielsen Norman Group. https://www.nngroup.com/articles/progressive-disclosure/
21. Pernice, K. (2017). *F-Shaped Pattern of Reading on the Web: Misunderstood, But Still Relevant (Even on Mobile).* Nielsen Norman Group. https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/
22. Pernice, K. (2019). *Text Scanning Patterns: Eyetracking Evidence.* Nielsen Norman Group. https://www.nngroup.com/articles/text-scanning-patterns-eyetracking/
23. Schade, A. (2018). *Scrolling and Attention.* Nielsen Norman Group. https://www.nngroup.com/articles/scrolling-and-attention/

**Official design guidance**

24. UK Government Digital Service. (2024). *Accordion — GOV.UK Design System.* https://design-system.service.gov.uk/components/accordion/
25. U.S. Web Design System. (2024). *Accordion — USWDS.* https://designsystem.digital.gov/components/accordion/
26. Google Material Design. *Bottom navigation — Material Design 2.* https://m2.material.io/components/bottom-navigation

*Prepared: 2026-08-11. This note is research only; no code changes are proposed.*
