# Background correction of rejected or omitted framework updates

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

The extension can reject invalid operations, but a syntactically valid correction is not proof of narrative fidelity. Inspect the corrected values when the game outcome matters. Versions 3.7.10–3.7.12 did not correct completely omitted transactions; 3.7.13 adds the receipt contract below.

Tests use fake providers to count requests and cover correction, locks, cancellation, concurrent changes, branch identity, uncertain persistence and collection lifecycle. Local runtime previews use synthetic data and mocked network/storage; live provider compatibility still requires deployment acceptance.
# Follow-up

Version 3.7.11 adds the visual declarations and explicit coverage-completion route described in [framework-media.md](framework-media.md). Missing semantic coverage in an otherwise accepted transaction is not an automatic retry loop.

## Receipts for every normal reply (3.7.13)

Normal game replies must include one framework transaction. Once initialized, a genuinely unchanged turn uses a unique transaction ID, the current base revision and `ops:[]`. This receipt advances the saved revision and replay history without altering entities, values or locks. Empty initialization is still rejected.

Completely absent protocol now produces the distinct `missing_protocol` diagnostic and uses the same configured zero/one/two-call correction budget. A quiet system request compares the original narrative with saved state, including newly interacting NPCs and their already described appearance. It may return real updates or a no-change receipt; it must not invent activity to fill an empty transaction. Narrative, history roles and the composer remain untouched. Quoted or fenced examples are not automatically executed or treated as omission retries. Quiet, suppressed and restored historical replies do not start automatic requests.

With automatic correction disabled, the missing receipt remains visible in diagnostics and the latest reply can be checked explicitly. The request audit records `missing_protocol`, the original reply and correction outcome. This catches absent data, not an incorrectly asserted no-change receipt or every fact omitted from a valid transaction; those remain semantic limits.

## Public scene and cast review (3.7.14)

A valid no-change receipt can still omit a concrete nearby character. By default, accepted `ops:[]` receipts receive one quiet scene/cast review when background correction is enabled. **More → Scene and character review** offers no-change receipts, every accepted reply, or off. The existing correction switch also disables automatic review. Review uses at most one additional text call, persists its budget before requesting, and cannot loop on malformed review output. Format correction and review do not start independent automatic budgets on the same reply.

The reviewer compares the original narrative with the already committed state and actual recent conversation. Individually described nearby characters can be recorded before a formal conversation or a known name; unknown names stay neutral. Generic crowds remain scene descriptions. An explicit **Review this scene and cast** action can also check an accepted latest reply, including historical replies. Opening a chat never starts a review.

Review operations are restricted to NPC/scene definitions, their public text fields, and explicitly departed NPCs/scenes. Existing money, inventory, attributes and player-owned assets cannot be mutated or replayed. Locks, branch anchors and verified persistence still apply. A reviewer returning `ops:[]` creates a `checked` audit record without an extra game revision; additions create a `corrected` record with purpose `review`. The original story, message roles, draft and stored images remain intact. Review does not automatically generate images.

This is a bounded model-assisted reconciliation step, not proof of semantic completeness. The reviewer can still overlook a fact or propose an inaccurate public description. The local diagnostic record preserves the review output for inspection. Default no-change review does not cover every omission in a nonempty transaction; use every-reply review or an explicit review when needed.


## Player-requested panel checks

Each universal-framework entity, group, field and collection item has a **Check** button. **More → Check all panels** checks the entire game. A click makes at most one background text request using the current saved state and up to ten recent conversation messages. It does not append a player message, rewrite the narrative, advance the story or generate images. Appearance and image intent can be checked; actual image generation remains a separate action.

The extension owns the selected scope. Scoped results cannot modify other entities, groups, fields or collection items. Existing types and player locks still apply. Whole-panel checks may add missing records, correct absolute resource values or archive discarded items when supported by existing narration. The prompt explicitly checks for departed characters, previous scenes and consumed or discarded items. Confirmed absent elements may be archived out of the current display while retaining history; lack of mention alone does not establish departure. Reinitialization, lock changes, dice, encounters and tools are rejected. A no-change result records the check without increasing the game revision.

Checks are unavailable during generation, media work, pending saves or another check. Switching chats, editing state, changing swipes or adding a turn invalidates delayed output. Request status, selected scope, validation errors and raw transaction output are saved in the selected assistant swipe; the last five previous checks are retained for review. These are model-assisted consistency checks, not a guarantee of factual correctness. Uncertain facts must remain unchanged. The latest attempt is visible in data diagnostics.
