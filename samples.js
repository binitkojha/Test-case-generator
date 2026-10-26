// Sample project — the Zip Clock "Pending Punch Acknowledgement" flow (acknowledgement-screen/pending-ack-flow.html).
// Data values come from that prototype's dummy data.

const SAMPLE_PENDING_ACK = {
    project: {
        name: "Zip Clock — Pending Punch Acknowledgement",
        code: "PPA",
        infix: "CR",
        environment: "QA / Dev (iOS and Android)",
        testedBy: "QA Team",
        executionDate: "2026-10-21",
        platform: "Mobile app",
        fileName: "Pending_Punch_Acknowledgement_Prototype.xlsx",
        defaultStatus: "Untested",
        basePre: "Manager Andrew is logged in to Zip Clock on the mobile app at site Altametrics. The pending punches in the Test Data exist.",
    },

    scope: "changed",
    changeAreas: [
        { area: "Pending Punch to Acknowledge list and employee detail", type: "NEW" },
        { area: "Punches to Acknowledge — Report, Confirm, Save", type: "EXISTING-REVAMPED" },
        { area: "Reported Concerns, concern detail and Edit Punch", type: "NEW" },
    ],
    surfaces: ["Mobile app", "Manager web"],
    basisText: "Prototype: acknowledgement-screen/pending-ack-flow.html (manager mobile flow).",

    modules: [
        {
            code: "HOM", name: "Requests tiles", description: "Acknowledgement tiles on the Requests tab", precondition: "",
            scenarios: `Verify the Pending Punch to Acknowledge tile shows the number of employees with pending punches. [High] {Pending punches roster}
- Open the Requests tab => The Needing Action and Awaiting Action from Others sections should be displayed.
- Review the Pending Punch to Acknowledge tile => The badge should read 18.
Verify the Punches to Acknowledge tile shows the manager's own punches. [High] {Own punches to acknowledge}
- Review the Punches to Acknowledge tile => The badge should read 7.
Verify the Reported Concerns tile shows the number of concerns to review. [High] {Reported concerns}
- Review the Reported Concerns tile => The badge should read 13.
Verify Need Acknowledgement opens the employee list. [High]
- Select the Pending Punch to Acknowledge tile => The employee list should be displayed.`,
        },
        {
            code: "LST", name: "Employee list", description: "Employees with pending punch acknowledgement", precondition: "",
            scenarios: `Verify the summary shows the number of employees pending acknowledgement. [High] {Pending punches roster}
- Open Pending Punch to Acknowledge => The employee list should be displayed.
- Review the summary line => "18 Employees Pending Punch Acknowledgement" should be displayed.
Verify each card shows the avatar, name and pending punch count. [High] {Employee with one punch}
- Review Liam K's card => The LK avatar and the name Liam K should be displayed.
- Review the card details => "Pending Punches : 1" and "10/16/2026" should be displayed.
Verify an employee with punches on several dates shows the number of business dates. [High] {Employee with several dates}
- Review Noah P's card => "Pending Punches : 8" should be displayed.
- Review the date line => "2 business dates" should be displayed.
Verify the employee list keeps the API order. [Medium] {Pending punches roster}
- Review the first three cards => The cards should appear in the order Liam K, Sofia M, Noah P.
Verify the same employee always gets the same avatar colour. [Low]
- Note Noah P's avatar colour => The colour should be noted.
- Go back and open the list again => Noah P's avatar should show the same colour.`,
        },
        {
            code: "DTL", name: "Employee detail", description: "Pending punches for one employee", precondition: "",
            scenarios: `Verify the employee detail shows the profile and pending count. [High] {Employee with several dates}
- Select Noah P's card => The employee detail should be displayed.
- Review the profile card => The name Noah P and "8 punches pending acknowledgement" should be displayed.
Verify each punch shows its details. [High] {Employee with one punch}
- Select Liam K's card => The employee detail should be displayed.
- Review punch #1 => Business Date 10/16/2026, Type Rest Break End, Original Time 7:28a, Updated Time 7:16a, Modified By Andrew and Modified At 2026/10/16 08:47 AM should be displayed.
- Review the tag => The Edited tag should be displayed.
Verify a punch added by the manager shows no original time. [High] {Added punch}
- Select Noah P's card => The employee detail should be displayed.
- Review the Meal Break End punch on 10/16/2026 => Original Time should show "—".
- Review the punch tag => The Added tag should be displayed.
`,
        },
        {
            code: "ACK", name: "Punches to Acknowledge", description: "Manager's own edited punches — Select all, Report, Confirm, Save", precondition: "",
            scenarios: `Verify the list shows the manager's own punches to acknowledge. [High] {Own punches to acknowledge}
- Select the Punches to Acknowledge tile => Punches to Acknowledge should be displayed.
- Review the summary line => "7 Punches to Acknowledge" should be displayed.
- Review the first card => Break Start(Rest), 10/16/2026, Original "—", Updated 5:49a, By Andrew and Due to System Failure should be displayed with status Pending.
Verify Select all selects every punch. [High]
- Select Select all => Every punch should be checked.
- Review the selection count => "7 selected" should be displayed.
Verify selected punches can be confirmed. [High]
- Select the first two punches => "2 selected" should be displayed.
- Select Confirm => Both punches should show status Confirmed.
- Review the message => "2 punch(es) marked Confirmed. Tap Save to submit." should be displayed.
Verify a selected punch can be reported without a popup. [High]
- Select the Clock Out punch on 10/17/2026 => "1 selected" should be displayed.
- Select Report => The punch should show status Reported.
- Review the screen => No pop-up should be displayed.
Verify Save submits only punches with a status. [High]
- Confirm two punches and report one punch => Three punches should have a status.
- Select Save => "3 punch(es) saved." should be displayed.
- Review the list => Four punches should remain with status Pending.
- Review the Punches to Acknowledge badge => The badge should read 4.
Verify the empty state after every punch is acknowledged. [Medium]
- Select Select all and Confirm => Every punch should show status Confirmed.
- Select Save => "All punches reviewed. Nothing left to acknowledge" should be displayed.
- Review Select all => Select all should be disabled.`,
        },
        {
            code: "RCN", name: "Reported Concerns", description: "Attestation, shift confirmation and acknowledgement concerns to resolve", precondition: "",
            scenarios: `Verify concerns are grouped by type with counts. [High] {Reported concerns}
- Select the Reported Concerns tile => "13 Reported Concerns to Review" should be displayed.
- Review the groups => Reported Attestation 3, Reported Shift Confirmation 4 and Reported Acknowledgement 6 should be displayed.
Verify a group collapses and expands. [Medium]
- Select the Reported Attestation header => The group should collapse.
- Select the header again => The three attestation concerns should be displayed.
Verify an acknowledgement concern shows the punch type and time. [High]
- Review Roman's concern => Shift Date - 2026/10/14 and Break Start(Rest) → 7:36a should be displayed.
- Review the action icon => The edit icon should be displayed instead of the view icon.
Verify the thumbs-up icon resolves a concern. [High]
- Select the thumbs-up icon on Zoe F's concern => "Concern marked as resolved." should be displayed.
- Review the list => Zoe F's concern should no longer be listed.
- Review the summary line => The count should read 12.`,
        },
        {
            code: "CND", name: "Concern detail", description: "Attestation and shift confirmation answers", precondition: "",
            scenarios: `Verify the attestation detail shows the shift and answers. [High] {Attestation concern}
- Select the view icon on Owen C's concern => The concern detail should be displayed.
- Review the shift summary => Job Code Host, Clock In 4:00p and Clock Out 11:30p should be displayed.
- Review Q1 => Answer No and Reason "Meal break started after the 5th hour" should be displayed.
- Review Q2 => Answer Yes should be displayed with no reason.
Verify the shift confirmation detail heading and answers. [Medium]
- Select the view icon on Lucas B's concern => "Shift Confirmation Detail" should be displayed.
- Review Q2 => Answer No and Reason "Worked 15 minutes after clock out" should be displayed.
Verify Resolve closes the concern. [High]
- Select Resolve => "Concern marked as resolved." should be displayed.
- Review the screen => Reported Concerns should be displayed without the resolved concern.
Verify Edit Punches opens the punch editor. [High]
- Select Edit Punches => Edit Punch should be displayed with the employee's name in the title.`,
        },
        {
            code: "EDT", name: "Edit Punch", description: "Punch edit form with Clock Hours", precondition: "Manager Andrew is logged in to Zip Clock on the mobile app at site Altametrics. Edit Punch is open for Mia T's acknowledgement concern.",
            scenarios: `Verify the form is filled with the shift details. [High] {Edit punch record}
- Select the edit icon on Mia T's acknowledgement concern => "Edit Punch (Mia T)" and "Thu, Oct 15" should be displayed.
- Review the fields => Job Code Cook, Pay Rate 18.00, Clock In 09:00 AM, Clock Out 05:30 PM and Adjustment Reason Forgot to Clock Out should be displayed.
- Review Clock Hours => 08:30 should be displayed.
Verify Clock Hours updates when the times change. [High]
- Change Clock Out to 06:00 PM => Clock Hours should read 09:00.
Verify Clock Hours for an overnight shift. [High] {Overnight punch}
- Enter 10:00 PM in Clock In and 06:00 AM in Clock Out => Clock Hours should read 08:00.
Verify a break can be added and removed. [Medium]
- Select Add Break (+) => A Rest break row with empty Start and End should be displayed.
- Select the remove icon on the row => The break row should no longer be displayed.
- Review the Break section => "No breaks. Tap + to add one." should be displayed.
Verify Save stores the punch and resolves the concern. [High]
- Change Clock Out to 05:15 PM => Clock Hours should read 08:15.
- Select Save => "Punch saved. Concern resolved." should be displayed.
- Review the screen => Reported Concerns should be displayed.
Verify Delete needs a second tap to confirm. [High]
- Select Delete => The button should read "Tap to confirm".
- Wait 3 seconds => The button should read "Delete" again.
- Select Delete twice => "Punch deleted." should be displayed.`,
        },
    ],

    form: {
        module: "EDT",
        submit: "Save",
        fields: [
            "Job Code | select | required | error=Select a job code | options=Server,Team leader,Cook,Host,Cashier",
            "Pay Rate | number | min=0 | max=999.99",
            "Clock In | time | required | error=Enter clock in",
            "Clock Out | time | after=Clock In",
            "Cash Tip | number | min=0 | max=9999.99",
            "Adjustment Reason | select | required | error=Select an adjustment reason | options=Due to System Failure,Forgot to Clock In,Forgot to Clock Out,Missed Break Punch,Device Offline,Schedule Change",
            "Comments | text | maxlen=250",
        ].join("\n"),
    },

    actions: [
        "Confirm | ACK | | at least one punch is selected",
        "Report | ACK | | at least one punch is selected",
        "Save | ACK | | at least one punch has a status",
        "Resolve | CND | |",
        "Save | EDT | |",
    ].join("\n"),

    reports: `Verify a punch edited on the web appears in the mobile list. [High] {Employee with one punch}
- Edit Liam K's Clock In in Punch Approvals on Zip Clock web => The punch should be saved.
- Open Pending Punch to Acknowledge on mobile => Liam K's card should show one more pending punch.
Verify an acknowledgement saved on mobile clears the web row. [High]
- Confirm and save a punch on mobile => The punch should be removed from the mobile list.
- Open Pending Punch Acknowledgement on Zip Clock web => The row should no longer be listed.`,

    regression: `Verify Punch Approvals still opens from the Requests tab. [High]
- Select the Punches to Approve tile => Punch Approvals should be displayed.
Verify the manager can still clock in after acknowledging punches. [High]
- Acknowledge and save one punch => "1 punch(es) saved." should be displayed.
- Open the Clock tab and clock in => The clock-in confirmation should be displayed.`,

    data: [
        { category: "Environment", item: "QA environment URL", value: "https://<qa-env>.altametrics.com", notes: "Placeholder: confirm the QA URL." },
        { category: "Environment", item: "Site", value: "Altametrics", notes: "" },
        { category: "Environment", item: "Platforms", value: "iOS and Android (each case executed on both)", notes: "" },
        { category: "Users", item: "Manager login", value: "Andrew (Manager, also an employee) — QA account", notes: "Placeholder account: seed before execution." },
        { category: "Punches", item: "Pending punches roster", value: "37 edited punches for 18 employees: Liam K, Sofia M, Noah P, Mia T, Ethan W, Ava L, Lucas B, Chloe H, Mateo G, Zoe F, Daniel V, Isla N, Owen C, Ruby S, Leo D, Nora J, Caleb Y, Hazel Q", notes: "From the prototype data." },
        { category: "Punches", item: "Employee with one punch", value: "Liam K — Rest Break End 10/16/2026, 7:28a → 7:16a by Andrew, modified 2026/10/16 08:47 AM", notes: "" },
        { category: "Punches", item: "Employee with several dates", value: "Noah P — 8 pending punches on 10/15/2026 and 10/16/2026", notes: "" },
        { category: "Punches", item: "Added punch", value: "Noah P — Meal Break End 10/16/2026, no original time, updated 8:40a", notes: "Empty original time = punch added by the manager." },
        { category: "Punches", item: "Own punches to acknowledge", value: "7 punches for Andrew: Break Start(Rest) and Break End(Rest) 10/16; Clock In, Break Start(Meal), Break End(Meal), Clock Out 10/17; Clock In 10/18", notes: "" },
        { category: "Concerns", item: "Reported concerns", value: "13 concerns: 3 attestation (Cary, Mia T, Owen C), 4 shift confirmation (Andrew, Cary, Lucas B, Zoe F), 6 acknowledgement (Cary ×2, Roman, Sofia M, Mia T, Ethan W)", notes: "" },
        { category: "Concerns", item: "Attestation concern", value: "Owen C, 2026/10/19, Host, 4:00p–11:30p, Meal 10:05p–10:35p; Q1 No — Meal break started after the 5th hour; Q2 Yes", notes: "" },
        { category: "Concerns", item: "Edit punch record", value: "Mia T, Thu Oct 15, Cook, $18.00, 9:00a–5:30p, Forgot to Clock Out", notes: "" },
        { category: "Boundary", item: "Overnight punch", value: "Clock In 10:00 PM, Clock Out 06:00 AM (08:00 clock hours)", notes: "" },
    ],

    coverage: { validation: true, buttons: true, reports: true, regression: true, edge: true },
};
