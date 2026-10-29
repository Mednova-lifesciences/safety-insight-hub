# Data protection — MedNova PV Assist

Status as of 29 October 2026. This document records what the software does to protect personal data under the **Nigeria Data Protection Act 2023 (NDPA)**, and what MedNova (as the provider and data processor) and NAFDAC (as the data controller for regulatory pharmacovigilance) still need to do. It is an engineering record, not legal advice. Have the NDPC-registered Data Protection Officer and counsel review it before relying on it.

## 1. What data the platform holds

| Area | Personal data | Sensitivity |
|---|---|---|
| Line lists (AEFI / ADR) | Patient name or initials, hospital/record number, sex, age, date of birth, reactions, outcome, vaccine and batch, reporter name, designation, phone, e-mail, facility and address | **Health data: sensitive personal data (NDPA s.30)** |
| ICSRs / cases, WhatsApp intake | As above, plus free-text narratives and, for image intake, photos of paper forms | Sensitive |
| PSUR / PBRER review | Mostly aggregate data. Also the QPPV's name and contact details, and occasionally case narratives in line listings | Mostly non-sensitive; narratives may be sensitive |
| Accounts | Staff names, e-mails, roles, organisation | Personal |

## 2. Lawful basis

- **Sensitive (health) data, s.30(1)(h):** processing "is necessary for reasons of public health and provides for suitable and specific measures to safeguard the fundamental rights, freedoms and interests of the data subject". Pharmacovigilance by the national regulator fits this purpose. **The "suitable and specific measures" are a condition of the basis, not optional extras.** Sections 4 and 5 list what the software provides. NAFDAC must document the basis in its records of processing and its DPIA.
- s.30(1)(g) (medical care under a duty of confidentiality) and s.30(1)(i) (archiving, research or statistics on the basis of a law) may also apply to parts of the processing. Counsel should confirm which basis NAFDAC records.

## 3. Roles

- **NAFDAC** decides why and how pharmacovigilance data is processed: **data controller**.
- **MedNova** provides and operates the platform on NAFDAC's instructions: **data processor**. Under s.29(1) it must apply the Act's principles, assist with data-subject rights, secure the data (Part VII), give NAFDAC the information it needs to show compliance, and tell NAFDAC when it engages a new sub-processor. Under s.29(2) these measures include a **written agreement**.
- **Sub-processors engaged by MedNova:** OpenAI (AI analysis), Supabase (database and authentication), Render (backend API), and Vercel (web front end). Each needs a written agreement under s.29(2). See section 7.

## 4. Implemented in the software

### 4.1 De-identification before every AI call (s.39(2)(a): pseudonymisation)

- **Where:** `src/server/ai/deidentify.py`, called from `src/server/ai/client.py`. Every OpenAI request in the backend goes through `structured_completion` or `vision_structured_completion`, and both de-identify the request first. That covers column mapping, analysis, the adversarial pass, Fix, code-list reading, outcome mapping, coding suggestions, C.1.7 AI, PSUR screening, scientific review, V4 prefill, the memo, research synthesis, literature and WhatsApp intake. The browser never calls OpenAI: there is no key in the bundle (checked, section 4.5). So a modified browser cannot skip this step, and a new route cannot forget it.
- **What is replaced:** patient names and initials, patient record/hospital numbers, dates of birth, reporter names, phone numbers, e-mail addresses and street addresses become tokens such as `[[NAME_1]]`, `[[RECORD_2]]`, `[[DOB_1]]`, `[[PHONE_3]]`. Line-list columns are replaced by **what the column is**: the mapped field, or the header when it is unmapped. Free text such as PSURs, narratives and remarks is scanned for e-mails, phone numbers, street addresses, labelled dates of birth, and names introduced by a title or label ("Dr", "Mrs", "Patient name:", "QPPV:").
- **Consistency:** the same value gets the same token within a request, so the model can still see that two rows name the same patient.
- **Restoring:** the real values never leave the server. They are put back into the model's answer on the server, so the application sees exactly what it saw before.
- **Instructions to the model:** a short notice tells it to treat tokens as present, valid values and never to "fix" them.
- **Tests:** `test_deidentify.py` checks that no identifier reaches the request, that clinical values and structure are kept, that tokens are consistent and restored, and that dates, batch and lot numbers, dose counts and case IDs are *not* mistaken for identifiers.

### 4.2 AI data log (accountability)

- Every OpenAI request writes one row to `pv_ai_disclosures` with the endpoint, role, model, and **counts per kind of identifier replaced and per field. Never a value.**
- Administrators (Review Officer, Evaluator, Peer Reviewer, PV Manager) see it on **AI data log** (`/ai-log`). Row-level security limits each organisation to its own rows. Rows can't be changed or deleted from the app; only the backend's service role writes them.

