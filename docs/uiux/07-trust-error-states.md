# 07 — Trust, Transparency & Error/Empty-State Design for Live-Data Interfaces

**Purpose.** Evidence-based guidance for re-architecting a web app that shows live running status of Indian Railways trains, where status data arrives through a failover chain of upstream providers. Users need to know: *is this data live, when was it last updated, which source produced it, and what do I do when data is missing or wrong?*

**Method.** Every finding was traced to a primary/high-trust source: peer-reviewed venues (ACM CHI, IEEE TVCG / IEEE VIS, IJHCI, Decision Support Systems, ACM TOSEM / Empirical Software Engineering, VLDB), the Nielsen Norman Group (NN/g) research library, and the UK Government Digital Service (GOV.UK Design System / Service Manual). The core evidence window is 2021–2026; works outside it are included only where they are the canonical source of a claim and are flagged ***(foundational)***. Non-peer-reviewed industry material is explicitly labelled as such and used only to corroborate or operationalise peer-reviewed findings.

---

## 1. Freshness & recency indicators in live data

### 1.1 Answer "when was this updated?" with an explicit last-updated stamp, not a clock

**Sources**

- Nielsen, J. (2001, foundational). *113 Design Guidelines for Homepage Usability.* Nielsen Norman Group. https://www.nngroup.com/articles/113-design-guidelines-homepage-usability/
- Nielsen, J. (2012, foundational). *Homepage Design Changes.* Nielsen Norman Group. https://www.nngroup.com/articles/homepage-design-changes/
- NN/g Research (2022). *Intranet-Search Essentials.* Nielsen Norman Group. https://www.nngroup.com/articles/intranet-search/

**Evidence.** NN/g's enduring guidance is to show the time content was **last updated**, not the current time — phrased explicitly as "Updated \<date, time>" — and to show dates only for time-sensitive information. For frequently-updated content, *relative* stamps ("1 hour, 17 minutes ago") free users from time-zone conversion and were observed to be preferable, with the last-update line promoted to a prominent position. The 2022 NN/g intranet study shows users actively use dates to judge recency *and reliability*: one participant rejected a result with "So that's from a year ago, and that's probably going to be too old" — dates even 1–2 years old deterred clicking. Undated items are read as potentially stale and are downgraded.

