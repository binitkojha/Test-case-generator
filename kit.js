// Altametrics Test Case Kit (from Altametrics_Test_Case_Kit_Bundle.md):
// the v3 standard rules, product context, the five test-basis files, module plans and the CIO reference suite.

const MODULE_NAMES = {
    HOM: "Home / summary", CIN: "Clock in", SFT: "Active shift", BRK: "Breaks", ACK: "Acknowledgement",
    SCF: "Shift confirmation", ATT: "Attestation", ESN: "E-signature", PRV: "Pending review",
    SCH: "Schedule / punches", LNG: "Localisation", DSH: "Dashboard", CFG: "Configuration", NOT: "Notes",
    UI: "UI and layout", API: "API contract", DB: "Database records", INT: "Integrations",
    RPT: "Reports and payroll", REG: "Regression impact", EDG: "Edge and negative",
};

// Team format: these Environment rows first, in this order (environment and platform are separate fields)
const ENVIRONMENT_DATA = [
    { category: "Environment", item: "Environment and build", value: "QA, build to confirm", notes: "Placeholder: confirm the build number." },
    { category: "Environment", item: "Platform", value: "iOS and Android", notes: "" },
    { category: "Environment", item: "QA environment URL", value: "https://<qa-env>.altametrics.com", notes: "Placeholder: confirm the QA URL." },
    { category: "Environment", item: "Tenant or site", value: "Altametrics", notes: "" },
    { category: "Environment", item: "Site time zone", value: "America/Los_Angeles (Pacific)", notes: "Assumed: California compliance rules apply. Confirm." },
    { category: "Environment", item: "Business day start", value: "04:00 AM", notes: "Placeholder: confirm site Operational Days." },
];
// Rows from earlier versions that the team format no longer uses
const LEGACY_ENVIRONMENT = ["Site", "Time Clock device resolution"];

// ---------- Rules the AI follows (Standard v3 + CLAUDE.md authoring rules) ----------

const STANDARD_V3 = `ALTAMETRICS TEST CASE WORKBOOK STANDARD (v3) — authoring rules

Modules
- One functional module per changed screen or flow, using the context file codes (CFG, NOT, CIN, SFT, BRK, ACK, SCF, ATT, ESN, PRV, SCH, LNG, DSH, HOM). Then RPT — Reports and payroll (web reports, payroll screens and cross-product checks such as a Zip Schedules publish), REG — Regression impact (existing behaviour verifiable on the current build), EDG — Edge, negative and non-functional (long names, double tap, overnight shifts, invalid values, network loss).
- Module order: functional modules in user-journey order, then UI, API, DB, INT, RPT, REG, EDG. UI-only revamps never get API, DB or INT cases; full-stack enhancements cover all four layers (configure, capture, action, record) and any excluded area is documented in the Dashboard notes. No accessibility or DST fall-back cases, no regression cases that need a baseline from the previous build.
- Persistence checks for a flow go at the end of its functional module and are verified on Punch Management or a report.
- Every case must be executable on the QA build by a tester using the Time Clock device and the manager web only, with each Expected Result observable on screen.

Cells
- Test Case ID: PREFIX_CR_MOD_NNN for a change-scoped suite, PREFIX_MOD_NNN for a full-module suite; 3 digits, sequential per module without gaps, never reused. The app assigns IDs; send "" for new cases.
- Importance: High for core flow and compliance, Medium for secondary states and validation, Low for cosmetic checks.
- Test Descriptions: one sentence starting with "Verify" and ending with a period.
- Preconditions: the application state before step 1 with concrete names and times (e.g. "Andrew is clocked in at 09:02 AM on job code Cleaner."). API endpoints and database tables without a supplied contract are marked as contract placeholders in Test Data.
- Test Steps: one imperative action per step starting with a capitalised verb (Tap, Enter, Review, Open, Select …), unnumbered, no leading space, no trailing period.
- Test Data: "<Data Item>: <Value>" lines taken from the Test Data sheet, concrete values only — never "valid data" or "test user". Add new items with upsert_data.
- Expected Result: exactly one assertion with exactly one "should", e.g. "X should be displayed.", "The button should read "Clock In · Cleaner"." One verb per sentence — never "wrap or ellipsize".
- Use the exact UI text from the test basis with the same capitalisation. Never invent labels, messages or rules.
- Prefix "To confirm: " when the behaviour is not stated in the test basis.
- Actual Result: the exact past-tense mirror of the Expected Result without "To confirm:" (e.g. "The button read "Select Job Code"."). Status defaults to Pass only when execution evidence is recorded; a Pass without verified execution evidence is an error.

Coverage for each change area
- Happy path; each button state (enabled, disabled and what enables it); cancel where it changes data; flag on / off effects.
- Empty, missing-translation and long-text cases where relevant; English / Spanish where the feature supports it.
- Reports: date range, each filter value, search, each export type, and data parity with the actions taken.
- Follow data through Configure → Capture → Action → Record (settings, device, dashboard, reports).

Test Data sheet
- Environment rows first, in this order: Environment and build, Platform, QA environment URL, Tenant or site, Site time zone, Business day start.
- Category order: Environment, Users, Configuration, Schedule, Records, Reports, Boundary.`;

