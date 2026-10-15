import type { DocLocale, Paper, RenderContext } from "./types";

export interface LoadContext {
  locale: DocLocale;
  /** Query string of the request (e.g. statement from/to). */
  query: Record<string, string | undefined>;
}

export interface DocumentType<T = unknown> {
  /** URL segment, e.g. "invoice" → GET /v1/documents/invoice/:id.pdf */
  key: string;
  paper: Paper;
  /** Feature the staff route belongs to (docs/features.md), e.g. "invoices". */
  feature: string;
  /** Optional permission key for the staff route (staff package). */
  permission?: string;
  /** Loads the data through a port; null → 404. */
  load(tenantId: string, id: string, ctx: LoadContext): Promise<T | null>;
  /** Pure: data → complete HTML document. */
  render(data: T, ctx: RenderContext): string;
  /** File name without directories, e.g. "INV-26-27-0001.pdf". */
  filename(data: T, locale: DocLocale): string;
  /** Cache/version key part (e.g. updatedAt); optional. */
  version?(data: T): string | null;
}

export class DocumentRegistry {
  private readonly types = new Map<string, DocumentType<unknown>>();

  register<T>(def: DocumentType<T>): void {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(def.key)) throw new Error(`Invalid document type key "${def.key}"`);
    if (this.types.has(def.key)) throw new Error(`Document type "${def.key}" is already registered`);
    this.types.set(def.key, def as DocumentType<unknown>);
  }

  /** Replaces a registered type (e.g. a custom invoice layout). */
  override<T>(def: DocumentType<T>): void {
    this.types.delete(def.key);
    this.register(def);
  }

  get(key: string): DocumentType<unknown> | undefined {
    return this.types.get(key);
  }

  has(key: string): boolean {
    return this.types.has(key);
  }

  list(): DocumentType<unknown>[] {
    return [...this.types.values()];
  }
}

/** "INV/26-27/0001" → "INV-26-27-0001" (safe in Content-Disposition on every OS). */
export function safeFilename(base: string, ext = "pdf"): string {
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${cleaned || "document"}.${ext}`;
}
