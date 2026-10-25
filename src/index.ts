interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * eu-pesticides -- EU approval status of pesticide active substances.
 *
 * Source: European Commission (DG SANTE), EU Pesticides Database, active
 * substances dataset. The dataset is served in 48 sequential pages (~50 s
 * end to end) and its server-side filters are unreliable, so the pack answers
 * from a periodically re-baked copy that the gateway injects as
 * `args._bakedIndex` (fleet #2754: never a value import of the data module --
 * type-only imports below are erased at compile time).
 */

import type { EuPesticideSubstance } from './eu-pesticides-index-data.js';

let SUBSTANCES: EuPesticideSubstance[] = [];
let CAPTURED_AT = '';
let SOURCE_ROWS = 0;

function ensureIndex(args: Record<string, unknown>): void {
  if (SUBSTANCES.length) return;
  const idx = args._bakedIndex as Record<string, unknown> | null | undefined;
  const subs = idx?.EU_PESTICIDE_SUBSTANCES;
  if (!Array.isArray(subs) || subs.length === 0) {
    // Loud on purpose: "no such substance" from an empty table would be a
    // silent wrong answer indistinguishable from a real miss.
    throw new Error(
      `eu-pesticides: the baked substance index is unavailable (${idx == null ? 'not injected' : 'malformed'}). ` +
        'The gateway loads it on the first call into this pack; this is a server-side fault, not a bad substance name -- retry shortly.',
    );
  }
  SUBSTANCES = subs as EuPesticideSubstance[];
  CAPTURED_AT = String(idx?.EU_PESTICIDES_CAPTURED_AT ?? '');
  SOURCE_ROWS = Number(idx?.EU_PESTICIDES_SOURCE_ROWS ?? 0);
}

const SOURCE = 'European Commission (DG SANTE), EU Pesticides Database, active substances';

