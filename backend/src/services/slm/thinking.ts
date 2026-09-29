/**
 * Removes Qwen-style reasoning from a completion. Thinking is disabled upstream, but models and hosts do not
 * always honour that, so this runs on every completion:
 *  - complete `<think>...</think>` blocks are removed;
 *  - text before a lone `</think>` is removed (the opening tag was part of the prompt);
 *  - an unclosed `<think>` (generation cut off mid-thought) drops everything after it.
 */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const closing = out.toLowerCase().lastIndexOf("</think>");
  if (closing !== -1) out = out.slice(closing + "</think>".length);
  const opening = out.toLowerCase().indexOf("<think>");
  if (opening !== -1) out = out.slice(0, opening);
  return out.trim();
}
