# Parallel fit

Read in Plan. Skill-guided: nothing enforces it. Advice only: warn in one or two lines, never refuse or block. An explicit request for a team
still gets a team after the warning.

Suggest a single session or a plain subagent instead of a team when:
- slices would edit the same files;
- slices depend on each other in sequence;
- the work is one tightly coupled bug;
- it fits in one session anyway.

Why: research on coordinated coding agents found coupled work gets worse with more agents, and messaging
does not fix it.

If slices overlap in files and the user still wants a team: warn, then order the overlapping slices with
`addBlockedBy` (or narrow their scopes) so they never run at once.

Size: start with 3 to 5 teammates and about 5 to 6 tasks each (Anthropic's agent-teams doc). Add more only
when slices are independent and the work waits on them.

Make no claim that a team is faster, better or cheaper.
