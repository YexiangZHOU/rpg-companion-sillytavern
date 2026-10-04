# Narrative coverage and reviewable updates

The framework remains model-defined. Its instructions ask for changes that matter to play: a specific current scene, recurring interaction partners, item names and quantities with ownership, and accepted objectives. No mandatory game categories or numeric defaults are introduced. Unknown values remain unknown. Executable, independent initialization and incremental examples explain the protocol without becoming game facts.

The game view uses explicit summary fields first. If none exist, it displays up to three existing compact numeric, resource, choice or boolean fields. This fallback does not modify field definitions or stored values. NPC state remains inside its status disclosure. The first group that actually has visible fields opens by default; explicit disclosure choices remain respected within the current chat. Switching chats resets disclosure memory. A scene without recorded detail displays an explicit hint. Save feedback describes the submitted transaction, not complete narrative coverage.

## Diagnostics

Open **More → Data update diagnostics**. Review is read-only, limited to the current chat's selected swipes and the most recent 100 assistant replies. Older snapshots are still considered when determining the baseline. The export contains message positions, outcome codes, revisions and observation timestamps where available. It excludes narrative text, raw prompts, API credentials and provider error bodies. Existing rejected reply data remains available through the message's raw-data disclosure.

- **Saved snapshot:** an existing snapshot is valid and matches the exact reply. This does not prove that every fact in the narrative was recorded.
- **Live observation:** the current page captured parsing, validation, concurrency or save/readback results. Observations are bound to the exact message text and swipe and disappear on page reload. Export them before reloading if needed.
- **Replay:** the current parser checks the saved reply against preceding valid snapshots without applying it. This is explicitly not a historical execution log. A reply that validates now but has no matching snapshot is reported as uncommitted, not silently accepted. Older parser versions may have rejected it differently.

JSON/protocol errors are separated from schema, type, lock and revision validation. Missing protocol is not automatically an error: the turn may have no state changes. A failed save/readback means the server outcome is unknown, since SillyTavern may already have written the file. Review does not retry model requests or writes. Native provider/tool-call transport errors outside the framework are not captured by this diagnostic view.

This is not a durable server audit service. No additional chat metadata, browser storage, network calls or background log writes are introduced. Successful state snapshots and rejected raw replies use the existing chat persistence path. A new persistent audit store would require a separate retention, privacy and failure-handling design.

## Verification boundaries

Tests execute both prompt examples and cover incremental cargo/objective updates, parse/validation distinctions, immutable replay, save failure, corrupt snapshots, history limits and edit/swipe/chat isolation. Browser checks use synthetic data and host adapters. Actual model coverage remains probabilistic and requires a fresh deployment acceptance test; this change does not automatically repair existing missing facts or loosen transaction validation.
