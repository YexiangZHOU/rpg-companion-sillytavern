# Framework protocol boundaries and scene review

Version 3.7.9 addresses a response boundary that could silently skip a valid transaction: the model closed a legacy status code fence and put the opening framework tag on the same line.

The parser and rejected-block presentation now share an offset-preserving context scanner. It tracks the opening fence's delimiter and length. A matching closing fence immediately followed by an explicit framework tag is recognized as a transaction boundary. This compatibility rule does not repair JSON, accept bare objects, or execute actual quoted, inline, fenced or unfinished-code examples. Existing transaction validation, locks, revision checks and verified-save requirements still apply. Malformed transactions at that boundary remain rejected and available through the existing raw-data disclosure.

When all framework tags occur in excluded examples or code, diagnostics report `ignored_protocol` / `quoted_or_fenced` instead of an ordinary no-update result. The reply and game state are preserved. Live observations remain ephemeral, while replay is explicitly labeled as current-parser review rather than a historical execution log.

Instructions now provide complete tagged examples with standalone tag lines. The transition example updates the existing scene, archives an explicitly departed character, and adds the arriving interaction partner. No fixed RPG categories or numerical defaults are introduced. Multiple active scenes remain legal for games that need them; a visible review hint and diagnostic warning flag their ambiguity instead of inferring departure or automatically archiving an entity. This is not an automatic narrative-completeness validator.

Historical replies are never reapplied merely because the parser was updated. Repairing a saved chat requires a separate deliberate action. The private failed response was replayed locally without changing its text to verify this boundary; it is not included in the repository.

Validation covers matching and mismatched delimiters, fence lengths, CRLF, quoted and inline examples, malformed JSON, multiple transactions, source offsets, saved/reloaded state, isolated diagnostic observations, and nonmutating scene warnings. Production acceptance and browser download completion must be reported separately from local tests.
