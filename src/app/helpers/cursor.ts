/**
 * The page cursor, set through one door so a write that changes nothing never
 * reaches the document.
 *
 * `cursor` is an inherited property, so assigning to `document.body.style`
 * invalidates style for every element on the page — the browser does that work
 * whether or not the value actually differs. Several scene components hold an
 * opinion about the cursor and re-assert it from their own `pointermove`
 * handlers: the three <PolygonSprite /> pieces of the face, <ThirdEye />, and
 * the hero's model. Measured over six seconds of pointer movement across the
 * About section, that came to 29 writes, none of which changed the value.
 *
 * The comparison is against the inline style rather than a cached copy, so an
 * assignment made anywhere else can't leave this out of step. Reading it is a
 * plain inline-style read — no computed style, no layout flush.
 */
export function setPageCursor(value: string) {
  const { style } = document.body;
  if (style.cursor === value) return;
  style.cursor = value;
}
