<!--
title: Never Trust an LLM's JSON — Building a Runtime Trust Layer
date: 2026-08-10
description: How MeritMind turns a 70B model's free-form output into a verdict safe enough to render — validation, normalization, and the failures that shaped it.
-->

# Never Trust an LLM's JSON

MeritMind reads a messy student profile and an equally messy opportunity description and returns a **structured eligibility verdict** — an `eligible / maybe / not_eligible` badge, a 0–100 score, a per-criterion breakdown, and next steps. The whole product hinges on one uncomfortable fact:

> The model is the engine, but the model is also the least trustworthy component in the system.

A `llama-3.3-70b-versatile` call in JSON mode returns *well-formed* JSON almost every time. "Almost" is the problem. This post is about the layer that stands between that JSON and the UI — why it exists, exactly what it checks, and the concrete ways the model tried to break it.

---

## The shape we render

Everything downstream renders a `Verdict`. Nothing else is allowed to reach the UI:

```ts
type CriterionStatus = "pass" | "partial" | "fail" | "unknown";

interface Verdict {
  verdict: "eligible" | "maybe" | "not_eligible";
  matchScore: number;         // 0–100, integer
  summary: string;            // non-empty
  criteria: {
    criterion: string;
    status: CriterionStatus;
    reason: string;
  }[];
  recommendations: string[];
}
```

If the scorecard renders a score of `142`, or a badge from a `verdict` string the model invented, the product has lied to a student about whether they qualify for a scholarship. That's the failure mode we're designing against.

## Why JSON mode isn't enough

`response_format: json_object` at `temperature: 0.2` buys you two things: valid JSON syntax, and mostly-consistent output. It buys you **nothing** about:

- **Value domains** — `verdict: "eligible?"`, `verdict: "likely"`, `status: "yes"` are all syntactically valid JSON strings the model has handed back.
- **Ranges** — `matchScore: 105`, `matchScore: "80"`, `matchScore: null`.
- **Shape** — `criteria` as an object instead of an array; a criterion missing its `status`.
- **Emptiness** — a `summary` of `""`, which passes a `typeof === "string"` check and renders as a blank card.

JSON mode guarantees the *grammar*. It says nothing about the *contract*. So the contract gets enforced in code.

---

## The trust layer

Two pure functions, no SDK, no network — which is the whole point: they're unit-testable without a key.

```ts
export function parseVerdict(text: string): Verdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Model did not return valid JSON");
  }
  return validateVerdict(parsed);
}
```

