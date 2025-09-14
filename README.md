# Diff the Universe

Evaluate AI agents by testing them against fake versions of real services.

## Background

The idea came from the YC AI Agents Hackathon 2025 with my Wordware colleagues. We kept hitting rate limits and losing control of test state while building evaluation systems at Wordware. The hackathon prototype proved the concept - fake services you can fully control. Now building it properly from scratch.

## Problem

Can't properly test AI agents against real APIs:
- Rate limits stop your tests
- No control over data/state
- Can't reproduce bugs
- Tests pollute production data
- API calls cost money at scale

## Solution

Build fake versions of services (Slack, Gmail, etc) that:
- Run locally with no rate limits
- Give you complete control over state
- Let you plant specific test data
- Can snapshot/restore between tests
- Measure exactly what the agent did
