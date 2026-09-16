# CRM Jail — replay against the manual audits

Window **2026-08-31 to 2026-09-04**, scoring the exact records each auditor sampled.

`agree` = same verdict. `bot stricter` = auditor passed it, bot failed it.
`bot softer` = auditor failed it, bot passed it. `no verdict` = bot deferred (Phase 2 or judge unavailable).
**Overall: 88.0% agreement** across 1055 compared items — 82 bot-stricter, 45 bot-softer, 90 no verdict, 1 left blank by the auditor.


## Sabrina Johnson

**replay failed:** Error: COQL 400: {"code":"INVALID_QUERY","details":{"expected_data_type":"bigint","column_name":"id"},"message":"value given seems to be invalid for the column","status":"error"}


## Eric Wade (admissions)

15 records · **84.8% agreement** on 323 compared items · 25 bot-stricter · 24 bot-softer · 30 no verdict

| Item | Where | Auditor | Bot | Direction | Bot's note |
|---|---|---|---|---|---|
| L1 | Leads #2 | 0 | 1 | bot softer |  |
| L7 | Leads #2 | 0 | 1 | bot softer |  |
| L8 | Leads #2 | 0 | 1 | bot softer |  |
| L15 | Leads #2 | 0 | 1 | bot softer |  |
| L16 | Leads #2 | 0 | 1 | bot softer |  |
| L28 | Leads #2 | 0 | 1 | bot softer |  |
| L1 | Leads #3 | 0 | 1 | bot softer |  |
| L7 | Leads #3 | 0 | 1 | bot softer |  |
| L8 | Leads #3 | 0 | 1 | bot softer |  |
| L15 | Leads #3 | 0 | 1 | bot softer |  |
| L16 | Leads #3 | 0 | 1 | bot softer |  |
| L28 | Leads #3 | 0 | 1 | bot softer |  |
| L1 | Leads #4 | 0 | 1 | bot softer |  |
| L2 | Leads #4 | 0 | 1 | bot softer |  |
| L7 | Leads #4 | 0 | 1 | bot softer |  |
| L8 | Leads #4 | 0 | 1 | bot softer |  |
| L15 | Leads #4 | 0 | 1 | bot softer |  |
| L16 | Leads #4 | 0 | 1 | bot softer |  |
| L28 | Leads #4 | 0 | 1 | bot softer |  |
| C12 | Contacts #1 | 1 | 0 | bot stricter | These entries are just a log of call attempts and outcomes (LVM, missed, dropped |
| C13 | Contacts #1 | 1 | 0 | bot stricter |  |
| C13 | Contacts #2 | 1 | 0 | bot stricter |  |
| C12 | Contacts #3 | 1 | 0 | bot stricter | There is a narrative (called client, completed pre-assessment, reviewed program  |
| C12 | Contacts #4 | 0 | 1 | bot softer | There is a narrative: no bed availability was communicated, family expressed urg |
| C13 | Contacts #4 | 1 | 0 | bot stricter |  |
| D17 | Deals #1 | 1 | 0 | bot stricter |  |
| D20 | Deals #1 | 1 | 0 | bot stricter |  |
| D25 | Deals #1 | 1 | 0 | bot stricter |  |
| D37 | Deals #1 | 0 | N/A | bot softer |  |
| D38 | Deals #1 | N/A | 0 | bot stricter |  |
| D17 | Deals #2 | 1 | 0 | bot stricter |  |
| D20 | Deals #2 | 1 | 0 | bot stricter |  |
| D25 | Deals #2 | 1 | 0 | bot stricter |  |
| D37 | Deals #2 | 0 | N/A | bot softer |  |
| D38 | Deals #2 | N/A | 0 | bot stricter |  |
| D17 | Deals #3 | 1 | 0 | bot stricter |  |
| D20 | Deals #3 | 1 | 0 | bot stricter |  |
| D25 | Deals #3 | 1 | 0 | bot stricter |  |
| D37 | Deals #3 | 0 | N/A | bot softer |  |
| D17 | Deals #4 | 1 | 0 | bot stricter |  |
| D20 | Deals #4 | 1 | 0 | bot stricter |  |
| D25 | Deals #4 | 1 | 0 | bot stricter |  |
| D37 | Deals #4 | 0 | N/A | bot softer |  |
| D38 | Deals #4 | N/A | 0 | bot stricter |  |
| D17 | Deals #5 | 1 | 0 | bot stricter |  |
| D20 | Deals #5 | 1 | 0 | bot stricter |  |
| D22 | Deals #5 | 1 | 0 | bot stricter | There is a decent narrative (meth use history, depression, homelessness, program |
| D25 | Deals #5 | 1 | 0 | bot stricter |  |
| D38 | Deals #5 | N/A | 0 | bot stricter |  |