// ---------- Team format (QA team decisions) — wins wherever it differs from the standard ----------
const TEAM_FORMAT = `INTAKE & DOCUMENT INGESTION
Confirm four things before generating: change areas each marked NEW or EXISTING-REVAMPED, surfaces affected, design material, and scope — changed areas only, UI-only, or full module. Ask for what is missing; never guess.

CRITICAL — SYSTEM UNDER TEST (SUT) ISOLATION (APPLICATION ONLY):
- The uploaded file (presentation deck, PDF, release notes, PRD) is strictly a SPECIFICATION REFERENCE. It is NEVER the system under test.
- NEVER write test steps, descriptions, or expected results that test the document itself (e.g., NEVER say "Open Release Notes", "Review Slide 1", "Verify Fig 1.1 is displayed", "Check document", or "Verify Thank You slide").
- NEVER treat document headings or marketing copy (e.g., "Improved Visibility", "Time Savings", "Consistent Experience") as standalone test cases.
- NEVER write test cases for slides or sections labeled "Previous Screen" or "Previous Behavior". Only test the "Updated Screen" and new functionality.
- ALL test steps and verifications must take place directly ON THE SOFTWARE APPLICATION (e.g., Time Clock kiosk, Mobile App, Manager web).
- Never derive the suite prefix from the input file name (e.g., never use "S1" from "Slide 1"). Always ask for or derive the official product/module acronym (e.g., MPMS, CIO, SCW, UPS).

MANDATORY SYNTHETIC DUMMY DATA CREATION:
- Never leave application test data blank, and never write generic placeholders like "valid user", "test data", or "N/A".
- The generator MUST invent realistic, concrete dummy data matching the feature:
    • Users: Specific employee names, PINs, and job roles (e.g., "Andrew, PIN 4821, Job Role: Cleaner").
    • Dates & Timestamps: Concrete dates and time ranges (e.g., "Wed 10/21/2026 09:00 AM – 05:30 PM").
    • Schedules & Punches: Break durations (e.g., "Rest 11:00 AM, Meal 01:00 PM"), open/closed punch entries.
    • Boundaries: Long character strings (e.g., 34-character name "Maximiliano Bartholomew-Fitzgerald").
- Every generated dummy data item must be stored in the 'Test Data' sheet and mapped in Column E ('Used By (Test Case IDs)') to the exact test case IDs that consume it.
- In Sheet1, the 'Test Data' column (Column F) must explicitly cite the created dummy data.

SCOPE CONTROL & MODULAR COVERAGE:
- For UI-Only screen revamps: Generate 12 to 18 high-value test cases covering containers/navigation, populated cards, active states, empty/zero states, multiple entries, totals boxes, and layout edge cases. Do NOT generate empty or dummy API, DB, or backend integration cases for pure UI enhancements.
- For full-stack enhancements: Cover the change through all four layers — configure, capture, action, record. Include functional, UI, API, DB, INT, RPT, REG, and EDG modules. If an area is excluded, document it in the Dashboard notes rather than dropping it silently.
- Every wizard: Case for Back on each step, abandoning midway, and re-entering after cancellation.
- Every new setting: One case ON, one OFF, one for the default and its fallback.
- Every enhancement: One double-action or concurrency case, one maximum length or truncation case, one offline or interrupted network case.
- Every expiring value or timer: One case just inside the boundary, one past it, one where regenerating invalidates the previous value.
- Every attempt or retry limit: One case below the limit, one at it.

WHERE THE STANDARD IS AMBIGUOUS — TEAM DECISIONS
- Sheet names must strictly be: 'Dashboard', 'Sheet1', and 'Test Data'. (NEVER name the test cases tab 'Test Case' or 'Test Cases').
- Use PREFIX_MOD_NNN for a full-module suite; add the CR segment only for a change-scoped suite (PREFIX_CR_MOD_NNN).
- IDs must be numbered sequentially without gaps within each module (001, 002, 003). Never reuse an ID.
- Do not number steps inside the cell — one row per step, so the row position is the number.
- Name environment (Dev, QA, Staging) and platform (iOS, Android) as separate fields; never merge them.
- Do not name device models unless the case depends on that device.
- Where the standard and this list disagree, this list wins.

WORDING THE TEAM AGREED
- Every Test Description must start with "Verify..." targeting a single discrete condition or UI state.
- Say Manager web or Admin portal, never back office.
- Quote toast, banner, validation and dialog text verbatim in quotation marks.
- The "One Should" Rule: Every numbered step must have exactly one corresponding sentence containing the word "should" in the Expected Result.
- When the exact message text has not been supplied, assert only that a message is displayed and prefix the line with "To confirm:". Never invent wording.
- Drop the "To confirm:" prefix in the Actual Result mirror. Actual Result is the exact past-tense mirror of the Expected Result.
- Test Data holds concrete values — never "valid data" or "test user".

WORKBOOK LOOK & STYLING
- Primary test cases sheet must be named 'Sheet1'.
- Module banner merged across all nine columns (A to I), fill FF6A1B41, white bold.
- Header row white bold on FF4F81BD, height 26, frozen.
- Grey spacer row between every test case.
- Body Calibri 11, thin borders, wrapped, top aligned; ID and Status centred.
- Column widths: A=15.6, B=13.6, C=44.1, D=33.9, E=34.7, F=27.9, G=37.0, H=42.8, I=13.0; row height minimum 42.
- Landscape, fit to one page wide, header row repeated per page.
- Status defaults to Pass once execution evidence is recorded (build, tester and date, or a link to the run); without evidence a case stays Untested. Pass is bold green FF00801A, centred.
- Module order in Sheet1 and Dashboard: functional modules in user-journey order, then UI, API, DB, INT, RPT, REG, EDG.

DASHBOARD SPECIFICATION
- Project Details block in A1:D5 with fill FFDCE6F1 and navy accents FF1F497D.
- Execution table starting at row 7 with headers on FF4F81BD.
- Do NOT use '=COUNTIF(...)' formulas with wildcards. Enter explicit numeric counts per module in column B, hardcode Passed in column C, Failed=0 in D, Blocked=0 in E.
- Table Formulas:
    • Untested: =B{row}-C{row}-D{row}-E{row}
    • Pass Rate: =IF(B{row}=0,"",C{row}/B{row}) formatted as percentage 0%
    • TOTAL row: =SUM(...) across columns B through F
- Passed, Failed and Blocked are the only cells anyone types into — amber fill, blue font. Everything else is a formula.
- Overall Test Execution Status card (columns I & J) references the totals row: Passed (=C{total_row}), Failed (=D{total_row}), Blocked (=E{total_row}), Untested (=F{total_row}), and Total (=SUM(J8:J11)).
- Pie chart titled "Overall Test Execution Status", sourced strictly from the execution status card (categories I8:I11, data J7:J11), never from the module table.
- Fixed slice colours: Passed 4F81BD, Failed C0504D, Blocked 9BBB59, Untested 8064A2 (or 7030A0).
- Data labels show Value and Percentage separated by '; ' (e.g. "4; 6%").
- Legend placed on the right, chart anchored below the module table at cell A17, width ~16, height ~10.
- Suppress labels on zero-value slices so empty statuses do not stack.
- Notes block below the chart: what is covered, what is excluded, and the IDs of every case resting on an assumption.

TEST DATA SPECIFICATION
- Strict Category sequence: Environment -> Users -> Configuration -> Schedule -> Records -> Reports -> Boundary.
- Mandatory Environment rows first, in this order, and only those the enhancement touches:
    1. Environment and build
    2. Platform (iOS and Android)
    3. QA environment URL
    4. Tenant or site
    5. Site time zone
    6. Business day start
- Followed immediately by synthesized application data (Users, Schedules, Punches, Formatted Dates).
- Map every row in column E ('Used By (Test Case IDs)') to the exact comma-separated case IDs that consume it.
- Delete any row no case uses; never leave unused rows in the sheet.
- Mark API endpoints and database tables as contract placeholders when no contract has been supplied.`;

