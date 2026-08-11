# 05 — Design Systems, Design Tokens & Component Architecture for a Live-Data UI

**Purpose.** Evidence-based guidance for re-architecting a web app that shows live running status of Indian Railways trains, where the current UI is built from page-scoped components that repeat the same Tailwind class strings (card shells, mono uppercase labels, pill badges, stat tiles, buttons). The plan is to extract a small shared "primitives" layer and organise features as vertical slices. This document answers: *which parts of a design system / token architecture actually earn their maintenance cost, where the primitive-vs-semantic seam belongs, and when duplication should be extracted into a shared component.*

**Method.** This topic is not well served by peer-reviewed HCI venues, so the evidence base is the closest thing to primary sources that exists: the W3C Design Tokens Community Group specification (a W3C-hosted open standard), official design-system documentation from major vendors (Material Design 3, Adobe Spectrum, Salesforce Lightning, Shopify Polaris, GOV.UK, IBM Carbon), the canonical refactoring literature (Fowler; Metz), and the two largest public industry surveys of design-systems practice (Sparkbox 2021; Supernova 2024). Practitioner-pattern material (class-variance-authority, shadcn/ui, Kent C. Dodds) is explicitly labelled as consensus practice rather than empirical evidence and is used only to operationalise the higher-trust findings. Works outside the 2021–2026 window appear only where they are the canonical source of a claim and are flagged ***(foundational)***.

---

## 1. Design tokens — the empirical case for (and the counterpoint)

### 1.1 A token layer is the standard answer to cross-team design drift

**Sources**

- Design Tokens Community Group (2025). *Design Tokens Format Module 2025.10.* W3C. https://www.designtokens.org/tr/2025.10/format ; announcement https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
- Google (2024). *Material Design 3 — Design tokens overview.* https://m3.material.io/foundations/design-tokens/overview
- Shopify. *Polaris tokens* (quoting Salesforce). https://github.com/Shopify/polaris-tokens
- Supernova (2024). *State of Design Tokens 2024.* https://www.supernova.io/state-of-design-tokens
- Sparkbox (2021). *2021 Design Systems Survey.* https://sparkbox.com/foundry/2021_design_systems_survey

**Evidence.** The canonical definition, from Salesforce and adopted by Shopify Polaris: design tokens are "the visual design atoms of the design system — specifically, they are named entities that store visual design attributes" (e.g. a named colour instead of a hex code). The W3C Design Tokens Community Group — 20+ editors from Adobe, Amazon, Google, Microsoft, Meta, Shopify, Salesforce and Figma — shipped the first stable, vendor-neutral token format (2025.10, October 2025) after four years of drafts. Its own announcement states the problem the standard exists to solve: teams maintaining multi-brand design systems "juggle dozens or even hundreds of token files manually, leading to drift, errors, and maintenance overhead." Material Design 3 documents tokens as the system's "single source of truth," tokenising every design decision so themes and colour roles can be swapped without touching components. Supernova's *State of Design Tokens 2024* (200+ surveyed designers/developers) found tokens near-universal in practice — the dominant mechanism being token support inside design tools rather than bespoke infrastructure. The Sparkbox survey (370+ practitioners) shows shared components and shared style values are the norm in teams that have a system, while teams that do not consistently cite the same cost of entry: time, governance, and tooling. Note that most of this evidence is adoption/consensus data, not controlled experiments — the *mechanism* behind it (single source of truth → one edit propagates) is structural, not a measured effect.

### 1.2 But tokens are a foundation, not the product — the counterpoint

**Source**

- Curtis, N. (2026). *"We're Focused Too Much on Design Tokens."* Interview, Design Systems Collective. https://www.designsystemscollective.com/were-focused-too-much-on-design-tokens-nathan-curtis-on-design-systems-today-a329fdd79d4c

