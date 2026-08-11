# 03 — Accessibility Requirements & Best Practice for the Re-architecture

**Purpose.** Evidence-based guidance for making the re-architected live train-status web app (React 19 + Tailwind 4, CSS-variable HSL tokens, monochrome theme with green/amber/red semantic status) accessible to people with low vision, colour-vision deficiency (CVD), vestibular/motion sensitivity, motor impairments, and keyboard-only / screen-reader users. Surfaces in scope: (a) train-number search combobox with autocomplete, (b) run-date picker (previous runs / today / next run), (c) data-source gateway dropdown, (d) live status timeline + delay badges where **colour is currently the sole carrier** of on-time/delayed state, and (e) progress bar, refresh controls, and animated live indicators.

**Method.** Every finding is traced to a primary/high-trust source: W3C/WAI normative guidance (WCAG 2.2, the WCAG 3.0 working draft, WAI-ARIA Authoring Practices Guide), peer-reviewed venues (ACM CHI, MDPI Computers, Journal of Interior Design), the Nielsen Norman Group (NN/g), the UK Government Digital Service (GOV.UK Design System / Service Manual), and Apple/Google platform accessibility documentation. The core evidence window is 2021–2026; works outside it are included only where they are the canonical source of a claim and are flagged ***(foundational)***. Non-normative industry material is labelled as such and used only to operationalise primary findings.

---

## 1. Contrast ratios — text, non-text, and the APCA approach for muted-on-muted

### 1.1 WCAG 2.2 text contrast: 4.5:1 normal, 3:1 large — the legal baseline

**Sources**

- W3C WAI (2023). *Understanding SC 1.4.3 Contrast (Minimum), Level AA.* WCAG 2.2 Understanding. https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum
- W3C (2024). *Web Content Accessibility Guidelines (WCAG) 2.2.* https://www.w3.org/TR/WCAG22/
- GOV.UK Design System (n.d.). *Colour.* https://design-system.service.gov.uk/styles/colour/
- GDS Way / GOV.UK Service Manual (2024). *The GDS Way — accessibility: WCAG 2.2 AA is the legal standard for UK public sector.* https://gds-way.digital.cabinet-office.gov.uk/manuals/accessibility.html

**Evidence.** WCAG 2.2 SC 1.4.3 requires a contrast ratio of at least **4.5:1** for normal text and **3:1** for large text (18 pt/24 px, or 14 pt/18.66 px bold) against the background behind it. This is the AA floor adopted into legislation (e.g. UK public sector bodies must meet WCAG 2.2 AA, enforced since October 2024). GOV.UK treats 4.5:1 as a component acceptance criterion (e.g. its banner component) and ships a curated palette so the ratio is guaranteed. WCAG 2.2 uses the WCAG 2.x relative-luminance ratio formula.

**Application.** Audit every foreground-on-background pair derived from the HSL tokens. Body text, delay figures, timestamps, placeholder text, and the "muted" secondary text must each be checked against their *actual* rendered background (card surface, not the page background). Placeholder and disabled text are only exempt when truly inactive; any text a user must read for meaning must pass. Verify in both light and dark token variants.

### 1.2 Non-text contrast: 3:1 for UI components, states, and meaningful graphics

**Sources**

- W3C WAI (2023). *Understanding SC 1.4.11 Non-text Contrast, Level AA.* https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast
- WebAIM (2023). *Contrast and Color Accessibility — Understanding WCAG 2 Contrast and Color Requirements.* https://webaim.org/articles/contrast/

**Evidence.** SC 1.4.11 requires **3:1 against adjacent colours** for: (1) visual information required to identify UI components and their **states** (e.g. input borders, the selected state of a tab or toggle, focus indicators) and (2) graphical objects required to understand content. Crucially, "adjacent colours" means contrast may need to be measured in more than one place: a timeline's delay badge sits on a card that itself sits on the page background. The criterion explicitly covers state changes — *"any visual information necessary to indicate state, such as whether a component is selected or focused must also ensure that the information used to identify the control in that state has a minimum 3:1 contrast ratio."* WebAIM stresses this differs from text contrast: it is against *adjacent* colours, not just "background", and applies to each state. Hover states that only move the pointer are not "required to identify" state; but the active/selected state of a tab or the open/closed chevron of the gateway dropdown is.

