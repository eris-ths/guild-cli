// Wave-brief template registry use cases (#235).
//
// Thin orchestration over `TemplateRepository`. Two read verbs in
// scope: list every available template, and show one by name. Write
// path lives in `gate request --template <name>` (handlers/request.ts);
// this module is a read-only port consumer.

import {
  TemplateRepository,
  ParsedTemplate,
} from '../../infrastructure/template/TemplateRepository.js';

export interface TemplateSummary {
  readonly name: string;
  readonly version: number;
  readonly intendedUse: string;
  readonly gateRequired: boolean;
}

export class TemplateUseCases {
  constructor(private readonly repo: TemplateRepository) {}

  /** Return every parseable template, sorted by name. */
  list(): TemplateSummary[] {
    return this.repo.list().map(toSummary);
  }

  /** Return one template by name, or null when unknown. The full
   *  `ParsedTemplate` (including body) is exposed so `gate templates
   *  show` can render the markdown verbatim. */
  show(name: string): ParsedTemplate | null {
    return this.repo.find(name);
  }

  /** True when the templates dir exists. False is the legitimate
   *  empty-registry case (fresh install / public-repo clone). */
  registryExists(): boolean {
    return this.repo.exists;
  }

  /** Filesystem path of the templates dir — surfaced in error
   *  messages so the operator can find the SOT. */
  registryDir(): string {
    return this.repo.dir;
  }
}

function toSummary(t: ParsedTemplate): TemplateSummary {
  return {
    name: t.name,
    version: t.version,
    intendedUse: t.intendedUse,
    gateRequired: t.gateRequired,
  };
}
