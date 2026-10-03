# Legal drafts

Drafts of the terms of use and the legal notice of ORBES GENOME CODE (J-04), written from the code for counsel's review. **None of them is validated.** By the owner's decision, the legal pages go online before that review (J-06, under `/legal` of verify.theorbes.com); the announcement waits for it (LAUNCH §10).

| File | What it is | Language |
|---|---|---|
| [TERMS-FACTS.md](TERMS-FACTS.md) | Every rule the terms describe, with the exported constant and the line of code that applies it, and what the code does not do | French |
| [terms.fr.md](terms.fr.md) · [terms.en.md](terms.en.md) | Terms of use: the service, the ORBES account, registration, transfer, loss and theft, the ownership certificate, the warranty | French · English |
| [legal-notice.fr.md](legal-notice.fr.md) · [legal-notice.en.md](legal-notice.en.md) | Legal notice of theorbes.com and verify.theorbes.com: publisher, publication director, hosts (Vercel Inc., OVHcloud in Canada) | French · English |
| [counsel-note.fr.md](counsel-note.fr.md) | Note for counsel: fields to complete, the Toubon law, the consumer mediator, and the points where the code and the law must meet | French |

**Conventions.**

- `[À COMPLÉTER : …]` marks every field that awaits ORBES's legal identity or counsel's choice, in both languages (the English drafts keep the French marker, so one search finds every gap). A published page shows no such field: until it is filled in, the page reads "ORBES".
- Each article of the terms ends with a *Code : …* line (*Code: …* in English) that cites the rules of TERMS-FACTS it describes, or says that it is a legal clause with no rule of the code. These lines are for the review; they are not published.
- The terms and the legal notice are customer copy: they are held to the lexicon of BRAND §4.5 in English and in French (the packaging kit's §4), with no exception, and to no exclamation mark (BRAND §4.1).

**The test.** `genome/test/docs/terms-facts.test.ts` checks these files against the code:

- each value of TERMS-FACTS equals its exported constant (`PASSWORD_MIN_LENGTH`, `DEFAULT_SESSION_TTL_HOURS`, `SCAN_TOKEN_TTL_MS`, `CLAIM_ATTEMPT_LIMIT`, `TRANSFER_TTL_MS`, `RECOVERY_CODE_TTL_MS`, `TRANSFER_FREEZE_MS`, `TRANSFER_TOKEN_TTL_MS`, `CERTIFICATE_MAX_DAYS`, `SALE_TOKEN_TTL_MS`…), each code fragment is found at the line cited, and each absence (no email, no reset link, no undoing a transfer, no account deletion) holds in the code;
- the two production settings that would change a rule stay unset in `deploy/vps/.env.example`;
- every rule is cited by the terms in both languages, the article that cites it gives its value, and both languages cite the same rules article by article;
- the result clauses say what BRAND §4.5 and §4.6 say: AUTHENTIC qualifies the signed identity, a copy can verify like the original, registration is not a title of ownership; the second-hand sentence is the one /verify shows (`RESALE_GUIDANCE`) and its French translation in the packaging kit;
- the legal notice keeps the fields the brief names (company name, RCS, share capital, publication director) and names both hosts;
- the note for counsel covers the Toubon law and the consumer mediator.

A change to the code that moves or changes a rule fails the test, whose message gives the new line: update TERMS-FACTS, then the terms if the rule itself changed.