### 4.3 Organisation isolation (row-level security)

- Every `pv_` table has RLS with `organization_id = current_org_id()` for signed-in users. Anonymous access exists only for the public reporting link: inserting a case, and reading the product catalogue and organisation names.
- **Checked live on 29 Oct 2026** with `e2e/rls-check.mjs`, signed in as users of two synthetic test organisations and as an anonymous caller. It covered 10 tables, the cross-file loader's own query, a cross-organisation read and write by ID, invite codes, and the AI log.
  - *Before the fix:* 35/37 checks passed. **Every organisation's invite code was readable with the public key.**
  - *After the fix:* 39/39 checks passed.
- **Fixed by migration** `supabase/migrations/20261029120000_restore_grant_hardening.sql` (rollback in `supabase/rollbacks/`). The project rebuilt on 4 Oct 2026 had lost the grant hardening from migrations 013, 015 and 016:
  - invite codes are now hidden from client roles;
  - anonymous callers can no longer run any SECURITY DEFINER function;
  - the open "demo workspace access" policies, which `20260819002606_….sql` would recreate on a fresh database because it sorts after `006`, are dropped for good.
- The cross-file duplicate and batch-flag loader (`src/services/api/linelist-cross-file.ts`) goes through the same RLS: it can only read the caller's own organisation's line lists (verified by the same script).

### 4.4 Other measures already in place

- **Encryption in transit:** HTTPS everywhere, HSTS (`vercel.json`), and a Content-Security-Policy that limits the browser to the app, Supabase and the API.
- **Encryption at rest:** provided by Supabase, which runs on AWS-managed encrypted storage.
- **Audit:** consequential actions are recorded with who, when and why, including the new "Drop as duplicate" and "Not a duplicate" decisions.
- **Server-verified cell changes:** line-list cells can only be changed through the backend's verified save path (database trigger).
- **Signatures:** PSUR sign-offs need the signer's password.
- **Data minimisation:** the E2B export uses initials, never full names.

### 4.5 Secrets

- The OpenAI key, Supabase service-role key and JWT secret exist only in the Render backend environment. The browser bundle (`.output/public`) was searched on 29 Oct 2026 for each key's value and for the variable names: none are present.
- The browser uses only the Supabase URL and the publishable/anon key, which RLS constrains.
- `src/integrations/supabase/client.server.ts` (service role) is imported by no browser code.
- Test-account passwords are not stored in the repository.

## 5. Known gaps in the software

1. **Image intake is not de-identified.** ICSR image extraction sends a photo of a paper form to OpenAI, and the text on the photo cannot be redacted by this layer. The AI log marks these calls as `image (not de-identified)`. *Options:* turn image intake off for NAFDAC, crop or blur before upload, or use OCR followed by text de-identification.
2. **Names in free text without a cue are not found.** A bare patient name inside a narrative, with no title or label, still reaches OpenAI. Structured columns are always covered. *Options:* a named-entity recogniser on the server, or zero data retention (section 7).
3. **Clinical content still goes to OpenAI** (reactions, dates of vaccination and onset, ages, products). After de-identification this is **pseudonymised, not anonymous**, personal data, so the cross-border rules (section 6) still apply.
4. The baseline-versus-de-identified AI comparison was run on synthetic data only. Re-check AI findings on a representative real file before go-live.

## 6. Transfers abroad (ss.41–43)

Data leaves Nigeria. Supabase is in AWS eu-west-1 (Ireland), the Render backend is in Virginia (USA), OpenAI processes in the USA by default, and Vercel serves the front end from its global network.

- **s.41(1):** a transfer is allowed only if the recipient is subject to a law, binding corporate rules, contractual clauses, a code of conduct or a certification that gives **adequate protection** (s.41(1)(a)), or if a **s.43 condition** applies (s.41(1)(b)).
- **s.41(2):** the basis for each transfer and the adequacy assessment under s.42 **must be recorded**.
- **s.42:** adequacy means "substantially similar" principles. The NDPC may approve countries, standard contractual clauses or BCRs (s.42(4)–(5)). Without a determination, adequacy is not implied (s.42(6)).
- **s.43(1)(d):** where adequacy is absent, a transfer is allowed if it "is necessary for important reasons of public interest". National pharmacovigilance can plausibly rely on this, but it is a derogation. Rely on it only when NAFDAC has documented why the transfer, to *this* provider, is necessary, and preferably alongside contractual safeguards.
- The **GAID 2025** (in force 19 Sept 2025) adds Cross-Border Data Transfer Instruments and transfer impact assessments (Schedule 5).

