/** What the copywriter receives: only data of the product, never personal data (ADR-0170). */
export interface CopyRequest {
  readonly title: string;
  readonly currentDescription: string | null;
  /** The options of each variant, such as `{ talla: 'M', color: 'Azul' }`. */
  readonly variantOptions: readonly Readonly<Record<string, unknown>>[];
  readonly language: CopyLanguage;
  readonly tone: CopyTone;
}

/** A draft of the copy of a product. Nothing is saved: the staff reviews it first (ADR-0170). */
export interface CopyDraft {
  readonly title: string;
  readonly description: string;
  readonly highlights: readonly string[];
}

export const COPY_LANGUAGES = ['es', 'en'] as const;
export type CopyLanguage = (typeof COPY_LANGUAGES)[number];

export const COPY_TONES = ['neutral', 'friendly', 'formal'] as const;
export type CopyTone = (typeof COPY_TONES)[number];

/**
 * Writes product copy with an AI model (T-147, ADR-0170). An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS, like `ProductImageStorage`. Its adapter throws a
 * Problem `ai-unavailable` when the model cannot answer.
 */
export abstract class ProductCopywriter {
  abstract draft(request: CopyRequest): Promise<CopyDraft>;
}