## Michael Mendez (admissions)

15 records · **87.1% agreement** on 380 compared items · 34 bot-stricter · 15 bot-softer · 30 no verdict

| Item | Where | Auditor | Bot | Direction | Bot's note |
|---|---|---|---|---|---|
| L22 | Leads #1 | N/A | 0 | bot stricter |  |
| L24 | Leads #1 | N/A | 0 | bot stricter |  |
| L26 | Leads #1 | 1 | 0 | bot stricter | No note on the record. |
| L27 | Leads #1 | 1 | 0 | bot stricter | No note on the record. |
| L22 | Leads #2 | N/A | 0 | bot stricter |  |
| L23 | Leads #2 | N/A | 0 | bot stricter |  |
| L24 | Leads #2 | N/A | 0 | bot stricter |  |
| L25 | Leads #2 | N/A | 0 | bot stricter |  |
| L26 | Leads #2 | 1 | 0 | bot stricter | No narrative is present/there is no description of any call, conversation, or ev |
| L26 | Leads #3 | 1 | 0 | bot stricter | No note on the record. |
| L4 | Leads #5 | 0 | 1 | bot softer |  |
| L22 | Leads #5 | 0 | N/A | bot softer | Blank explained in the note: The note explains the client isn't with her insuran |
| L24 | Leads #5 | 0 | N/A | bot softer | Blank explained in the note: The note's mention of insurance/card details being  |
| L25 | Leads #5 | 0 | 1 | bot softer |  |
| L26 | Leads #5 | 0 | 1 | bot softer | The note briefly explains what happened: the loved one was contacted and reporte |
| C12 | Contacts #1 | 1 | 0 | bot stricter | There is a narrative (client is at Faithland Recovery, seeking continued treatme |
| C6 | Contacts #2 | 1 | 0 | bot stricter |  |
| C12 | Contacts #2 | 1 | 0 | bot stricter | There's a brief narrative (called twice, left voicemail, then reached her and sh |
| C1 | Contacts #4 | 0 | 1 | bot softer |  |
| C6 | Contacts #4 | 0 | 1 | bot softer |  |
| C7 | Contacts #4 | 0 | 1 | bot softer |  |
| C9 | Contacts #4 | 0 | N/A | bot softer |  |
| C10 | Contacts #4 | 0 | N/A | bot softer |  |
| C11 | Contacts #4 | 0 | N/A | bot softer |  |
| C13 | Contacts #4 | 0 | 1 | bot softer |  |
| D17 | Deals #1 | 1 | 0 | bot stricter |  |
| D20 | Deals #1 | N/A | 0 | bot stricter |  |
| D21 | Deals #1 | 1 | 0 | bot stricter |  |
| D25 | Deals #1 | 1 | 0 | bot stricter |  |
| D38 | Deals #1 | 1 | 0 | bot stricter |  |
| D17 | Deals #2 | 1 | 0 | bot stricter |  |
| D20 | Deals #2 | N/A | 0 | bot stricter |  |
| D21 | Deals #2 | 1 | 0 | bot stricter |  |
| D22 | Deals #2 | 1 | 0 | bot stricter | The note describes what happened (client called about phone policy, was reassure |
| D23 | Deals #2 | 1 | 0 | bot stricter | No CRM fields are identified as incomplete, nor is there any explanation for why |
| D25 | Deals #2 | 1 | 0 | bot stricter |  |
| D17 | Deals #3 | 1 | 0 | bot stricter |  |
| D25 | Deals #3 | 1 | 0 | bot stricter |  |
| D22 | Deals #4 | 1 | 0 | bot stricter | While early entries have narrative and next steps (e.g., 'follow-up call at 12pm |
| D23 | Deals #4 | 1 | 0 | bot stricter | No CRM field is explicitly named as incomplete with a reason (e.g., 'Payment amo |
| D25 | Deals #4 | 1 | 0 | bot stricter |  |
| D38 | Deals #4 | N/A | 0 | bot stricter |  |
| D39 | Deals #4 | 0 | 1 | bot softer |  |
| D40 | Deals #4 | 1 | 0 | bot stricter |  |
| D6 | Deals #5 | 0 | 1 | bot softer |  |
| D21 | Deals #5 | 1 | 0 | bot stricter |  |
| D22 | Deals #5 | 1 | 0 | bot stricter | There's a brief narrative about the client's plan (Residential at BVR then retur |
| D25 | Deals #5 | 1 | 0 | bot stricter |  |
| D31 | Deals #5 | 0 | N/A | bot softer | Blank explained in the note: Note explains client will return to us for VIOP, in |

