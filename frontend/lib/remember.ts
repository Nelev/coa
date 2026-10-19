// Who an answer to a flagged check is kept for, so that the agent can use it in a later review: the lots of the same product, every
// product, or nobody (this lot only: nothing is saved). The server takes the same three words.
export type Scope = "product" | "global" | "none";

export const DEFAULT_SCOPE: Scope = "product";

export const SCOPES: { value: Scope; label: string }[] = [
  { value: "product", label: "This product's future lots" },
  { value: "global", label: "All products" },
  { value: "none", label: "This lot only" },
];
