# Run Edit Run Accessibility Conformance Report

VPAT® Version 2.5 Rev, Revised Section 508 Edition (April 2025).

Product name: Lamp
Product version: 1.11.0
Evaluation date: 23 October 2026 (UTC; 2026-10-23)
Report date: 23 October 2026

## Product description

Lamp is a self-hostable status page and incident communication application. It publishes public component states, incident and maintenance permalinks, history and subscription forms; its operator application composes those records. This report describes the release source, not a separately deployed installation or every possible owner-authored message.

Contact for accessibility questions or defects: [Lamp repository issues](https://github.com/just-every/run-lamp/issues). Include the page, browser, assistive technology and steps; do not include private subscriber or incident information.

## Notes and scope

This is a limited evaluation report, not a declaration that Lamp meets every WCAG 2.2 AA criterion. No criterion is marked Supports before criterion-specific evidence has been measured in this round. The conservative Partially Supports entries below flag incomplete evaluation; they do not assert that an automated pass proves a complete criterion. This reporting limitation is stated explicitly because the ITI template reserves Not Evaluated for Level AAA, and this report contains only A and AA tables.

Public status, history, incident permalink, subscription management and maintenance permalink are the intended browser scope. Private pages are Not Applicable to this release surface because AUD-002 has not shipped: there is no private-page implementation to evaluate. This does not waive PAGE-020's future private-page obligation. Subscriber emails, email client combinations, all operator screens, translated content, every page layout, owner-customized themes and all error/empty/hover states are not fully measured. No overall conformance claim covers those surfaces.

The public footer's Accessibility (VPAT) link is not yet present; that composition is held by the owner UI pass. The report itself is public on the app host at `/docs/accessibility/vpat`.

## Evaluation methods used

The report structure follows the [ITI VPAT® 2.5 Rev 508 public template](https://www.itic.org/dotAsset/c9497d16-4684-480c-bae2-99256283731c.docx), read on 23 October 2026, and the [ITI instructions](https://www.itic.org/policy/accessibility/vpat).

Evaluation status for this candidate: browser measurements pending. The repository's existing `tests/e2e/accessibility.test.mjs` uses axe-core 4.12.1 with WCAG 2 A/AA, 2.1 AA and 2.2 AA tags at 1440 and 390 pixels. The additional maintenance/subscription journey is `tests/e2e/maintenance-timezone.test.mjs`. Planned measurements include serious/critical axe findings, horizontal overflow, a keyboard-only subscription and management journey, focus order and visible focus. A future edit may record a run only after it completes successfully on the candidate. This paragraph currently claims no successful run.

Automated testing cannot establish complete WCAG conformance. No human screen-reader session was run; a live-region attribute assertion is not an assertion that a screen reader announces it. No zoom, alternative input device, speech recognition, braille display or email-client compatibility evaluation is claimed.

## Applicable standards and guidelines

| Standards and Guidelines | Included in this report |
| --- | --- |
| WCAG 2.0 Level A and AA (ISO/IEC 40500), the Revised Section 508 baseline | Yes, limited evaluation as detailed per criterion |
| Revised Section 508, published 18 January 2017 and corrected 22 January 2018 | Yes, Chapters 3, 5 and 6; hardware is not supplied |
| WCAG 2.1 and 2.2 Level A and AA | Supplemental product benchmark, not an assertion of overall conformance; later-version criteria are labelled |

## Terms

Supports: the functionality has at least one method that meets the criterion without known defects or meets with equivalent facilitation.

Partially Supports: some functionality does not meet the criterion. In this report this conservative level also identifies criteria whose full scope is unmeasured, as disclosed in Notes; it must not be read as complete evaluation or a claim of Supports.

Does Not Support: the majority of functionality does not meet the criterion.

Not Applicable: the criterion is not relevant to the product or surface, with the reason stated.

## Chapter 3 Functional Performance Criteria

| Criterion | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| 302.1 Without Vision | Partially Supports | No human screen-reader or braille evaluation was performed. |
| 302.2 With Limited Vision | Partially Supports | Two viewport widths do not establish zoom, magnification or low-vision conformance. |
| 302.3 Without Perception of Color | Partially Supports | States include text labels; every surface and owner theme has not been manually evaluated. |
| 302.4 Without Hearing | Partially Supports | The named web journeys use no audio; a complete content and documentation review remains unmeasured. |
| 302.5 With Limited Hearing | Partially Supports | No assistive-hearing evaluation was performed. |
| 302.6 Without Speech | Partially Supports | Named journeys use no speech input; all workflows have not been evaluated. |
| 302.7 With Limited Manipulation | Partially Supports | A keyboard subscription journey covers a subset; complete alternative-input operation is unmeasured. |
| 302.8 With Limited Reach and Strength | Partially Supports | Device, switch and alternative-input operation have not been evaluated. |
| 302.9 With Limited Language, Cognitive, and Learning Abilities | Partially Supports | Plain text status labels exist; no cognitive accessibility evaluation was performed. |

## WCAG 2.x Level A

Table 1: Success Criteria, Level A. Version suffixes identify supplemental WCAG 2.1/2.2 criteria. Remarks apply to web content, web software and electronic documentation; unmeasured content is not covered by a Supports claim.

| Criterion | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| 1.1.1 Non-text Content | Partially Supports | Automated accessible-name checks cover rendered controls and images in the named journeys; human judgment of every author-supplied image alternative remains unmeasured. |
| 1.2.1 Audio-only and Video-only (Prerecorded) | Partially Supports | No audiovisual media is used by the evaluated status and subscription journeys; author-supplied media and future surfaces have not been evaluated. |
| 1.2.2 Captions (Prerecorded) | Partially Supports | No audiovisual media is used by the evaluated status and subscription journeys; author-supplied media and future surfaces have not been evaluated. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | Partially Supports | No audiovisual media is used by the evaluated status and subscription journeys; author-supplied media and future surfaces have not been evaluated. |
| 1.3.1 Info and Relationships | Partially Supports | Axe checks selected structural relationships; complete document semantics and every email rendering have not been manually evaluated. |
| 1.3.2 Meaningful Sequence | Partially Supports | DOM order is inspected by the subscription keyboard journey only; all reading sequences remain unmeasured. |
| 1.3.3 Sensory Characteristics | Partially Supports | States have textual names; every instruction and author-created message has not been manually evaluated. |
| 1.4.1 Use of Color | Partially Supports | Named states use text labels as well as color; a complete non-color visual review of every surface remains unmeasured. |
| 1.4.2 Audio Control | Partially Supports | The evaluated journeys emit no audio; other embedded or author-provided content has not been evaluated. |
| 2.1.1 Keyboard | Partially Supports | The subscription and management journey uses keyboard-only interaction; complete operator and docs keyboard coverage remains unmeasured. |
| 2.1.2 No Keyboard Trap | Partially Supports | The subscription and management journey checks keyboard progress; all dialogs and operator flows remain unmeasured. |
| 2.1.4 Character Key Shortcuts (2.1) | Partially Supports | Character-key shortcut settings across all surfaces have not been evaluated. |
| 2.2.1 Timing Adjustable | Partially Supports | Session limits, link expiry and all adjustable time limits have not been evaluated for accessibility. |
| 2.2.2 Pause, Stop, Hide | Partially Supports | Automatic status refresh exists; a manual pause and moving-content evaluation has not been performed. |
| 2.3.1 Three Flashes or Below Threshold | Partially Supports | A flash-frequency evaluation has not been performed. |
| 2.4.1 Bypass Blocks | Partially Supports | Axe includes bypass/landmark checks where available; complete repeated-block keyboard review remains unmeasured. |
| 2.4.2 Page Titled | Partially Supports | Axe checks document titles on named pages; every document and failure state has not been evaluated. |
| 2.4.3 Focus Order | Partially Supports | The subscription and management journey asserts keyboard focus order; all other routes and dynamic states remain unmeasured. |
| 2.4.4 Link Purpose (In Context) | Partially Supports | Axe checks link names; human review of every link purpose in authored incident/report content remains unmeasured. |
| 2.5.1 Pointer Gestures (2.1) | Partially Supports | Pointer, gesture, motion and target-size behavior has not been completely manually evaluated. |
| 2.5.2 Pointer Cancellation (2.1) | Partially Supports | Pointer, gesture, motion and target-size behavior has not been completely manually evaluated. |
| 2.5.3 Label in Name (2.1) | Partially Supports | Pointer, gesture, motion and target-size behavior has not been completely manually evaluated. |
| 2.5.4 Motion Actuation (2.1) | Partially Supports | Pointer, gesture, motion and target-size behavior has not been completely manually evaluated. |
| 3.1.1 Language of Page | Partially Supports | Axe language checks are included on named pages; authored content and every email client remain unmeasured. |
| 3.2.1 On Focus | Partially Supports | The keyboard subscription journey checks expected focus progression; every focus-triggered state remains unmeasured. |
| 3.2.2 On Input | Partially Supports | The subscription journey follows explicit submit controls; every input-triggered state remains unmeasured. |
| 3.2.6 Consistent Help (2.2) | Partially Supports | Help placement and availability across all public and operator documents remain unmeasured. |
| 3.3.1 Error Identification | Partially Supports | The successful subscription journey does not cover every validation error and accessible error association. |
| 3.3.2 Labels or Instructions | Partially Supports | Axe checks some accessible labels; all authored instructions and error states remain unmeasured. |
| 3.3.7 Redundant Entry (2.2) | Partially Supports | Repeated entry and autofill across every journey have not been evaluated. |
| 4.1.1 Parsing (WCAG 2.0/2.1; removed in 2.2) | Partially Supports | This obsolete-in-2.2 criterion is retained for the Section 508/WCAG 2.0 baseline; full HTML parsing conformance has not been evaluated. |
| 4.1.2 Name, Role, Value | Partially Supports | Axe inspects accessible names, roles and values on named pages; complete assistive-technology interaction remains unmeasured. |

## WCAG 2.x Level AA

Table 2: Success Criteria, Level AA. No Level AAA claim is made.

| Criterion | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| 1.2.4 Captions (Live) | Partially Supports | No audiovisual media is used by the evaluated status and subscription journeys; author-supplied media and future surfaces have not been evaluated. |
| 1.2.5 Audio Description (Prerecorded) | Partially Supports | No audiovisual media is used by the evaluated status and subscription journeys; author-supplied media and future surfaces have not been evaluated. |
| 1.3.4 Orientation (2.1) | Partially Supports | The named journeys use desktop and phone portrait viewports; landscape behavior and orientation restriction have not been evaluated. |
| 1.3.5 Identify Input Purpose (2.1) | Partially Supports | Input-purpose coverage outside the subscription journey is unmeasured. |
| 1.4.3 Contrast (Minimum) | Partially Supports | Axe color-contrast checks are included on named rendered pages; all states, images, email clients and author choices remain unmeasured. |
| 1.4.4 Resize Text | Partially Supports | The round uses two viewport widths; text zoom to 200 percent has not been evaluated. |
| 1.4.5 Images of Text | Partially Supports | No image-of-text review of every uploaded logo or authored content has been performed. |
| 1.4.10 Reflow (2.1) | Partially Supports | The named browser journeys inspect horizontal overflow at 390 pixels; 320 CSS pixels and all responsive states remain unmeasured. |
| 1.4.11 Non-text Contrast (2.1) | Partially Supports | Non-text control and focus-indicator contrast has not been manually measured across all states. |
| 1.4.12 Text Spacing (2.1) | Partially Supports | User text-spacing overrides have not been evaluated. |
| 1.4.13 Content on Hover or Focus (2.1) | Partially Supports | Hover/focus content across all screens has not been manually evaluated. |
| 2.4.5 Multiple Ways | Partially Supports | Navigation provides links, but alternate ways to find every public and operator page have not been evaluated. |
| 2.4.6 Headings and Labels | Partially Supports | Axe checks certain label and heading properties; descriptive quality across all content remains unmeasured. |
| 2.4.7 Focus Visible | Partially Supports | The subscription journey asserts visible keyboard focus; all other controls and themes remain unmeasured. |
| 2.4.11 Focus Not Obscured (Minimum) (2.2) | Partially Supports | The subscription journey inspects focused control geometry; every overlay and scroll position remains unmeasured. |
| 2.5.7 Dragging Movements (2.2) | Partially Supports | Pointer, gesture, motion and target-size behavior has not been completely manually evaluated. |
| 2.5.8 Target Size (Minimum) (2.2) | Partially Supports | Pointer, gesture, motion and target-size behavior has not been completely manually evaluated. |
| 3.1.2 Language of Parts | Partially Supports | Language changes inside author-supplied text have not been evaluated. |
| 3.2.3 Consistent Navigation | Partially Supports | Consistent navigation across every document has not been manually evaluated. |
| 3.2.4 Consistent Identification | Partially Supports | Consistent identification across every document and email has not been manually evaluated. |
| 3.3.3 Error Suggestion | Partially Supports | Error suggestions have not been evaluated across all forms. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Partially Supports | Reversible changes, review and confirmation for every deletion and publication have not been evaluated for accessibility. |
| 3.3.8 Accessible Authentication (Minimum) (2.2) | Partially Supports | Authentication cognitive-function and assistive-technology behavior have not been evaluated. |
| 4.1.3 Status Messages (2.1) | Partially Supports | Live-region markup can be inspected by automation; actual screen-reader announcement timing and all status messages have not been measured. |

## Chapter 4 Hardware

| Criterion | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| 401–415 Hardware | Not Applicable | Lamp supplies web software and documentation, not physical hardware. |

## Chapter 5 Software

WCAG responses above apply to web software and content. The report does not treat browser or operating-system accessibility as a substitute for evaluating Lamp.

| Criterion | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| 501.1 Scope | Partially Supports | The A/AA tables identify limited web-software evaluation; complete conformance is unmeasured. |
| 502 Interoperability with Assistive Technology | Not Applicable | The product is a web application and does not supply a native platform accessibility service; web interoperability is assessed under WCAG 4.1.2, which remains partial. |
| 503 Applications | Not Applicable | Native application platform features are not supplied. Lamp runs through the browser, with web requirements reported in the WCAG tables. |
| 504.2 Content Creation or Editing | Partially Supports | Operators author public incident, maintenance and report text; accessibility of every resulting document and editor operation has not been measured. |
| 504.2.1 Preservation of Information Provided for Accessibility | Partially Supports | Preservation of accessibility metadata through all imports, editing and exports has not been evaluated. |
| 504.2.2 PDF Export | Not Applicable | Lamp does not provide PDF export. |
| 504.3 Prompts | Partially Supports | Every authoring prompt and accessibility instruction has not been evaluated. |
| 504.4 Templates | Partially Supports | Multiple public templates exist; complete template conformance is not measured by this limited report. |

## Chapter 6 Support Documentation

| Criterion | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| 601.1 Scope | Partially Supports | Electronic repository documentation is published as web pages; complete documentation accessibility has not been evaluated. |
| 602.2 Accessibility and Compatibility Features | Partially Supports | This report records methods and limitations; a complete catalogue of accessibility/compatibility features is not yet evaluated. |
| 602.3 Electronic Support Documentation | Partially Supports | The WCAG tables also describe the limits of electronic documentation evaluation; complete docs keyboard and assistive-technology review remains unmeasured. |
| 602.4 Alternate Formats for Non-Electronic Support Documentation | Not Applicable | Lamp supplies electronic documentation; no non-electronic support documentation is supplied. |
| 603.2 Information on Accessibility and Compatibility Features | Partially Supports | Repository issues accept accessibility reports; complete support-process accessibility has not been evaluated. |
| 603.3 Accommodation of Communication Needs | Partially Supports | No evaluation of every support communication accommodation has been performed. |

## Legal disclaimer

This report provides the measured scope and stated limitations of Lamp 1.11.0 on the evaluation date. It is not a certification, legal opinion, warranty or promise that all installations, owner-authored content or assistive-technology combinations conform. Buyers should evaluate their required workflows and deployment. VPAT® is a registered service mark of the Information Technology Industry Council (ITI); ITI has not certified this product or report. Report defects through the contact above so the evaluation can be corrected.
