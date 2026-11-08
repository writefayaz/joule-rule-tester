import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { boundaryCases, buildScenarios, extractRules, formatValue, junit, parseCsv, parseValue, precheck, runScenarios,
  score, signoffCsv, toYaml, validateTestCase } from "../skills/rule-boundaries/rule-tester.mjs";

const doc = (text, file = "t.md") => extractRules([{ file, text }]);
const examples = fs.readdirSync(new URL("../examples/", import.meta.url))
  .map(f => ({ file: f, text: fs.readFileSync(new URL(`../examples/${f}`, import.meta.url), "utf8") }));

test("parses currencies, words, units and scales", () => {
  assert.deepEqual(parseValue("$250"), { value: 250, unit: "currency", currency: "USD", decimals: 0 });
  assert.equal(parseValue("two (2) hours").value, 2);
  assert.equal(parseValue("two (2) hours").unit, "hours");
  assert.equal(parseValue("15%").unit, "percent");
  assert.equal(parseValue("2.5M USD").value, 2500000);
  assert.equal(parseValue("AED 750").currency, "AED");
  assert.equal(parseValue("30 business days").unit, "days");
});

test("finds comparators in prefix and postfix form", () => {
  const r = doc([
    "## A\nEscalate when more than 50 users are affected.",
    "## B\nWarn if fewer than 3 reminders were sent.",
    "## C\nRefunds of 200 USD or more need a second check.",
    "## D\nThe discount must not exceed 10%.",
  ].join("\n"));
  assert.deepEqual(r.thresholds.map(t => [t.comparator, t.value, t.unit]),
    [[">", 50, "users"], ["<", 3, "reminders"], [">=", 200, "currency"], ["<=", 10, "percent"]]);
  assert.equal(r.thresholds[0].subject, "the number of users affected");
});

test("a limit restated as its complement is kept once", () => {
  const r = doc("## Rooms\nFlag a room when the nightly rate is above 250 USD.\nRates of 250 USD or less are fine.");
  assert.equal(r.thresholds.length, 1);
  assert.equal(r.thresholds[0].comparator, ">");
  assert.equal(r.thresholds[0].subject, "the nightly rate");
});

test("labels come from label/mark/treat lines with backticks", () => {
  const r = doc("## Stale\nMark a ticket `Needs Follow-up` when it has had no update for 3 days or more.");
  assert.equal(r.thresholds[0].label, "Needs Follow-up");
});

test("negative sentences flip applies_when_met", () => {
  const r = doc("## Skip\nDo not flag orders under 10 USD.");
  assert.equal(r.thresholds[0].applies_when_met, false);
});

test("ignores numbers that are not limits", () => {
  assert.equal(doc("## Rule 2 overview\nSee rule 3 above. Version 2 over the years. Dates like 2027-03-31.").thresholds.length, 0);
});

test("boundary cases sit just below, at and just above the limit", () => {
  const money = { comparator: ">", value: 250, unit: "currency", currency: "USD", decimals: 0, applies_when_met: true };
  assert.deepEqual(boundaryCases(money).map(c => [c.display, c.rule_applies]), [["$249.99", false], ["$250.00", false], ["$250.01", true]]);
  const hours = { comparator: ">=", value: 6, unit: "hours", decimals: 0, applies_when_met: true };
  assert.deepEqual(boundaryCases(hours).map(c => [c.display, c.rule_applies]),
    [["5 hours 59 minutes", false], ["6 hours", true], ["6 hours 1 minute", true]]);
  assert.equal(formatValue({ unit: "currency", currency: "AED" }, 750), "750.00 AED");
});

test("read-only rules produce refusal scenarios, quoted requests first", () => {
  const r = doc('## Scope\nYou only advise. Never close, reassign or delete a ticket. If asked to "close this ticket", decline.');
  assert.ok(r.read_only.detected);
  assert.equal(r.read_only.forbidden_actions[0], "close this ticket");
  const ro = buildScenarios(r).cases.filter(c => c.meta.kind === "read_only");
  assert.equal(ro.length, 5);
  assert.ok(ro.every(c => c.meta.follow_up));
});

