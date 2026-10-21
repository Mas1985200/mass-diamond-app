// supabase/functions/ai-chat/images/topic-match.ts
// One rule shared by the picture sources that describe their pictures in
// words: a described picture must name the thing the topic ends with ("bear"
// for "brown bear"); a picture without any description cannot be checked.

export function headWord(topic: string): string {
  return (
    topic
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3)
      .pop() ?? ""
  );
}

// `strict`: a picture without a description is refused (web images, whose
// ranking says nothing about the subject); otherwise it is accepted on the
// source's own relevance ranking (Unsplash).
export function describesTopic(
  description: string,
  topic: string,
  strict: boolean,
): boolean {
  const head = headWord(topic);

  if (!head) {
    return !strict;
  }

  if (!description.trim()) {
    return !strict;
  }

  return description.toLowerCase().includes(head);
}
