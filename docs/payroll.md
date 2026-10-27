# Staff attendance and payroll

`packages/payroll` (API) and `packages/payroll-ui` (web module) give a small Tamil Nadu shop (2 to 30 staff, salaried and
daily-wage, paid in cash, by bank or UPI) daily attendance, leave, a monthly payroll worked out from attendance, payslips
in English and Tamil, the register and bank sheet, and the postings to the books. Gap item #44.

- **Features** (`packages/payroll/src/ports.ts`): `payroll` "Staff attendance and leave" (shop toggle, **off** until the owner
  switches it on) and `payroll.salary` "Salary and payslips" (depends on `payroll`). App profiles BL, EC, PH, RS and SV
  grant `payroll.*`; plans: Starter `payroll` (attendance and leave), Pro and Enterprise `payroll.*` (`seed-fixtures.ts`).
- **Permissions**: `payroll.manage` (staff records and salaries, payroll, advances, payments, dues, settings) and
  `payroll.attendance` (mark and correct attendance, the check-in screen, the month sheet, approve leave; never
  salaries). Owners and admins hold both. The built-in **Manager** role gets `payroll.attendance`. There is deliberately
  no `payroll.view`: the built-in roles hold `*.view` and salaries are not for every member. Staff see **their own**
  attendance, leave and payslips through `/v1/payroll/me/*` with no permission: only the record linked to their login.
- **Migration** `0049_payroll`: `payroll_settings`, `payroll_employees`, `payroll_holidays`, `payroll_attendance`,
  `payroll_attendance_log`, `payroll_leave_types`, `payroll_leave_balances`, `payroll_leave_requests`,
  `payroll_advances`, `payroll_runs`, `payroll_run_lines`, `payroll_payments`, `payroll_due_payments`. Money is integer
  paise, rates basis points, days `real` (halves).
- **Wiring**: `apps/api/src/kit-payroll.ts` (POS PINs for check-in, the team list to link a login, audit, the books nudge,
  the `payslip` document type); the books read payroll through `kit-accounting.ts` `payroll` (see "The books").
- **Web**: `payrollModule()` at `/staff` in the billing, pharmacy, restaurant, services and shop apps; Settings →
  Staff and payroll at `/settings/payroll`.

## What already existed and is reused

| Existing | How payroll uses it |
|---|---|
| `packages/staff` (members, roles, permissions) | An employee may link a team member (`userId`) for self check-in, "my payslips" and the PIN screen. Most daily-wage staff never sign in, so employees are their own records. |
| POS PINs (`pos_staff_pins`, `pos.service.memberForPin`) | The check-in screen: a person types their POS PIN on the shop's device. Five wrong PINs lock the screen for 5 minutes (per shop, in memory). |
| AI shift planning (`packages/ai/src/counter/shifts.ts`) | A suggestion only, no roster table. Payroll keeps one shop shift (and an optional own shift per person) for late and overtime minutes. |
| Till sessions | Not used: the till's opener is not attendance. |
| Expenses | Not used: salaries post from payroll. The UI warns owners not to also enter salaries under Expenses (double count). |
| Accounting (`docs/accounting.md`) | The document sync posts payroll exactly like expenses and purchases: derived from the current documents, content-hashed, idempotent, reversed when a document goes away. |
| Documents module | Payslip PDF type `payslip` (A4, EN / TA). |
| Branches | Employees and holidays can carry a branch; the day board and month sheet filter by branch. One payroll per shop per month. |

## Attendance

One row per person per day (`payroll_attendance`): `present`, `absent`, `half_day`, `leave` (with a leave type),
`week_off`, `holiday`, plus check-in / check-out times and worked, late and overtime minutes.