`parseVerdict` owns the one thing JSON mode can still get wrong — occasionally the model wraps its object in prose or a ```` ```json ```` fence and the parse throws. We catch it and fail loudly rather than shipping `undefined` into the renderer.

The real work is `validateVerdict`, and every line of it is a scar from something the model actually did:

```ts
export function validateVerdict(raw: unknown): Verdict {
  if (!raw || typeof raw !== "object") throw new Error("Verdict is not an object");
  const r = raw as Record<string, unknown>;

  if (!VERDICT_VALUES.includes(r.verdict as (typeof VERDICT_VALUES)[number])) {
    throw new Error(`Invalid verdict value: ${String(r.verdict)}`);
  }
  if (typeof r.summary !== "string" || r.summary.trim() === "") {
    throw new Error("Verdict summary missing");
  }
  if (!Array.isArray(r.criteria)) throw new Error("Verdict criteria must be an array");

  const criteria = r.criteria.map((c, i) => {
    const o = c as Record<string, unknown>;
    if (typeof o?.criterion !== "string") throw new Error(`criteria[${i}].criterion missing`);
    if (!STATUS_VALUES.includes(o?.status as CriterionStatus)) {
      throw new Error(`criteria[${i}].status invalid: ${String(o?.status)}`);
    }
    return {
      criterion: o.criterion as string,
      status: o.status as CriterionStatus,
      reason: typeof o.reason === "string" ? o.reason : "",
    };
  });

  const recommendations = Array.isArray(r.recommendations)
    ? r.recommendations.filter((x): x is string => typeof x === "string")
    : [];

  return {
    verdict: r.verdict as Verdict["verdict"],
    matchScore: clampScore(r.matchScore),
    summary: r.summary,
    criteria,
    recommendations,
  };
}
```

There's a deliberate split in how it treats bad data, and it's the most important design decision in the file.

### Reject vs. repair

Some fields **throw**. Some fields get **quietly repaired**. The rule:

- **Throw when a wrong value would change the answer.** `verdict`, each criterion's `status`, the presence of a `summary` and `criterion` — if these are malformed, there is no honest way to guess what the model *meant*. A `status: "yes"` might be a pass or a partial; rendering either is a fabrication. So we refuse.
- **Repair when the field is decorative or clampable.** A missing `reason` becomes `""`. Non-string entries in `recommendations` are filtered out instead of aborting the whole verdict. A junk `matchScore` is coerced and clamped rather than thrown away.

That last one deserves its own function:

```ts
function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}
```

It handles the actual observed failures in order: `"80"` (string number) → coerced, `NaN`/`null`/`undefined` → `0`, `105` → `100`, `87.6` → `88`. The score is a *summary* of the criteria, not the source of truth — the per-criterion `status` values are — so a mildly-wrong score is a cosmetic bug, not a correctness one. Clamp it and move on.

The contrast is the whole philosophy: **guard hard on the fields that carry the verdict, be forgiving on the fields that merely dress it.**

---

## Push the honesty upstream, too

Runtime validation catches *malformed* output. It can't catch *confidently wrong* output — a model that guesses "eligible" when the profile never mentioned income. That failure is addressed one layer up, in the system prompt:

```ts
export const SYSTEM_INSTRUCTION =
  "You are an eligibility analyst for student opportunities... " +
  "If a required detail is missing from the profile, mark that criterion 'unknown' " +
  "and ask for it in recommendations rather than guessing. " +
  "Verdict 'eligible' only when no hard requirement fails; " +
  "'maybe' when something is unknown or partial; " +
  "'not_eligible' when a hard requirement clearly fails.";
```

`unknown` is a first-class `CriterionStatus` precisely so the model has an honest place to put "I don't know." Without it, every missing detail becomes a coin-flip between pass and fail. With it, uncertainty renders as a grey criterion and a "please provide X" recommendation — which is the correct answer for a mentor to give.

Defense in depth: **the prompt makes honesty easy, the validator makes dishonesty structurally impossible to render.**

---

## What made this testable

`verdict.ts` imports nothing but its own types. No `groq-sdk`, no `fetch`. That's not an accident — it's what lets the entire trust layer be tested without a key or a network call:

```ts
it("clamps an out-of-range score", () => {
  const v = validateVerdict({ verdict: "maybe", summary: "ok", criteria: [], matchScore: 105 });
  expect(v.matchScore).toBe(100);
});

it("throws on an invalid verdict value", () => {
  expect(() => validateVerdict({ verdict: "likely", summary: "x", criteria: [] }))
    .toThrow(/Invalid verdict value/);
});
```

The SDK call lives in a separate `gemini.ts` that does exactly one impure thing — talk to Groq — and hands the raw text straight to `parseVerdict`. Impurity is isolated to the smallest possible surface; everything worth testing is pure.

---

## The takeaway

When an LLM's output drives a decision a user acts on, its JSON is **untrusted input** — treat it exactly like a form submission from a stranger, because that's what it is. Concretely:

1. **Define the rendered type first.** Nothing reaches the UI that isn't that type.
2. **Validate value domains, not just JSON syntax.** JSON mode gives you grammar; you owe the contract.
3. **Reject what you can't safely guess; repair what's merely cosmetic.** Know which fields carry the answer.
4. **Keep the validator pure.** No SDK, no network — so it's trivially testable.
5. **Use the prompt for honesty, the validator for safety.** They catch different failures; you want both.

Remove the model and there's no product. But ship the model's raw output and there's no *trust* — and for a tool that tells a student whether they qualify, trust is the product.