const ALTAMETRICS_CONTEXT = `PRODUCTS
Altametrics builds restaurant workforce management and operations software.
  Zip Clock — timekeeping and labour compliance; Zip Inventory; Zip Checklist; Plum POS;
  Plum Timeclock — the physical time clock device (kiosk); Zip Schedules — scheduling, feeds shifts into Zip Clock.

ZIP CLOCK STRUCTURE
Configuration: Manage Account > App Settings > Zip Clock
  Global Settings — Departments, Scheduling Positions, Clock Settings, Job Codes, Extra Pay, Pay-Period, Adjustment Reasons,
    Premium Pay, Labor Rules, Clock Status, Clock Attestation Setup, Notes Configuration
  Site Settings — Operational Days, Labor Rules, Clock Settings, Manager Authorizations
Manager web: Dashboard with KPI cards and three action panels — Needing Action, Awaiting Action from Others, Review Actions.
  Reports: Employee Performance, Punch Management, Employee Violation, Follow The Trail Of Payroll, Payroll, Daily Punch,
  Ignored Punch, Notes and Broadcast, Employee Tip, Extra Pay, Department Payroll, Store Summary, Job Code Payroll,
  Employee Time Loss, Meal Break Waiver Consent, Attestation, Punch Acknowledgement.
Device: PIN authentication, job code selection, clock in / out, meal and rest breaks, clock-out wizard, My Schedule, My Punches.

ARCHITECTURE PATTERN: 1 Configure (settings set flags and author content) → 2 Capture (device presents what configuration allows)
→ 3 Action (dashboard surfaces exceptions to managers) → 4 Record (reports preserve the audit trail).
Test cases should follow data through all four layers.

MODULE CODES: HOM home/summary, CIN clock in, SFT active shift, BRK breaks, ACK acknowledgement, SCF shift confirm,
ATT attestation, ESN e-signature, PRV pending review, SCH schedule/punches, LNG localisation, DSH dashboard, RPT reports,
REG regression, EDG edge/negative, CFG configuration, NOT notes.

CALIFORNIA COMPLIANCE: paid 10-minute rest break per 4 hours worked or major fraction, due by shift start + 3 hours.
Unpaid 30-minute meal break before the end of the 5th hour of work; a second meal after the 10th hour. Meal waivers are
voluntary and revocable. Violations trigger premium pay (Premium Pay). Attestation captures whether the employee had the
opportunity to take each break, with a reason required on a negative answer.

RECURRING GAPS: which flag controls each behaviour and what happens when it is off; the fallback when optional content is
absent (missing translation, unassigned zone, empty field); the state model (can an action be undone, where the record goes);
which sample values are real configuration vs placeholder data (assume placeholder).

ENGLISH / SPANISH: English is mandatory and the fallback where no translation exists. Expect character limits per field.
Include cases for the fallback path and for layout breakage from longer Spanish strings.`;

// ---------- Test basis files ----------

