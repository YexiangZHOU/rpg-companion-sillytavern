# Universal visual intent and coverage

Version 3.7.11 adds visual declarations without fixed game statistics or categories. It includes the bounded background correction introduced in 3.7.10.

Version 3.7.12 pins the effective framework mode when saving chat preferences and when starting a normal generation. Previously, a preference-only metadata object could cause the first valid reply to be treated as a legacy chat and skipped. Preference controls now share a save lock and show a saving status to prevent overlapping changes. Existing legacy chats keep their mode.

## Data contract

Entities, groups, fields and collection items may contain a `visual` object:

```json
{"mode":"portrait","subject":"object","description":"A silver frigate with two rear engines","visible":true}
```

`mode` is `portrait`, `icon` or `none`. `subject` is `person`, `creature`, `object`, `place` or `symbol`. `description` is confirmed visible appearance, at most 2,400 characters. Optional `pending` explains why appearance cannot yet be confirmed. Replace the complete visual object to clear a pending reason. `visible` controls inclusion of an entity in scene illustrations; players/NPCs default to visible, other assets require explicit `true`. It does not override archival.

Use `updateDefinition.patch.visual` for definitions, and `upsertItem.item.visual` with `id` and `values` for collection entries. Omitting visual on an item update preserves it. Set `mode:none` to remove an optional visual from presentation. The model cannot supply image URLs, HTML or provider settings.

Fields may declare `role:appearance/location/action/weather/time/private`. This is presentation metadata, not a game system. An explicit text appearance field takes precedence over entity visual description. Old English/Chinese appearance labels remain readable. Private fields are excluded from the visual bridge. The model must keep secrets out of public entity descriptions and visual declarations; the extension cannot semantically detect a secret placed in those public fields.

## Required records and missing information

Prompts require current scene details, player/important character appearances and portrait intent for persistent physical assets such as vessels. Runtime coverage checks cover player/NPC, common asset kinds and arbitrary entities declaring portrait intent. Arbitrary custom kinds are not universally identifiable as physical objects, so prompts remain responsible for declaring them correctly.

Coverage is separate from validation. A valid inventory update is saved even when appearance is missing. A compact list identifies outstanding scene/appearance/portrait-intent records and injects those requirements into the next ordinary turn. An explicit pending portrait reason defers confirmation visibly. The checks cannot prove that all narrative facts or scene transitions were recorded.

The **Complete missing records** control makes at most one quiet text request. It does not add a player message, change the composer or continue the story. It uses the current revision and preserves the original narrative. Existing rejected transactions must be corrected first. In initialized games this completion route permits new definitions, description/visual/role changes and appearance/scene text values; it rejects existing numeric resource or inventory operations. Accepted data is not rolled back merely because other coverage gaps remain. The diagnostic record retains the request outcome and original/corrected data locally in the chat.

## Image execution

The per-chat **Portraits and icons** control has manual, proposal, automatic and disabled modes. When unset it inherits the existing portrait preference, normally manual. This is separate from the dynamic scene-image mode and legacy avatar options. Switching the mode or reloading does not generate an image.

Manual/proposal show per-target Generate buttons. Automatic mode attempts at most two portrait/icon jobs after a newly accepted ordinary reply; entities take priority, remaining targets stay pending. A background data correction or completion does not start images. Failed or interrupted attempts require an explicit retry for the same visual intent. Changing appearance makes it eligible again. Scene images retain their separate existing budget and controls.

Jobs reuse the native image module. Patched OpenAI generation snapshots per-request settings and shares a ten-request pool across portraits, icons and scenes; other sources use serialized `/sd` or `/imagine` commands. Legacy avatar text-prompt generation remains serialized to protect temporary preset changes, while its image requests may overlap. See [refresh and concurrency](framework-refresh-and-concurrency.md). A person, object/vessel, creature and icon use different framing. Targets are stable entity/group/field IDs or collection ID plus item ID. The fingerprint uses mode, subject and visual description, so numeric/quantity changes alone do not regenerate pictures. For a weather/value variant, the model must update visual description; no extra variant schema is inferred.

Generated images, fixed failure codes and fingerprints live separately in message/swipe metadata. Existing entity images and locks remain readable. New images require the local native image URL form. Locks, target archival, chat/swipe/reply changes, new turns, appearance changes and cancellation prevent stale results from being attached. A failed refresh retains the old image with failure/staleness status. Stop discards a pending result and subsequent jobs; an already issued provider request can still incur a charge and leave a native image file. The extension does not delete native image files automatically.

Save failures stop the job and require reload/verification before retrying on that message. Historical messages, shared account settings and game values are not silently migrated on load. Item/field icons are compact and their full images open in a dialog. No online provider behavior is established by synthetic tests.

## Scene entity illustrations (3.7.14)

Generated images for `kind:scene` entities appear directly in their scene cards, with a responsive width and preserved proportions. The existing View, Refresh and Lock controls remain available. These place illustrations are separate from the dynamic scene image, which depicts the current action and uses its own metadata and mode. Rendering a stored image never issues a new drawing request.
