# Background refresh and concurrent images

Full-panel, scene/cast, entity, group, field and collection-item refresh actions open an optional reminder dialog. Canceling sends no request. Confirming uses one background text request and leaves the conversation, message roles and draft intact. The reminder is bounded to 2,000 characters and retained with the refresh receipt for review.

Scene/cast refresh intentionally excludes player attributes and assets. Use full-panel or player-entity refresh to add missing player fields. The background request includes the active character card's description, scenario and system prompt, together with accepted state and recent conversation. Missing rule-defined attributes can be created dynamically; values already stated in the story can be copied, and genuinely unknown values remain null. No rule system or fixed attribute list is installed by the extension.

The patched native OpenAI image module exports `generateQuietImage` and `supportsConcurrentImageGeneration`. Each request snapshots model, endpoint, dimensions and quality without mutating account settings. Portraits, icons and dynamic scenes share a pool of at most ten active image requests. Other providers and unpatched cores retain serialized native command generation.

Different framework targets may generate simultaneously; duplicate requests for the same target are blocked. Metadata commits are serialized, revalidated immediately before writing, and merged with the latest image entries. Failed persistence marks the message uncertain; stale results from navigation, swipes, changed appearances or cancellation cannot become successful panel images. Automatic portrait/icon generation retains its existing two-image budget per reply.

Scene descriptions are stored intact and displayed inside an expandable full-text disclosure instead of a truncated 110-character string.