## 7. What MedNova and NAFDAC still need to do

| # | Action | Who | NDPA |
|---|---|---|---|
| 1 | Record the lawful basis (s.30(1)(h), and (g)/(i) if used) in NAFDAC's records of processing and privacy notice | NAFDAC | s.30, s.25 |
| 2 | **Carry out and file a DPIA before go-live.** Large-scale health data, AI processing and cross-border transfer are high-risk. Consult the Commission if residual risk is high (s.28(2)). The GAID 2025 includes a DPIA template and says DPIAs must be filed with the NDPC | NAFDAC with MedNova | s.28; GAID Art. 28 |
| 3 | **Written processing agreement NAFDAC ↔ MedNova** covering the s.29(1)(a)–(e) duties: principles, data-subject rights, security, compliance information, and notice of new sub-processors | Both | s.29 |
| 4 | **Written sub-processor agreements with OpenAI, Supabase, Render and Vercel.** Each offers a standard Data Processing Addendum: sign or accept it, keep copies, and list the sub-processors for NAFDAC | MedNova | s.29(1)(e), s.29(2) |
| 5 | **Record the transfer basis for each provider** (adequacy instrument, contractual clauses, or s.43(1)(d) with reasons) and do the GAID transfer impact assessment | NAFDAC with MedNova | s.41(2), s.42, s.43 |
| 6 | **OpenAI retention:** by default, API data is not used for training (since 1 March 2023) and abuse-monitoring logs are kept for up to 30 days. Apply for **Zero Data Retention or Modified Abuse Monitoring** (approval by OpenAI), and consider **EU data residency** (`eu.api.openai.com`, which needs ZDR/MAM), or a self-hosted or Nigerian-hosted model for the most sensitive flows | MedNova | s.39, s.41 |
| 7 | **Breach procedure:** the processor tells the controller without delay (s.40(1)), and the controller tells the Commission **within 72 hours** (s.40(2)) and the data subjects where the risk is high (s.40(3)). Name a contact point and rehearse the procedure | Both | s.40 |
| 8 | Appoint a DPO, and register as a data controller/processor of major importance if applicable | Both | s.32, s.44 |
| 9 | Close or accept the software gaps in section 5 (image intake, unlabelled names) and record the decision in the DPIA | MedNova | s.39 |
| 10 | Turn on Supabase **leaked-password protection** (flagged by the security advisor), and review account access quarterly | MedNova | s.39(2)(c) |
| 11 | Set retention periods for line lists, PSURs and the AI log, and delete when they expire | NAFDAC with MedNova | s.24(1)(d), s.39(1)(d) |

## 8. Provider facts (checked 29 Oct 2026)

| Provider | Role | Location | Notes |
|---|---|---|---|
| Supabase | Database, auth | AWS **eu-west-1 (Ireland)**: project `rcgiwtuvmczgcctfcrqf` | Encryption at rest, RLS. DPA available |
| Render | Backend API | **Virginia, USA**: service `safety-insight-hub`, free plan | Holds the AI and service-role secrets. Upgrade off the free plan for production |
| Vercel | Front end | Global edge network | Serves static assets; holds only public configuration |
| OpenAI | AI analysis | **USA** by default; EU residency available on approval | No training on API data by default. Abuse logs ≤30 days. ZDR/MAM by approval |

## Sources

- Nigeria Data Protection Act 2023, ss.28, 29, 30, 39, 40, 41, 42, 43 (text as published), e.g. via DataGuidance: https://www.dataguidance.com/sites/default/files/data_protection_act_2023.pdf
- NDPC, General Application and Implementation Directive (GAID) 2025, in force 19 Sept 2025. Summaries: DLA Piper, https://privacymatters.dlapiper.com/2025/06/nigeria-ndpc-issues-gaid-key-compliance-insights/ ; Mondaq on DPIAs under the NDPA and GAID, https://www.mondaq.com/nigeria/privacy-protection/1717414/navigating-the-ndpa-and-the-gaid-understanding-the-requirement-for-a-data-privacy-impact-assessment ; cross-border transfers, https://www.mondaq.com/nigeria/data-protection/1789480/cross-border-data-transfers-an-overview-of-legal-requirements-and-compliance-mechanisms-in-nigeria
- OpenAI, "Your data" (API data controls: training, retention, ZDR/MAM, data residency): https://developers.openai.com/api/docs/guides/your-data
- Supabase project region and security advisors: from the Supabase management API, 29 Oct 2026.
- Render service region and plan: from the Render API, 29 Oct 2026.

Check the GAID text itself on the NDPC website (https://ndpc.gov.ng) before filing. The summaries above are law-firm commentary.