const BASIS = [
    {
        key: "01", code: "SCW", name: "Zip Clock — Shift Close Workflow", fileName: "Shift_Close_Workflow.xlsx",
        modules: ["CFG", "NOT", "ACK", "SCF", "ATT", "ESN", "PRV", "LNG", "DSH", "RPT", "REG", "EDG"],
        text: `# Test basis: Zip Clock Shift Close Workflow (Clock-Out Note, Shift Confirmation, Attestation, E-Signature)
Short code: SCW. Source: release notes "Zip Clock — Shift Close Workflow" + screen recordings (Oct 2026 build).

## Summary
Clock-out becomes a guided review: clock-out note, punch acknowledgement (if enabled), shift confirmation, attestation questions, and e-signature, in English or Spanish. Pending items from earlier shifts can be completed. Reported punches and No answers go to the manager's Dashboard (Review Actions). All responses are recorded in the Attestation Report.

## Impacted areas
Manage Account > App Settings > Zip Clock (Clock Settings, Global Settings tiles); Time Clock device (employee list, ongoing punch screen, Clock Out wizard); Dashboard (Review Actions); Reports (Attestation Report).

## Settings (Clock Settings > Shift Close Workflow Settings)
- Enable Clock-Out Note — shows a policy reminder note before clock-out (NOTE step).
- Clock Interface Language — employees can switch the clock screen between English and Spanish (EN/ES toggle).
- Enable E-signature — employees sign on-device to certify the shift record (E-Signature Confirmation pop-up).
- Allow employees to acknowledge punches — employees can acknowledge punches (ACKNOWLEDGEMENT step). See 02.
- Enable Attestation Setup — makes the Clock Attestation Setup tile available under Global Settings.
- E-Signature Confirmation Message: English and Español tabs. Observed: required field (asterisk), character counter (e.g. 248/1000).
- Save is at the top of Clock Settings. Observed toast: "Clock setting saved".

## New Global Settings tiles
Notes Configuration: a Clock-Out Note card with a toggle, EN English (required) and ES Spanish tabs, and Save. Observed: a saved toast appears.
Clock Attestation Setup:
- Attestation Zones list: Add button. Columns: Zone Name, Sites Assigned, Last Updated By, Actions.
- Zone > Attestation tab: Shift Confirmation toggle, Attestation Questions toggle, ADD QUESTION.
- Expanding a question shows QUESTION TEXT in EN and ES, and RESPONSE OPTIONS in EN and ES.
- Each question has an ACTIVE toggle and a REASON toggle. REASON requires a follow-up reason when the employee answers No. Observed: a "Changes saved" toast appears.
- Zone > Assign Sites tab: Select Site, Add All, and the list of assigned sites.

## Flow A: Clock Out on the Time Clock (all flags on)
1. On the ongoing punch screen, tap Clock Out.
2. NOTE step: the configured note is shown. Tap Next.
3. ACKNOWLEDGEMENT step: Acknowledge or Report the listed punches, then Next. Only when that flag is on (see 02).
4. SHIFT CONFIRMATION step: the SCHEDULED SHIFT is shown next to the ACTUAL SHIFT. Tap Confirm or Report for each event, then Proceed.
5. ATTESTATION step: answer Yes or No to each question, then Submit.
   - Observed: answering No on a question with REASON on opens a "Specify reason" field. Tapping it opens the Specify Reason pop-up, titled with the question text. The options are Worked before clocking in, Worked after clocking out, and Worked during an unpaid break. Buttons: Cancel and Confirm. The chosen reason shows in the field. Submit stays disabled until a reason is chosen.
   - Note: the reason options come from the question's RESPONSE OPTIONS setup, so test with the configured values.
6. The E-Signature Confirmation pop-up opens ("Review your shift and sign to complete clock out"). It shows the confirmation message, ELECTRONIC SIGNATURE (employee name, "Signed electronically", date and time), Re-Review Shift/Attestation, and Accept & e-Sign.
   - When earlier shifts are pending, an orange banner shows "You still have pending items from previous shifts" with "<n> shifts to confirm & attest" and a Review button.
7. Tap Review to open the PENDING REVIEW step for the pending shift. Under SHIFT CONFIRMATION, tap Confirm or Report, then Next: ATTESTATION. Under ATTESTATION, answer, then Proceed to E-Sign.
8. Tap Accept & e-Sign, or Re-Review Shift/Attestation to go back. Once a pending shift is reviewed, it no longer shows in the pop-up.
9. The clock-out confirmation pop-up appears. Observed: "Great work today, <name>!"; "You have successfully clocked out at <time>"; an instruction to open the Altametrics Zip Clock mobile app and go to the My Punch tab; a QR code; the next shift; and a Close button.

## Flow B: Complete pending items before clock-out
1. On the ongoing punch screen, tap Pending Shift Confirmation & Attestation. It only shows when pending items exist.
2. Pending shifts are listed by date, each with Review.
3. On SHIFT CONFIRMATION, tap Confirm or Report for each event, then Proceed. On ATTESTATION, answer Yes or No, choose a reason for No where required, then Submit.
4. A "Shift reviewed" pop-up appears with Got it. The shift leaves the pending list. Observed: Back returns to the ongoing screen.

## Flow C: Language
- Observed: an EN/ES toggle on the Time Clock employee list switches the clock screens to Spanish. For example, "Confirmación de Turno y Certificación Pendiente" and "¡Buen trabajo hoy!".
- The note, questions, reasons and e-signature message use the ES text when Spanish is selected.

## Flow D: Manager review (Dashboard)
1. Review Actions shows Reported Attestation and Reported Shift Confirmation (and Reported Acknowledgement, see 02).
2. The view (eye) icon opens Attestation Detail (questions answered No, with the Reason, and Edit Punches) or Shift Confirmation Reported Detail (the reported punches, and Edit Punches).
3. Edit Punches opens the Edit Punch window. Correct the punch, choose an Adjustment Reason, then Save.
4. The Resolved (thumbs-up) icon resolves the item. Observed: the tooltip reads "Resolved?", a "Record marked as resolved" toast appears, and the row leaves the list.

## Flow E: Attestation Report
- Reports > Attestation Report card. Each shift row shows its punches, the shift confirmation Status, and the Response and Reason.
- Date range, Filter, and Search keyword. Filter options: Attestation Response (All / Yes / No) and Shift Confirmation Status (All / Reported / Correct), with Clear and Apply.
- The print icon offers Export PDF and Export CSV.

## Test data seen in recordings
Employees: Andrew, Brett, Harshey L, Adams. Job codes: Manager, Cleaner, Trainee. Site: Altametrics.

## Open questions (to confirm)
- Wizard steps when some flags are off: which steps are skipped, and the label of the last button (Next or Submit).
- What happens when the ES text is empty (fallback to English?).
- Whether sites outside every attestation zone see any attestation questions.
- How many pending shifts are shown, and whether pending items can be skipped.
- Whether the e-signature can be completed without reviewing pending shifts.`,
    },
    {
        key: "02", code: "PACK", name: "Zip Clock — Punch Acknowledgement", fileName: "Punch_Acknowledgement.xlsx",
        modules: ["CFG", "ACK", "SCH", "SFT", "DSH", "RPT", "REG", "EDG"],
        text: `# Test basis: Zip Clock Employee Punch Acknowledgement Redesign + Punch Acknowledgement Report
Short code: PACK. Source: release notes "Employee Punch Acknowledgement Redesign" + screen recordings.

## Summary
When a punch is added, modified or updated, the employee reviews each punch and either acknowledges or reports it, from the Dashboard, My Punches, or the Time Clock at clock-out.
- Previously, the pop-up showed only daily totals, and punches could be acknowledged or skipped but not reported.
- Reported punches go to managers under Review Actions, where they can be edited or approved.
- The new Punch Acknowledgement Report replaces the Employee Acknowledged Punch Report.
- The setting has moved to Shift Close Workflow Settings.

## Setting
"Allow employees to acknowledge punches", at Manage Account > App Settings > Zip Clock > Clock Settings > Shift Close Workflow Settings. Save is at the top of the page.

## Flow A: From the Dashboard (employee)
1. Under Needing Action, click Punches Needing Acknowledgement (it has a count badge).
2. The Punches to Review pop-up opens. Columns: checkbox, Event (type and date), Original, Updated, By, Adjustment Reason, Status. A header checkbox selects all.
3. Report, Confirm and Save are disabled until a punch is selected. Observed.
4. Select punches, then Report. The Status shows "Reported". Or Confirm, and the Status shows "Acknowledged".
5. Click Save. Observed: a loader, then the toast "Punch review saved successfully". The dashboard count updates.

## Flow B: From My Punches (web)
1. My Punches shows the weekly calendar with punch cards and a Total Hrs column. Click Confirm (top right).
2. The same Punches to Review pop-up opens. Select punches, then Report or Confirm, then Save. Observed: a toast appears.

## Flow C: From the Time Clock at clock-out
1. Tap Clock Out. The ACKNOWLEDGEMENT step shows "<n> PUNCHES TO REVIEW".
   - Each punch card shows the event, date, ORIGINAL, UPDATED, BY and REASON, with a checkbox.
   - Select All is at the top right. Report and Acknowledge are disabled until a punch is selected.
2. Select punches, then Report or Acknowledge. Observed: handled punches leave the list.
3. With all punches handled, the step shows "0 PUNCHES TO REVIEW".
4. Tap Next (release notes) or Submit (observed when acknowledgement is the only clock-out step). The clock-out completes and the confirmation pop-up appears.

## Flow D: Manager review
1. Under Awaiting Action from Others, Pending Acknowledgement opens the Pending Punch Acknowledgement pop-up. Columns: Name, Business Date, Type, Original Time, Updated Time, Modified By, Modified At. The list is paginated.
2. Review Actions > Reported Acknowledgement lists the reported punches.
   - The edit (pencil) icon opens Edit Punch.
   - The approve (thumbs-up) icon resolves the punch. Observed: the tooltip reads "Resolved?", a toast appears, the row leaves the list, and the count decreases.

## Flow E: Punch Acknowledgement Report
- Reports > Punch Acknowledgement Report card. It replaces the Employee Acknowledged Punch Report.
- Columns: Name, Business Date, Type, Original Time, Updated Time, Modified By, Modified At, Employee Action (ACKNOWLEDGED / REPORTED / PENDING), Employee Action At.
- Date range, Filter, All Employee dropdown, Search Keyword.
- Filter > Status: All, Acknowledged, Reported, Pending, with Clear and Apply.
- The print icon offers CSV Export and PDF Export.

## Test data seen in recordings
Employees: Andrew, Brett, Adams, Noah. Adjustment reasons: Missed to Clock In/Out, Due to System Failure, Manual Punch, delete. Site: Altametrics.

## Open questions (to confirm)
- With the flag off: are the Dashboard panels, the My Punches Confirm button and the ACKNOWLEDGEMENT step hidden?
- Can a punch be changed from Reported to Acknowledged before Save? After Save?
- Which edits trigger acknowledgement (add, edit, delete), and who must acknowledge a manager's own edit?
- Does Edit Punch on a reported punch reset it to Pending for the employee?
- The clock-out button label: Next or Submit, by configuration.`,
    },
    {
        key: "03", code: "CIO", name: "Zip Clock — Clock In / Clock Out Revamp", fileName: "Clock_In_Out_Revamp.xlsx",
        modules: ["CIN", "SFT", "BRK", "RPT", "REG", "EDG"],
        text: `# Test basis: Zip Clock Revamped Clock In / Out and Break Screens
Short code: CIO. Source: release notes "Zip Clock - Revamped Clock In / Out and Break Screens" + screen recordings.

## Summary
The Clock In / Out and break screens use a card layout. The employee selects a job code, then clocks in with one button that names the job code; tracks the active shift, and starts and ends meal breaks. Tips are declared on a dedicated Tip amount pop-up. Clock-in and clock-out each end with a confirmation pop-up. If there is no scheduled break and a labor law is configured for the site, the clock-in screen suggests a break.

## Clock-in screen
- Left: a profile card (photo, name, job tag), My Schedule, My Punches, and a NEXT SHIFT card (date, time, position).
- Right, top: "Greetings, <name>", "Select a job code to begin your shift", and a pill with today's scheduled shift time.
- Right, middle: the SELECT JOB CODE section, with one card per job code. The selected card is highlighted.
- Right, lower: a break card. It shows REST BREAK and/or MEAL BREAK with the duration and approximate time, for example "30 min (1:00p Approx)", and "Position : <position>".
- Bottom: the Clock In button. Observed: it shows "Select Job Code" and is disabled until a job code is chosen. After a job code is chosen, it reads "Clock In · <job code>".

## Clock-in confirmation pop-up
Observed: "You're clocked in — all the best for today's work!", "Clocked in at <time>", and a Got it button.

## Active shift screen
- Top card: SHIFT ACTIVE · <JOB CODE>, a running timer, SHIFT START, SCHEDULED (date and time), and JOB CODE.
- Left card: "Shift started at <time>", and TODAY, WEEK and SCHEDULED hours.
- Break cards: Meal Break and Rest Break, each "<n>m allocated (by <time>)". Selecting one changes the bottom button to "Start Meal Break Now" or "Start Rest Break Now". Observed.
- Switch Job Code card: "Currently working as <job code>". It is used to change the job code being worked.
- Clock Out: at the bottom.

## Break in progress
BREAK IN PROGRESS · <JOB CODE>, BREAK DURATION <timer> (<start time>), a break card "<n>min allocated (until <time>)", and an END BREAK button (orange).

## Clock-out
1. Tap Clock Out.
2. If prompted, the Tip amount pop-up appears: Cash and Credit fields, Cancel, and Continue. A numeric keypad opens.
3. Processing.
4. The confirmation pop-up appears. Observed: "Great work today, <name>!" and "You have successfully clocked out at <time>"; the mobile app instruction, a QR code, the next shift details, and Close.

## Test data seen in recordings
Employees: Harshey L (job codes Cleaner and Trainee; position Cook), Brett (Manager and Team leader). Site: Altametrics.

## Open questions (to confirm)
- Exact text and placement of the labor-law suggested break when no break is scheduled.
- When the Tip amount pop-up appears (which setting or role), and the validation on Cash and Credit (decimals, blank, max).
- The behaviour with a single job code (auto-selected?) and with no schedule for today.
- The full Switch Job Code flow (screens after tapping it).
- Ending a break early or late, and how break compliance is shown.`,
    },
    {
        key: "04", code: "MPMS", name: "Zip Clock — My Punches and My Schedule Revamp", fileName: "My_Punches_My_Schedule_Revamp.xlsx",
        modules: ["SCH", "REG", "EDG"],
        text: `# Test basis: Zip Clock My Punches and My Schedule Screen Revamp (Time Clock)
Short code: MPMS. Source: release notes "My Punches and My Schedule Screen Revamp" + screen recordings.

## Summary
A display-only revamp of the My Punches and My Schedule tabs on the Time Clock: a coloured date-range banner, day cards, the current day marked "(Today)", and highlighted Total Hrs. Punch and schedule data are unchanged. Available to all employees.

## Navigation
Dashboard > Clock In/Out > the employee screen shows the My Punches and My Schedule tabs.

## My Punches
- Header "My Punches" with Back.
- Green banner: "Punches For <start> - <end>" (two weeks).
- Columns Mon to Sun plus Total Hrs. Each day is a card with its date number. The current day is outlined and labelled "<n> (Today)".
- Punch entry: "<start>-<end>" or "<start> - Active" for an open punch, with the job role tag, and a break icon where a break was taken.
- An empty day shows "No punch available on this day".
- Total Hrs. shows each week's total in a highlighted box.

## My Schedule
- Header "My Schedule" with Back.
- Blue banner: "Schedule For <start> - <end>" (two weeks). The current day is outlined and labelled "(Today)".
- Shift entry: the time range, the role tag, the location, a rest break time (cup icon) and a meal break time (fork icon), when scheduled.
- An empty day shows "No shifts scheduled on this day".

## Regression
Punch times, roles, totals and shifts must match what was shown before the revamp. Only the layout changes.

## Open questions (to confirm)
- How the Total Hrs. value is calculated, and whether it includes the open (Active) punch.
- Navigating to other periods (is the view fixed to the current two weeks?).
- Multiple punches and multiple shifts on one day, and long role names.`,
    },
    {
        key: "05", code: "UPS", name: "Zip Clock — Upcoming Shifts Side Menu", fileName: "Upcoming_Shifts.xlsx",
        modules: ["HOM", "REG", "EDG"],
        text: `# Test basis: Time Clock Dashboard Upcoming Shifts Side Menu
Short code: UPS. Source: release notes "Plum Clock - Upcoming Shifts Side Menu" + Zip Clock Time Clock recordings.

## Summary
An Upcoming Shifts menu on the right of the clock dashboard. It lists the store's upcoming shifts for all employees, with the employee name, role, shift date and shift time, in order of shift date and time. Available to all users of the dashboard.

## Flow
1. Open the clock dashboard. The Upcoming Shifts menu is collapsed on the right, with a vertical "Upcoming Shifts" label and an arrow.
2. Select the arrow. The menu expands beside the employee list.
3. Each card shows the employee name, a role tag ("No Position" when none), and "<day>, <date> · <start>–<end>".
   - Observed: when the employee has a scheduled break, the card also shows "Rest — <start>-<end>" and "Meal — <start>-<end>".
4. Scroll within the menu to see the rest. The cards are ordered by shift date and time.
5. Select the arrow again to collapse the menu.

## Test data seen in recordings
Andrew (Floor Supervisor), Henna (Catering), Amanda (No Position), Smith (Bartendar; Rest 5:00a-5:15a, Meal 7:59a-8:29a), Bryan (Cashier), Alexanders (Manager), Oliver (No Position).

## Open questions (to confirm)
- Brand: the release notes are for Plum Clock, but the same menu is on the Zip Clock Time Clock. Test both?
- How far ahead the list goes (days), and whether today's remaining shifts are included.
- Whether the menu remembers its expanded or collapsed state, and its behaviour with no upcoming shifts.
- The role tag spelling as shown ("Bartendar").`,
    },
];