- **Not every day needs a mark.** A working day with no row counts as the shop's `unmarkedAs` (default **present**: most
  small shops only mark absences). Weekly offs (shop setting, or the person's own) and holidays come from the calendar.
- **Ways to mark**: the check-in screen (`POST /attendance/kiosk { pin }`, toggles in/out), self check-in from the
  person's own login (`POST /me/check`, setting `selfCheckIn`), the manager's day board (one tap or "mark all unmarked
  present", `POST /attendance/bulk`), or a mark with times (`POST /attendance/mark`).
- **Late** = minutes after the shift start when past the grace period (default 10). **Overtime** = minutes worked past
  the shift length, counted from `otAfterMinutes` (default 30). A day worked under `halfDayBelowMinutes` (default 4 h)
  becomes a half day at check-out. Late minutes are reported, never deducted automatically.
- **Corrections are audited.** Changing a day that was already marked needs a reason (400 `reason_required`); every
  change (new marks too) is written to `payroll_attendance_log` with before / after, who and when (`GET /attendance/log`),
  and mutating requests are also in the shop's audit log. Days of a month whose payroll is **final** can't be changed
  (409 `payroll_finalized`): cancel that payroll first.
- **Month sheet** `GET /attendance/sheet?month=` (and `format=csv`): a code per day (P, A, H, H/CL, CL, WO, HO, blank, `-`
  before joining / after leaving) and the counts payroll uses.
- Selfies and location were not asked for and are not built.

## Leave

Leave types (seeded on first use, all editable): Casual 12, Sick 12, Earned 12 (carried forward up to 24), Leave without
pay (unpaid, no limit). Yearly days, paid or not, carry forward and its cap are per type; the leave year starts in the
month chosen in settings (default January).

- Requests (`POST /leave/requests`, or `/me/leave-requests` by the person) count working days only (weekly offs and
  holidays are free; half day = 0.5). Overlapping requests are refused.
- **Approval** (owner, admin or `payroll.attendance`) checks the balance (409 `leave_balance_low`), then marks each working
  day as leave, linked to the request (days the person actually worked are left alone). Cancelling an approved request
  removes those marks. Balance = yearly days + opening (carried) + adjustment − used, where *used* is counted from the
  attendance rows (so leave marked by hand counts too). `POST /leave/carry-forward { year }` writes the openings.
- Not done: pro-rating the yearly days for people who join mid-year (the owner adjusts the balance), accrual per month,
  encashment, a request spanning two leave years is counted in the year it starts.

## Payroll

**Salary structure** per person (copied onto each payroll line, so later raises don't change past payslips; changes are in
the audit log with before / after): pay type monthly (basic, DA, HRA, any allowances), daily (wage a day) or hourly;
an own overtime rate an hour (blank = worked out); PF / ESI / PT switches; how they are paid (cash, bank with account
and IFSC, UPI) and UAN / ESI number / PAN for the payslip.

**A month's run** (`POST /runs { month }`, one per month): a draft worked out from attendance; `refresh` recomputes it
(owner adjustments are kept), `PATCH /runs/:id/lines/:lineId` sets overtime minutes, extra loss-of-pay days, extra
earnings (bonus, incentive), deductions (fine, canteen), TDS and the advance recovery for the month. `finalize` freezes it
and posts it; a final payroll can be cancelled (reason required) when nobody is marked paid and no later month is final;
a draft is simply deleted. `pay` marks lines paid (each person's own method unless one is given); a payment can be undone.

**Paid days** (`logic.ts`):

| Pay type | Paid days | Pay |
|---|---|---|
| Monthly, basis "working days" (default) | working days − LOP | each component × paid days / working days of the month |
| Monthly, basis "days in the month" | days employed − LOP | ÷ days in the month |
| Monthly, basis "fixed" (26 or 30) | fixed × days employed / days in month − LOP | ÷ fixed days |
| Daily wage | present + half days × 0.5 + paid leave + days worked on offs (+ holidays / weekly offs when the shop pays them) | wage × paid days |
| Hourly | — | rate × minutes worked + paid leave at a shift's hours |

LOP = absent days + unpaid leave (half a day for a half day without leave). Weekly offs, holidays and a comp-off are paid
for monthly staff. Days before joining / after the last working day are not paid. Work on a weekly off or holiday is paid
as an extra day (setting). **Overtime** pays `otMultiplier` (default 2) × the ordinary hourly rate (basic + DA ÷ basis days
÷ shift hours; daily wage ÷ shift hours), or the person's own rate.

**Rounding**: each component to the paisa; PF to the nearest rupee; ESI **up** to the next rupee; net pay to the rupee
(setting, default on; the difference is "Rounded off" on the payslip and goes to Round off in the books). Advances and
other deductions never take net pay below zero (they are cut back and flagged `recovery_reduced`); finalizing refuses a
negative net.

**Advances / loans** (`/advances`): amount, monthly instalment, first month, method. Each payroll recovers the instalment
(or what is left, or the owner's figure for the month); outstanding = amount − recoveries in **final** payrolls. An advance
can be cancelled only before anything was recovered.

**Statutory dues** (`/dues`): PF (employee + employer), ESI, professional tax and salary TDS due per month from final
payrolls against what was paid (`POST /dues { kind, month, amount, method, reference }`). Returns and challans (EPFO ECR,
ESIC, PT returns, Form 24Q) are filed outside RBMS.

**Outputs**: payslip PDF `GET /v1/documents/payslip/<lineId>.pdf?locale=en|ta` (owners / `payroll.manage`) and
`/v1/payroll/me/payslips/<id>/pdf?lang=` (the person); payroll register CSV `GET /runs/:id/register.csv` (days, every
head, employer cost, payment); bank transfer sheet CSV `GET /runs/:id/bank-sheet.csv` (bank-paid staff not yet marked
paid: name, account, IFSC, bank, amount, narration; rearrange to your bank's bulk-upload template, open the account
column as text).

## Statutory defaults: check with your auditor

All statutory parts are **off** until the owner switches them on (shop settings) and on per person. Every rate and limit
is editable; Settings shows "Defaults — check with your auditor" on each card.

| Item | Default | Notes / limits of what is built |
|---|---|---|
| PF | employee 12%, employer 12% of basic + DA, capped at a ₹15,000 wage (cap can be switched off) | Employer 12% is booked as one amount (no EPS 8.33% / EPF 3.67% split, no EDLI or admin charges, no VPF). No ECR file. |
| ESI | employee 0.75%, employer 3.25% of gross when the wage rate is ₹21,000 or less | Eligibility is checked each month on the salary rate (monthly) or wage × 26 (daily), not held for the contribution period (Apr–Sep / Oct–Mar). Overtime is in the contribution. No exemption for very low daily wages. |
| Professional tax (Tamil Nadu) | half-yearly income slabs: up to ₹21,000 nil; ₹21,001–30,000 ₹180; 30,001–45,000 ₹425; 45,001–60,000 ₹930; 60,001–75,000 ₹1,025; above ₹75,000 ₹1,250; deducted in September (Apr–Sep) and March (Oct–Mar) on the half-year's gross from final payrolls | The slab table and the deduction months are editable; rates differ by corporation / municipality and change by government order. "Monthly" mode deducts a sixth each month instead. Staff who leave before the deduction month are not caught. |
| TDS on salary | a manual amount per person per month | No Form 24Q, no tax computation, no Form 16. |
| Overtime | 2 × ordinary rate | TN Shops and Establishments Act: confirm with your auditor. |
| Leave | CL 12, SL 12, EL 12 (carry 24) | Check against your standing orders. |
| Holidays | suggestions: Republic Day, Tamil New Year, May Day, Independence Day, Gandhi Jayanti (fixed dates) | Festival holidays move every year; add them by hand. |

## The books

Final payrolls, salary payments, advances given and statutory deposits are documents of the accounting document sync
(`packages/accounting/src/rules.ts` `payrollPostings`, port `SourcesPort.payroll`, adapter `kit-accounting.ts`), posted only
when the shop's books are on. Idempotent (content hash per source) and reversible: cancelling a payroll, undoing a payment,
cancelling an advance or a due payment removes the document from the sync, which reverses its entry. Payroll changes nudge
the books (`accounting.kick`, debounced).

| Event | Source type | Debit | Credit |
|---|---|---|---|
| Payroll made final (dated the month's last day) | `payroll_run` | Salaries and wages (gross), Employer PF and ESI (employer shares), Round off (net rounded up) | Salaries payable (net), PF payable (both shares), ESI payable (both shares), Professional tax payable, TDS on salaries payable, Advances to staff (recovered), Other income (other deductions), Round off (net rounded down) |
| Salary paid | `salary_payment` | Salaries payable | money account of the method |
| Advance given | `staff_advance` | Advances to staff | money account |
| PF / ESI / PT / salary TDS deposited | `payroll_due` | the dues account | money account |

New standard accounts (seeded on chart top-up; a code clash falls back to a free code): 1410 Advances to staff,
2210 PF payable, 2211 ESI payable, 2212 Professional tax payable, 2213 TDS on salaries payable, 5960 Salaries and wages,
5965 Employer PF and ESI. 2200 Salaries payable now has the key `salaries_payable`; shops seeded before keep their 2200,
which is adopted (keyed) the first time payroll posts instead of adding a second one. The sync also creates any standard
account a posting needs that a shop's chart lacks.

## Tests

- `packages/payroll/src/logic.test.ts` (39): day counts, paid days on each basis, LOP, half days, comp-offs, joiners,
  daily and hourly pay, overtime, PF ceiling and rounding, ESI ceiling and rounding up, PT slabs (half-yearly, monthly,
  edited table), advance recovery and the net-below-zero guard, TDS, rounding, run totals, check-in late / overtime / half
  day, leave days, balances and carry forward, settings merge and input checks.
- `packages/payroll/src/service.db.test.ts` (needs `PAYROLL_TEST_DATABASE_URL`): a month end to end against Postgres
  (correction with reason and log, leave approval and balance, PIN check-in, advance, the October payroll, final lock,
  payments, book sources balance, PF due paid, cancel and re-run).
- `packages/accounting/src/payroll-rules.test.ts` (6): postings balance, rounding both ways, payments / advances / dues,
  paying everything clears the liabilities, hashing.
- `apps/api/src/kit-payroll.test.ts`: 60 random payrolls (salaries, days, statutory switches, deductions) all post a
  balanced journal.
- `packages/payroll-ui/src/module.test.ts` (7): EN / TA key parity, every used key exists, gates, format helpers.

## Not built

Form 24Q / Form 16, EPFO ECR and ESIC challan files, PT returns, gratuity and bonus (Payment of Bonus Act) computation,
salary revision history with arrears, shift rosters, biometric devices, selfie / location check-in, per-branch payroll
runs and books, leave accrual and pro-rating, WhatsApp payslips.
