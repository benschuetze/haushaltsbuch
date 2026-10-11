export type Segment = { text: string; bold: boolean };

/**
 * The model likes **bold** for amounts and names. Only that one mark is honoured, as plain segments, so the
 * answer never becomes HTML; an unpaired ** stays as written.
 */
export function boldSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let rest = text;
  for (let m = /\*\*([^*\n]+?)\*\*/.exec(rest); m; m = /\*\*([^*\n]+?)\*\*/.exec(rest)) {
    if (m.index > 0) segments.push({ text: rest.slice(0, m.index), bold: false });
    segments.push({ text: m[1] as string, bold: true });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest || segments.length === 0) segments.push({ text: rest, bold: false });
  return segments;
}