## Taylor Bertchie (admissions)

15 records · **91.8% agreement** on 352 compared items · 23 bot-stricter · 6 bot-softer · 30 no verdict

| Item | Where | Auditor | Bot | Direction | Bot's note |
|---|---|---|---|---|---|
| L6 | Leads #1 | 0 | 1 | bot softer |  |
| L22 | Leads #1 | 1 | 0 | bot stricter |  |
| L25 | Leads #1 | N/A | 0 | bot stricter |  |
| L6 | Leads #2 | 0 | 1 | bot softer |  |
| L9 | Leads #2 | 1 | 0 | bot stricter |  |
| L26 | Leads #2 | 1 | 0 | bot stricter | No note on the record. |
| L28 | Leads #3 | 0 | 1 | bot softer |  |
| L13 | Leads #5 | 0 | 1 | bot softer |  |
| L28 | Leads #5 | 0 | 1 | bot softer |  |
| C8 | Contacts #3 | N/A | 0 | bot stricter |  |
| D23 | Deals #1 | 1 | 0 | bot stricter | No field is explicitly flagged as unable to be completed along with a reason. If |
| D25 | Deals #1 | 1 | 0 | bot stricter |  |
| D40 | Deals #1 | 1 | 0 | bot stricter |  |
| D23 | Deals #2 | 1 | 0 | bot stricter | The Total Patient Responsibility field is left at $0.00 without any explanation  |
| D25 | Deals #2 | 1 | 0 | bot stricter |  |
| D40 | Deals #2 | 1 | 0 | bot stricter |  |
| D25 | Deals #3 | 1 | 0 | bot stricter |  |
| D40 | Deals #3 | 1 | 0 | bot stricter |  |
| D17 | Deals #4 | 1 | 0 | bot stricter |  |
| D20 | Deals #4 | 1 | 0 | bot stricter |  |
| D23 | Deals #4 | 1 | 0 | bot stricter | No fields are explicitly named as incomplete with a reason. For example, if inta |
| D25 | Deals #4 | 1 | 0 | bot stricter |  |
| D39 | Deals #4 | 1 | 0 | bot stricter |  |
| D5 | Deals #5 | 1 | 0 | bot stricter |  |
| D17 | Deals #5 | 1 | 0 | bot stricter |  |
| D20 | Deals #5 | 1 | 0 | bot stricter |  |
| D23 | Deals #5 | 1 | 0 | bot stricter | No field is explicitly identified as unable to be completed along with a reason. |
| D25 | Deals #5 | 1 | 0 | bot stricter |  |
| D37 | Deals #5 | 0 | N/A | bot softer |  |

## Kenny Reitz

**replay failed:** Error: COQL 400: {"code":"INVALID_QUERY","details":{"expected_data_type":"bigint","column_name":"id"},"message":"value given seems to be invalid for the column","status":"error"}


## Items that disagree most

A rule that disagrees on many records is likelier to be wrong than the auditors.

| Item | Criterion | Disagreements | Stricter | Softer |
|---|---|---|---|---|
| D25 | Deal created or updated the same day | 15 | 15 | 0 |
| D17 | Insurance Provider | 10 | 10 | 0 |
| D20 | Insurance Policy Type | 9 | 9 | 0 |
| D23 | Any field that could not be completed is named in Notes with | 6 | 6 | 0 |
| D38 | BD referral packet attached | 6 | 6 | 0 |
| L26 | Notes contain a clear narrative of what happened | 5 | 4 | 1 |
| L28 | Lead created or updated the same day | 5 | 0 | 5 |
| C12 | Notes contain a clear narrative plus next step | 5 | 4 | 1 |
| D37 | Note explaining why, plus the next step | 5 | 0 | 5 |
| L22 | Insurance Provider | 4 | 3 | 1 |
| C13 | Contact created or updated the same day | 4 | 3 | 1 |
| D22 | Notes contain a clear narrative plus next step | 4 | 4 | 0 |
| D40 | Pre-screen / pre-assessment completed entirely and attached | 4 | 4 | 0 |
| L1 | First and last name present | 3 | 0 | 3 |
| L7 | Interaction Status | 3 | 0 | 3 |