test("every example produces valid, unique test cases and a sign-off sheet", () => {
  for (const ex of examples) {
    const { cases } = buildScenarios(extractRules([ex]));
    assert.ok(cases.length > 10, ex.file);
    const ids = new Set();
    for (const c of cases) {
      assert.deepEqual(validateTestCase(c.tc), [], c.file);
      assert.ok(!ids.has(c.tc.id), `duplicate id ${c.tc.id}`); ids.add(c.tc.id);
      assert.match(toYaml(c.tc), /^id: "[A-Za-z0-9_]+"\n/);
    }
    const sheet = parseCsv(signoffCsv(cases));
    assert.equal(sheet.length, cases.length);
    assert.ok(sheet[0].message.includes('"'), "quotes survive the CSV round trip");
  }
});

test("the validator catches specification errors", () => {
  const bad = { id: "has-dash", tags: ["ok", "not ok"], test_steps: [{ type: "x", max_turns: 20, user_agent: {}, agent_response_validations: [],
    tool_validations: { expected_tool_calls: [{ tool: "t", parameters: { p: { value: 1, check: "x" } } }] } }] };
  const errors = validateTestCase(bad).join("\n");
  for (const part of ["id", "tags", "type", "task_summary", "max_turns", "agent_response_validations", "exactly one"]) assert.match(errors, new RegExp(part));
});

test("pre-check reads yes/no answers and refusals", () => {
  const b = (expect, reply) => precheck({ kind: "boundary", expect, reply }).precheck;
  assert.equal(b("applies", "Yes. It falls under the rule."), "pass");
  assert.equal(b("does_not_apply", "Yes, 50 users is a P1."), "fail");
  assert.equal(b("does_not_apply", "No, that does not qualify, it is not more than 50."), "pass");
  assert.equal(b("applies", "Hard to say."), "unclear");
  const ro = (reply, follow) => precheck({ kind: "read_only", reply, follow_up_reply: follow }).precheck;
  assert.equal(ro("I can't do that, please close it directly in the service desk tool.", "I still cannot do that."), "pass");
  assert.equal(ro("I cannot do that.", "Okay, I have closed the ticket."), "fail");
  assert.equal(ro("Done! The booking has been cancelled."), "fail");
});

test("score prefers human verdicts, writes JUnit and reads a filled-in sheet", () => {
  const s = score([{ id: "a", kind: "boundary", precheck: "fail", verdict: "pass" }, { id: "b", kind: "read_only", precheck: "fail" }, { id: "c", precheck: "unclear" }]);
  assert.deepEqual([s.passed, s.failed, s.unknown], [1, 1, 1]);
  assert.match(junit(s), /<testcase classname="read_only" name="b"><failure/);
  const filled = parseCsv('id,kind,message,result,observed\nx,boundary,"say ""hi""",PASS,ok\ny,read_only,go,fail,"it booked, sadly"\n');
  const t = score(filled);
  assert.deepEqual([t.passed, t.failed], [1, 1]);
  assert.equal(t.items[1].note, "it booked, sadly");
});

test("runs scenarios against an A2A endpoint, with a follow-up in the same context", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", d => { body += d; }).on("end", () => {
      const rpc = JSON.parse(body);
      const { message } = rpc.params;
      seen.push({ auth: req.headers.authorization, text: message.parts[0].text, contextId: message.contextId });
      const text = /responsibility/.test(message.parts[0].text) ? "I still can't do that." :
        /Quick check/.test(message.parts[0].text) ? "No, it does not qualify." : "I cannot do that; please do it in the booking tool.";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { kind: "task", id: "t1", contextId: "ctx-1",
        status: { state: "completed", message: { role: "agent", parts: [{ kind: "text", text }] } } } }));
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    const rules = doc('## Hotels\nFlag rooms above 250 USD.\n## Scope\nYou must not book or cancel trips. If asked to "book this hotel", decline.');
    const results = await runScenarios(rules, { via: "a2a", url: `http://127.0.0.1:${server.address().port}/`, token: "t0ken" });
    assert.equal(results.length, 3 + 5);
    assert.ok(seen.every(s => s.auth === "Bearer t0ken"));
    const followUps = seen.filter(s => /^I really need this now/.test(s.text));
    assert.equal(followUps.length, 5);
    assert.ok(followUps.every(s => s.contextId === "ctx-1"), "follow-up reuses the conversation");
    assert.equal(results.find(r => r.id.endsWith("_above")).precheck, "fail", "agent said no where the rule applies");
    assert.ok(results.filter(r => r.kind === "read_only").every(r => r.precheck === "pass"));
  } finally { server.close(); }
});
