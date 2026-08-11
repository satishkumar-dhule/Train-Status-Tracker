# 04 · Data-Viz for Status, Progress & Timelines

**Purpose.** Evidence for presenting live status, progress, timelines, and operations data for at-a-glance comprehension in the re-architected Indian Railways live train-status web app. This note answers five questions:

- (a) Glanceability — what makes a display legible in a 5-second check at a station
- (b) Ordering and salience — where the "how late is it?" answer belongs, and what draws the eye
- (c) Progress-indicator design — continuous vs. discrete encodings, motion, perceived duration
- (d) Timeline & route viz — how to show scheduled vs. actual times, and when sparklines/small multiples help
- (e) Clutter vs. focus — decluttering, and replacing gauges/dials with linear encodings on the ops page

**Source policy.** Peer-reviewed papers (ACM CHI/DIS/UIST, IEEE TVCG, Journal of Vision, Elsevier, arXiv), the NN/g research library, and official US government data-visualization guidance (CDC COVE, USWDS). Claims are cited inline and backed in the [Reference list](#reference-list). The load-bearing evidence is 2021–2026; older works (Cleveland & McGill 1985, Myers 1985, Tufte 1990/2006, Few 2006/2013, Harrison et al. 2007/2010, Parsons & Tinkelman 2013) are flagged as *foundational anchors* because the recent findings chain back to them.

**Current surfaces being evaluated.**

| Surface | Current structure |
|---|---|
| Hero "where is the train now / how late" | Position + delay, card at top of journey page |
| Journey progress viz | Percent-done bar (distance/route-based) |
| Station-by-station timeline | Scheduled vs. actual times, stacked card |
| "Next stop + ETA" card | Part of the status card |
| Monitoring ops page (secondary audience) | Endpoint latency sparklines + provider health |

---

## (a) Glanceability and at-a-glance monitoring

### Findings

**"Glanceable" has a precise meaning: a display that supports awareness through brief, low-effort looks.** The canonical treatment defines glanceable/peripheral displays as those whose changes can be perceived without focused attention, so that a user can monitor a status from the corner of the eye or in a quick glance (Matthews et al., 2006, *Designing and Evaluating Glanceable Peripheral Displays*, DIS '06 — foundational anchor). For a railway status app the practical target is the "station sprint" glance: user looks at screen for a few seconds, gets one fact, pockets the phone.

**A dashboard's job is at-a-glance monitoring, not exploration.** Few's definition — a single-screen display of the most important information, understood at a glance, used for monitoring (Few, 2013, *Information Dashboard Design* 2nd ed. — foundational anchor) — and the NN/g treatment agree: "Dashboards are collections of data visualizations, presented in a single-page view that imparts at-a-glance information on which users can act quickly … not intended as expansive views of complex data." NN/g splits dashboards into **operational** (time-sensitive, continuously updating, for immediate decisions and spotting unacceptable deviations) vs. **analytical** (further thought and investigation) (Laubheimer, 2017). The train-status journey page is textbook *operational*: continuously updating data, time-sensitive decisions (wait? run? board?), immediate action. The ops page is operational for its own audience. Nothing on these pages should ask a user to "explore."

**The first glance reads global statistics; comparisons are slow and serial.** The strongest recent synthesis (Franconeri, Padilla, Shah, Zacks & Hullman, 2021, *The Science of Visual Data Communication: What Works*, Psychological Science in the Public Interest) reviews the perception literature: within a first glance viewers pull means, minimums, maximums, outliers, and global trends from positions, lengths, areas, slopes, and intensities — *fast and automatically*. But the second step, comparing values, is serial and capacity-limited: hundreds of milliseconds per comparison, only a handful per second, and interactions among roughly four variables at most. This is the core argument for making the critical status judgment a **single, preattentively readable fact** rather than something the user must compute by comparing chart marks.

**In eye-tracking, numbers are the primary focal point of attention.** A 2025 eye-tracking study of 60 participants viewing 1,216 real-world dashboards found that "Number" objects received the highest saliency coverage of all object types and were "the primary focal point of user visual attention" — driven by prominent features (larger/bolder type) and position directly under titles (Yang, Hou, Li, Chang & Zeng, 2025, *Dashboard Vision*, IEEE TVCG 31(10)). For a status app the headline implication: the delay figure is not "one more data point" — it is the one object the eye will find first if you design it to be found.

### Concrete application to this app

**Make the journey page's first-viewport hero a single operational fact: "Running 45 min late," with the number as the largest object on the screen.** Everything else (next stop, ETA, progress) is secondary context that reinforces or explains that one fact. Because the glance reads global statistics fast but comparisons slowly, do not ask the user to compare scheduled vs. actual visually in the hero — state the delta directly as a number and word ("45 min late"), reserving the side-by-side encoding for the timeline (§d). This matches the NN/g operational-dashboard definition: one screen, one answer, act on it.

---

## (b) Ordering, salience, and hero position

### Findings

**Attention is not uniform across a dashboard — it concentrates in the upper-left and falls off toward the lower-right.** Yang et al. (2025) aggregated all fixations and found "the user's attention is concentrated in the upper left corner … followed by the lower left corner and the upper right corner, and finally the lower right corner." They corroborate the well-known upper-left bias of prior UI work and the F-pattern from web reading, which NN/g replicated on mobile and found alive (Pernice, 2017). For a mostly-mobile audience the practical rule is the same as NN/g's F-pattern conclusion: put the key fact where the first fixations land and anchor it visually (bold, bordered), because scrolled content below is far less likely to be seen.

**Bigger objects hold attention; size and attention are correlated.** Yang et al. (2025) measured a significant positive correlation between object area and attention intensity (r = 0.75, p < .001): larger elements earn more dwell time. The hero number should be physically large, not just bold.

**Layout pattern changes where attention goes.** In the same study, four layouts behaved differently:

- **Stratified** (hierarchical, top-down) — highest saliency coverage of all layouts; attention flows down the hierarchy in logical order; numbers near the top get read first. Good for "important facts first."
- **Table** — attention decreases left→right and top→bottom; lowest saliency coverage; viewers focus on the first view.
- **Grouped** — the *grouped views* attract more attention than the (larger) main view, e.g. a map main view lost to smaller text-bearing panels around it.
- **Open** — attention declines left→right only; with no hierarchy, nothing is prioritized.

The actionable takeaway: an explicit hierarchical (stratified) order — headline number → supporting facts → detail — is the layout that spreads attention most predictably and keeps the primary fact dominant (Yang et al., 2025).

**People fixate on the labels, not the highlighted marks.** A striking Yang et al. (2025) result: when a bar in a chart was highlighted, users fixated on the *corresponding text label on the axis* rather than the highlighted bar itself; legends drew more attention than axes; and numbers/text were the top attention category overall. Design implication: do not rely on color-highlighting alone to convey the value — put the critical value in text where the eye already looks. This aligns with the older finding (Lohse, 1993, cited in Franconeri et al., 2021) that direct labels outperform legends: people answer questions about data faster and more accurately when data are labeled directly in the graph instead of mapped through a legend.

**Guiding the eye to the right comparison is itself a design act.** Franconeri et al. (2021) review evidence that color-highlighting a single group makes viewers process that comparison first and helps low-knowledge readers most (citing Ajani et al., 2021/2022; Grant & Spivey, 2003); practitioner guidance echoes it (Knaflic, 2015, *Storytelling with Data*). But the highlighting must carry one comparison, not several — multiple competing highlights undo the effect.

### Concrete application to this app

**Order the journey page as a stratified hierarchy: (1) delay number top-left and largest, (2) next stop + ETA as supporting facts, (3) progress and timeline below.** Do not give a map or other large decorative element "main view" status — Yang et al. (2025) show a big main view can *lose* attention to smaller text-bearing panels around it. Put the delay value in text (not only color), label station rows directly rather than through a legend, and use at most one highlight color on the timeline for "you are here."

---

## (c) Progress-indicator design: continuous vs. discrete, motion, and perceived duration

### Findings

**Percent-done indicators matter, and have since 1985.** Myers (1985, CHI — foundational anchor) showed that a percent-done indicator makes waits feel shorter, are preferred, and improve tolerance of long operations — the original empirical basis for progress feedback. The question for a train app is not *whether* to show progress but *how* to encode it.

**Continuous vs. discrete changes what "running out" feels like.** A 2025 Journal of Vision study (Kaur, Zhao & Ongchoco, 2025, VSS abstract) directly tested the current question: a timer bar that emptied *continuously* produced greater urgency (shorter inter-click latencies) than a bar segmented into *discrete chunks* that disappeared at regular intervals, and the effect reversed direction when the bar was *filling* rather than emptying. The authors conclude discreteness makes time feel more "manageable," reducing the sense of urgency. (Evidence caveat: single experiment, conference-abstract level.) Transfer to a journey: a **station-segmented** progress display (tick marks per station, chunks consumed as stations pass) reads as calmer and more manageable than a smooth continuously-draining bar; a continuous draining bar reads as more urgent. Choose by intent — reassurance for "your train is on its way" vs. urgency for "delay growing."

**Motion and speed profile change perceived duration — and the field does not fully agree.** Harrison, Yeo & Hudson (2010, CHI — foundational anchor) showed animated ribbing moving *backwards and decelerating* reduced perceived duration by ~11% and that non-constant progress behavior is more tolerated at the start (Harrison et al., 2007, UIST). A recent psychophysics study (Wang, Kang & Rau, 2022, arXiv:2211.13909) measured points of subjective equality with adaptive Bayesian methods and eye-tracking: the **constant-speed and speed-up** progress bars were perceived as *fastest*, and the *final* segment anchored duration judgments (an anchoring effect), with more cognitive demand correlating with longer perceived time. This sits uneasily against older work favoring decelerating or slow-to-fast profiles (Conrad et al., 2010; Villar et al., 2013, both reviewed in Wang et al., 2022). The robust, cross-study conclusions are: (i) perceived duration is manipulable by motion, (ii) the *end state* of the bar dominates perception, and (iii) extra perceptual/cognitive demands make waits feel longer. For a status display the safe move is: **avoid motion games entirely** — you are not hiding a loading wait; you are reporting a real state, and motion tricks would mislead.

**Mobile results are consistent about simple > decorated.** A 2024 mobile study (Nontasil & Tangmanee, 2024, *Journal of System and Management Sciences*, N=90, ages 20–29) found a ribbed-pattern bar felt faster than an unribbed bar on mobile, that a short bar was better than a long one, and that a plain progress circle (no ribbing) was the best-fit indicator for mobile waiting. The common thread: on small screens, simpler, smaller indicators read faster and less stressfully; a thick long animated bar is the worst choice.

**Animation is a working-memory hazard.** The PSPI review (Franconeri et al., 2021) warns that arbitrary object motion is trackable for only ~1–2 objects at a time and that animations strain working memory (the "transient information effect"); in a review of ~100 studies, animated diagrams did not beat labeled static diagrams for understanding, and in one experiment animated diagrams produced 20% errors vs. 5% for static diagrams (Kriz & Hegarty, 2007). Animation can also *inflate confidence* (Paik & Schraw, 2013). The one sanctioned use of animation is conveying sampling/uncertainty (Hullman et al., 2015; Kale et al., 2019, via Franconeri et al., 2021). So: a journey-progress bar should be a static segmented display; if anything moves, it should be the slowly-updating position marker on a static timeline, not a churning animated bar.

**The percent bar itself is a misleading encoding for a train journey.** Route-percent ignores that delays are a *time* offset, not a distance offset — a train 40% along the route can be 90 minutes late, and a train "99% complete" can sit outside the terminal for an hour. Every piece of evidence above says the encoding should reflect what the user actually needs to know: *which stations are passed, which remain, and how the clock is doing* — not an abstract percentage.

### Concrete application to this app

**Replace the percent-done bar with a discrete, station-segmented progress strip — one tick per station, the "you are here" marker on a static route line — paired with the numeric delay.** Segmentation keeps the display calm (Kaur et al., 2025) rather than urgent, the static layout avoids working-memory strain and confidence inflation (Franconeri et al., 2021), and the ticks make "how far along the *route*" (not the clock) legible at a glance. Keep it small and short (Nontasil & Tangmanee, 2024). Never animate the fill. If the design ever needs to express *urgency* of an unresolved state (e.g., "train stuck, delay growing"), that is the one case where a continuous or draining cue is defensible per the timer-bar finding — but that same finding says the normal state should not look urgent.

---

## (d) Timeline and route visualization

### Findings

**Linear horizontal is the default timeline shape for good reason.** The only controlled experiment isolating timeline shape (Di Bartolomeo, Pandey, Leventidis, Saffo, Syeda, Carstensdottir, Seif El-Nasr, Borkin & Dunne, 2020, CHI '20, N=192 crowdworkers, 4 shapes × 3 data types) found timeline shape **significantly affects completion time but not accuracy**, and that users have a strong preference for linear timelines. Non-linear shapes — especially spirals — were slowest for event lookup, and for cognitively harder tasks (comparing intervals) the authors explicitly recommend "a simple timeline design like the linear design." A station strip is exactly the "compare intervals" case (scheduled vs. actual spacing), so: keep the timeline a horizontal line. The earlier design-space survey (Brehmer, Lee, Bach, Riche & Munzner, 2017, *Timelines Revisited*, IEEE TVCG — an analysis of 263 timelines and their 14 design choices: representation, scale, layout, sorting, etc.) provides the vocabulary — a journey page is a linear-scale, category-sorted timeline with a narrative: "this is where you are, this is what remains."

**Scheduled vs. actual is an uncertainty-encoding problem, and uncertainty has evidence.** The most recent timeline-encoding study (Potter, Le, Syeda, Intille & Borkin, 2025, IEEE VIS 2025, N=81) compared encodings of temporal uncertainty on timelines and found participants were **more accurate when temporal uncertainty was encoded with transparency than with dashing** — and, importantly, that user *preference* did not always align with *performance*. Transfer to the train app: the *actual* position/time is inherently uncertain (a live estimate), while the *scheduled* time is a known reference point. Encode the known scheduled time as a firm discrete marker, and the uncertain actual as a continuous filled element/band whose transparency reflects confidence — and do not use dashed lines for "uncertain," however idiomatic that looks. Do not assume what users say they prefer is what they perform best with.

**Sparklines and small multiples earn their place for trends, not for exact values.** The only controlled evaluation of small-multiple sparklines (Parsons & Tinkelman, 2013, *International Journal of Accounting Information Systems*, 129 participants) found that one-page sparkline displays beat six-page tables at **pattern recognition, pattern comparison, and anomaly detection**, but performed *worse* at precise data lookup. Sparklines trade precision for density (Tufte, 2006, *Beautiful Evidence*, which introduced them — foundational anchor). The US government's data-viz guidance applies the same logic: use small multiples to keep cognitive load manageable, e.g., for line charts with more than five series, and keep scale consistent across panels so patterns are comparable (CDC COVE, 2026; USWDS, data visualizations component). Separately, for *trend comparison* tasks on phones, a static small-multiples design was faster than animation in a controlled mobile study (Brehmer, Lee, Isenberg & Choe, 2019, IEEE TVCG/VIS): small multiples completed 7 of 9 trend-comparison tasks faster than animation, with task-dependent accuracy. For an ops page, sparklines/small multiples are the right pattern for "is this endpoint degrading?" — with the current numeric value printed next to each sparkline to compensate for their weak point (precise lookup).

**Beware the memorability of cluttered layouts.** Borkin et al. (2013, *What Makes a Visualization Memorable?*, IEEE TVCG) found that factors including clutter hurt memorability of visualizations — a reminder that the timeline's job is not to be distinctive but to be read, and that visual noise around the "you are here" marker competes with it.

### Concrete application to this app

**Render the station timeline as a single horizontal line with direct per-station labels (station name + scheduled time) and one continuous "actual" overlay whose confidence is shown by transparency — never dashing.** Scheduled times are the firm baseline markers; the current actual position is a filled marker with transparency reflecting estimate confidence (Potter et al., 2025). Keep the shape linear (Di Bartolomeo et al., 2020) and the whole strip's scale consistent (CDC COVE, 2026). The exact ETA and delay stay as printed numbers beside the markers — sparklines-style density would serve trends, but the timeline must support precise lookup of "when does my train leave this stop," which requires direct numeric labels (Parsons & Tinkelman, 2013; Lohse, 1993).

---

## (e) Clutter vs. focus — and the case against gauges/dials

### Findings

**Declutter and focus are now empirically validated, not just practitioner folklore.** Ajani, Lee, Xiong, Nussbaumer Knaflic, Kemper & Franconeri (2022, *Declutter and Focus*, IEEE TVCG 28(10)) ran controlled experiments on the two most common practitioner prescriptions: decluttered designs were rated more **professional**, and adding *focus* (guiding the eye to one pattern) improved **aesthetics and clarity** ratings and — critically — **memory for the highlighted pattern**, measured by both redrawings and free-response recall. This is the strongest recent evidence that "less chrome + one emphasized thing" changes what users take away. It descends from Tufte's data-ink principle (Tufte, 1990, *Envisioning Information* — foundational anchor): maximize the ink carrying information, minimize everything else. The NN/g summary of the mechanism: on dashboards, *length and 2D position* are the preattentive encodings people read accurately; *angle and area* are read poorly; and color should carry *categories*, not magnitudes (Laubheimer, 2017, citing Cleveland & McGill, 1985, *Graphical Perception*, Science — foundational anchor).

**Gauges and dials fail exactly on those grounds — and this is old, settled guidance.** Cleveland & McGill's (1985) rank order puts angle and area near the bottom of accurate encoding channels; gauges encode one value as an *angle* and consume a lot of screen for very little information (Few, 2013; Few, 2006, *Rich Data, Poor Data*, Perceptual Edge whitepaper). NN/g states it plainly: circular visualizations "consume a lot of precious space on a dashboard and are also harder to interpret than linear graphs," and the gauge's radial form wastes space on the same information a linear bullet chart communicates better (Laubheimer, 2017). Few's recommended replacement is the **bullet graph** — a linear, length-encoded bar with target and range bands — which fits in a fraction of the space (Few, 2006/2013). There is no 2021–2026 empirical study that resurrects gauges; every recent treatment of dashboard patterns treats radial gauges as the anti-pattern (Bach, Freeman & Abdul-Rahman, 2023, *Dashboard Design Patterns*, IEEE TVCG 29(1), cataloguing design patterns for dashboards).

**One highlight, not many.** Franconeri et al. (2021) review color-highlighting as a way to direct the first comparison, but the effect is for *a single group*. Yang et al. (2025) add the eye-tracking nuance: color-coded regions do draw attention (maps and area charts captured broad attention) while multimedia objects captured the *least* attention of all object types — i.e., decorative/fancy widgets are where attention goes to die. So: restrained color, one emphasized pattern, and no decorative flash.

### Concrete application to this app

**On the ops page, replace any gauge/dial representation of latency or provider health with linear bullet charts and per-endpoint sparklines (with current value printed), all on a consistent scale.** Latency-as-length is read preattentively; latency-as-needle-angle is not (Cleveland & McGill, 1985; Laubheimer, 2017; Few, 2013). Use small-multiple sparklines for the trends, with the current numeric latency printed beside each (Parsons & Tinkelman, 2013; Brehmer et al., 2019; CDC COVE, 2026). Reserve the single highlight color for the *one* degraded endpoint (Ajani et al., 2022; Franconeri et al., 2021) — every other panel stays muted, because more than one emphasized thing is no emphasis. And across the whole app: no 3D, no pie/donut/radial gauges for quantitative values, no decorative animation (Laubheimer, 2017; Tufte, 1990; Franconeri et al., 2021).

---

## Synthesis: mapping evidence to the current surfaces

| Current element | Evidence verdict | Recommended move |
|---|---|---|
| Hero "where / how late" | Numbers are the highest-attention object; upper-left + size drive attention (Yang et al., 2025) | Delay figure = largest text object, top-left; state the delta as a number + word; never force scheduled-vs-actual comparison in the hero |
| Journey progress viz (percent bar) | Percent mis-encodes time-vs-distance; continuous motion reads urgent and strains working memory (Kaur et al., 2025; Franconeri et al., 2021; Wang et al., 2022) | Discrete station-segmented strip with static "you are here" marker; no fill animation; small footprint |
| Station-by-station timeline (scheduled vs. actual) | Linear shape best for comparison tasks; transparency > dashing for temporal uncertainty; direct labels beat legends (Di Bartolomeo et al., 2020; Potter et al., 2025; Lohse, 1993) | Single horizontal line; scheduled = firm discrete markers, actual = filled overlay with transparency = confidence; station names + scheduled times printed directly |
| "Next stop + ETA" card | Keep facts co-located and directly labeled; glance reads global stats fast, comparisons slow (Laubheimer, 2017; Franconeri et al., 2021) | Keep in viewport one under the hero number; exact ETA as printed text, not a chart you must decode |
| Ops page (latency sparklines + provider health) | Length encodes best; angle/area poorly; sparkline small-multiples support trend/anomaly reading but not precise lookup; one highlight only (Cleveland & McGill, 1985; Few, 2013; Parsons & Tinkelman, 2013; Brehmer et al., 2019; Ajani et al., 2022) | Bullet charts + sparklines with printed current values on a consistent scale; single highlight color for the degraded endpoint; no gauges/dials |

---

## Top 5 transferable principles (ranked by evidence strength)

1. **Lead with the number, in the upper-left, made large.** "Number" objects are the primary focal point of dashboard attention; attention is biased to the upper-left; object size correlates with attention (r ≈ 0.75); and length/2D position are the encodings people read accurately. The delay figure is the hero. (Yang et al., 2025; Cleveland & McGill, 1985; Laubheimer, 2017)
2. **One glance, one question — declutter the page and focus the eye on a single comparison.** Decluttered designs read as more professional and focused designs measurably improve memory for the emphasized pattern; guiding attention to the critical comparison is the highest-leverage design act. (Ajani et al., 2022; Franconeri et al., 2021)
3. **Show scheduled vs. actual on one linear timeline with direct labels; never a legend and never dashing.** Linear timelines beat circular/spiral for comparison tasks; direct labels beat legends for speed and accuracy; transparency encodes temporal uncertainty more accurately than dashing, and preference ≠ performance. (Di Bartolomeo et al., 2020; Lohse, 1993; Potter et al., 2025)
4. **Keep motion out of the status signal.** Continuous draining encodings manufacture urgency, animation strains working memory and inflates confidence, and the bar's final segment anchors perceived duration — so report state with a static, discrete, segmentable encoding and reserve any animation for genuine uncertainty. (Kaur et al., 2025; Franconeri et al., 2021; Wang et al., 2022)
5. **Encode quantities with length/position, not angle/area — bullet charts + sparkline small multiples for the ops page.** This is the most stable, best-consensus result in the field (rankings have held since 1985) and the empirically-supported pattern for trend monitoring; sparklines support trend and anomaly detection, so pair them with printed current values for precision. (Cleveland & McGill, 1985; Few, 2013; Laubheimer, 2017; Parsons & Tinkelman, 2013; Brehmer et al., 2019)

## Caveats & unverified claims

- **Do not cite "NN/g: removing chart junk raised task completion 33%."** That figure circulates only on second- and third-hand aggregators and could not be traced to a primary NN/g study during this research. Use the peer-reviewed evidence instead: Ajani et al. (2022) for declutter/focus effects.
- **Progress-bar speed-profile findings conflict across studies.** The 2022 finding (constant/speed-up fastest) contradicts older deceleration-friendly results (Conrad et al., 2010; Villar et al., 2013). This is why this note recommends *static* status encoding rather than picking a "winning" motion profile.
- **Kaur et al. (2025)** is a single conference-abstract study (VSS); treat the discrete-vs-continuous urgency finding as directional, not settled.
- **Parsons & Tinkelman (2013)** uses accounting students as proxies for non-expert readers; the pattern holds for trend/anomaly tasks and failed for precise lookup, which is the precise reason direct numeric labels are recommended alongside sparklines.

---

## Reference list

**Peer-reviewed / arXiv**

1. Ajani, K., Lee, E., Xiong, C., Nussbaumer Knaflic, C., Kemper, W., & Franconeri, S. (2022). *Declutter and Focus: Empirically Evaluating Design Guidelines for Effective Data Communication.* IEEE Transactions on Visualization and Computer Graphics, 28(10), 3351–3364. https://doi.org/10.1109/TVCG.2021.3068337
2. Bach, B., Freeman, E., & Abdul-Rahman, A. (2023). *Dashboard Design Patterns.* IEEE Transactions on Visualization and Computer Graphics, 29(1), 342–352. https://doi.org/10.1109/TVCG.2022.3209448
3. Borkin, M. A., Vo, A. A., Bylinskii, Z., Isola, P., Sunkavalli, S., Oliva, A., & Pfister, H. (2013). *What Makes a Visualization Memorable?* IEEE Transactions on Visualization and Computer Graphics, 19(12), 2306–2315. https://doi.org/10.1109/TVCG.2013.234
4. Brehmer, M., Lee, B., Bach, B., Riche, N. H., & Munzner, T. (2017). *Timelines Revisited: A Design Space and Considerations for Expressive Storytelling.* IEEE Transactions on Visualization and Computer Graphics, 23(12). https://doi.org/10.1109/TVCG.2016.2614803
5. Brehmer, M., Lee, B., Isenberg, P., & Choe, E. K. (2019). *A Comparative Evaluation of Animation and Small Multiples for Trend Visualization on Mobile Phones.* IEEE Transactions on Visualization and Computer Graphics (Proc. IEEE VIS 2019). https://doi.org/10.1109/TVCG.2019.2934397
6. Cleveland, W. S., & McGill, R. (1985). *Graphical Perception and Graphical Methods for Analyzing Scientific Data.* Science, 229(4716), 828–833. https://doi.org/10.1126/science.229.4716.828 (Foundational anchor.)
7. Di Bartolomeo, S., Pandey, A., Leventidis, A., Saffo, D., Syeda, U. H., Carstensdottir, E., Seif El-Nasr, M., Borkin, M. A., & Dunne, C. (2020). *Evaluating the Effect of Timeline Shape on Visualization Task Performance.* CHI '20: Proceedings of the 2020 CHI Conference on Human Factors in Computing Systems, 1–12. https://doi.org/10.1145/3313831.3376237
8. Franconeri, S. L., Padilla, L. M., Shah, P., Zacks, J. M., & Hullman, J. (2021). *The Science of Visual Data Communication: What Works.* Psychological Science in the Public Interest, 22(3), 110–161. https://doi.org/10.1177/15291006211051956
9. Harrison, C., Amento, B., Kuznetsov, S., & Bell, R. (2007). *Rethinking the Progress Bar.* UIST '07: Proceedings of the 20th Annual ACM Symposium on User Interface Software and Technology, 115–118. (Foundational anchor.)
10. Harrison, C., Yeo, Z., & Hudson, S. E. (2010). *Faster Progress Bars: Manipulating Perceived Duration with Visual Augmentations.* CHI '10: Proceedings of the SIGCHI Conference on Human Factors in Computing Systems, 1545–1548. https://doi.org/10.1145/1753326.1753556 (Foundational anchor.)
11. Kaur, J., Zhao, J., & Ongchoco, J. D. K. (2025). *Discrete vs. continuous timer bars: How visual segmentation shapes the perception of time "running out".* Journal of Vision, 25(9), 2292 (Vision Sciences Society annual meeting abstract). https://doi.org/10.1167/jov.25.9.2292
12. Matthews, T., Rattenbury, T., Carter, S., Dey, A. K., & Mankoff, J. (2006). *Designing and Evaluating Glanceable Peripheral Displays.* DIS '06: Proceedings of the 6th Conference on Designing Interactive Systems. https://doi.org/10.1145/1142405.1142457 (Foundational anchor.)
13. Myers, B. A. (1985). *The Importance of Percent-Done Progress Indicators for Computer-Human Interfaces.* CHI '85: Proceedings of the SIGCHI Conference on Human Factors in Computing Systems, 11–17. https://doi.org/10.1145/317456.317459 (Foundational anchor.)
14. Nontasil, P., & Tangmanee, C. (2024). *Investigating the Impact of Progress Indicator Design on User Perception of Delay.* Journal of System and Management Sciences, 14(4), 333–344. https://doi.org/10.33168/JSMS.2024.0421
15. Parsons, L. M., & Tinkelman, D. (2013). *Testing the feasibility of small multiples of sparklines to display semimonthly income statement data.* International Journal of Accounting Information Systems, 14(1), 58–76. https://doi.org/10.1016/j.accinf.2012.09.001 (Foundational anchor.)
16. Potter, V., Le, H., Syeda, U. H., Intille, S., & Borkin, M. (2025). *An Evaluation of Temporal and Categorical Uncertainty on Timelines: A Case Study in Human Activity Recall Visualizations.* IEEE VIS 2025 / IEEE Transactions on Visualization and Computer Graphics.
17. Sarikaya, A., Correll, M., Bartram, L., Tory, M., & Fisher, D. (2019). *What Do We Talk About When We Talk About Dashboards?* IEEE Transactions on Visualization and Computer Graphics, 25(1), 682–692. https://doi.org/10.1109/TVCG.2018.2864903
18. Wang, Q., Kang, X., & Rau, P.-L. P. (2022). *The Magic of Slow-to-Fast and Constant: Evaluating Time Perception of Progress Bars by Bayesian Model.* arXiv:2211.13909. https://doi.org/10.48550/arXiv.2211.13909
19. Yang, M., Hou, Y., Li, L., Chang, X., & Zeng, W. (2025). *Dashboard Vision: Using Eye-Tracking to Understand and Predict Dashboard Viewing Behaviors.* IEEE Transactions on Visualization and Computer Graphics, 31(10). https://doi.org/10.1109/TVCG.2025.3532497

**NN/g research library**

20. Laubheimer, P. (2017). *Dashboards: Making Charts and Graphs Easier to Understand.* Nielsen Norman Group. https://www.nngroup.com/articles/dashboards-preattentive/
21. Pernice, K. (2017). *F-Shaped Pattern of Reading on the Web: Misunderstood, But Still Relevant (Even on Mobile).* Nielsen Norman Group. https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/

**Books / practitioner**

22. Few, S. (2013). *Information Dashboard Design: Displaying Data for At-a-Glance Monitoring* (2nd ed.). Analytics Press. (Foundational anchor.)
23. Few, S. (2006). *Rich Data, Poor Data: Designing Dashboards to Inform.* Perceptual Edge whitepaper. https://www.perceptualedge.com/articles/Whitepapers/Rich_Data_Poor_Data.pdf (Foundational anchor.)
24. Tufte, E. R. (1990). *Envisioning Information.* Graphics Press. (Data-ink ratio; foundational anchor.)
25. Tufte, E. R. (2006). *Beautiful Evidence.* Graphics Press. (Sparklines; foundational anchor.)
26. Knaflic, C. N. (2015). *Storytelling with Data: A Data Visualization Guide for Business Professionals.* Wiley. (Highlighting guidance as reviewed in Franconeri et al., 2021.)

**Official / government guidance**

27. CDC. (2026). *Small Multiples — COVE Data Visualization Types.* U.S. Centers for Disease Control and Prevention. https://www.cdc.gov/cove/data-visualization-types/small-multiples.html
28. U.S. Web Design System. *Data visualizations.* General Services Administration. https://designsystem.digital.gov/components/data-visualizations/

*Prepared: 2026-08-11. This note is research only; no code changes are proposed.*
