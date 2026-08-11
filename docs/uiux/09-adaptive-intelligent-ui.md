# 09 · Adaptive, Intelligent & Anticipatory Interfaces — Autonomy vs. User Control

**Purpose.** Evidence for re-architecting the live Indian Railways train-status web app (home/search → journey → monitoring). The re-architecture is considering five "intelligent" behaviors, each of which gives the system a degree of autonomy the user did not explicitly request:

- (a) Auto-landing on a recommended run date (predictive default)
- (b) Opt-in auto-refresh of live status (automatic content updating)
- (c) Smart-default data-source gateway (automatic provider selection)
- (d) Adaptive information density (condensed/dense by context)
- (e) Relevance-driven progressive disclosure (layering by importance)

This note asks one question per feature: *what does the evidence say the system is allowed to do on the user's behalf, and under what conditions?*

**Source policy.** Peer-reviewed papers (ACM CHI, CHI EA, IUI, AutomotiveUI, UbiComp, User Modeling and User-Adapted Interaction, Computer Science Review, Pervasive and Mobile Computing, Sensors), official standards (W3C WCAG 2.2, WAI-ARIA), and rigorous industry research (Nielsen Norman Group, Microsoft HAX Toolkit). Claims are cited inline and backed in the [Reference list](#reference-list). Pre-2021 works are included only as explicitly marked *foundational anchors*; the 2021–2026 sources carry the argument. This note is the design-research companion to [note 08](08-ia-cognitive-load.md) (progressive disclosure mechanics) and [note 07](07-trust-error-states.md) (trust and error states).

**Current IA being evaluated.**

| Page | Current structure | Autonomy candidates |
|---|---|---|
| Home/search | Big centered search card + separate "recents" list | Predictive default run date |
| Journey | Run-date tabs → data-source gateway dropdown → stacked cards (identity, journey summary stats, next-stop, progress bar, station timeline) | Auto-refresh; smart default source; density; relevance layering |
| Monitoring ops | Ops page (secondary audience) | Density by role; live refresh cadence |

---

## (a) Predictive defaults — auto-landing on the recommended run date

### Findings

**Defaults carry real behavioral weight.** Nielsen's canonical treatment (Nielsen, 2005, "The Power of Defaults," NN/g) reports the Cornell study by Joachims et al. (SIGIR 2005): in a controlled experiment, **42% of users clicked the top search hit; when the top two hits were secretly swapped, the top slot still drew 34%** — users follow the default position far more than pure relevancy would predict. Nielsen's conclusion for UI design: users "rarely utilize customization features," so *the default experience is the experience most users get*; set defaults to the most helpful/representative value, not the first value in a list. A default is therefore best used as *guidance*, not as a hidden decision.

**Personalization is a best guess — and users rarely control its assumptions.** Schade's NN/g research review (Schade, 2016, "6 Tips for Successful Personalization") is explicit: "Personalization is a best guess at what might be helpful to the user based on data analysis, but **past behavior does not always predict future actions**"; a wrong guess is a "frustrating experience that might annoy the user at every visit." She recommends personalizing *functionality* (remember recent/frequent selections, prefill) while (1) keeping all non-targeted content reachable ("provide an out"), and (2) letting users override — because "users rarely have any control over these assumptions." Applied to a run-date default: pre-select the *recommended* run, never restrict access to the others, and keep the override obvious.

**Proactive behavior must respect user agency — in peer-reviewed, in-window evidence.** Oh, Kim, Kim, Im & Lee (2024, CHI) studied proactive voice assistants that "predict users' needs and autonomously take action"; their Wizard-of-Oz smart-home study found that **asking rather than assuming** — communication that lets the user accept, modify, or reject the proposed action — is what preserves user agency and perceived control when the system cannot be certain. The transferable rule: *the less certain the prediction, the more it should be offered as a visible, rejectable suggestion rather than silently executed.* For a run date, certainty is genuinely limited (past schedules do not guarantee a train runs today); that is precisely the "ask, don't assume" zone.

**Autonomous navigation is a WCAG "change of context."** If "auto-landing" means redirecting or re-arranging the page without user action, WCAG 2.2 SC 3.2.5 *Change on Request* (Level AAA) requires that changes of context "are initiated only by user request or a mechanism is available to turn off such changes"; technique G76 ("providing a mechanism to request an update of the content instead of updating automatically") and failure F61 ("complete change of main content through an automatic update that the user cannot disable") define the compliant shape (W3C, 2023).

Microsoft's 18 Guidelines for Human-AI Interaction (Amershi et al., 2019, CHI — foundational anchor; operationalized in the HAX Toolkit) are directly on point: **"Show contextually relevant information," "Make clear why the system did what it did," "Remember recent interactions," "Convey the consequences of user actions," and "Provide global controls."**

### Concrete application to this app

Pre-select the recommended run date *as an active tab the user can see and change in one tap* — not a silent redirect. Show the reason in one line ("Train runs daily · today's 12:20 run"), keep every run date reachable from the same tab bar, and remember a manual override across sessions (Schade, 2016; Amershi et al., 2019, G12). This is a *predictive default*, not an *autonomous action*: no page navigation, no content re-arrangement that would trip WCAG 3.2.5, and the user retains an always-visible "out" (Oh et al., 2024; Nielsen, 2005).

---

## (b) Opt-in auto-refresh with frequency control

### Findings

**Auto-updating content has a normative control requirement.** WCAG 2.2 SC 2.2.2 *Pause, Stop, Hide* (Level A) states: for auto-updating information that starts automatically and is presented in parallel with other content, there must be "a mechanism for the user to **pause, stop, or hide it or to control the frequency of the update** unless the auto-updating is part of an activity where it is essential" (W3C, 2023). Its guidance for real-time *status* content (weather radar, tickers, traffic) is directly relevant to a live train page: pausing and *jumping to the current display* on resume is preferred over holding stale data — i.e., a "pause → live" refresh is the accessible shape for status pages. SC 2.2.1 *Timing Adjustable* (Level A) and failure F41 extend the same principle to `meta refresh` page reloads. Level A is the conformance baseline, so the auto-refresh candidate *requires* a pause/frequency control regardless of other UX arguments.

**Timing is a first-class design variable, and "opportune moment" is partly individual.** The largest published field test of update timing — Okoshi, Tsubouchi & Tokuda (2018, *Pervasive and Mobile Computing*, foundational anchor) — embedded interruptibility detection in the Yahoo! JAPAN Android app and ran 3 weeks with **>680,000 users**: deferring notifications until a detected "breakpoint" **reduced average user response time by 49.7%** and increased clicks and engagement. Chen, Chang & Chan (2022, CHI) confirmed opportune-moment prediction improves notification response in VR. Wang, Gupta & Martelaro (2025, AutomotiveUI) ran a four-session interruptibility study (22 participants, ~700 good/bad labels) and found users split into **four distinct availability profiles** (always available; prioritizing their task; task-content dependent; mental-state dependent), with gaze/head-pose the strongest predictors. Conclusion: there is no single correct refresh cadence or timing rule — it must be *user-controllable* and ideally *context-sensitive* (defer while the user is reading; refresh at natural pauses).

**Burst and frequency control is a UX failure mode, not just an accessibility one.** NN/g's review (Kendrick, 2018, "Five Mistakes in Designing Mobile Push Notifications") reports the 2018 Telefonica study (Pielot et al., MobileHCI, foundational anchor): the average user receives **56 notifications/day**; NN/g's mistakes #3 (sending bursts), #4 (irrelevant content), and #5 (making it hard to turn off) map one-to-one onto auto-refresh design, and the article stresses that settings are not an excuse for bad defaults because "most users don't bother customizing" (see also note 08's finding that users stick with defaults).

**Understandability is a precondition for accepting automation.** Eiband, Buschek & Hussmann (2021, IUI) argue users must be able to understand what an intelligent system does — including *when and why it updates itself* — as the basis for trust and control; unexplained automatic refresh erodes that basis (see also Amershi et al., 2019, G11 "Make clear why").

### Concrete application to this app

Make auto-refresh **opt-in and frequency-controlled** (e.g., off / every 30 s / 1 m / 5 m), with a manual **"Update now"** control always available (G76), satisfying WCAG 2.2.2's Level A frequency/pause mechanism. Ask for the permission only after the user has seen the page's value (NN/g mistake #1 — "reciprocity"), tell the user what will update and how often (NN/g mistake #2), announce updates accessibly with a polite live region (`role="status"`) rather than re-rendering the whole page, and defer refreshes while the user is actively reading the timeline (Okoshi et al., 2018; Wang, Gupta & Martelaro, 2025; Chen et al., 2022). The default cadence matters more than any offered option, because most users will keep it (Kendrick, 2018; Nielsen, 2005).

---

## (c) Smart-default data-source gateway

### Findings

**Choosing a default is legitimate; choosing silently is not.** The same defaults evidence applies as in (a): pre-selecting a recommended source is standard UI practice (Nielsen, 2005), but the *selection itself* is a consequential system decision the user must be able to see and override (Amershi et al., 2019, G11 "make clear why"; G17 "provide global controls").

**The 2021–2026 AUI literature consistently ties acceptance to user control and understanding.** Miraz, Ali & Excell (2021, *Computer Science Review*) survey adaptive user interfaces and universal usability and frame the central design axis as *adaptive* (system-driven) vs. *adaptable* (user-driven) — with automatic-only adaptation risking predictability and user agency. Wang, Khalajzadeh, Grundy, Madugalla, McIntosh & Obie (2023, *UMUAI*) systematically review adaptive UIs in chronic-disease monitoring systems and find recurring success factors of **user involvement and user understanding**; adaptations that users cannot influence or inspect erode trust. Brdnik, Heričko & Šumak (2022, *Sensors*) map 5,167 IUI articles and report that **evaluation of intelligent interfaces is often confined to development/pilot phases with no standardized process** — a warning that un-validated autonomous behavior (e.g., silently switching the data provider) is exactly the kind of feature that ships untested. Together these say: *automatic selection may be the default, but it must be visible, explainable, and overridable.*

### Concrete application to this app

Keep the gateway as a **server-side default choice with a visible, overridable surface** — consistent with note 08's recommendation to remove the gateway dropdown from the decision path — but surface the active source ("Live via NTES · last updated 09:41") and provide one-tap override and persistent memory of the user's choice. Degrade with a *visible* fallback notice rather than silently switching providers mid-session (see note 07 on trust/error states). This keeps the implementation detail out of the user's way (note 08) while honoring the user-control requirement the AUI literature returns to repeatedly (Miraz et al., 2021; Wang, Khalajzadeh et al., 2023; Amershi et al., 2019).

---

## (d) Adaptive information density

### Findings

**Density adaptation is common in monitoring UIs — and its success hinges on user control.** The UMUAI systematic review (Wang, Khalajzadeh et al., 2023) documents density/presentation adaptation as a recurring AUI technique in monitoring systems, with the recurring caveat that hiding raw detail erodes trust unless users can drill back down. The adaptive-vs-adaptable distinction from the AUI surveys (Miraz et al., 2021; Brdnik et al., 2022) applies directly: silently *reducing* what a user sees is a high-risk adaptation; making density a *user choice* (adaptable) is low-risk and always permitted.

**Minimalism is evidence-backed but bounded.** NN/g's heuristic "Aesthetic and minimalist design" (Nielsen, 1994, current version) and Schade's personalization review (2016) agree on the mechanism — extraneous information competes with relevant information — but Schade adds the critical boundary: **do not remove access** to content just because it is less likely to be needed; "users have different needs at different times." (Note 08's progressive-disclosure and cognitive-load findings — e.g., Springer & Whittaker 2019/2020 showing that hiding detail by default *improved* task performance — justify hiding; they do not justify making hidden data unreachable.)

### Concrete application to this app

Offer a **visible, remembered density switch** (condensed vs. dense) for the journey timeline and the ops page rather than silently adapting density. Default to condensed for the hurried mobile path (note 08), but ensure the dense view (full station timeline, all columns) is one tap away and the switch is not re-decided behind the user's back. Density is an *adaptable* control; it should not become an *autonomous* adaptation without evidence that a specific user benefits (Brdnik et al., 2022; Miraz et al., 2021).

---

## (e) Relevance-driven progressive disclosure

### Findings

**Relevance is the selection criterion; disclosure is the mechanism.** Amershi et al. (2019) guideline "Show contextually relevant information" names relevance as what the system should prioritize. Nielsen's progressive-disclosure treatment (2006, NN/g) and the peer-reviewed evidence reviewed in note 08 (Springer & Whittaker, 2019; 2020) show that layered presentation *improves* task performance when the split is right and the "more" path is clear. What the personalization and AUI evidence adds is that relevance ordering must never become relevance *restriction*: Schade (2016) cites the "Me / All" tab pattern as the model — a personalized, relevance-ordered view with an explicit switch to the complete set.

### Concrete application to this app

Layer the journey page by relevance — headline status fact first (delay, current position, next stop, ETA), then the station timeline, then run-date/source/advanced metadata — exactly as note 08's disclosure analysis prescribes, and keep an explicit path to "all" data. Relevance-driven ordering is safe; relevance-driven *removal* of run dates, sources, or timeline rows is not (Schade, 2016; Wang, Khalajzadeh et al., 2023). This is the one candidate feature with the least controversy in the evidence: the literature uniformly supports layered presentation with full access.

---

## Cross-cutting: consent, control, and the adaptive-vs-adaptable axis

**The single strongest in-window statement on this axis is the consent/control work.** Seymour, Alt, Benenson, Grimme, Karegar, Poikela, Rossi & Warner (2026, CHI EA) — "Moving Beyond Clicks: Rethinking Consent and User Control in the Age of AI" — argue that consent and control in intelligent systems are first-class interface problems: click-through is not consent, and control surfaces must be usable, accessible, and understandable. Microsoft's HAX Toolkit (2023–) operationalizes the 18 Guidelines (Amershi et al., 2019) into workbook and pattern materials, institutionalizing "provide global controls" and "convey consequences" as standard practice for AI product teams. Across every candidate feature above, the evidence converges on one design posture: **the system may propose, but the user disposes.** Autonomous action is acceptable when it is (1) the recommended *default* rather than a silent side effect, (2) visible and explainable, (3) reversible in one step, and (4) evaluated with real users before being trusted (Brdnik et al., 2022).

---

## Top 5 transferable principles

1. **User control is the price of autonomy.** Every autonomous behavior — auto-refresh, auto-landing, automatic source selection, density adaptation — must be opt-in (or a visible, rejectable default), reversible, and never remove access to data. This is both normative (WCAG 2.2.2 Level A for auto-updating content) and the consistent finding of the 2021–2026 literature. (W3C, 2023; Oh et al., 2024; Seymour et al., 2026; Wang, Khalajzadeh et al., 2023; Miraz et al., 2021)
2. **Timing and moderation of updates are first-class design variables — and are partly personal.** Defer non-urgent updates to opportune moments, control frequency, and never burst; the evidence is a large-scale field study (49.7% response-time reduction) plus in-window studies showing four distinct availability profiles. (Okoshi et al., 2018; Chen et al., 2022; Wang, Gupta & Martelaro, 2025; Kendrick, 2018; W3C, 2023)
3. **Defaults are powerful — encode the recommended choice and keep override one step away.** Users follow defaults (top-hit click rate 42%→34% even when relevance is equalized) and rarely customize; set the run-date and source defaults to the *recommended* value, show the reason, and remember overrides. (Nielsen, 2005; Schade, 2016; Amershi et al., 2019)
4. **Explain the "why" behind intelligent behavior.** Users must understand what the system did, why, and with what consequences before they can trust or control it. (Eiband et al., 2021; Amershi et al., 2019; Microsoft HAX Toolkit, 2023–; Wang, Khalajzadeh et al., 2023)
5. **Adaptive presentation must be evaluated and remain user-adaptable.** The IUI field's evaluation practice is a known gap; density/relevance adaptation should ship as *adaptable* (user-switchable) features validated with real users, keeping all data reachable. (Brdnik et al., 2022; Miraz et al., 2021; Wang, Khalajzadeh et al., 2023; Schade, 2016; Nielsen, 1994)

---

## Reference list

**Peer-reviewed / arXiv**

1. Amershi, S., Weld, D., Vorvoreanu, M., Fourney, A., Nushi, B., Collisson, P., Suh, J., Iqbal, S., Bennett, P. N., Inkpen, K., Teevan, J., Kikin-Gil, R., & Horvitz, E. (2019). *Guidelines for Human-AI Interaction.* CHI '19: Proceedings of the 2019 CHI Conference on Human Factors in Computing Systems. https://doi.org/10.1145/3290605.3300233 (Foundational anchor.)
2. Brdnik, S., Heričko, T., & Šumak, B. (2022). *Intelligent User Interfaces and Their Evaluation: A Systematic Mapping Study.* Sensors, 22(15), 5830. https://doi.org/10.3390/s22155830
3. Chen, K.-W., Chang, Y.-J., & Chan, L. (2022). *Predicting Opportune Moments to Deliver Notifications in Virtual Reality.* CHI '22: Proceedings of the 2022 CHI Conference on Human Factors in Computing Systems. https://doi.org/10.1145/3491102.3517529
4. Eiband, M., Buschek, D., & Hussmann, H. (2021). *How to Support Users in Understanding Intelligent Systems? Structuring the Discussion.* IUI '21: 26th International Conference on Intelligent User Interfaces. https://doi.org/10.1145/3397481.3450694
5. Miraz, M. H., Ali, M., & Excell, P. S. (2021). *Adaptive user interfaces and universal usability through plasticity of user interface design.* Computer Science Review, 40, 100363. https://doi.org/10.1016/j.cosrev.2021.100363
6. Oh, J., Kim, W., Kim, S., Im, H., & Lee, S. (2024). *Better to Ask Than Assume: Proactive Voice Assistants' Communication Strategies That Respect User Agency in a Smart Home Environment.* CHI '24: Proceedings of the CHI Conference on Human Factors in Computing Systems. https://doi.org/10.1145/3613904.3642193
7. Okoshi, T., Tsubouchi, K., & Tokuda, H. (2018). *Real-world large-scale study on adaptive notification scheduling on smartphones.* Pervasive and Mobile Computing, 50, 1–24. https://doi.org/10.1016/j.pmcj.2018.07.005 (Foundational anchor.)
8. Pielot, M., Vradi, A., & Park, S. (2018). *Dismissed! A Detailed Exploration of Mobile Email and Messaging Notifications.* MobileHCI '18: Proceedings of the 20th International Conference on Human-Computer Interaction with Mobile Devices and Services. https://doi.org/10.1145/3229434.3229445 (Foundational anchor.)
9. Seymour, W., Alt, F., Benenson, Z., Grimme, S., Karegar, F., Poikela, M. E., Rossi, A., & Warner, M. (2026). *Moving Beyond Clicks: Rethinking Consent and User Control in the Age of AI.* CHI EA '26: Extended Abstracts of the 2026 CHI Conference on Human Factors in Computing Systems. https://doi.org/10.1145/3772363.3778697
10. Springer, A., & Whittaker, S. (2019). *Progressive Disclosure: Designing for Effective Transparency.* IUI '19: Proceedings of the 24th International Conference on Intelligent User Interfaces. https://doi.org/10.1145/3301275.3302322
11. Springer, A., & Whittaker, S. (2020). *Progressive Disclosure: When, Why, and How Do Users Want Algorithmic Transparency Information?* ACM Transactions on Interactive Intelligent Systems (TiiS), 10(4). https://doi.org/10.1145/3374218
12. Wang, H. H., Gupta, J., & Martelaro, N. (2025). *Non-Emergency Notification Timing for Drivers Doing Non-Driving-Related Tasks in Autonomous Vehicles: An Interruptibility Study.* AutomotiveUI '25: 17th International Conference on Automotive User Interfaces and Interactive Vehicular Applications, 208–230. https://doi.org/10.1145/3744333.3747831
13. Wang, W., Khalajzadeh, H., Grundy, J., Madugalla, A., McIntosh, J., & Obie, H. O. (2023). *Adaptive user interfaces in systems targeting chronic disease: a systematic literature review.* User Modeling and User-Adapted Interaction. https://doi.org/10.1007/s11257-023-09384-9

**Standards & official guidance**

14. W3C. (2023). *Understanding WCAG 2.2 — Success Criterion 2.2.2 Pause, Stop, Hide (Level A).* https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
15. W3C. (2023). *Understanding WCAG 2.2 — Success Criterion 3.2.5 Change on Request (Level AAA).* https://www.w3.org/WAI/WCAG22/Understanding/change-on-request.html
16. W3C. *WAI-ARIA Authoring Practices Guide — Live Regions.* https://www.w3.org/WAI/ARIA/apg/patterns/live-regions/
17. W3C. *WAI-ARIA 1.2 — aria-live.* https://www.w3.org/TR/wai-aria-1.2/#aria-live

**NN/g research library**

18. Kendrick, A. (2018). *Five Mistakes in Designing Mobile Push Notifications.* Nielsen Norman Group. https://www.nngroup.com/articles/push-notification/
19. Nielsen, J. (1994; current version). *10 Usability Heuristics for User Interface Design.* Nielsen Norman Group. https://www.nngroup.com/articles/ten-usability-heuristics/
20. Nielsen, J. (2005). *The Power of Defaults.* Nielsen Norman Group. https://www.nngroup.com/articles/the-power-of-defaults/
21. Nielsen, J. (2006). *Progressive Disclosure.* Nielsen Norman Group. https://www.nngroup.com/articles/progressive-disclosure/
22. Schade, A. (2016). *6 Tips for Successful Personalization.* Nielsen Norman Group. https://www.nngroup.com/articles/personalization/

**Microsoft**

23. Microsoft. (2023–). *HAX Toolkit — Guidelines for Human-AI Interaction.* https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/

---

*Prepared: 2026-08-11. This note is research only; no code changes are proposed.*
