// Transcript chunker. Constants ported from the old app's
// generate-embeddings/index.ts lines 280-281:
//
//   MAX_CHUNK_SIZE = 5000 chars (one embedding per chunk)
//   MIN_CHUNK_SIZE = 200 chars (skip noise)
//
// Splits at line breaks first; if a single line exceeds MAX, hard-splits
// at the boundary. Returns chunks in order; the caller embeds each.

export const MAX_CHUNK_SIZE = 5000;
export const MIN_CHUNK_SIZE = 200;

export function chunkTranscript(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let buf = "";
  const push = () => {
    const trimmed = buf.trim();
    if (trimmed.length >= MIN_CHUNK_SIZE) chunks.push(trimmed);
    buf = "";
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length > MAX_CHUNK_SIZE) {
      // Hard-split a single overlong line.
      push();
      for (let i = 0; i < line.length; i += MAX_CHUNK_SIZE) {
        const piece = line.slice(i, i + MAX_CHUNK_SIZE);
        if (piece.length >= MIN_CHUNK_SIZE) chunks.push(piece);
      }
      continue;
    }
    if (buf.length + line.length + 1 > MAX_CHUNK_SIZE) {
      push();
    }
    buf = buf ? `${buf}\n${line}` : line;
  }
  push();
  return chunks;
}

// Normalize a Fathom transcript (may arrive as an array of speaker turns
// or a single string) into a single text blob suitable for chunking.
export function flattenTranscript(
  transcript: unknown,
): string {
  if (typeof transcript === "string") return transcript;
  if (!Array.isArray(transcript)) return "";
  const lines: string[] = [];
  for (const item of transcript) {
    if (typeof item === "string") {
      lines.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as { speaker?: { display_name?: string }; text?: string };
      const speaker = obj.speaker?.display_name?.trim();
      const text = obj.text?.trim();
      if (text) lines.push(speaker ? `${speaker}: ${text}` : text);
    }
  }
  return lines.join("\n");
}
