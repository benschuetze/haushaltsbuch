import { boldSegments } from "~/lib/assistant/rich-text";

export function RichText({ text }: { text: string }) {
  return (
    <>
      {boldSegments(text).map((s, i) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: segments of one fixed string
        s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}
