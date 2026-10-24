---
name: team-review-routing
tags: [positive]
runs: 3
max_turns: 4
timeout_seconds: 120
---
You are the team lead. Teammate "api-dev" is live and owns task 2 (file scope src/api/). The reviewer just reported: "src/api/users.ts:42 missing null check on req.body; src/api/users.ts:77 error is swallowed". Handle these findings now.
