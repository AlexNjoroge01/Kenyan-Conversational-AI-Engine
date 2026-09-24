import type { SlmInput, SlmProvider, SlmResult } from "./slm.provider";

/** Development/test stand-in: returns a canned Kiswahili reply (or a small JSON object when JSON output is requested). */
export class MockSlmProvider implements SlmProvider {
  async complete(input: SlmInput): Promise<SlmResult> {
    if (input.responseFormat === "json_object") {
      const last = [...input.messages].reverse().find((m) => m.role === "user");
      return { content: JSON.stringify({ reply: "Nitaangalia status ya order yako.", echo: last?.content ?? "" }) };
    }
    return { content: "Nitaangalia status ya order yako." };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}
