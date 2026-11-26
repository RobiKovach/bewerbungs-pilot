# BewerbungsPilot "Simpler" — brainstorming notes (2026-11-26, in progress)

Not a spec yet. State of the design conversation with Robert, to continue from here.

## Why
Too many clicks; a normal user needs too long to learn the app. Robert as developer knows the flow, a newcomer does not.
Goal: lower the entry threshold across the whole newcomer path (welcome steps → search → package → sending).

## Today's path (recon from code, 0.14.0)
1. Welcome steps: welcome → AI helper (choose/install/sign in) → profile wizard (4 steps: CV upload → review 6 sections,
   each "All correct" → 3–7 story questions → documents) → email → done. No package until all 6 sections are confirmed
   and one story exists (`server/src/profile/readiness.ts`).
2. Search: wishes must be filled (titles + city), then "Search now".
3. Per vacancy ~8 clicks + contacts: ★ → Favourites tab → Create package → language → Create → wait → Approve → Send →
   Send; plus "Find contact" and "Research the company" separately.

## Decided by Robert
- Vacancy no longer current at package creation → no package; message + "Hide" / "Create anyway".
- Contact only behind the Arbeitsagentur captcha → package is created without contact ("Sehr geehrte Damen und
  Herren"); the captcha is offered afterwards in one line, never blocking.
- Scope: the whole newcomer path, not only package creation.
- Entry = variant C (approved "все ок"):
  1. welcome → AI helper (unchanged);
  2. CV upload, "Reading your CV…";
  3. ONE screen "Here is what we read": short summary of all sections + wishes (job titles and city proposed by the AI
     from the CV and address, editable right there) + one "All correct" that confirms everything; "Change" next to each
     section for those who want it;
  4. one or two story questions, skippable (then letters come from the CV; the app reminds once later);
  5. done → the app runs the first search by itself and opens the offers.
  Moved later (Claude's call, Robert ok): mail connection → at the first send; attachments → at the first package;
  photo → profile only.
- Package per vacancy (Claude's proposal, not contradicted): one button "Prepare application" on the card: checks the
  offer is alive, marks it favourite, takes the language from the offer text, finds contact + company facts, writes
  the letter; the person sees the ready package and "Check and send". Review before sending stays mandatory.
- Working style (Robert): **choose several offers, then send as a batch** — also how he expects normal users to work.

## Next (continue with "продовжуй")
- Play back the batch flow: select several cards → "Prepare applications (N)" → background preparation one by one
  (alive check, contact, facts, letter) → a review queue: each package shown in turn with "Send" / "Edit" / "Skip";
  offers that are gone are listed apart. Open questions to settle: how review works in a batch (one by one vs. one
  overview), mail sending pace for a batch, what happens with packages that need the captcha.
- Then: approaches message (2–3 ways to build it) → Robert picks → full design doc + builder check → writing-plans.
