import { vendor } from "./api";

const VAR: Record<string, string> = {
  claude: "anthropic", anthropic: "anthropic",
  gpt: "openai", openai: "openai", o1: "openai", o3: "openai",
  gemini: "google", google: "google", vertex_ai: "google",
};

/** CSS colour for a model's vendor, from the tokens in globals.css. */
export const vendorColor = (model: string) => `var(--vendor-${VAR[vendor(model).toLowerCase()] ?? "other"})`;