**Evidence.** The field's most senior practitioner (embedded in 100+ systems) argues the community has over-indexed: "our community is focused too much on design tokens. Every day people are posting some design token tool they built or article they wrote that solves the same design token challenge in a subtly different way." His push is to think beyond theming — "often just colour theming" — toward the harder, more valuable work: component props, token taxonomy, behaviour, and compositional structure. This matters as a scoping guardrail: a two-developer app extracting a token infrastructure "because design systems do it" is exactly the waste Curtis is calling out.

**Application.** Adopt a token layer as the styling seam — in Tailwind 4 that is the `@theme` block, which maps design decisions to CSS variables in one place — but keep it deliberately small. Capture only what the app actually repeats: the status palette (on-time / late / cancelled / stale-failure / neutral), the mono uppercase label treatment, radii, and the spacing scale. Do not build a multi-brand theming pipeline for an app with one brand. The token layer's job here is to make the status palette a one-line change, not to run a design-token toolchain.

## 2. Primitive vs semantic tokens — where the seam belongs

### 2.1 Mature systems layer raw values → semantic roles → component tokens

**Sources**

- Adobe (2024). *Spectrum design data — tokens.* https://opensource.adobe.com/spectrum-design-data/tokens/ ; *Spectrum — design tokens.* https://spectrum.adobe.com/page/design-tokens/
- Google (2024). *Material Design 3 — Color roles.* https://m3.material.io/styles/color/roles
- GOV.UK (2024). *Colour — Design System* (functional colours). https://design-system.service.gov.uk/styles/colour/ ; *Brand colour* (web functional palette). https://brand.design-system.service.gov.uk/colour/web/
- IBM (2021). *Carbon v10 — Themes.* https://v10.carbondesignsystem.com/guidelines/themes/code/
- Curtis, N. (2016, foundational). *Tokens in Design Systems.* https://nathanacurtis.substack.com/p/tokens-in-design-systems-25dd82d58421 ; *Naming Tokens in Design Systems.* https://nathanacurtis.substack.com/p/naming-tokens-in-design-systems-9e86c7444676

**Evidence.** Adobe Spectrum is the clearest formalisation: three named tiers. The **palette** holds raw values (e.g. `gray-500`, specific hex codes); **aliases** are semantic tokens that reference the palette (e.g. `text`, `background`, `info`) — the docs state aliases "are the semantic colour tokens that reference the palette"; **component tokens** bind aliases to components (e.g. button foreground). Material 3 does the same thing with **colour roles** (`primary`, `on-primary`, `surface`, `error`…): roles are semantic, can be re-themed wholesale via dynamic colour, and each role *pair* is engineered to meet WCAG contrast, so an inaccessible pairing is structurally hard to produce. GOV.UK's **functional colours** (`govuk-colour("red")` used for error/alert, `"green"` for success) are semantic names that survive palette changes. IBM Carbon separates **theme tokens** (background/text — these change per theme: white, g10, g90, g100) from **core tokens** (spacing, type scale — constant across themes). Curtis's naming guidance distils the seam: name a token for *what it is* (a category + a role), not for *where it is used*, so it stays reusable.

**Evidence quality note.** These are industry design decisions from primary system documentation, not measured results; their convergent shape (all four systems independently arrived at the same three-tier layering) is the strongest signal available.

**Application.** The app's real need is semantic tokens for *status semantics*, not a full primitive palette. Define one semantic token per status — on-time, late, cancelled, stale/unknown — each resolving to a colour. A policy change ("cancelled is amber, not red") is then a single token edit, and every pill, stat tile, and status line updates together. In Tailwind 4, expose these through `@theme` as theme variables so components reference `--color-on-time` / `--color-cancelled` rather than hex or Tailwind's default palette. Leave the full primitive → semantic → component ladder to the day the app actually ships multiple brands or dark mode.

## 3. Component reuse and maintenance cost — evidence and limits

### 3.1 Reuse delivers consistency; efficiency only arrives with governance

**Sources**

- Visnapuu, J. (2023). *Consistency, Efficiency, and Scalability in Design Systems.* Master's thesis, Uppsala University (***student thesis, not peer-reviewed***). https://www.diva-portal.org/smash/record.jsf?pid=diva2:1802144
- Sparkbox (2021). *2021 Design Systems Survey.* https://sparkbox.com/foundry/2021_design_systems_survey
- Design Tokens Community Group (2025). *First stable version* announcement. https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/