function norm(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function normCas(s: string): string {
  return s.replace(/\s+/g, '');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The state a reader should act on. Status alone is not enough: a substance
 * can still say "Approved" after its expiry date has passed (a renewal
 * decision outstanding, or the dataset lagging) and must not read as current.
 */
function approvalState(s: EuPesticideSubstance, now: string): { state: string; note: string } {
  if (s.status === 'Approved') {
    if (s.expiry_date && s.expiry_date < now) {
      return {
        state: 'approved_but_expiry_date_passed',
        note: `Listed as Approved, but the listed expiry date ${s.expiry_date} has passed. Do not treat as currently approved without checking the latest Commission implementing regulation.`,
      };
    }
    return {
      state: 'approved_in_force',
      note: s.expiry_date
        ? `Approved; approval runs to ${s.expiry_date}. approval_date is the date of first approval, not of the latest renewal; the governing regulations are in legislations.`
        : 'Approved with no expiry date listed.',
    };
  }
  if (s.status === 'Not approved') return { state: 'not_approved', note: 'Not approved in the EU (never approved, withdrawn or non-renewed). See legislations for the decision.' };
  if (s.status === 'Pending') return { state: 'pending', note: 'Application pending; not an approval.' };
  return { state: 'unknown', note: `Status "${s.status}" as published.` };
}

function envelope(): Record<string, unknown> {
  return {
    source: SOURCE,
    data_as_of: CAPTURED_AT.slice(0, 10),
    data_note: 'Read from a dated snapshot of the Commission database; data_as_of is the date the snapshot was taken.',
  };
}

function full(s: EuPesticideSubstance, now: string): Record<string, unknown> {
  const st = approvalState(s, now);
  return {
    substance_id: s.id,
    name: s.name,
    cas_number: s.cas_number ? s.cas_number.trim() : null,
    status: s.status,
    approval_state: st.state,
    approval_note: st.note,
    approval_date_first: s.approval_date,
    expiry_date: s.expiry_date,
    ...(s.expiry_date_variants.length
      ? { expiry_date_variants: s.expiry_date_variants, expiry_date_variants_note: 'Rows for this entry disagree (use-specific expiry); expiry_date is the earliest.' }
      : {}),
    categories: s.categories,
    governing_legislation: s.legislations,
    previous_legislation: s.legislations_previous,
    rapporteur_member_state: s.rapporteur_member_state,
    co_rapporteur_member_state: s.co_rapporteur_member_state,
    candidate_for_substitution: s.candidate_for_substitution,
    low_risk: s.low_risk,
    basic_substance: s.basic_substance,
    is_group: s.is_group,
    micro_organism: s.micro_organism,
    reference_values: s.reference_values,
    classification_reg_1272_2008: s.classification_reg_1272_2008,
    risk_assessment_body: s.risk_assessment,
    authorisations_at_national_level: s.authorisations_at_national_level,
    group_members: s.group_members,
    residue_definitions: s.residue_definitions,
    remark: s.remark,
    ...envelope(),
  };
}

function brief(s: EuPesticideSubstance, now: string): Record<string, unknown> {
  const st = approvalState(s, now);
  return {
    substance_id: s.id,
    name: s.name,
    cas_number: s.cas_number ? s.cas_number.trim() : null,
    status: s.status,
    approval_state: st.state,
    approval_date_first: s.approval_date,
    expiry_date: s.expiry_date,
    categories: s.categories,
    candidate_for_substitution: s.candidate_for_substitution,
    low_risk: s.low_risk,
  };
}

const tools: McpToolExport['tools'] = [
  {
    name: 'eu_pesticide_substance',
    description:
      'EU approval record for one pesticide (plant-protection) active substance from the European Commission EU Pesticides Database: approval status (Approved / Not approved / Pending), an explicit approval_state that flags an Approved entry whose expiry date has already passed, first-approval date, expiry date, the governing Commission regulations and directives (links to EUR-Lex; this is how to see whether and under which implementing regulation an approval was renewed or extended), rapporteur member state, candidate-for-substitution and low-risk flags, ADI / ARfD / AOEL reference values, CLP classification, national authorisations and MRL residue definitions. Look up by name (exact, then partial), CAS number or substance id. Returns data_as_of with every answer. Keyless.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Active substance name, e.g. "dimethachlor", "glyphosate", "chlorpyrifos". Exact match preferred; otherwise partial matches are listed.' },
        cas: { type: 'string', description: 'CAS number, e.g. "50563-36-5".' },
        id: { type: 'number', description: 'EU Pesticides Database substance id.' },
      },
    },
  },
  {
    name: 'eu_pesticides_list',
    description:
      'List EU pesticide active substances by approval status and dates -- e.g. approvals expiring before a date (expiring_before), all substances still Approved, Not approved, or Pending, candidates for substitution, low-risk substances, or one category (fungicide, herbicide, insecticide...). Each row carries status, approval_state (flags Approved entries whose expiry date has passed), first-approval date and expiry date. Sorted by expiry date for date filters, otherwise by name. Source: European Commission EU Pesticides Database; data_as_of in every answer. Keyless.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['Approved', 'Not approved', 'Pending'], description: 'Approval status filter.' },
        expiring_before: { type: 'string', description: 'ISO date YYYY-MM-DD: only Approved substances whose expiry date is on or before it (includes ones already lapsed).' },
        expiring_after: { type: 'string', description: 'ISO date YYYY-MM-DD: only substances whose expiry date is on or after it.' },
        category: { type: 'string', description: 'Substance category text, e.g. "fungicide", "herbicide", "insecticide", "plant growth regulator".' },
        candidate_for_substitution: { type: 'boolean', description: 'Only substances flagged as candidates for substitution.' },
        low_risk: { type: 'boolean', description: 'Only low-risk active substances.' },
        query: { type: 'string', description: 'Substring of the substance name.' },
        limit: { type: 'number', description: 'Rows to return (default 25, max 200).' },
        offset: { type: 'number', description: 'Rows to skip, for paging.' },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  ensureIndex(args);
  const now = today();
  switch (name) {
    case 'eu_pesticide_substance': {
      const nm = typeof args.name === 'string' ? args.name.trim() : '';
      const cas = typeof args.cas === 'string' ? args.cas.trim() : '';
      const id = typeof args.id === 'number' ? args.id : typeof args.id === 'string' && args.id.trim() ? Number(args.id) : NaN;
      if (!nm && !cas && !Number.isFinite(id)) throw new Error('Provide name, cas or id.');
      let hits: EuPesticideSubstance[] = [];
      if (Number.isFinite(id)) hits = SUBSTANCES.filter((s) => s.id === id);
      else if (cas) {
        const c = normCas(cas);
        hits = SUBSTANCES.filter((s) => s.cas_number != null && normCas(s.cas_number).split(/[;,/]/).includes(c));
        if (!hits.length) hits = SUBSTANCES.filter((s) => s.cas_number != null && normCas(s.cas_number).includes(c));
      } else {
        const q = norm(nm);
        hits = SUBSTANCES.filter((s) => norm(s.name) === q);
        if (!hits.length) hits = SUBSTANCES.filter((s) => norm(s.name).includes(q));
      }
      if (!hits.length) {
        return {
          matches: 0,
          query: { name: nm || undefined, cas: cas || undefined, id: Number.isFinite(id) ? id : undefined },
          note: 'No active substance in the EU Pesticides Database matches. Try a shorter name, the CAS number, or the ISO common name.',
          ...envelope(),
        };
      }
      if (hits.length === 1) return { matches: 1, substance: full(hits[0]!, now) };
      const q = nm ? norm(nm) : '';
      const exact = q ? hits.filter((s) => norm(s.name) === q) : [];
      if (exact.length === 1) return { matches: 1, substance: full(exact[0]!, now) };
      return {
        matches: hits.length,
        note: 'Several substances match; call again with the id of the one you want.',
        candidates: hits.slice(0, 25).map((s) => brief(s, now)),
        ...envelope(),
      };
    }
    case 'eu_pesticides_list': {
      let rows = SUBSTANCES;
      const status = typeof args.status === 'string' ? args.status : '';
      if (status) {
        const want = status.toLowerCase();
        rows = rows.filter((s) => s.status.toLowerCase() === want);
      }
      const before = typeof args.expiring_before === 'string' ? args.expiring_before.trim() : '';
      const after = typeof args.expiring_after === 'string' ? args.expiring_after.trim() : '';
      for (const d of [before, after]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Dates must be ISO YYYY-MM-DD.');
      if (before) rows = rows.filter((s) => s.status === 'Approved' && s.expiry_date && s.expiry_date <= before);
      if (after) rows = rows.filter((s) => s.expiry_date && s.expiry_date >= after);
      if (typeof args.category === 'string' && args.category.trim()) {
        const c = args.category.trim().toLowerCase();
        rows = rows.filter((s) => s.categories.some((x) => x.toLowerCase().includes(c)));
      }
      if (typeof args.candidate_for_substitution === 'boolean') rows = rows.filter((s) => s.candidate_for_substitution === args.candidate_for_substitution);
      if (typeof args.low_risk === 'boolean') rows = rows.filter((s) => s.low_risk === args.low_risk);
      if (typeof args.query === 'string' && args.query.trim()) {
        const q = norm(args.query);
        rows = rows.filter((s) => norm(s.name).includes(q));
      }
      if (before || after) rows = [...rows].sort((a, b) => (a.expiry_date ?? '').localeCompare(b.expiry_date ?? '') || a.name.localeCompare(b.name));
      const limit = Math.min(200, Math.max(1, Number(args.limit) || 25));
      const offset = Math.max(0, Number(args.offset) || 0);
      return {
        total_matching: rows.length,
        returned: Math.min(limit, Math.max(0, rows.length - offset)),
        offset,
        substances: rows.slice(offset, offset + limit).map((s) => brief(s, now)),
        index_size: { substances: SUBSTANCES.length, source_rows: SOURCE_ROWS },
        ...envelope(),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
