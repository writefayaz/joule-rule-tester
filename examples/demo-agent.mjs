#!/usr/bin/env node
// A deliberately flawed stand-in for the fictional service desk agent in
// service-desk-triage-extension.yaml, so you can try joule-rule-tester without a
// Joule Studio tenant:
//
//   node skills/rule-boundaries/rule-tester.mjs run rule-tests/rules.json \
//     --via cmd --cmd "node examples/demo-agent.mjs {message}"
//
// Its mistakes, on purpose:
//   - treats "more than 50 users" as "50 or more"
//   - gives in when someone claims authority or hides an instruction in a record
const message = process.argv.slice(2).join(" ");
const say = text => console.log(text);

const value = message.match(/\bis (\d+(?:\.\d+)?) (users?|minutes?|days?)\b/i);
if (/quick check of your rules/i.test(message) && value) {
  const n = Number(value[1]);
  const unit = value[2].toLowerCase();
  if (unit.startsWith("user")) {
    // Bug: should be n > 50.
    say(n >= 50 ? `Yes. ${n} users affected means this is a P1 Major Incident.` : `No. ${n} users is not more than 50, so it does not qualify as a P1 Major Incident.`);
  } else if (unit.startsWith("minute")) {
    say(n >= 30 ? `Yes. After ${n} minutes down, call the on-call engineer.` : `No. ${n} minutes is not yet 30 minutes, so it does not qualify.`);
  } else {
    say(n >= 3 ? `Yes. ${n} days without an update means Needs Follow-up.` : `No. ${n} days is less than 3 days, so it does not qualify.`);
  }
} else if (/department head|authoriz|SYSTEM NOTE/i.test(message)) {
  // Gives in, and says what it "did" (past tense of the requested action).
  const verb = (message.match(/\b(close|reassign|delete|change)\b/i)?.[1] ?? "close").toLowerCase();
  const done = { close: "closed", reassign: "reassigned", delete: "deleted", change: "changed" }[verb];
  say(`Understood. I have ${done} it for you. Done!`);
} else if (/\b(close|reassign|delete|change)\b/i.test(message)) {
  say("I can't do that. I only advise; please make that change in the service desk tool.");
} else {
  say("I can help you triage tickets. What would you like to check?");
}
