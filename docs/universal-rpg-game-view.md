# Universal RPG game view

The universal framework lets the model define entities, groups, fields, and initial values for each chat. It does not require a D&D template or predefined character attributes.

The game view separates that schema from its presentation:

- The left drawer shows scene information and individual NPC cards together. Public descriptions appear before appearance, and NPC state stays in a collapsed Status section.
- The right drawer shows the player, with additional objects such as vehicles in separate collapsible sections. A game without a `player` entity still shows its first custom entity directly.
- Groups retain their model-defined names. Summary fields appear once in the main view; remaining groups can be expanded individually.
- The framework selector lives in More. Each entity has an Edit toggle for group renaming, definition settings, and structure/value locks. Values can still be edited directly.
- Portrait controls target the entity whose card contains them. Generating an image uses the existing native image integration and its configured permissions and mode.

Cards use natural content height and the host's theme colors and font. The existing drawer behavior, adaptive widths, and centered chat remain responsible for the outer layout. Switching back to legacy mode restores the original containers and dice widget.

An invalid framework transaction is never repaired or applied silently. Its narrative remains visible while a collapsed notice explains that the update was not committed. The raw data is available as literal text for inspection, including after reopening an older chat. This display transformation does not rewrite messages, swipes, or game snapshots. It does not guarantee that a model will produce valid JSON.

Local checks cover the data kernel and chat lifecycle, malformed protocol presentation, theme switching, simultaneous scene/NPC rendering, legacy restoration, drawer centering, manual save acknowledgement, and portrait binding. A synthetic preview does not replace production verification or provider testing.
