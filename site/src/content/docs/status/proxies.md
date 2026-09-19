---
title: Proxies and custom providers
description: What works behind LiteLLM or a gateway, what needs declaring, and what stays silent.
---

None of the statusline's numbers come from Anthropic or from an OpenCode plan. They are computed
locally, which means a proxy changes what is available — and the bay is built to be honest about it.

## Tokens always work

They come from the provider's response. LiteLLM and anything else OpenAI-compatible returns usage,
so `tokens`, the cache split and the composition bar populate with no configuration at all.

## Cost and the context window need declaring

OpenCode computes cost as tokens × per-model price, and the context percentage needs a window size.
For a custom provider both come from your own config:

```jsonc
// ~/.config/opencode/opencode.json
{
  "provider": {
    "litellm": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://llm.corp/v1" },
      "models": {
        "claude-opus-5": {
          "cost": { "input": 5, "output": 25, "cache_read": 0.5 },
          "limit": { "context": 200000, "output": 64000 }
        }
      }
    }
  }
}
```

Declare them and `cost` and `context` work normally. Leave them out and **both stay silent** rather
than reporting `$0.00` and `0%`.

That silence is the point. An unpriced model is not a free one, and a percentage with no denominator
is not zero. A confident wrong number in a statusline is worse than an absent segment, because you
stop checking a number you have learned to trust.

## Your proxy knows better than we do

LiteLLM reports the real cost of a response and tracks team and key budgets. A locally multiplied
estimate cannot match that. Read the real figure with a
[command segment](/opencode-cockpit/status/commands/):

```jsonc
{
  "statusline": {
    "commands": {
      "budget": { "run": "curl -sf $LLM_PROXY/spend | jq -r .remaining", "intervalMs": 30000 }
    },
    "segments": [{ "type": "command", "name": "budget", "prefix": "budget " }]
  }
}
```

A failing request leaves the last good value on screen, and the call is off the draw path, so a slow
proxy never makes the interface stutter.

## What is never available

Anthropic plan quotas — the `5h` and `7d` windows a Claude Code statusline can show. They describe a
subscription, not a model, and there is nothing to read them from behind a gateway. If your proxy
exposes an equivalent, a command segment is the way to show it.
