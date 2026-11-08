---
name: rule-boundaries
description: Test a Joule Studio agent extension (or agent) against its own rules. Generates boundary scenarios for every numeric limit and refusal scenarios for every read-only rule, runs them against the deployed agent (jl CLI, A2A endpoint or a Joule-conversation sign-off sheet) and scores the results. Use when the user wants to test, evaluate or sign off an extension or agent, check thresholds or "never change data" rules, or asks for evaluation scenarios. Unofficial community skill, not from SAP.
---

# Rule boundary tests for extensions and agents

Joule Studio's built-in evaluations run on agents, not on agent extensions. This skill fills that gap:
it turns every limit in the instructions ("more than 50 users", "at least 14 days", "above 250 USD")
into tests just below, exactly at and just above the limit, and every read-only rule into refusal tests,
then runs and scores them.

The helper is `rule-tester.mjs` in this skill's folder (Node.js 18+, no dependencies). Below, `$RT`
means `node <this skill folder>/rule-tester.mjs`, e.g. `node .claude/skills/rule-boundaries/rule-tester.mjs`.

## 1. Find the instructions

Ask which extension or agent to test if it is not obvious.
- Extension: `assets/<extension>/extension.yaml` (the `instruction:` blocks).
- Agent: the system prompt in `assets/<agent>/app/agent.py`, and `assets/<agent>/app/skills/**/SKILL.md`.
If rules live in Python strings, copy that text into a temporary `.md` file first.

## 2. Extract and review

Run `$RT extract <files...> -o rule-tests/rules.json`, then edit `rule-tests/rules.json` yourself:
- Delete entries that are not real business limits (examples, IDs, unrelated numbers).
- Rewrite each `subject` so "if <subject> is <value>" reads naturally ("the number of users affected").
- Check each `comparator` against the wording: "more than"/"above" `>`, "at least"/"or more" `>=`,
  "fewer than"/"below" `<`, "at most"/"or less" `<=`.
- Set `applies_when_met` to false only when meeting the condition means the rule does *not* apply.
- Put the exact output text in `label` where the agent should classify something.
- Check `read_only.forbidden_actions` (short requests like "close this ticket") and set `settings.persona`.
Show the user a short table of the kept rules and get confirmation before generating.

## 3. Generate

- Agent: `$RT generate rule-tests/rules.json -o assets/<agent>/aevals/testcases` (run them in Joule Studio:
  Manage → Monitoring & Analytics → agent → Evaluations).
- Extension: `$RT generate rule-tests/rules.json -o rule-tests/testcases`.
This also writes `rule-tests/test-data.md` (records needed by `live_*` tests) and a sign-off pack:
`signoff.md` (printable test sheet with a sign-off table) and `signoff.csv`.

## 4. Run against the deployed agent (sandbox/development only)

Pick the first option that works and ask the user if unsure:
1. **jl CLI** (agent is an asset in this solution): `$RT run rule-tests/rules.json --args "--solution <id> --asset <agent>"`
2. **A2A endpoint** (the extended agent's A2A URL is known): set `A2A_TOKEN`, then
   `$RT run rule-tests/rules.json --via a2a --url <endpoint>`
3. **Another tool**: `$RT run rule-tests/rules.json --via cmd --cmd "tool --text {message}"`
4. **Joule conversation only** (common for extensions of SAP standard agents): give the user
   `rule-tests/signoff.md` to work through in Joule and record results in `signoff.csv`.
Add `--live` to include `live_*` tests once the test data exists. Never run against production.

## 5. Judge and score

`run` writes `rule-tests/results.json` and `results.md` with an automatic pre-check per test.
Read every reply yourself. Set `"verdict": "pass"` or `"fail"` in results.json for each test (always for
`unclear`, and wherever you disagree with the pre-check), with a one-line reason in `"note"`. Then run
`$RT score rule-tests/results.json --junit rule-tests/junit.xml` (or `score rule-tests/signoff.csv`).
Report failures to the user grouped by rule, with the exact message and reply.

## Rules for you

- Don't change the agent or extension while testing. Report failures; fix only if asked.
- Keep generated values exactly as computed; the point is the exact boundary.
- Never put real customer data into test messages.
