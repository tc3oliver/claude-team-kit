# Self-review checklist (low risk)

Answer each from the code, not from memory of writing it.

1. Does every changed line trace to the ticket or spec? Remove anything extra.
2. Do inputs at the edges (empty, null, huge, wrong type) behave sensibly?
3. Is every error path handled or deliberately propagated?
4. Is there a new abstraction with only one caller? Inline it.
5. Do tests assert behavior, and did you see them fail before the fix or pass after it?
6. Any leftover debug output, commented-out code, TODO, `skip` or `.only`?
7. Do names, imports and error handling match the neighbouring code?
8. Does anything callers rely on change (signatures, return shapes, file formats)? If yes, reclassify as high risk.

Report the result per item only when it fails.
