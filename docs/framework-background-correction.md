# Background correction of rejected framework updates

Version 3.7.10 adds a bounded correction path for malformed JSON and invalid framework operations. It uses SillyTavern's configured main connection through a quiet raw request. The extension supplies a system correction instruction and actual recent conversation messages with their original roles. It never appends a fabricated player message or changes the composer draft.

## Behavior

- The story remains the original assistant narrative. Correction output must contain exactly one valid framework transaction without new prose, image requests, dice requests or other executable tags.
- Current types, locks and revision still apply. All operations commit together, after validation and verified save/readback. Correction cannot silently skip a failed operation.
- The default is at most two extra text requests per failed reply. The current chat's **More → Background correction** setting offers off, one or two. The request budget is persisted before calling the model; reload and duplicate receive events cannot silently start a new automatic budget.
- The panel shows progress and the outcome. Stop prevents further attempts and discards an in-flight result; it does not guarantee that a provider has stopped processing or billing an already sent request. An explicit retry starts a fresh bounded budget.
- A historical rejected latest reply can be retried explicitly from **Data update diagnostics**. Opening an old chat does not repair it automatically.
- Changing the chat, selected swipe, original reply, state/locks, or starting another turn invalidates pending work. Repaired data attaches to the original assistant message and swipe, never a new chat bubble.
- Save/readback uncertainty stops correction. Reload to establish what was actually saved before retrying; network/authentication failures do not receive model-format retries.

## Equipment lifecycle

Instructions now distinguish removing a value, a collection entry, and an entire definition. `upsertItem` requires a collection and a non-null item object. Use `archiveItem` for a removed collection entry; use `archive` for a retired field/entity. A text equipment slot may instead remain with an explicit empty value. Independent possessions should normally use stable collection item IDs. Partial consumption updates quantity; return/recovery restores the existing ID. Categories and game rules remain model-defined.

## Diagnostics and limits

Type errors expose a bounded operation index and field ID/type. Per-swipe correction records preserve the original rejected reply and up to two bounded attempt outputs locally, with provenance distinct from a saved original transaction. The diagnostic summary export contains statuses and fixed validation metadata, not private raw replies, provider errors or credentials. The expanded local review includes private game data.

The extension can reject invalid operations, but a syntactically valid correction is not proof of narrative fidelity. Inspect the corrected values when the game outcome matters. Missing protocol alone does not trigger another paid request. This release does not implement the separate scene/appearance completeness or generalized media design.

Tests use fake providers to count requests and cover correction, locks, cancellation, concurrent changes, branch identity, uncertain persistence and collection lifecycle. Local runtime previews use synthetic data and mocked network/storage; live provider compatibility still requires deployment acceptance.
# Follow-up

Version 3.7.11 adds the visual declarations and explicit coverage-completion route described in [framework-media.md](framework-media.md). The original correction behavior below remains limited to rejected transactions; missing coverage is not an automatic retry loop.
