export interface SlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SlmInput {
  messages: SlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /** "json_object" asks the model for structured JSON output. */
  responseFormat?: "text" | "json_object";
  // Reserved: tool/function definitions will be added here without changing the chat API contract.
}

export interface SlmResult {
  content: string;
}

export interface SlmProvider {
  complete(input: SlmInput): Promise<SlmResult>;
  isHealthy(): Promise<boolean>;
}