**Evidence.** The only close-to-academic treatment found, an Uppsala thesis (2023) comparing Material Design, Apple Human Interface Guidelines, and IBM Carbon, concludes the primary measurable benefit of a shared design system is **consistency**; efficiency through reuse is real but *secondary and conditional* — it only materialises when governance (component ownership, contribution process, documentation) is in place. Without governance, shared components decay and teams route around them. Sparkbox's survey corroborates the conditionality: respondents in teams without a system most often explain it by cost/time rather than need, while those with systems treat shared components as the baseline. The DTCG announcement supplies the cost side of the ledger for *unmanaged* sharing: manual file duplication across teams is what "leads to drift, errors, and maintenance overhead." The honest synthesis: **reuse pays when the shared thing is small, stable, and owned; it loses money when it is large, speculative, or unowned.**

**Application.** Extract only primitives that are (a) genuinely repeated across pages today, and (b) small enough to be stable — the Card shell, the Stat tile, the Pill/Badge, the mono-uppercase Label, the Button. Make them presentational ("dumb") components that know nothing about trains or providers, so reuse never couples shared UI to domain logic. Keep them in the app repo (see §5.2's copy-paste model) rather than a separately-published library, which removes most of the governance cost the evidence says is required to make reuse pay.

## 4. Variant-based component APIs vs many props

### 4.1 A small, enumerated variant set beats free-form configuration

**Sources**

- joe-bell (2024). *class-variance-authority (CVA).* https://cva.style ; https://github.com/joe-bell/cva
- Dodds, K. C. (2025). *Compound Components: Truly Flexible React APIs.* Epic React. https://www.epicreact.dev/compound-components-truly-flexible-react-apis-5nu15
- Salesforce. *Lightning Web Components — variant attribute* (component-level docs). https://developer.salesforce.com/docs/component-library/documentation/en/lwc

**Evidence.** *(Practitioner consensus, not controlled evidence — no peer-reviewed studies exist on this axis.)* Three independent strands converge. First, Lightning Web Components — Salesforce's component library used by thousands of teams — exposes a single `variant` attribute on its components (e.g. base/neutral/brand/destructive for a button) instead of free-form styling props, treating the enumerated variant as part of the public API. Second, class-variance-authority (CVA, Apache-2.0, the standard Tailwind/React variant helper and the mechanism inside shadcn/ui) formalises exactly this shape: `variants`, `compoundVariants` (combinations of variants), and `defaultVariants` — a finite, declared set of appearance options rather than an open-ended prop surface. Third, Kent C. Dodds's argument against the alternative — the **props explosion** — is that a component accumulating conditional props ("if `size === …`", "if `tone === …`") becomes a config engine rather than a component; his preferred alternative for flexibility is composition via the compound-component pattern (context + subcomponents, as in Radix), not more props. The reasoning shared by all three: an enumerated variant set keeps the API small, keeps the visual system closed (you cannot express a state the system does not own), and keeps status/error styling centralised instead of re-spelled per call site.

**Application.** The Pill/Badge and Button primitives should expose a small enumerated `variant` prop — for the pill: `on-time | late | cancelled | stale | neutral`, resolved to the semantic tokens from §2 — and nothing else visual. This is precisely the LWC shape. Do not add free-form colour or size props: with the failover chain serving different data quality, forcing status colouring through the variant enum is what keeps every failure state visually consistent and auditable. Use CVA's `compoundVariants` if a status must also change shape (e.g. a pill that adds an icon when cancelled), and fall back to composition (compound components) only if a future feature genuinely needs structure a variant cannot express.

## 5. When to abstract — the rule of three and the cost of premature abstraction

### 5.1 Three strikes, then refactor — and prefer duplication to the wrong abstraction

**Sources**

- Fowler, M. (1999, foundational). *Refactoring* — the "Rule of Three," attributed to Don Roberts. Summarised at https://www.incusdata.com/blog/refactoring-the-rule-of-three and https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming)
- Metz, S. (2016, foundational). *The Wrong Abstraction.* https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction
- Dodds, K. C. (2020, foundational). *AHA — Avoid Hasty Abstractions* (summary). https://dev.to/cher/avoiding-hasty-abstractions-aha-programming-3d3b

**Evidence.** The "Rule of Three" (Fowler, *Refactoring*, crediting Don Roberts) is the canonical cost rule: the first time you see duplication, do nothing; the second time, note the similarity; the third time, refactor — "three strikes and you refactor." The rationale is that only the third occurrence is enough information to extract the *right* shape. Sandi Metz's *The Wrong Abstraction* supplies the failure mode and is unambiguous: "duplication is far cheaper than the wrong abstraction" and "prefer duplication over the wrong abstraction." Her point is not anti-abstraction — it is that refactoring is how abstractions evolve, and a wrong abstraction (extracted too early, or from two dissimilar cases) taxes every future change. Kent C. Dodds's AHA principle refines the criterion from *code* duplication to *intent* duplication: extract when the same intent repeats (even if the code differs), not merely when the same string repeats — which is the difference between a Card shell that is the same *shape* everywhere and two unrelated things that merely look alike.

**Application.** Before extracting the shared primitives, count genuine occurrences and check intent. A Card shell appearing in 5+ places with the same anatomy (title row, content, footer) passes the Rule of Three and shares intent — extract it. A "stat tile" that is really two different intents (live running status vs historical on-time %) that merely share styling is the Wrong Abstraction trap — keep the duplication until a third, intent-matching case exists, then abstract. Extract at the moment of the third use, not in advance.

### 5.2 Own the primitives in-repo (the shadcn/ui copy-paste model)

**Source**

- shadcn/ui (2024). *Docs — "Why" / installation philosophy.* https://ui.shadcn.com/docs

**Evidence.** *(Practitioner consensus.)* shadcn/ui popularised an inversion of the distribution model: components are **copied into your repository** rather than installed as an opaque library, so "you own your code." This is a middle path between two expensive options the earlier evidence rules out — no distributed library (whose governance cost §3.1 says is where reuse stops paying) and no bespoke internal framework. Its adoption across a very large number of projects is itself evidence that owning small, presentational, copy-pasteable primitives in-repo is an accepted way to get §3's benefits at minimal governance cost.

**Application.** Put the extracted primitives in an in-repo `components/primitives` directory (or equivalent) with no external dependency beyond the token variables. The vertical slices (train status page, schedule page, etc.) consume the primitives by composition — exactly the shape Curtis's workshop material describes as "UI component composition and subcomponents." This keeps the shared layer thin enough that §3's governance requirement is effectively satisfied by code review alone.

---

## Top 5 transferable principles

1. **Tokens are a seam, not a product.** Use Tailwind 4 `@theme` as a single source of truth for the handful of decisions the app repeats — but stop there; no token toolchain or multi-brand pipeline (Curtis 2026; DTCG 2025).
2. **Name tokens for semantics, not use.** Model the five statuses (on-time / late / cancelled / stale / neutral) as semantic tokens that resolve to colours, so a palette change is one edit and every pill, stat tile, and status line updates together (Spectrum, M3, GOV.UK, Carbon).
3. **Reuse pays only for small, stable, owned primitives.** Extract the Card shell, Stat tile, Pill/Badge, Label, and Button; keep them presentational and in-repo so the governance cost reuse requires stays at code-review level (Uppsala 2023; Sparkbox 2021).
4. **Give primitives an enumerated variant API, not free-form props.** `variant="on-time | late | cancelled | stale | neutral"` closes the visual system and centralises failure-state styling; reach for composition (compound components) only when a variant cannot express the structure (LWC, CVA, Dodds 2025).
5. **Three strikes before you abstract; duplicate is cheaper than wrong.** Count occurrences and check *intent* before extracting; at the third intent-matching use, refactor (Fowler; Metz; Dodds 2020).
