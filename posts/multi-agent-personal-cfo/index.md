<!--
title: Building a Multi-Agent Personal CFO with Gemma
date: 2026-08-10
description: A local-first financial advisor where the LLM reasons but never does the math — deterministic Python does.
-->

# Building a Multi-Agent Personal CFO with Gemma

Most "AI financial advisor" demos ask a language model to add up your bills.
That's the one thing an LLM is *worst* at. So I built the opposite: a system
where **Gemma reasons and routes, but every number comes from deterministic
Python**. No hallucinated interest rates, no invented account balances.

## The core idea

The model never touches arithmetic. It does three things well:

- **Route** a question to the right specialist ("can I afford this?" vs. "is this a scam?")
- **Explain** results in plain language
- **Reflect** — an optional Judge pass that checks its own output against rules

Everything financial — affordability, loan amortization, emergency-fund runway,
fraud heuristics — is plain Python that returns *structured* results. The LLM
gets facts, not a calculator.

## Architecture

A thin FastAPI layer wraps a singleton service. The service owns one model
backend (GPU, CPU, or a demo stub) and hands questions to an orchestrator that
coordinates the specialist agents.

```
  Web SPA
     │  HTTP
  FastAPI  ──►  Service (singleton model backend)
                   │
              Orchestrator ──► Router ──► specialist agents
                   │                         (affordability, loans,
                   ▼                          fraud, bills, budget…)
              Finance engine  ◄── deterministic math, no LLM
                   │
              Judge (rule-based reflection, optional)
```

Because the math is deterministic, the same question always gives the same
number regardless of which model — or no model — is loaded. The `dashboard_snapshot`
endpoint renders your whole financial picture *without any LLM call at all*.

## Why the split matters

Three properties fall out of "LLM reasons, Python computes":

1. **Trust.** Numbers are auditable Python, not model output. A CIBIL score is
   validated to 300–900 by a Pydantic schema before it's ever used.
2. **Cost.** The expensive part (math) is free. Only the cheap part (a sentence
   or two of explanation) hits the model, so the economics look like normal SaaS
   rather than a GPU furnace.
3. **Security.** The model's raw reasoning is scrubbed before anything reaches
   the frontend — you get the conclusion, not the chain of thought.

## Running it

It runs fully on CPU in demo mode — no GPU required to try it:

```
pip install -r requirements.txt
uvicorn src.api:app --reload
```

On Kaggle it launches the FastAPI SPA behind a cloudflared tunnel, so you get a
public URL straight from a notebook.

## What's next

The demo is GPU-bound single-user; the seams (swappable backend, deterministic
core) are deliberately placed so it can grow into a multi-user cloud product
with a hosted LLM API doing the reasoning. The math never has to change.

> The lesson: let the language model do language. Let arithmetic be arithmetic.
