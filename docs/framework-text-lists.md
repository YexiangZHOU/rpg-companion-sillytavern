# Repeated labels in text lists

The `tags` field type accepts an ordered list of strings. Labels are values,
not identifiers. Repeated labels are preserved, including a ship equipped with
two identical weapons. The validator must not silently deduplicate such a list
or reject an otherwise valid initialization because of repeated text.

Entity, group, field and collection entry identifiers remain unique. Choice
options also remain unique. Type, length, revision, transaction, ownership and
lock checks are unchanged. Use a `collection` with stable entry IDs and quantity
columns when individual items need independent updates or richer data.

An initialization rejected by an earlier version remains uncommitted after an
upgrade. Historical replies are not automatically replayed. Any explicit
recovery must validate against the current branch, preserve the original reply,
protect concurrent edits and verify the resulting saved snapshot.
