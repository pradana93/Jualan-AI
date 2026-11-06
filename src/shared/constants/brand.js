// Product identity — the single source of truth for the platform's name,
// taglines and the small bits of copy that appear on multiple surfaces.
//
// This is the reseller-facing brand (what customers see at `/`). The upstream
// engine still calls itself "9router" internally in logs, CLI commands and the
// MITM layer — those strings are deliberately NOT touched here, because they
// reference the real npm package and on-disk paths.
export const BRAND = {
  name: "PrismGate",
  // Split for two-tone wordmarks: "Prism" + "Gate"
  nameLead: "Prism",
  nameTail: "Gate",
  tagline: "One prism, every model.",
  title: "PrismGate — AI Access Platform",
  description:
    "Buy credit points, mint your own API keys, and route Claude, GPT, Gemini, Llama and hundreds more through a single OpenAI-compatible gateway.",
  supportEmail: "majestap93@gmail.com",
  // The gateway's own name for the raw engine, shown in operator-only copy.
  engine: "9router",
};

/** Credit-point key prefix shown throughout the customer UI. */
export const KEY_PREFIX_LABEL = "sk-9r-";