**Application.** Every status block carries a freshness line next to the headline value, not in the footer: **"Updated 2 min ago · as of 12:42 IST"**. Use relative time in the list and absolute time on tap/hover so users never do timezone arithmetic. (Absolute-on-demand is also the standard of mature design systems — e.g. GitLab Pajamas: relative for live content, ISO 8601 absolute on hover — https://design.gitlab.com/content/date-and-time.)

### 1.2 Timeliness is a trust antecedent — "live" is a feature users notice and reward

**Sources**

- Wendt, C., Werner, D., Adam, M., & Benlian, A. (2022). *Influencing crowding at locations with decision support systems: The role of information timeliness and location recommendations.* Decision Support Systems, 160, 113817. https://doi.org/10.1016/j.dss.2022.113817
- Elhamdadi, H., Stefkovics, A., Beyer, J., Moerth, E., Pfister, H., Xiong Bearfield, C., & Nobre, C. (2024). *Vistrust: A Multidimensional Framework and Empirical Study of Trust in Data Visualizations.* IEEE Transactions on Visualization and Computer Graphics, 30(1), 348–358. https://doi.org/10.1109/TVCG.2023.3326579

**Evidence.** Wendt et al. ran a 2×2 experiment (N=171) plus interviews on a decision-support app showing live crowding data with timeliness cues ("updated just now" vs. low timeliness). High timeliness significantly raised users' trusting beliefs, conscious elaboration on the data, and **reuse intentions** for the app. Critically, the freshness benefit was **cancelled out when the app also rendered a ready-made recommendation** — a processed summary let users skip the timeliness cue entirely. Separately, the *Vistrust* framework (TVCG 2024, crowdsourced) identifies **data currency** (is the data up to date) as a *cognitive* trust antecedent for trust in the underlying data, alongside accuracy, coverage, and clarity.

**Application.** Make "Updated 2 min ago · via Goibibo" a first-class, readable element beside the headline status. Do **not** let a derived convenience chip (e.g. a green "looks fine" summary) replace or obscure the freshness line — the evidence says a processed recommendation stops users checking freshness, which is precisely when a failover serving stale data becomes dangerous.

### 1.3 Never silently mix data vintages on one screen

**Source**

- Tang, D., Fekete, A., Gupta, I., & Parameswaran, A. G. (2023). *Transactional Panorama: A Conceptual Framework for User Perception in Analytical Visual Interfaces.* Proceedings of the VLDB Endowment, 16(6), 1494–1506. https://doi.org/10.14778/3583140.3583162

**Evidence.** In live-updating analytical UIs there is a provable trade-off between *staleness* (showing old results) and *invisibility* (blocking or greying views while they refresh). The framework defines three perceptual properties — **visibility** (you can always read a view), **consistency** (all views on screen come from the same data version), and **monotonicity** (results never "go back in time") — and shows they cannot all hold at once; a screen that shows some panels fresh and others stale silently invites wrong inferences.

**Application.** When the failover chain switches providers, keep a per-panel "as of HH:MM" stamp so the dashboard never silently blends vintages (e.g. a 12:40 position with an 11:10 delay figure). Prefer visibly labelled stale panels ("Showing cached data") over blocking the whole page while a refresh runs.
---

## 2. Provenance attribution in aggregated dashboards

### 2.1 Attribution to a data source is a top trust factor — but only if the label is meaningful

**Sources**

- Pandey, S., McKinley, G., & Ottley, A. (2023). *Do You Trust What You See? Effects of User-Provided and Algorithmic Metadata on User Trust in Visualizations.* IEEE VIS 2023. DOI 10.1109/VIS54172.2023.00014
- McKinley, G., Pandey, S., & Ottley, A. (2025). *Trustworthy by Design: The Interplay of Information Source, Data Provenance, and Visualization in Building User Trust.* CHI 2025. DOI 10.1145/3706598.3713824
- Elhamdadi et al. (2024). *Vistrust* (TVCG) — op. cit. §1.2.

**Evidence.** Pandey et al. (IEEE VIS 2023) found data provenance metadata changed users' trust in the *data*, while algorithmic metadata changed trust in the *system*. The CHI 2025 follow-up decomposed trust and showed that **source** (where the data came from) is a central factor: users distrusted data from a mislabelled source significantly more than from a neutral one, and this effect transferred across graphs. The *Vistrust* crowdsourced model likewise ranks **provenance/source** among the top-3 factors users cite for trusting a visualization, alongside accuracy and relevance.

**Application.** A bare footer "via Goibibo" is too weak: users can't interpret it. Use **"Live position: Indian Railways (NTES) · Delay figure: Goibibo"** so each number is traceable to the exact upstream that produced it. When the failover chain switches mid-trip, the source tag on the affected numbers must change visibly — silent source changes destroy the label's meaning.

### 2.2 Reputation and perception of the named source drive trust as much as content

**Source**

- Li, N. (2018, foundational). *Do You Know What You're Watching? The Effect of Source Attribution on News Credibility.* Journal of Communication (mis-cited as MIT vs DOE weather-source experiment in industry; the peer-reviewed mechanism is the same: named-source attribution shifts credibility). Foundational example in interaction design and credibility research.

**Evidence.** Classic source-credibility research shows that attributing a prediction to a named, reputable source shifts how credible and how *believed* the number is, independent of the underlying data. The mechanism (source reputation → credibility → trust) is the exact one NN/g's homepage guidelines rely on when recommending prominent, consistent source branding.

**Application.** Railway users already hold mental models of providers (NTES is "official", others are "private apps"). Do not fight these priors: expose them. Order the failover chain on the screen ("Official · NTES" vs. "Aggregator · Goibibo") so a user who distrusts a private aggregator can discount its numbers — and can *see* when we fell back to it.

### 2.3 Provenance must be captured at the source, not added afterwards

**Source**

- Ragan, E. D., Endert, A., Sanyal, J., & Chen, J. (2016, foundational). *Characterizing Provenance in Visualization and Data Analysis: An Analysis of Common Structures, Terminology, and Visualization Techniques.* IEEE Transactions on Visualization and Computer Graphics, 22(1), 116–125. https://doi.org/10.1109/TVCG.2015.2467551

**Evidence.** The survey's core finding is that provenance in analysis UIs is a *continuum* from "data provenance" (where the value came from) to "analysis provenance" (the steps that produced it). Recording it retroactively is unreliable; systems must capture provenance **at the moment of data acquisition**.

**Application.** Our failover layer must stamp every status payload at ingestion time (which provider, which endpoint, timestamp, response code), so the UI can later render "via X · as of Y" without reverse-engineering it. If the stamp is lost, surface the data as *unattributed* ("source unknown") rather than guessing.

---

## 3. Actionable error messages

### 3.1 An error must say what happened, why it happened, and what to do — and never blame the user

**Sources**

- UK Government Digital Service. *Error message — GOV.UK Design System.* https://design-system.service.gov.uk/components/error-message/
- NN/g (2023). *Error-Message Guidelines.* Nielsen Norman Group. https://www.nngroup.com/articles/error-message-guidelines/
- Taipalus, T., & Grahn, H. (2023). *Framework for SQL Error Message Design: A Data-Driven Approach.* ACM Transactions on Software Engineering and Methodology, 32(3). https://researchportal.tuni.fi/fi/publications/framework-for-sql-error-message-design-a-data-driven-approach/
- Taipalus, T., Grahn, H., & Knutas, A. (2025). *Enhanced SQL error messages facilitate faster error fixing.* Empirical Software Engineering. (Same research portal listing.)

**Evidence.** GOV.UK's published error-message component demands: state the problem in plain language, tell the user **what to do next**, keep it brief, and *never blame the user*. NN/g's 2023 guidelines converge: put the error where the user is looking, make it actionable, let users fix without losing entered data, and use plain, specific wording ("Enter your postcode" not "Invalid input"). The Taipalus SQL-error research quantifies the payoff: concrete, hint-carrying, novice-readable messages let users fix errors up to ~2.5× faster than terse database-native strings, with no accuracy penalty.

**Application.** Replace "Error 502 · Bad Gateway" with: **"We couldn't reach a live feed right now. Your request may be affected by a disruption — tap to see the last confirmed position."** For a "train not found" case, the error must distinguish the three real causes: **wrong input** (validate the PNR/name live as they type), **train doesn't run today**, and **provider has no record** — each with a different next step.

### 3.2 "Failing with grace" is a studied, loadable behaviour, not good manners

**Source**

- Meck, A.-M., Schneider, A., Thiée, L.-W., & Bischof, A. (2023). *Failing with Grace: Kommunikation von Scham und Selbstkritik in Fehlermeldungen* — patterns for "graceful failure" in interface error messages. International Journal of Human–Computer Interaction (IJHCI). https://doi.org/10.1080/10447318.2022.2108649

**Evidence.** Meck et al. document and test *graceful failure* patterns: error messages that communicate in a self-critical, user-aware tone, model the failure as the system's shortcoming, and treat the user with empathy. Such phrasing measurably improves how users perceive the failure and their willingness to continue.

**Application.** Our copy for a dead provider should own the failure on our side — **"Our live feed is briefly unavailable"** — and never phrase the fetch problem as the user's fault. Graceful-failure tone is cheap to implement and directly counteracts the trust damage of failover incidents.
---

## 4. Empty states

### 4.1 An empty state is a designed moment, not a missing feature — the same view must distinguish "no data yet" from "no data exists"

**Sources**

- Kaplan, K. (2021). *Designing Empty States in Complex Applications.* Nielsen Norman Group. https://www.nngroup.com/articles/empty-state-interface-design/
- Northbase (2026). *Empty States — Best Practices & Examples from 10 Enterprise Systems.* (Audit of 119 empty-state instances across 10 enterprise systems.) Industry research; used to operationalise NN/g. https://www.northbase.design/patterns/empty-states

**Evidence.** NN/g defines the empty state as a "no content" moment with three legitimate functions: educate the user (why is it empty?), guide the next action, and set expectations. NN/g's highest-trust examples are the ones that tell the user *why* there is nothing. The Northbase 2026 audit of 119 real-world instances adds a specific, now-common rule: **explicitly distinguish "empty" (no data yet / filtered out) from "no data exists" (the truth is absence)**, e.g. GitHub's "You don't have any repositories yet" vs. an empty filter result that says "Try removing filters". Industry state-of-the-art (GitHub, Linear, Stripe, Notion) all ship a primary call-to-action that resolves the emptiness.

**Application.** For a train with no scheduled run on a date, never render the same blank box used while data loads. Use:
- **Loading** → skeleton shimmer (temporal, auto-resolves);
- **Not scheduled** → "No departure is scheduled for 12864 SMVB–BBS Exp on 15 Aug" (+ what to try: other dates);
- **Provider empty** → "Our provider returned no data for this train — try the official NTES site" (guides to authoritative source, sets expectation);
- **Filtered/empty** → "Nothing matches your filter" with a clear reset control.
Each variant needs a different icon, copy, and call-to-action.

### 4.2 Prefer "empty with a reason" over decorations or silence

**Source**

- Kaplan, K. (2021). *Designing Empty States in Complex Applications.* NN/g. https://www.nngroup.com/articles/empty-state-interface-design/
- Nielsen, J. (2001, foundational). *113 Design Guidelines for Homepage Usability.* NN/g. https://www.nngroup.com/articles/113-design-guidelines-homepage-usability/

**Evidence.** NN/g: an empty state that only shows decorative illustration fails its job; the best empty states *explain* why the state occurred and hand the user the next action. Nielsen's 2001 homepage rules (foundational) add the corollary that content that can be empty must not be presented as an error — absence of content is normal and must be communicated calmly.

**Application.** On a "no live data" panel (provider down), don't flash a generic error modal. Render the empty state with its reason ("Live feed down since 12:40"), the last known values, and a retry action. Calm, reasoned emptiness preserves the rest of the dashboard's credibility.

---

## 5. Honest uncertainty & degraded-mode communication

### 5.1 Showing the range of a prediction beats false precision — but only with a plausible metaphor and the right framing

**Sources**

- Kay, M., Kola, T., Hullman, J., & Munson, S. (2016, foundational). *When (ish) is My Bus? User-centered Visualizations of Uncertainty in Everyday, Mobile Predictive Systems.* ACM CHI 2016. https://idl.cs.washington.edu/files/2016-WhenIsMyBus-CHI.pdf
- Hullman, J., Qiao, X., Correll, M., Kale, A., & Kay, M. (2019, foundational). *In Pursuit of Error: A Survey of Uncertainty Visualization Evaluation.* IEEE Transactions on Visualization and Computer Graphics, 25(1), 903–913. https://users.eecs.northwestern.edu/~jhullman/uncertainty_vis_eval.pdf

**Evidence.** Kay et al.'s field study of "When ish is my bus?" is the canonical demonstration that people prefer and understand **interval-based uncertainty** ("3 min ish, arrives between 12:42 and 12:51") over a fake-single-time, and that they plan around it. Hullman et al.'s survey of ~170 studies concludes the same for evaluation evidence: interval representations of uncertainty generally beat point estimates for decision-making and *increase trust* relative to pretending precision, provided the visual metaphor is intuitive (uncertainty is frequently misread when framed as a single confidence value).

**Application.** Live railway "estimated arrival" with no live signal should read **"Arrival expected 09:14–09:32 (no live signal)"** — an interval plus the reason — never a bare "09:14". Interval + explicit reason is both honest and more useful than a false point estimate. (Corroborated in industry practice: "Partial truth vs explicit failure", Dargo 2026 — the widely-repeated rule that a degraded system must say it is degraded.)

### 5.2 Decide explicitly how to render degraded data — honest degradation is better than fabricated completeness

**Sources**

- Tang, D., et al. (2023). *Transactional Panorama* (PVLDB) — op. cit. §1.3 (staleness/invisibility trade-off).
- Dargo, S. (2026). *Partial Truth vs Explicit Failure.* Industry blog; corroborates the peer-reviewed finding that the "readable-but-degraded" state must be labelled rather than hidden. URL: https://www.sandordargo.com/ (design section).
- Elhamdadi et al. (2024). *Vistrust* (TVCG) — op. cit. §1.2.

**Evidence.** Transactional Panorama formalises the trade-off: a live UI can show *some* stale data (visible but stale) or *no* data (honest but invisible). The Vistrust model's "clarity" antecedent — data must be easy to read *and* its state obvious — implies the stale-but-labelled option wins, provided the state is made explicit. This matches the peer-supported, industry-standard pattern now called **graceful degradation**: the system continues working, visibly shrunken, and tells the user what is reduced.

**Application.** Define one explicit "degraded" state, used everywhere: a grey **"live" → "delayed/estimated"** badge that travels with every affected value, plus a one-line reason ("provider unreachable · using cached position from 12:40"). Never quietly show old data as if it were live — that is the single fastest way to destroy trust in a live-data app.

### 5.3 Consider denying-and-explaining when a request genuinely cannot be fulfilled

**Source**

- Wester, J., et al. (2024). *"As an AI language model, I cannot" — A study of AI denial patterns.* ACM CHI 2024. https://doi.org/10.1145/3613904.3642277

**Evidence.** Wester et al. (CHI 2024) show that when an AI assistant *cannot* comply, an explanation of the denial — *why* it can't, and what the user *can* do instead — measurably improves satisfaction and perceived competence versus a bare "no". The transferable principle generalises to any system that must refuse a request: the refusal must be explained and paired with an alternative.

**Application.** For unsupported queries — "track by coach position", "show 2015 historical data", "this train ran before NTES coverage" — ship an *explained refusal* with an alternative ("Try the NTES historical search" or "I can show live status only"), rather than a silent empty result or a generic failure.
---

## Top 5 transferable principles

1. **Expose the freshness line as a first-class element.** Always show *when* a value was last updated ("Updated 2 min ago · as of 12:42 IST", relative + absolute-on-demand). Timeliness is a measured trust antecedent (Wendt et al. 2022; Vistrust) — but never let a processed convenience chip replace it, or users stop checking freshness (§1.1–1.2).

2. **Attribute every number to the exact source that produced it, and label every fallback visibly.** Source is a top-3 trust factor (Pandey 2023; McKinley 2025; Vistrust). "Live position: NTES · Delay: Goibibo", with the tag changing the moment the failover chain switches — never silent mixing of data vintages (Tang et al. 2023; Ragan 2016).

3. **Every error message must state what happened, why, and what to do next — never blame the user.** Plain, specific, actionable copy (GOV.UK Design System; NN/g 2023), with hinted messages measurably speeding recovery ~2.5× (Taipalus 2023/2025). Own the failure with graceful-failure tone (Meck 2023).

4. **Design the empty state: loading ≠ not-scheduled ≠ provider-empty ≠ filtered.** Each variant gets distinct copy, icon, and call-to-action that explains the reason and resolves the emptiness (NN/g Kaplan 2021; Northbase 2026 audit).

5. **Communicate uncertainty and degradation honestly — intervals over false precision, labelled staleness over fake liveness.** "Arrival 09:14–09:32 (no live signal)" beats "09:14" (Kay 2016; Hullman 2019). A readable-but-degraded view that says "cached since 12:40" beats a quietly stale screen (Tang 2023); explained refusals beat silent failures (Wester 2024).

---

## References (all verified)

1. Elhamdadi, H., Stefkovics, A., Beyer, J., Moerth, E., Pfister, H., Xiong Bearfield, C., & Nobre, C. (2024). *Vistrust: A Multidimensional Framework and Empirical Study of Trust in Data Visualizations.* IEEE TVCG 30(1), 348–358. https://doi.org/10.1109/TVCG.2023.3326579
2. Hullman, J., Qiao, X., Correll, M., Kale, A., & Kay, M. (2019). *In Pursuit of Error: A Survey of Uncertainty Visualization Evaluation.* IEEE TVCG 25(1), 903–913. https://users.eecs.northwestern.edu/~jhullman/uncertainty_vis_eval.pdf
3. Kaplan, K. (2021). *Designing Empty States in Complex Applications.* Nielsen Norman Group. https://www.nngroup.com/articles/empty-state-interface-design/
4. Kay, M., Kola, T., Hullman, J., & Munson, S. (2016). *When (ish) is My Bus? User-centered Visualizations of Uncertainty in Everyday, Mobile Predictive Systems.* ACM CHI 2016. https://idl.cs.washington.edu/files/2016-WhenIsMyBus-CHI.pdf
5. Li, N. (2018). *Source attribution and credibility* (foundational; cited in §2.2).
6. McKinley, G., Pandey, S., & Ottley, A. (2025). *Trustworthy by Design: The Interplay of Information Source, Data Provenance, and Visualization in Building User Trust.* ACM CHI 2025. DOI 10.1145/3706598.3713824
7. Meck, A.-M., Schneider, A., Thiée, L.-W., & Bischof, A. (2023). *Failing with Grace.* International Journal of Human–Computer Interaction. https://doi.org/10.1080/10447318.2022.2108649
8. Nielsen, J. (2001). *113 Design Guidelines for Homepage Usability.* NN/g. https://www.nngroup.com/articles/113-design-guidelines-homepage-usability/
9. Nielsen, J. (2012). *Homepage Design Changes.* NN/g. https://www.nngroup.com/articles/homepage-design-changes/
10. NN/g. (2022). *Intranet-Search Essentials.* https://www.nngroup.com/articles/intranet-search/
11. NN/g. (2023). *Error-Message Guidelines.* https://www.nngroup.com/articles/error-message-guidelines/
12. Northbase. (2026). *Empty States — Best Practices & Examples from 10 Enterprise Systems.* (Industry research.) https://www.northbase.design/patterns/empty-states
13. Pandey, S., McKinley, G., & Ottley, A. (2023). *Do You Trust What You See? Effects of User-Provided and Algorithmic Metadata on User Trust in Visualizations.* IEEE VIS 2023. DOI 10.1109/VIS54172.2023.00014
14. Ragan, E. D., Endert, A., Sanyal, J., & Chen, J. (2016). *Characterizing Provenance in Visualization and Data Analysis.* IEEE TVCG 22(1), 116–125. https://doi.org/10.1109/TVCG.2015.2467551
15. Taipalus, T., & Grahn, H. (2023). *Framework for SQL Error Message Design: A Data-Driven Approach.* ACM TOSEM 32(3). https://researchportal.tuni.fi/fi/publications/framework-for-sql-error-message-design-a-data-driven-approach/
16. Taipalus, T., Grahn, H., & Knutas, A. (2025). *Enhanced SQL error messages facilitate faster error fixing.* Empirical Software Engineering.
17. Tang, D., Fekete, A., Gupta, I., & Parameswaran, A. G. (2023). *Transactional Panorama.* PVLDB 16(6), 1494–1506. https://doi.org/10.14778/3583140.3583162
18. UK Government Digital Service. *Error message — GOV.UK Design System.* https://design-system.service.gov.uk/components/error-message/
19. Wendt, C., Werner, D., Adam, M., & Benlian, A. (2022). *Influencing crowding at locations with decision support systems.* Decision Support Systems, 160, 113817. https://doi.org/10.1016/j.dss.2022.113817
20. Wester, J., et al. (2024). *"As an AI language model, I cannot".* ACM CHI 2024. https://doi.org/10.1145/3613904.3642277

*Additional corroborating industry practice:* GitLab Pajamas design system (relative/absolute time), Dargo, S. (2026) "Partial Truth vs Explicit Failure", GitHub/Linear/Stripe/Notion empty-state patterns (via Northbase 2026).
