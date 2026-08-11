# Search & Form Interaction Design — Evidence Base for the Train-Status App

**Purpose.** Evidence for re-architecting the train-search experience of the Indian Railways live-status web app: combobox input with suggestions listbox, inline valid/invalid indicators, submit button, and a separate "recent searches" section.

**Product facts.** Primary input is a train **number** (5-digit) or **name** from a catalog of a few thousand trains. This is a *known-item search* over a finite, curated vocabulary — closer to the GOV.UK accessible-autocomplete case (a small, finite answer set) than to open-ended web search.

**Scope note on dates.** The instruction asks for literature published 2021–2026. For several of these questions the canonical, methodologically strongest evidence predates 2021 (e.g., the controlled inline-validation study is Wroblewski & Etre 2009; the largest query-log autocomplete studies are Bing/Yahoo, 2013–2014). Those seminal studies are included and explicitly flagged with their year; they are the sources the 2021+ practitioner literature (NN/g, Baymard, Smashing, GDS) itself cites. Recent (2021–2026) confirmatory/refining work is cited for each topic where it exists.

---

## (a) Autocomplete: when to show, how many, how to highlight matches

### When to show suggestions

**GOV.UK (GDS) search autocomplete — 5 suggestions, triggered at ≥3 characters.**
In its December 2024 rollout, GOV.UK shows suggestions only after 3 characters "so that we have enough of an indication of what users could be searching for to provide them with relevant suggestions", caps the list at 5 to avoid overwhelming users and scrolling, and pushes page content down instead of overlaying it (accessibility for screen readers). An A/B test on live traffic found suggestions were used in **55% of searches where they were shown**, and when a suggestion was used the results click-through was 92% — evidence that autocomplete meaningfully improves a real search task (Fraser, 2024, "Making it quicker and easier to search on GOV.UK", Inside GOV.UK blog, https://insidegovuk.blog.gov.uk/2024/12/12/making-it-quicker-and-easier-to-search-on-gov-uk/).

**Latency sensitivity of the trigger.** A controlled study at Yahoo (adding artificial delays 0–1750 ms) found added delays under **500 ms are imperceptible** and delays **above 1000 ms are noticed with very high likelihood**; query-log analysis showed users are more likely to click results served at lower latency (Arapakis, Bai & Cambazoglu, 2014, "Impact of Response Latency on User Behavior in Web Search", SIGIR, https://doi.org/10.1145/2600428.2609627). On mobile, users tolerate roughly 4× more latency before impact, but beyond ~7–10 s experience degrades sharply (Arapakis, Park & Pielot, 2021, "Impact of Response Latency on User Behaviour in Mobile Web Search", CHIIR, https://doi.org/10.1145/3406522.3446038). A 2024 controlled study of IDE autocomplete found benefit even at up to 300 ms latency, and concluded autocomplete's primary benefit is *information* rather than keystroke savings (Jiang & Coblenz, 2024, "An Analysis of the Costs and Benefits of Autocomplete in IDEs", FSE, https://doi.org/10.1145/3660765). Implication: show suggestions quickly; a 3-char threshold plus client-side catalog caching keeps response well under the 500 ms perception threshold.

**Show suggestions even before typing (for recents) is a sanctioned pattern.** The W3C APG "no autocomplete" variant of the combobox pattern explicitly covers the case where "the popup suggests a set of recently entered values, and the suggestions do not change as the user types" — i.e., a recents list bound to focus/empty input is a first-class combobox behavior (W3C, 2024, "Combobox Pattern", WAI-ARIA Authoring Practices Guide, https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

### How many suggestions

**Baymard usability testing (desktop + mobile): too many suggestions cause choice paralysis.** When autocomplete lists exceed ~10 items on desktop (fewer on mobile, ~8), users either ignore suggestions ("mere noise") or spend excessive time reading them, effectively halting the search. Recommended: **no more than 10 on desktop; 4–8 on mobile**, all visible without scrolling (Scott, 2022, "9 UX Best Practice Design Patterns for Autocomplete Suggestions", Baymard Institute, https://baymard.com/blog/autocomplete-design). The same study reports only 19% of e-commerce sites implement autocomplete correctly.

**Controlled experiment (mobile): fewer suggestions → earlier acceptance.** Kamvar, Kellar, Patel & Xu (CHI 2008) varied the number of suggestions (0–5) and found users with fewer suggestions accepted a correct suggestion earlier; they also found suggestion *movement* in the list (re-ranking as you type) delayed acceptance, and that users accepted correct suggestions after ~1.4 displays on average (97.4% accepted by the third display). Their headline guideline: **show as many suggestions as fit on screen without scrolling** — a list sized so no scrolling is needed. (Kamvar, Kellar, Patel & Xu, 2008, "Computers and iPhones and Mobile Phones, oh My! A logs-based comparison of search users on different devices" is a different paper; the suggestion study is "Query Suggestions for Mobile Search", CHI 2008, https://doi.org/10.1145/1357054.1357210.)

**Google practitioner guideline agrees: at most 5, never more than 10**, ordered by score (dominant-suggestion case) or alphabetically (when scores are close) (Tunkelang, 2017, "Autocomplete and User Experience", Query Understanding / Google, https://queryunderstanding.com/autocomplete-and-user-experience-421df6ab3000).

**Position bias in suggestion ranking.** Large-scale Bing log analysis shows lower-ranked autocomplete suggestions get substantially less engagement than higher-ranked ones; engagement is most likely after the user has typed about *half* the query, at word boundaries (Shokouhi & Radinsky, 2014, "On User Interactions with Query Auto-Completion", SIGIR, https://doi.org/10.1145/2600428.2609508). An eye-tracking study confirmed a strong, consistent position bias across ranking conditions — ranking quality directly shapes whether QAC is used at all (2014, "An Eye-tracking Study of User Interactions with Query Auto Completion", CIKM, https://doi.org/10.1145/2661829.2661922). **Ranking quality matters more than list length**: getting the top 2–3 suggestions right is the highest-leverage autocomplete investment.

### How to highlight matches

**NN/g: visually differentiate typed text from suggested text, and emphasize the *predictive* part.** Suggestions should be scannable; styling the completion (not the repeated typed prefix) is what helps users scan differences between options. NN/g also warns: **never suggest queries that return zero or poor results** — a bad suggestion is worse than none, and users who don't see their product after a few characters may conclude the site doesn't have it (Moran, 2018, "Site Search Suggestions", Nielsen Norman Group, https://www.nngroup.com/articles/site-search-suggestions/).

**Baymard: highlight the predictive portion, not the typed prefix.** Emphasizing the completion string reduces visual repetition and highlights differences between suggestions, making the list comparable "in an instant". The active (hovered/focused) suggestion must be shaded with a hand cursor so users know it is selectable (Scott, 2022, Baymard, https://baymard.com/blog/autocomplete-design).

**GOV.UK bolds the suggested keywords** as "a widely used autocomplete design pattern that helps users quickly spot what they're looking for" (Fraser, 2024, GDS, https://insidegovuk.blog.gov.uk/2024/12/12/making-it-quicker-and-easier-to-search-on-gov-uk/).

**Suggestion accuracy drives adoption.** In a controlled CHI study, word-suggestion *accuracy* was a decisive factor in whether suggestions helped: accurate suggestions improved entry speed on touch devices (with no gain on desktop), and accuracy influenced how often suggestions were adopted at all (2021, "Typing Efficiency and Suggestion Accuracy Influence the Benefits and Adoption of Word Suggestions", CHI, https://doi.org/10.1145/3411764.3445725). For a finite catalog this argues for **only suggesting trains that exist**, never fabricating a partial prefix match with no backing record.

> **Application to train search:** show ≤ 6 suggestions in a single scroll-free list, triggered on focus (recents group) and from ~2–3 typed characters (catalog matches); rank exact train-number/name prefixes first (position bias); render each row as `Number · Name · origin→destination`, bold the *completion* characters after the typed substring, never show a suggestion that isn't a real train; keep client-side matching so suggestions appear in <300 ms.

---

## (b) Validation timing: live vs. on-submit

**The controlled baseline (foundational, pre-2021).** Wroblewski & Etre tested 22 users on six variants of a registration form: inline validation beat submit-only validation with a **22% increase in success, 22% fewer errors, 31% higher satisfaction, 42% faster completion, and 47% fewer eye fixations**. Critically, the same study compared *when* to validate: for open-ended fields, **validating "after" (on blur) was 7–10 s faster than validating "while typing" or "before and while"**, because per-keystroke errors caused users to stop, wait for the message to update, and re-check. Premature validation also produced higher error rates and worse satisfaction; participants described it as "scolding". Persistent success indicators (green checks) reassured users; in-field validation messages gave no benefit (Wroblewski, 2009, "Inline Validation in Web Forms", A List Apart, https://alistapart.com/article/inline-validation-in-web-forms/). This is the primary study behind nearly all later guidance — flag it as the source of the numbers.

**NN/g (recent, consensus).** Aim for inline validation wherever possible; keep messages next to the field; indicate *success* for complex fields (e.g., password rules) but don't overdo success indicators; **don't validate fields before input is complete** (an error on an untouched field, or mid-typing, is frustrating); and don't rely on validation summaries alone (Krause, 2019, last reviewed 2024, "10 Design Guidelines for Reporting Errors in Forms", NN/g, https://www.nngroup.com/articles/errors-forms-design-guidelines/). Premature error messages — appearing on focus, or before the user can finish typing — are classed as "hostile patterns": display errors only after the error has actually been made; provide constraints upfront (Kaplan, 2022, "Hostile Patterns in Error Messages", NN/g, https://www.nngroup.com/articles/hostile-error-messages/).

**Baymard (2024 testing): three details make or break inline validation.** (1) *Avoid premature validation* — check on blur or once the value reaches the expected length, not on every keystroke for a fresh field. (2) *Remove the error the moment it's corrected* — re-check an already-invalid field on every keystroke (debounced) so the red state clears instantly. (3) *Use positive inline validation* (a green check when the value is valid) so even error-free users benefit and move faster (2024, "Usability Testing of Inline Form Validation", Baymard, https://baymard.com/blog/inline-form-validation). NN/g makes the same "reward early" point for fields already in error (Kaplan, 2022, "Hostile Patterns", https://www.nngroup.com/articles/hostile-error-messages/).

**Smashing (Friedman) synthesis.** "Late validation is almost always better" for format-checked fields; the exceptions where *live* feedback genuinely helps are password-strength meters, character counts, and username availability. Required/empty fields should be validated **only on submit**. The "reward early, punish late" rule: after a field has errored, re-validate on every keystroke (reward early); for fields that were valid, wait until blur (punish late). For short forms, validation on submit is defensible — the risk of mid-typing errors outweighs the benefit (Friedman, 2022, "A Complete Guide to Live Validation UX", Smashing Magazine, https://www.smashingmagazine.com/2022/09/inline-validation-web-forms-ux/).

> **Application to train search:** the input accepts two formats (5-digit number; train name), so:
> - *Format check on blur* — flag "train numbers are 5 digits" only after the user leaves the field; never while typing ("1", "12"… is not yet an error).
> - *Existence check* — against the train catalog, on blur, with a **positive green check + train name** when the number resolves to a known train (positive inline validation, both NN/g and Baymard).
> - *Live re-check once invalid* — the moment the user edits an errored value, clear the error as soon as it becomes valid (reward early).
> - *On submit* — full re-validation; submit is never disabled (allow the user to override if their value is correct but unrecognised).

---

## (c) Keyboard navigation in listboxes / comboboxes

**W3C APG Combobox Pattern is the normative reference** for the ARIA combobox + listbox popup. Required behaviors:
- **Down/Up arrows** move focus into the popup and between options (selection follows focus via `aria-activedescendant` while DOM focus stays in the input);
- **Enter** accepts the focused suggestion — "either by placing the input cursor at the end of the accepted value in the combobox or by performing a default action on the value";
- **Escape** dismisses the popup (and, if it was already closed, may clear the input);
- **Alt+Down / Alt+Up** open/close the popup without changing selection;
- **Printable characters** return focus to the input and continue filtering;
- The pattern also defines the four autocomplete behaviors (`aria-autocomplete="none"|"list"|"inline"|"both"`) and which ARIA states must be live-managed (`aria-expanded`, `aria-controls`, `aria-activedescendant`) (W3C, 2024, "Combobox Pattern", APG, https://www.w3.org/WAI/ARIA/apg/patterns/combobox/; see also the editable-combobox-with-list-autocomplete example, https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-list/). MDN's combobox role page summarises the same contract for implementers (MDN, 2025, "ARIA: combobox role", https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/combobox_role).

**Empirical support for the key map (Baymard).** Operating systems and Google have trained users that autocomplete can be navigated by keyboard: **up/down arrows move, Enter submits the focused suggestion, and the list should wrap** at the ends. Baymard's testing additionally found that **copying the focused suggestion into the search field** is important: it teaches less-experienced users how autocomplete works and lets experts "continue" the suggestion (add further qualifiers) before committing (Scott, 2022, Baymard, https://baymard.com/blog/autocomplete-design). This "copy on focus, submit on Enter" split is exactly the W3C "list autocomplete with manual selection" behavior — suggestion browsing never commits a value by itself.

> **Application to train search:** implement the APG key map exactly: focus stays in the input, `aria-activedescendant` drives the highlighted row, arrows move/wrap, Escape closes the popup, printable chars filter. Copy the highlighted train into the input on arrow-focus so a user can extend a partial name ("Rajdhani …") before submitting. Add a **submit button** alongside the input: keyboard users get explicit Enter-to-commit, and it doubles as the on-submit validation trigger.

---

## (d) Recents in the dropdown vs. a separate "recent searches" section

**Recents are a recognized combobox state.** The W3C APG "no autocomplete" variant is precisely a popup of recently entered values shown without typing — recents *in* the dropdown is the documented pattern for a combobox (W3C, 2024, APG, https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

**Recents inside dropdowns work when labeled and separated.** NN/g's e-commerce studies tested enriched suggestion panels that mix query suggestions with "recently searched items", "recently viewed" images, and promoted content. Users rarely used them (7 of 60 encounters), and *when left unlabeled* interpreted them as promotional content or ignored them as banner blindness. NN/g's explicit mitigations: **clearly label each suggestion type** (e.g., "recent searches"), **maintain dedicated spaces** for each content type rather than shifting them by query, and don't mix personal history with promoted/popular queries under one label (Kaplan, 2022, "Enriched Site-Search Suggestions: Rarely Used", NN/g, https://www.nngroup.com/articles/enriched-site-search-suggestions/).

**Personal history is the single most effective signal for ranking suggestions.** In supervised QAC experiments on AOL and Bing logs, the user's **long-term search history** was the most effective personalization feature (outperforming demographics, location, and session context); a live Bing A/B test over ~3.1M users confirmed engagement gains from personalizing the suggestion list (Shokouhi, 2013, "Learning to Personalize Query Auto-Completion", SIGIR, https://doi.org/10.1145/2484028.2484076). Session recency likewise improves completions (Bar-Yossef & Kraus, 2011, "Context-Sensitive Query Auto-Completion", WWW, https://doi.org/10.1145/1963405.1963500). So the *content* of a recents group demonstrably helps at the moment of re-search — which argues for placing it where re-searching happens: in the dropdown on focus, not buried in a separate page section.

**Why not a separate page section.** A separate "recent searches" block below the search card forces users to break out of the search field, aim at a distant target, and re-focus afterward — an extra interaction step on every re-search. NN/g's intranet research shows users re-run familiar queries repeatedly and value being able to execute them instantly from the search box; the same research also cautions that suggestions "didn't play nicely with users' natural inclination to hit Enter", i.e., the dropdown must never hijack an intended search (Kaley, 2022, "Intranet-Search Essentials", NN/g, https://www.nngroup.com/articles/intranet-search/). When recents appear *inside* the dropdown, they are also reachable by keyboard with one arrow-press — impossible for a separate section.

**Evidence-based recents hygiene:** record a recent only after a *meaningful submitted* lookup (not per keystroke, not on hover), deduplicate, order newest-first, cap the list (5–8), and provide per-item remove / clear controls. A recents list that includes every half-typed attempt becomes noise and is ignored — the same failure mode NN/g documented for unlabeled, undifferentiated suggestion panels (Kaplan, 2022, NN/g, https://www.nngroup.com/articles/enriched-site-search-suggestions/).

> **Application to train search:** replace the separate "recent searches" section with a **"Recent trains" group inside the dropdown, shown on focus with an empty input** (the W3C `aria-autocomplete="none"` state), labeled with a heading, capped at ~5, newest-first, deduplicated, each row tappable/selectable to re-open the train's status. The on-page space freed by removing the separate section is better spent on the search card's own content. Keep simple text suggestions always available (NN/g: "do not eliminate simple text autosuggestions" — Kaplan, 2022, https://www.nngroup.com/articles/enriched-site-search-suggestions/).

---

## (e) Search-then-decide: should selecting a suggestion submit immediately?

**The core safety principle (NN/g): always preserve the ability to search on the typed keyword.** In intranet usability testing, users habitually hit Enter to execute their search; when a slow-to-load suggestions list auto-selected its top item just as the user pressed Enter, the user **accidentally searched the suggestion instead of the keyword they typed**. NN/g's rule: "Let users choose the suggestion that matches their intent and **always preserve the ability to search on the original keyword** they entered." (Kaley, 2022, "Intranet-Search Essentials", NN/g, https://www.nngroup.com/articles/intranet-search/). The corollary: **do not auto-submit the first suggestion on Enter** unless the user has explicitly highlighted it.

**Explicit selection is a distinct, user-committed step.** In the CHI mobile-suggestion experiment, selecting a suggestion required a deliberate action (down-arrow to highlight, then accept), and users exercised it selectively — even accepting suggestions that cost *more* keypresses, showing they treat "pick from list" as an explicit decision rather than an automatic handoff (Kamvar et al., 2008, CHI, https://doi.org/10.1145/1357054.1357210). The APG key map encodes the same two-phase model: arrow *moves* the highlight (via `aria-activedescendant`, without changing the committed value), Enter *commits* the highlighted option or performs the default action (W3C, 2024, APG, https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

**Two legitimate commit models — pick one per suggestion type.**
1. *Copy-then-decide (manual selection).* Arrows copy the suggestion into the field (W3C "list autocomplete with manual selection"; Baymard's copy-on-focus finding); the user then edits or presses Enter. This is safest when the suggestion may not exactly match intent.
2. *Commit-on-select.* Selecting a suggestion immediately runs the action (GOV.UK's model: picking a suggestion updates the query and goes to results — acceptable there because suggestions are complete, unambiguous queries: Fraser, 2024, GDS, https://insidegovuk.blog.gov.uk/2024/12/12/making-it-quicker-and-easier-to-search-on-gov-uk/).

**Arapakis' latency finding sharpens the risk.** Suggestions that appear just as the user submits create the exact mis-selection NN/g describes; because users perceive no delay below ~500 ms and notice it reliably above 1 s (Arapakis et al., 2014, SIGIR, https://doi.org/10.1145/2600428.2609627), a slow dropdown is not just annoying — it actively causes wrong searches. Keep suggestion latency under the perception threshold and never let a late-arriving list steal an Enter keystroke.

**Synthesis for a known-item search:** because a train number/name resolves to a single record, *explicitly* selecting a suggestion may commit immediately (model 2) — the user's intent is unambiguous. But **Enter on the typed text must search exactly what was typed**, and a suggestion must only be committed if the user highlighted it (mouse hover/click or arrow + Enter). Recents rows are the same: they are explicit choices of a specific train.

> **Application to train search:** arrow/hover highlights a suggestion and copies it into the input; **Enter** commits the *highlighted* suggestion if one is active, otherwise searches the raw typed text verbatim; **Escape** closes the dropdown and returns to editing the typed query; **clicking or tapping** a suggestion (including a "Recent trains" row) navigates directly to that train's status page. Never auto-select suggestion #1, and never bind Enter to the top suggestion unless the user arrowed to it.

---

## Latency budget (cross-cutting)

Suggestions are a fast interaction; the evidence above sets a concrete budget:
- <500 ms added delay: imperceptible; >1000 ms: reliably noticed (Arapakis et al., 2014, SIGIR, https://doi.org/10.1145/2600428.2609627).
- ~300 ms of latency still permits autocomplete to deliver value (Jiang & Coblenz, 2024, FSE, https://doi.org/10.1145/3660765).
- Slow-to-load suggestion content is a top reason enriched suggestions fail in practice (Kaplan, 2022, NN/g, https://www.nngroup.com/articles/enriched-site-search-suggestions/).
- Debounce input ~150–300 ms and ship the train catalog client-side (a few thousand records is trivially cacheable) so suggestion rendering is instant and network only verifies live status after commit.

---

## Top 5 transferable principles

1. **Suggest only real trains, ranked hard by position, in a short scroll-free list.** ≤6 suggestions, triggered on focus (recents) and from ~2–3 typed characters; exact number/name-prefix matches first; never suggest a train that doesn't exist. Position bias means top-2 ranking quality beats list length (Shokouhi & Radinsky, 2014; Kamvar et al., 2008; Scott, 2022; Fraser, 2024).

2. **Two-phase keyboard contract: arrows move, Enter commits, Escape undoes, and Enter on plain typed text searches the typed text.** Follow the W3C APG combobox key map with `aria-activedescendant`; copy the highlighted suggestion into the field on arrow-focus; never auto-submit suggestion #1 on Enter (W3C, 2024; Kaley, 2022; Scott, 2022).

3. **Validation timing is the hard-won lesson: format-check on blur, positive green check on resolve, live re-check only once invalid, empty/required checked on submit.** Never flag mid-keystroke; reward-early-punish-late (Wroblewski, 2009; Krause, 2019; Kaplan, 2022; Baymard, 2024; Friedman, 2022).

4. **Recents live inside the dropdown, labeled and capped, not in a separate page section.** Show "Recent trains" as a labeled group on focus (the W3C no-autocomplete state); record only meaningful submissions, dedupe, newest-first, ~5 rows, with remove/clear; keep simple text suggestions alongside (W3C, 2024; Kaplan, 2022; Shokouhi, 2013).

5. **Keep suggestion latency under the perception threshold (<500 ms, target ~200 ms).** Cache the catalog client-side and debounce typing; a slow dropdown not only degrades UX, it causes wrong searches when a late list steals an Enter (Arapakis et al., 2014; Jiang & Coblenz, 2024; Kaley, 2022; Kaplan, 2022).