**Application.** For the timeline (surface d), the **delay badge border, the badge's fill, and the status dot are graphical objects** — the shape/border separating a badge from the card must hold ≥3:1 against the card surface, and the card surface must hold ≥3:1 against the page background if the card boundary is the only thing delimiting it. Same for the progress bar's track-vs-fill boundary (≥3:1) and the chevron/border of the data-source gateway dropdown. Inactive (disabled) controls are exempt; do not grey out an *active* control.

### 1.3 WCAG 3.0 / APCA: perceptual contrast, and the muted-on-muted problem

**Sources**

- W3C (2025). *WCAG 3.0 working draft (silver).* https://www.w3.org/TR/wcag-3.0/
- Myndex Research / Inclusive Reading Technologies — Somers, A. (2023). *APCA in a Nutshell; APCA Easy Intro; APCA Readability Criterion.* https://git.apcacontrast.com/documentation/APCAeasyIntro.html and https://readtech.org/ARC/
- Roselli, A. (2026, April). *WCAG3 Contrast as of April 2026.* https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html
- Verou, L. (2024). *On compliance vs readability: Generating text colors with CSS.* https://lea.verou.me/blog/2024/contrast-color/
- J. Havelka (2026). *APCA vs WCAG Contrast — the next generation.* https://colors.jarhalab.com/wiki/apca-vs-wcag *(industry/developer source, used only to operationalise the above)*

**Evidence.** The APCA (Accessible Perceptual Contrast Algorithm) — developed to replace the WCAG 2 ratio — is perceptually uniform and accounts for font size, weight, polarity (light-on-dark vs dark-on-light), and spatial frequency. Target levels: **Lc 90** preferred / **Lc 75** minimum for body text; **Lc 60** for UI components and large text; **Lc 30** absolute minimum for placeholder/disabled text; **Lc 15** the point of invisibility for non-text. Two caveats are essential for accurate use: (1) APCA was exploratory content in the WCAG 3.0 draft and was removed from the July 2023 draft; WCAG 3's final contrast algorithm is not yet decided (Roselli, Apr 2026 — "WCAG3 is years away… perhaps 2030"), so **WCAG 2.2 AA remains the only current legal/normative baseline**; (2) nevertheless, APCA is the accepted design-side method for judging actual readability, and colours that pass it "greatly exceed WCAG 2's minimums in the vast majority of cases" (Somers). The WG itself has said APCA may be re-adopted later; the W3C CSS Working Group is designing `color-contrast()` and OKLCH-based algorithms around the same perceptual model (Verou 2024).

The practical failure APCA exposes: **the WCAG 2 ratio understates how hard very-light-grey text is to read**. It "overstates contrast for dark colours" and gives unreadable passes in the mid-to-low contrast region — precisely the range of a monochrome "light-grey text on light-grey card" theme. A concrete, documented migration: a shadcn-style token `--muted-foreground: hsl(240 5% 71%)` on the muted card surface scored only **Lc 57.1** under APCA (below the Lc 75 body-text floor) while still nominally passing WCAG AA 4.5:1; the fix was raising lightness to `hsl(240 5% 82.7%)` for **Lc 75.5** — a small, almost imperceptible change that crosses a real readability threshold (paul repo APCA migration notes, 2025). For light-on-light "muted" text the adjustment is the same shape: raise the *perceptual lightness* difference, don't just tweak hue.