// ---------- Reference suite: Clock In / Clock Out Revamp (reviewed, Oct 2026) ----------

const CIO_REFERENCE = (() => {
    const MODULES = {
        CIN: ["Clock-in screen, job code selection and clock-in confirmation", "Clock-in screen & Job Code"],
        SFT: ["Active shift screen, Switch Job Code and Clock Out (Tip amount, confirmation)", "Active Shift & Clock Out"],
        BRK: ["Break cards, suggested break and Break in progress", "Break cards & compliance"],
        RPT: ["Reports and payroll", "Reports and payroll"],
        REG: ["Regression impact", "Regression impact"],
        EDG: ["Edge, negative and non-functional", "Edge and negative"],
    };
    const DATA = {
        MANAGER_WEB_LOGIN: ["Users", "Manager web login", "QA Manager (qa.manager@altametrics.test), site Altametrics", "Placeholder account: seed before execution."],
        INVALID_CREDENTIALS: ["Users", "Invalid credentials", "PIN 0000 (not assigned to any employee)", ""],
        PRIMARY_EMPLOYEE: ["Users", "Primary employee", "Harshey L, PIN 6143, job codes Cleaner and Trainee, position Cook", "From recordings; seed PIN."],
        SECONDARY_EMPLOYEE: ["Users", "Secondary employee", "Brett, PIN 5732, job codes Manager and Team leader", "From recordings; seed PIN."],
        SINGLE_JOB_CODE_EMPLOYEE: ["Users", "Single job code employee", "Andrew, PIN 4821, job code Cleaner only", "Seed before execution."],
        TODAY_S_SCHEDULED_SHIFT_: ["Schedule", "Today's scheduled shift (Harshey L)", "Tue 10/20/2026 09:00 AM – 05:30 PM, position Cook", ""],
        NEXT_SCHEDULED_SHIFT_HAR: ["Schedule", "Next scheduled shift (Harshey L)", "Wed 10/21/2026 09:00 AM – 05:30 PM, position Cook", ""],
        SCHEDULED_BREAKS_HARSHEY: ["Schedule", "Scheduled breaks (Harshey L)", "Rest break 10 min by 12:00 PM; Meal break 30 min (1:00p Approx)", "Allocations from the schedule."],
        SHIFT_WITHOUT_BREAKS_BRE: ["Schedule", "Shift without breaks (Brett)", "Tue 10/20/2026 09:00 AM – 05:30 PM, no breaks scheduled; California meal and rest rules configured for the site", "Labor-law suggestion trigger."],
        CLOCK_IN_TIME: ["Records", "Clock-in time", "09:02 AM", ""],
        CLOCK_OUT_TIME: ["Records", "Clock-out time", "05:31 PM", ""],
        MEAL_BREAK_TAKEN: ["Records", "Meal break taken", "Start 01:00 PM, 30 min allocated, until 01:30 PM", ""],
        TIP_AMOUNTS: ["Records", "Tip amounts", "Cash 12.50; Credit 8.00", ""],
        INVALID_TIP_VALUES: ["Records", "Invalid tip values", 'Cash "abc"; Cash 12.345; Credit blank; Cash 100000', "Validation rules to confirm."],
        LONG_EMPLOYEE_NAME: ["Boundary", "Long employee name", "Maximiliano Bartholomew-Fitzgerald (34 characters), PIN 9476", "Seed as an extra employee."],
        OVERNIGHT_SHIFT: ["Boundary", "Overnight shift", "Adams, 10/20/2026 10:00 PM to 10/21/2026 06:00 AM, job code Cleaner", ""],
    };
    const NOT_CLOCKED = "Time Clock is online at site Altametrics. Harshey L is not clocked in and has today's scheduled shift with breaks.";
    const CLOCKED = "Harshey L is clocked in at 09:02 AM on job code Cleaner.";
    const CASES = [
        ["CIN", "High", "Verify the left panel shows the profile card, My Schedule, My Punches and the NEXT SHIFT card.", NOT_CLOCKED, "PRIMARY_EMPLOYEE NEXT_SCHEDULED_SHIFT_HAR", `
Enter Harshey L's PIN => The clock-in screen should be displayed.
Review the profile card => The photo, the name Harshey L and the job tag should be displayed.
Review the links => My Schedule and My Punches should be displayed.
Review the NEXT SHIFT card => The card should show the date, time and position of the next shift.`],
        ["CIN", "High", "Verify the greeting, instruction and today's shift pill.", NOT_CLOCKED, "PRIMARY_EMPLOYEE TODAY_S_SCHEDULED_SHIFT_", `
Enter Harshey L's PIN => "Greetings, Harshey L" should be displayed.
Review the instruction => "Select a job code to begin your shift" should be displayed.
Review the shift pill => The pill should show 09:00 AM – 05:30 PM.`],
        ["CIN", "High", "Verify SELECT JOB CODE shows one card per job code.", NOT_CLOCKED, "PRIMARY_EMPLOYEE", `
Review the SELECT JOB CODE section => Cleaner and Trainee should be displayed as cards.`],
        ["CIN", "High", 'Verify Clock In is disabled and reads "Select Job Code" until a job code is chosen.', NOT_CLOCKED, "PRIMARY_EMPLOYEE", `
Review the bottom button before selecting a job code => The button should read "Select Job Code".
Tap the button => The button should be disabled.`],
        ["CIN", "High", "Verify selecting a job code highlights its card and names it on the Clock In button.", NOT_CLOCKED, "PRIMARY_EMPLOYEE", `
Tap the Cleaner card => The Cleaner card should be highlighted.
Review the bottom button => The button should read "Clock In · Cleaner".`],
        ["CIN", "Medium", "Verify changing the selected job code moves the highlight and updates the button.", NOT_CLOCKED + " Cleaner is selected.", "PRIMARY_EMPLOYEE", `
Tap the Trainee card => The Trainee card should be highlighted.
Review the Cleaner card => The Cleaner card should no longer be highlighted.
Review the bottom button => The button should read "Clock In · Trainee".`],
        ["CIN", "High", "Verify Clock In shows the clock-in confirmation pop-up.", NOT_CLOCKED + " Cleaner is selected.", "PRIMARY_EMPLOYEE CLOCK_IN_TIME", `
Tap Clock In · Cleaner at 09:02 AM => The clock-in confirmation pop-up should be displayed.
Review the message => "You're clocked in — all the best for today's work!" should be displayed.
Review the time => "Clocked in at 09:02 AM" should be displayed.
Tap Got it => To confirm: The pop-up should close.`],
        ["CIN", "Medium", "Verify the clock-in screen with a single job code.", "Andrew has only job code Cleaner and is not clocked in.", "SINGLE_JOB_CODE_EMPLOYEE", `
Enter Andrew's PIN => The SELECT JOB CODE section should show one card.
Review the bottom button => To confirm: The button should read "Clock In · Cleaner" with the card pre-selected.`],
        ["CIN", "Medium", "Verify the clock-in screen when no shift is scheduled today.", "Harshey L has no scheduled shift today.", "PRIMARY_EMPLOYEE", `
Enter Harshey L's PIN => The clock-in screen should be displayed.
Review the shift pill => To confirm: The shift pill should not be displayed.`],
        ["SFT", "High", "Verify the active shift top card shows status, timer, start, schedule and job code.", CLOCKED, "PRIMARY_EMPLOYEE CLOCK_IN_TIME TODAY_S_SCHEDULED_SHIFT_", `
Enter Harshey L's PIN => The active shift screen should be displayed.
Review the top card heading => SHIFT ACTIVE · CLEANER should be displayed.
Review the timer => A running timer should be displayed.
Review the details => SHIFT START 09:02 AM, SCHEDULED 10/20/2026 09:00 AM – 05:30 PM and JOB CODE Cleaner should be displayed.`],
        ["SFT", "High", "Verify the left card shows the start time and TODAY, WEEK and SCHEDULED hours.", CLOCKED, "PRIMARY_EMPLOYEE CLOCK_IN_TIME", `
Review the left card => "Shift started at 09:02 AM" should be displayed.
Review the hour totals => TODAY, WEEK and SCHEDULED hours should be displayed.`],
        ["SFT", "Medium", "Verify the shift timer keeps counting.", CLOCKED, "PRIMARY_EMPLOYEE", `
Note the timer value and wait 60 seconds => The timer should increase by one minute.`],
        ["SFT", "High", "Verify the Switch Job Code card shows the current job code.", CLOCKED, "PRIMARY_EMPLOYEE", `
Review the Switch Job Code card => "Currently working as Cleaner" should be displayed.`],
        ["SFT", "Medium", "Verify Switch Job Code changes the job code being worked.", CLOCKED, "PRIMARY_EMPLOYEE", `
Tap the Switch Job Code card => To confirm: The job code selection should be displayed.
Select Trainee and confirm => To confirm: The top card should read SHIFT ACTIVE · TRAINEE.`],
        ["SFT", "High", "Verify Clock Out opens the Tip amount pop-up with Cash, Credit and a numeric keypad.", CLOCKED + " The tip prompt applies to Harshey L.", "PRIMARY_EMPLOYEE", `
Tap Clock Out => The Tip amount pop-up should be displayed.
Review the fields => Cash and Credit should be displayed.
Tap the Cash field => A numeric keypad should open.
Review the buttons => Cancel and Continue should be displayed.`],
        ["SFT", "High", "Verify Continue with tips completes clock-out and shows the confirmation pop-up.", CLOCKED + " The Tip amount pop-up is open.", "PRIMARY_EMPLOYEE TIP_AMOUNTS CLOCK_OUT_TIME", `
Enter Cash 12.50 and Credit 8.00 => The fields should show 12.50 and 8.00.
Tap Continue at 05:31 PM => The clock-out confirmation pop-up should be displayed.
Review the greeting => "Great work today, Harshey L!" should be displayed.
Review the time => "You have successfully clocked out at 05:31 PM" should be displayed.`],
        ["SFT", "Medium", "Verify the clock-out confirmation pop-up shows the mobile app instruction, QR code, next shift and Close.", CLOCKED, "PRIMARY_EMPLOYEE NEXT_SCHEDULED_SHIFT_HAR", `
Complete clock-out => The clock-out confirmation pop-up should be displayed.
Review the lower section => The mobile app instruction and a QR code should be displayed.
Review the next shift => The next shift should show Wed 10/21/2026 09:00 AM – 05:30 PM.
Tap Close => To confirm: The Time Clock employee list should be displayed.`],
        ["SFT", "Medium", "Verify Cancel on the Tip amount pop-up leaves the employee clocked in.", CLOCKED + " The Tip amount pop-up is open.", "PRIMARY_EMPLOYEE", `
Tap Cancel => To confirm: The active shift screen should be displayed.
Review the top card => SHIFT ACTIVE · CLEANER should still be displayed.`],
        ["SFT", "Medium", "Verify Tip amount validation for invalid values.", CLOCKED + " The Tip amount pop-up is open.", "PRIMARY_EMPLOYEE INVALID_TIP_VALUES", `
Attempt to enter abc in Cash => The keypad should not accept letters.
Enter 12.345 in Cash => To confirm: Only two decimal places should be accepted.
Leave Credit blank and tap Continue => To confirm: The blank field should be saved as 0.00.
Enter 100000 in Cash => To confirm: A maximum-value message should be displayed.`],
        ["SFT", "Medium", "Verify which employees are prompted for tips.", "Brett is clocked in on job code Manager.", "SECONDARY_EMPLOYEE", `
Tap Clock Out as Brett => To confirm: The Tip amount pop-up should appear only for roles configured to declare tips.`],
        ["SFT", "High", "Verify the clock-in punch is stored in Punch Management with the job code and time.", "Harshey L clocked in at 09:02 AM on Cleaner. QA Manager is logged in to the manager web.", "MANAGER_WEB_LOGIN CLOCK_IN_TIME", `
Open Punch Management for Harshey L on 10/20/2026 => To confirm: A clock-in should be listed with job code Cleaner at 09:02 AM.`],
        ["SFT", "Medium", "Verify declared tips are stored against the punch.", "Harshey L declared tips at clock-out. QA Manager is logged in to the manager web.", "MANAGER_WEB_LOGIN TIP_AMOUNTS", `
Open Punch Management for Harshey L on 10/20/2026 => To confirm: Cash 12.50 and Credit 8.00 should be stored against the clock-out punch.`],
        ["BRK", "High", "Verify the clock-in break card shows the scheduled breaks with duration and approximate time.", NOT_CLOCKED, "PRIMARY_EMPLOYEE SCHEDULED_BREAKS_HARSHEY", `
Enter Harshey L's PIN => The break card should be displayed.
Review the meal break => MEAL BREAK should show "30 min (1:00p Approx)".
Review the rest break => REST BREAK should show its duration and approximate time.
Review the position => "Position : Cook" should be displayed.`],
        ["BRK", "High", "Verify a break is suggested when none is scheduled and a labor law is configured.", "Brett is not clocked in.", "SECONDARY_EMPLOYEE SHIFT_WITHOUT_BREAKS_BRE", `
Enter Brett's PIN => The clock-in screen should be displayed.
Review the break card => To confirm: A suggested break should be displayed.`],
        ["BRK", "High", "Verify the active shift break cards show the allocation and due time.", CLOCKED, "PRIMARY_EMPLOYEE SCHEDULED_BREAKS_HARSHEY", `
Review the Meal Break card => The card should show "30m allocated (by 01:00 PM)".
Review the Rest Break card => The card should show "10m allocated (by 12:00 PM)".`],
        ["BRK", "High", "Verify selecting Meal Break changes the bottom button to Start Meal Break Now.", CLOCKED, "PRIMARY_EMPLOYEE", `
Tap the Meal Break card => The bottom button should read "Start Meal Break Now".`],
        ["BRK", "High", "Verify selecting Rest Break changes the bottom button to Start Rest Break Now.", CLOCKED, "PRIMARY_EMPLOYEE", `
Tap the Rest Break card => The bottom button should read "Start Rest Break Now".`],
        ["BRK", "High", "Verify the Break in progress screen during a meal break.", CLOCKED, "PRIMARY_EMPLOYEE MEAL_BREAK_TAKEN", `
Tap Start Meal Break Now at 01:00 PM => BREAK IN PROGRESS · CLEANER should be displayed.
Review the duration => BREAK DURATION should show a running timer with 01:00 PM.
Review the break card => The card should show "30min allocated (until 01:30 PM)".
Review the button => An orange END BREAK button should be displayed.`],
        ["BRK", "High", "Verify END BREAK returns to the active shift.", CLOCKED + " A meal break is in progress.", "PRIMARY_EMPLOYEE", `
Tap END BREAK => To confirm: The active shift screen should be displayed.
Review the top card => SHIFT ACTIVE · CLEANER should be displayed.`],
        ["BRK", "Medium", "Verify how an early or late break end is shown.", CLOCKED + " A meal break started at 01:00 PM.", "PRIMARY_EMPLOYEE MEAL_BREAK_TAKEN", `
Tap END BREAK at 01:20 PM => To confirm: A short-break indication should be displayed.
Start a rest break and end it after 15 minutes => To confirm: A long-break indication should be displayed.`],
        ["RPT", "High", "Verify declared tips appear in the Employee Tip report.", "Harshey L clocked out with tips on 10/20/2026. QA Manager is logged in.", "MANAGER_WEB_LOGIN TIP_AMOUNTS", `
Open the Employee Tip report for 10/20/2026 => Harshey L's tips should show Cash 12.50 and Credit 8.00.`],
        ["RPT", "Medium", "Verify a published schedule change updates the shift pill and break card.", NOT_CLOCKED, "PRIMARY_EMPLOYEE", `
Change Harshey L's shift in Zip Schedules to 10:00 AM – 06:30 PM and publish => The schedule should be published.
Enter Harshey L's PIN => The shift pill should show 10:00 AM – 06:30 PM.`],
        ["RPT", "Medium", "Verify a switched job code is reflected in the Job Code Payroll report.", "Harshey L worked Cleaner then switched to Trainee and clocked out.", "MANAGER_WEB_LOGIN PRIMARY_EMPLOYEE", `
Open the Job Code Payroll report for 10/20/2026 => To confirm: Hours should be split between Cleaner and Trainee. ++ The first punch was clocked out and a second punch was added with the updated job code.`],
        ["REG", "High", "Verify punch times recorded through the new screens match the Daily Punch report.", "Harshey L clocked in at 09:02 AM, took a meal 01:00 PM – 01:30 PM and clocked out at 05:31 PM.", "MANAGER_WEB_LOGIN CLOCK_IN_TIME MEAL_BREAK_TAKEN CLOCK_OUT_TIME", `
Open the Daily Punch report for 10/20/2026 => The report should list 09:02 AM, 01:00 PM, 01:30 PM and 05:31 PM for Harshey L.`],
        ["REG", "High", "Verify PIN authentication still opens the correct screen for each state.", "Time Clock is online.", "PRIMARY_EMPLOYEE INVALID_CREDENTIALS", `
Enter Harshey L's PIN while not clocked in => The clock-in screen should be displayed.
Enter PIN 0000 => To confirm: An invalid PIN message should be displayed.`],
        ["REG", "Medium", "Verify meal break premium logic is unaffected by the new break screens.", "Harshey L takes a meal break starting after the end of the 5th hour.", "PRIMARY_EMPLOYEE", `
Start the meal break at 02:15 PM and end it at 02:45 PM, then clock out => The clock-out confirmation pop-up should be displayed.
Open the Employee Violation report for 10/20/2026 => To confirm: A meal break violation should be listed for Harshey L.`],
        ["EDG", "Medium", "Verify a long job code name fits on its card and the Clock In button.", NOT_CLOCKED + ' A job code named "Senior Prep Cook Overnight Lead" is assigned.', "PRIMARY_EMPLOYEE", `
Review the job code card => The full name should be displayed without overlap.
Select it and review the button => The button text should wrap without overflowing.`],
        ["EDG", "Medium", "Verify a double tap on Clock In records one clock-in.", NOT_CLOCKED + " Cleaner is selected.", "PRIMARY_EMPLOYEE", `
Double-tap Clock In · Cleaner => Only one clock-in confirmation pop-up should be displayed.
Open the Daily Punch report => Only one clock-in punch should be listed.`],
        ["EDG", "Medium", "Verify an overnight shift shows correct times across midnight.", "Adams is clocked in at 10:00 PM on 10/20/2026.", "OVERNIGHT_SHIFT", `
Enter Adams' PIN at 01:00 AM on 10/21/2026 => The SHIFT START should show 10:00 PM.
Review the timer => The timer should show 3 hours elapsed.`],
        ["EDG", "Medium", "Verify a long employee name in the greeting and confirmation pop-up.", "Maximiliano Bartholomew-Fitzgerald is not clocked in.", "LONG_EMPLOYEE_NAME", `
Enter the PIN => The greeting should show the full name without overlap.
Clock in and clock out => The confirmation greeting should wrap without truncating the name.`],
    ];

    const project = {
        name: "Zip Clock — Clock In / Clock Out Revamp", code: "CIO", infix: "CR", fileName: "Clock_In_Out_Revamp.xlsx",
        environment: "QA", testedBy: "QA Team", executionDate: "2026-10-20", platform: "iOS and Android",
        basePre: "",
    };
    const data = [...ENVIRONMENT_DATA.map(d => ({ ...d })),
        ...Object.values(DATA).map(([category, item, value, notes]) => ({ category, item, value, notes }))];
    const sections = Object.entries(MODULES).map(([code, [title, name]]) => ({ code, name, title, cases: [] }));
    for (let [mod, importance, description, pre, keys, steps] of CASES) {
        const section = sections.find(s => s.code === mod);
        section.cases.push({
            id: "", importance, description, pre,
            data: keys.split(" ").map(k => `${DATA[k][1]}: ${DATA[k][2]}`).join("\n"),
            steps: steps.trim().split("\n").map(line => {
                const [action, rest] = line.split(" => ");
                const [expected, observation] = rest.split(" ++ ");
                const actual = pastTense(expected) + (observation ? "\n" + observation : "");
                return { action, expected, actual, status: "Pass" };
            }),
        });
    }
    const suite = { sections };
    numberCases(suite, project);
    return {
        project, data, suite,
        basis: "03",
        modules: Object.entries(MODULES).filter(([c]) => !TAIL_SECTIONS[c]).map(([code, [title, name]]) => ({ code, name, description: title, precondition: "", scenarios: "" })),
    };
})();