**Application.** Keep the HSL token architecture, but add an Lc requirement per token pair: `--muted-foreground` on `--card` must reach **Lc ≥ 75** (APCA) and ≥4.5:1 (WCAG 2.2 AA) for secondary text; badges/chips and large-tag text ≥ Lc 60. Use a perceptually uniform lightness difference between the two greys (e.g. raise the lighter token's lightness %), because a "passing" ratio computed on two light greys is exactly the case where WCAG 2 math is least trustworthy. Document the target Lc value as a comment beside each foreground token, and re-check pairs whenever a token changes. Do **not** ship values that only pass WCAG 2 AA on light-grey-on-light-grey — assume the WCAG 2 pass is suspect until APCA confirms it.

---

## 2. prefers-reduced-motion and the animated live indicators

**Sources**

- W3C WAI (2023). *Understanding SC 2.3.3 Animation from Interactions (Level AAA).* https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions
- W3C WAI. *Technique C39: Using the CSS prefers-reduced-motion query to prevent motion.* https://www.w3.org/WAI/WCAG22/Techniques/css/C39
- W3C WAI. *Technique SCR40: Using the CSS prefers-reduced-motion query in JavaScript to prevent motion.* https://www.w3.org/WAI/WCAG22/Techniques/client-side-script/SCR40
- MDN (2025). *prefers-reduced-motion CSS media feature.* https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- web.dev (2023). *Animation and motion — Accessibility.* https://web.dev/learn/accessibility/motion

**Evidence.** SC 2.3.3 (AAA) states motion animation triggered by interaction can be disabled unless essential; the normative intent is to prevent vestibular triggers (dizziness, nausea, headaches). The sufficient technique is the `prefers-reduced-motion` media query (C39 for CSS, SCR40 for JS): when the user sets the OS "reduce motion" preference, non-essential animation must be suppressed. MDN and web.dev add important guidance: the preference means "reduce", not necessarily "remove all"; `*{animation:none!important}` is discouraged because users still want essential feedback; both CSS and JS-driven animation must be covered (e.g. `window.matchMedia("(prefers-reduced-motion: no-preference)")` for React-managed animation); and even animations shorter than WCAG's 5-second thresholds should be avoided where a reduced-motion preference is set.

**Application.** This app's surfaces are prime motion surface area: the **pulsing/refreshing "live" dot**, the **progress bar fill animation**, the **refresh spinner**, the **timeline slide/transition** when the run-date tab or data-source changes, and any autocomplete popup fade/slide. Implementation notes: define motion tokens (duration/type) in the design system and gate them behind `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }`; for React state-driven animation use `useSyncExternalStore`/`matchMedia` to read the preference in JS and swap in static equivalents (a solid "Live" badge instead of a pulsing dot, a determinate progress value instead of an indeterminate shimmer); never make the only "data is updating" signal a spinner (add a `role="status"` live region announcing "Updating data… / Updated 2 min ago"). Prefer replacing motion with a static state change (colour, opacity, text) rather than removing the indicator entirely, so low-vision users still perceive the change.

---

## 3. Train-number search: combobox/listbox autocomplete (ARIA APG pattern)

**Sources**

- W3C WAI. *Combobox Pattern.* WAI-ARIA Authoring Practices Guide. https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- W3C WAI. *Editable Combobox With List Autocomplete Example.* APG. https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-list/
- MDN (2025). *ARIA: combobox role; aria-autocomplete; aria-activedescendant.* https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/combobox_role
- GOV.UK (govuk_publishing_components, 2021). *Accessibility acceptance criteria — autocomplete (Vararu, T., Watson, L., Horsford, E.).* https://docs.publishing.service.gov.uk/repos/govuk_publishing_components/accessibility_acceptance_criteria.html
- NN/g — McCloskey, M. (2014, foundational). *Keyboard-Only Navigation for Improved Accessibility.* https://www.nngroup.com/articles/keyboard-accessibility/
- Higley, S. (2019, foundational). *\<select\> your poison part 2: test all the things.* 24 Accessibility. https://www.24a11y.com/2019/select-your-poison-part-2/

**Evidence.** The APG defines the combobox as an input with a popup (listbox/tree/grid/dialog), with four autocomplete behaviours: none, list-with-manual-selection, list-with-automatic-selection, and list-with-inline. The required ARIA: `role="combobox"` **on the focusable input itself** (ARIA 1.2; the ARIA 1.0 "wrapper div with aria-owns" pattern is obsolete and breaks modern screen readers); `aria-expanded="true|false"` toggled on open/close; `aria-controls` referencing the popup; `aria-activedescendant` pointing at the currently highlighted `option` while **DOM focus never leaves the input**; `aria-autocomplete="list"` (or `both` if inline completion); popup is `role="listbox"` with `role="option"` children, `aria-selected` on the chosen option; a persistent accessible name via `<label for>`/`aria-labelledby`. Keyboard: Down opens the list and moves highlight, Up/Down move, Enter commits, Escape closes without clearing, Tab commits and moves on. The key interaction rule: keep the caret in the field while arrow keys move a *virtual* highlight (`aria-activedescendant`); never `focus()` an option. GDS's published 17-point autocomplete acceptance criteria operationalise this — the field must be keyboard-focusable, show focus, expose that it is editable, say when autocomplete is available and when the list expanded, announce match counts *as they change*, enable keyboard/touch navigation of matches, announce selection, confirm it, and **return focus to the field** after confirm. NN/g's foundational keyboard guidance covers the same ground at the behavioural level (all interactive elements reachable; focus must be obvious). Empirical testing (Higley, 24a11y) shows the filtered/autoselect combobox performs well when implemented to the current ARIA, but that filtering with no-results states and losing focus cause real failures — and that a native `<select>`/`<datalist>` is more robust than any hand-rolled widget where its constraints are acceptable.

**Application.** Use an APG-conformant combobox for surface (a), ideally via a headless library that already implements the pattern (e.g. React Aria's `useComboBox`, Downshift, Radix Combobox — pick a headless one so markup stays yours) rather than hand-rolling; the edge cases (async results, IME composition, virtualised long train-number lists) are exactly what libraries have fixed. Concrete notes: `role="combobox"` on the `<input>`, not a wrapper; pair `aria-controls` with the listbox `id`; keep `aria-expanded` true only while visible; toggle `aria-activedescendant` to the highlighted `option` id as arrows move; add a **visually hidden `aria-live="polite"` result-count region** separate from the listbox ("8 results", "No matches for 129" — satisfying 4.1.3 Status Messages) and announce it on every filter change; set `autocomplete="off"` on the input so the browser's native autofill popup doesn't collide; never auto-open on empty input; keep the label a real `<label>` so clicking it focuses the field; if the first match auto-selects, say so to AT and make committing explicit (Enter) — per GDS criterion 14.

---

## 4. Run-date picker: ARIA tabs vs buttons — which is correct, and the pitfalls

**Sources**

- W3C WAI. *Tabs Pattern.* WAI-ARIA APG. https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- W3C WAI. *Tabs With Manual Activation — Example.* APG. https://www.w3.org/WAI/ARIA/apg/patterns/tabs/examples/tabs-manual/
- W3C WAI. *Radio Group Pattern.* APG. https://www.w3.org/WAI/ARIA/apg/patterns/radio/
- W3C WAI. *Developing a Keyboard Interface* (roving tabindex; selection follows focus). APG Practices. https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- MDN (2025). *ARIA: tablist role; tab role.* https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/tablist_role

**Evidence.** The APG defines tabs as "a set of layered sections of content, known as tab panels, that display one panel of content at a time" — i.e. tabs exist to swap **panels of content**, and the tab is a *label* for a panel. Keyboard contract: roving tabindex (only the selected `tab` is `tabindex=0`; others `-1`), arrow Left/Right (Home/End optional) move focus between tabs, Space/Enter activate with **manual activation**, Tab moves into the panel. `aria-selected="true"` marks the active tab. The APG's own warning is the decisive one: automatic activation is "recommended…as long as their associated tab panels are displayed without noticeable latency"; where a panel takes time to render, selection-follows-focus is "extremely detrimental" — each arrow press triggers a slow load. Tabs are also semantically wrong when the widget is really a single-choice filter: the Radio Group pattern is the APG's model for "choose one of N options"; MDN and APG usage guidance reserve `tablist` for layered content, and MDN's tab example explicitly requires that every tab control *displays its associated panel*. A picker that merely changes which dataset (previous runs / today / next run) fills a timeline is closer to a **single-choice control (radio group / segmented buttons with `aria-pressed`)** than to a tabbed interface, especially because each change here would fetch data.

**Pitfalls if tabs are used regardless:** (1) putting `role="tab"` on elements that don't switch a real `tabpanel`; (2) leaving every tab `tabindex=0`, so Tab-stops explode and arrow-key conventions break; (3) `aria-selected` missing or set on non-tab buttons; (4) hiding panels with `display:none` but forgetting the `hidden` attribute semantics, or leaving hidden panels focusable; (5) automatic activation causing a network fetch per arrow press; (6) failing to label the tablist and panels (`aria-labelledby` wiring between tab ↔ panel).

**Application.** For surface (b), the correct, lowest-risk answer is **a 3-option single-select: segmented buttons (radio group) or toggle buttons with `aria-pressed`**, not `role="tab"` — because (i) it is a choice among datasets, not navigation among always-present layered panels, and (ii) every change triggers a data fetch, which is precisely the latency scenario the APG says tabs must not auto-activate through. If product insists on a tab *look*, implement it as a tablist **with manual activation only** (Space/Enter commits, arrows move focus without firing fetches), preload/cache panels so the active panel renders instantly, keep one `tabindex=0`, wire `aria-selected`, `aria-controls`, `aria-labelledby`, and never auto-open a fetch on focus. Keyboard ordering must make "Today" the initially focused/selected option, with Home/End to jump ends.

---

## 5. Minimum touch-target sizes

**Sources**

- W3C WAI (2023). *Understanding SC 2.5.8 Target Size (Minimum), Level AA.* https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- W3C (2021/2023). *SC 2.5.5 Target Size (Enhanced), Level AAA.* https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced
- Apple (2025). *Accessibility — Human Interface Guidelines; Buttons.* https://developer.apple.com/design/human-interface-guidelines/accessibility
- Google (2024). *Make apps more accessible; Touch target size.* https://developer.android.com/guide/topics/ui/accessibility/apps and https://support.google.com/accessibility/android/answer/7101858
- BBC (2023). *Target touch size — Accessibility for Products.* https://www.bbc.co.uk/accessibility/forproducts/guides/mobile/target-touch-size/

**Evidence.** WCAG 2.2 SC 2.5.8 (new, AA) requires every pointer target to be **at least 24×24 CSS px**, with five exceptions (spacing — a 24 px circle around an undersized target must not intersect another target; equivalent control; inline text; user-agent sized; essential). The AAA companion 2.5.5 asks for 44×44. Platform guidance is stricter than the WCAG floor: **Apple HIG — 44×44 pt** recommended minimum for iOS/iPadOS interactive controls (28 pt absolute minimum), with button centres ideally ≥60 pt apart; **Google/Material — 48×48 dp** with ≥8 dp separation; BBC — 7–10 mm (~44 px) targets. The exceptions matter: padding extends the hit area (a 16×16 icon inside a button with 4 px padding = 24×24); the *spacing* exception is the escape hatch for dense rows (two 16 px icons pass if their centres are ≥24 px apart). WCAG guidance explicitly warns undersized *height* is the most common real-world failure (a wide-but-16px-tall row). For touch, the OS guesses the intended target when targets are too small, producing mis-taps.

**Application.** Apply to every control: the **refresh button** (≥44 px hit area — it sits beside other controls, so spacing alone is risky), the **combobox options** (full-width rows, ≥24 px tall, 44 px where feasible on touch), the **run-date segments** (three adjacent buttons — each ≥24×24, aim ≥44 to avoid mis-taps on a packed toolbar), the **data-source gateway dropdown trigger**, and **delay badges/timeline rows if they are interactive** (make the whole row the target, minimum 44 px tall on mobile). Where a compact chip must stay small (e.g. a badge), pad the bounding box rather than the glyph, or keep 24 px of clear space around it. In Tailwind this maps to `min-h`/`min-w` utilities plus padding, not just font size.

---

## 6. Making colour not the sole carrier of on-time/delayed status

**Sources**

- W3C WAI (2023). *Understanding SC 1.4.1 Use of Color (Level A); Technique G14 (colour differences also available in text); Failure F81 (identifying required/error fields by colour differences only).* https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html ; https://www.w3.org/WAI/WCAG22/Techniques/general/G14 ; https://www.w3.org/WAI/WCAG22/Techniques/failures/F81
- IBM Carbon Design System (2022). *Status indicators.* https://v10.carbondesignsystem.com/patterns/status-indicator-pattern/
- De-Brito, C., et al. (2024). *Investigating Color-Blind User-Interface Accessibility via Simulated Interfaces.* MDPI Computers, 13(2), 53. https://doi.org/10.3390/computers13020053
- Zin, W., et al. (2023). *Passenger Perceptions, Information Preferences, and Usability of Crowding Visualizations on Public Displays in Transit Stations and Vehicles.* CHI 2023. https://doi.org/10.1145/3544548.3581241
- Hwang, H., Lee, E., & Choi, G.-S. (2020, foundational). *Wayfinding Signage for People with Color Blindness.* Journal of Interior Design. https://doi.org/10.1111/joid.12169

**Evidence.** SC 1.4.1 (Level A): "Color is not used as the only visual means of conveying information." The key word is *only*: colour may reinforce, but a non-colour channel (text, shape, pattern, icon, position, or a ≥3:1 lightness difference) must carry the same information. G14: the information conveyed by colour must "also be conveyed explicitly in text". F81 flags the exact failure pattern this app has — a state indicated **by colour differences only**. The CVD-relevant scale is large: ~1 in 12 men and 1 in 200 women have CVD; red-green confusion (protanopia/deuteranopia) is the most common form — precisely this app's green/amber/red status palette. Peer-reviewed evidence is direct: the CHI 2023 transit-crowding paper *explicitly notes that colour-based cues in public-transit displays "can create accessibility barriers for people with visual impairments (e.g. color blindness)"* and designs its visualisations to work monochrome; the 2024 MDPI CVD-simulation study found UIs that use colour to distinguish icons or signal state/errors are measurably harder to use under simulated CVD; the Journal of Interior Design wayfinding study confirms red/green confusion in real signage. IBM's Carbon system operationalises the requirement for enterprise status patterns: a status indicator is a combination of **colour + shape + symbol + text label**, and the documented rule is to include at least three of the four — *"Avoid designs with less than three indicators of status; using solely colour and symbols is inaccessible."* The practical test used across sources: **if the interface is equally understandable in grayscale, the use of red/green is appropriately supplemented** (colorblind.io; MDPI).

**Application.** For surface (d), the delay badge and status dot must gain a redundant channel immediately. Concrete: every badge carries visible text — **"On time"**, **"Delayed 12 min"**, **"Cancelled"** — plus a distinct shape/icon per state (filled circle/check ✓ for on-time, triangle/! for delayed, cross ✕ for cancelled), with green/amber/red used only as a reinforcing layer. The timeline's status column should differ in **position/geometry** as well (e.g. an icon column), not just hue. Because the theme is monochrome + three semantic colours, keep hue-differences AND lightness-differences ≥3:1 so the states also separate in grayscale/forced-colours mode. Add an aria-label/visible legend ("Green · on time ·  — amber · delayed · — red · cancelled") so assistive tech and monochrome/high-contrast users get the mapping. Grey-scale-check the whole timeline during design review; if any state is indistinguishable in grayscale, it fails 1.4.1.

---

## 7. Focus visibility and keyboard navigation for the timeline rows (and refresh/dropdown)

**Sources**

- W3C WAI (2023). *Understanding SC 2.4.7 Focus Visible (Level AA); Understanding SC 2.4.11 Focus Not Obscured (Minimum, AA); Understanding SC 2.4.13 Focus Appearance (AAA).* https://www.w3.org/WAI/WCAG22/Understanding/focus-visible ; https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum ; https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance
- W3C WAI. *Technique C45: Using CSS :focus-visible; Technique C40: two-colour focus indicator; Technique F78 (outlines/borders removed or non-visible).* https://www.w3.org/WAI/WCAG22/Techniques/css/C45
- W3C WAI. *Developing a Keyboard Interface* (tab sequence; roving tabindex; composites). APG. https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- GOV.UK Design System (n.d.). *Colour — focus token #ffdd00; GDS Way — keyboard focus states.* https://design-system.service.gov.uk/styles/colour/
- NN/g — McCloskey, M. (2014, foundational). *Keyboard-Only Navigation for Improved Accessibility.* https://www.nngroup.com/articles/keyboard-accessibility/
- Wang, H.-H. (2025). *Test Keyboard Accessibility On Your Website.* NN/g. https://www.nngroup.com/videos/no-mouse-keyboard-accessibility/
- Eberman, B., et al. (2023). *BAGEL: An Approach to Automatically Detect Navigation-Based Web Accessibility Barriers for Keyboard Users.* CHI 2023. https://doi.org/10.1145/3544548.3580749

**Evidence.** SC 2.4.7 (AA) requires a visible keyboard-focus indicator for every keyboard-operable component; its Understanding notes the indicator is subject to 1.4.11 (≥3:1). WCAG 2.2 added **2.4.11 Focus Not Obscured (AA)** — a focused component must not be entirely hidden by author content (sticky headers/refresh overlays count) — and **2.4.13 Focus Appearance (AAA)**: the indicator must be at least the area of a **2 CSS-px-thick perimeter** of the component and change contrast by **≥3:1** between focused/unfocused states. C45 (sufficient) routes focus styling through `:focus-visible` so the ring appears only for keyboard nav while mouse clicks stay clean. GOV.UK's standard is a high-visibility **yellow (`#ffdd00`) background with `#0b0c0c` text** used *only* for the focused state. NN/g's foundational and 2025 research is blunt: removing or hiding the focus indicator is "catastrophic" for keyboard users (a common cause is `outline:none` reset styles); focus must be obvious and consistent, tab order must match visual layout, and every widget (dropdowns, popups, dialogs) must be fully keyboard-traversable — NN/g's video guidance repeats the same test: Tab through the whole app with no mouse and every control must show where it is. Peer-reviewed support: the CHI 2023 BAGEL study measured "unapparent focus" as one of three common keyboard-navigation failure types on real sites, finding that `outline:0`/reset styles and faint default outlines are pervasive. APG keyboard practice: in a composite widget (a list of rows), the tab sequence should expose **one** entry point, then arrow keys move inside (roving tabindex); exposing every row as a Tab stop forces users to tab through the whole timeline.

**Application.** Timeline rows (d): if rows are interactive (tap to expand/drill into a train), make each row a real `<button>`/`<a>` (never a `<div>` with a click handler) with a `:focus-visible` ring meeting 2.4.13 (≥2 px perimeter, ≥3:1 change against the card). Prefer **roving tabindex or a grid/list pattern** so Tab lands once on the list and arrow keys move between rows — otherwise a 40-row timeline becomes 40 Tab stops (the NN/g sequential-access problem). Keep the **sticky status/refresh header** out of the way of focus: ensure a focused row is never permanently hidden behind the sticky bar (scroll-padding + no fixed overlay — 2.4.11), and that auto-scroll "live updates" never yank focus. The refresh button, gateway dropdown, combobox, and run-date segments all need the same ring; the dropdown's open/close chevron needs a visible focused state; and after selecting from the combobox or gateway dropdown, focus must return to the field/trigger (GDS criterion 17; APG). Add a "skip to timeline" link at the top so keyboard users bypass the toolbar (NN/g). Finally, verify with the GDS/axe manual checklist — automated tools catch ~30% of issues (GDS Way), so do a real Tab-through and a screen-reader pass per release.

---

## Non-negotiables for the re-architecture

Ordered by legal/conformance floor (AA), then hard usability requirements, then forward-compatible additions.

**Contrast (surfaces a–e)**
1. Every text token pair meets WCAG 2.2 AA — 4.5:1 normal / 3:1 large — measured against its **actual** background (card surface, badge surface, selected-state surface), in light and dark token sets.
2. Non-text elements meet 1.4.11 (≥3:1): badge/chip borders and fills, status dots, progress-bar track-vs-fill, dropdown chevrons, input borders, focus indicators.
3. **Muted-on-muted is banned by default.** Any `--muted-foreground`-style token must additionally reach **APCA Lc ≥ 75** for body/secondary text (Lc ≥ 60 for large/UI text); record the Lc value as a comment on every foreground token and re-audit on any token change. Document the token's target Lc alongside the HSL value.
4. No token ships on a "passes 4.5:1 but looks grey-on-grey" basis — the WCAG 2 ratio is treated as suspect for light-on-light pairs until APCA confirms readability.

**Motion (surface e)**
5. All animation/transition motion is gated behind `@media (prefers-reduced-motion: reduce)` in CSS **and** a `matchMedia`/JS path for React-driven animation (spinner, pulsing live dot, progress shimmer, panel transitions).
6. "Data is updating" is never conveyed by motion alone — a `role="status"` live region announces refresh/update events and result counts.

**Combobox (surface a)**
7. Implement the APG combobox (or a headless library implementing it): `role="combobox"` on the input, `aria-expanded`, `aria-controls` → `role="listbox"` with `role="option"` children, `aria-activedescendant` for virtual focus, `aria-autocomplete`, `aria-selected`, stable option ids, visible `<label>`.
8. DOM focus never leaves the input while navigating options; Enter commits, Escape closes without clearing; `autocomplete="off"`; a visually hidden polite live region announces match counts (4.1.3); focus returns to the input after commit.

**Run-date picker (surface b)**
9. Implement as a **segmented single-select (radio group or `aria-pressed` toggle buttons), not `role="tab"`**, because it selects a dataset and every change triggers a fetch. If a tablist look is kept, manual activation only (arrows move focus without fetching), one `tabindex=0`, `aria-selected`/`aria-controls`/`aria-labelledby` wired, panels preloaded/cached.

**Targets (all surfaces)**
10. Every pointer target ≥24×24 CSS px (WCAG 2.2 AA 2.5.8); target **44 px on touch** (Apple 44 pt / Material 48 dp) for the refresh button, run-date segments, gateway trigger, combobox options, and any interactive timeline row; use padding for hit-area, not glyph size; keep 24 px clearance around small chips.

**Colour-not-sole-carrier (surface d)**
11. Every status is carried by **text + shape/icon + position**, with colour as a reinforcement only (meets 1.4.1/G14): "On time" + ✓/filled circle, "Delayed 12 min" + triangle/!, "Cancelled" + ✕ — plus a visible legend and programmatic labels. Grey-scale test: no state may be distinguishable by hue alone.
12. Keep ≥3:1 lightness separation between the three status colours so states also separate in grayscale and forced-colours mode.

**Focus & keyboard (surfaces b–e)**
13. `:focus-visible` ring on every control meeting 2.4.13 shape (≥2 px perimeter) and ≥3:1 contrast change (GOV.UK-style high-visibility treatment); no `outline:none` without a replacement.
14. Timeline list = one Tab entry + arrow-key navigation (roving tabindex / list pattern), not a Tab stop per row; skip-to-timeline link; focused row never obscured by sticky headers/refresh overlays (2.4.11) and never stolen by auto-scroll.
15. Full keyboard path verified per release: Tab-through with no mouse + a screen-reader pass (automated tools catch ~30% of issues — GDS Way).

**Process**
16. Contrast and reduced-motion checks are part of the design-system CI (token pair tests; `prefers-reduced-motion` fixture), and every component ships its WCAG criterion + acceptance criteria in its docs (GDS practice).

---

Research only — no code changes.
