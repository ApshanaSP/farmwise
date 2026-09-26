"use client";

/**
 * Complaint type in two steps: pick a category, then a subtype within it.
 *
 * Choosing a different category clears the subtype, so the pair is never
 * inconsistent. The "Other" category has no fixed department — selecting it
 * reveals a description box, and the department is decided at submit time by
 * the classifier in src/lib/ai-classifier.ts from what the citizen writes.
 */

import { AlertTriangle, CheckCircle2, Info, Sparkles } from "lucide-react";

export interface Subcomplaint {
  id: number;
  gccId: number;
  label: string;
  categoryId: number;
  departmentId: number | null;
  departmentName: string | null;
  mappingStatus: "mapped" | "assumed" | "unmapped";
}

export interface ComplaintCategory {
  id: number;
  name: string;
  sortOrder: number;
  subcomplaints: Subcomplaint[];
}

export interface TaxonomySource {
  url: string;
  label: string;
  fetchedAt: string;
  notes?: string;
}

interface Props {
  categories: ComplaintCategory[];
  selectedCategoryId: number | null;
  onSelectCategory: (categoryId: number | null) => void;
  selectedId: number | null;
  onSelect: (subcomplaint: Subcomplaint | null) => void;
  /** Free text for the "Other" category. */
  otherDescription: string;
  onOtherDescriptionChange: (value: string) => void;
  source?: TaxonomySource | null;
  loading?: boolean;
}

/** A category with no fixed department is routed from the description. */
const isOtherCategory = (name: string) => name.trim().toLowerCase() === "other";

export default function ComplaintTypeSelector({
  categories,
  selectedCategoryId,
  onSelectCategory,
  selectedId,
  onSelect,
  otherDescription,
  onOtherDescriptionChange,
  source,
  loading
}: Props) {
  const category = categories.find((c) => c.id === selectedCategoryId) ?? null;
  const subtypes = category?.subcomplaints ?? [];
  const selected = subtypes.find((s) => s.id === selectedId) ?? null;
  const otherSelected = Boolean(category && isOtherCategory(category.name));

  if (loading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="skeleton h-11" />
        <div className="skeleton h-11" />
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className="form-label" htmlFor="complaintCategory">
            Complaint Type <span className="text-red-600">*</span>
          </label>
          <select
            id="complaintCategory"
            required
            className="form-input"
            value={selectedCategoryId ?? ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              onSelectCategory(id);
              // The old subtype belongs to the old category.
              onSelect(null);
            }}
          >
            <option value="">Select complaint type</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label" htmlFor="complaintSubtype">
            Complaint Sub Type <span className="text-red-600">*</span>
          </label>
          <select
            id="complaintSubtype"
            required
            className="form-input"
            disabled={!category}
            value={selectedId ?? ""}
            onChange={(e) =>
              onSelect(subtypes.find((s) => s.id === Number(e.target.value)) ?? null)
            }
          >
            <option value="">
              {!category
                ? "Select a complaint type first"
                : subtypes.length === 0
                ? "No sub types"
                : "Select sub type"}
            </option>
            {subtypes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {category && subtypes.length > 0 && (
            <p className="form-hint">
              {subtypes.length} sub type{subtypes.length === 1 ? "" : "s"} under {category.name}.
            </p>
          )}
        </div>
      </div>

      {/* "Other": the citizen describes it, the classifier routes it */}
      {otherSelected && selected && (
        <div className="mt-5 animate-fade-up rounded-2xl border border-navy-200 bg-navy-50/60 p-4">
          <label className="form-label" htmlFor="otherDescription">
            Describe the complaint <span className="text-red-600">*</span>
          </label>
          <textarea
            id="otherDescription"
            rows={3}
            maxLength={400}
            required
            className="form-input bg-white"
            placeholder="e.g. A transformer near the park has been sparking for two days."
            value={otherDescription}
            onChange={(e) => onOtherDescriptionChange(e.target.value)}
          />
          <p className="mt-2 flex items-start gap-1.5 text-xs text-navy-700">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            Your description is read automatically and the complaint is routed to the department
            that handles it. An officer confirms the routing before work begins.
          </p>
        </div>
      )}

      {/* Current selection */}
      <div className="mt-6">
        {selected ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-2.5">
              <CheckCircle2
                className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-wide text-emerald-700">
                  {category?.name}
                </p>
                <p className="mt-0.5 text-sm font-bold text-ink">{selected.label}</p>

                {selected.departmentName ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    Routed to <span className="font-semibold">{selected.departmentName}</span>
                    {selected.mappingStatus === "assumed" && " (confirmed by an officer)"}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-ink-muted">
                    The department is chosen from your description when you submit.
                  </p>
                )}

                {selected.mappingStatus === "assumed" && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    The Corporation does not publish a department for this type, so this routing is
                    our best match and an officer will confirm it.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  onSelectCategory(null);
                }}
                className="ml-auto flex-shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
              >
                Clear
              </button>
            </div>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 text-sm text-ink-muted">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-faint" aria-hidden="true" />
            Choose a complaint type, then the sub type that fits best. If nothing matches, pick{" "}
            <span className="font-semibold text-ink">Other</span> and describe it.
          </p>
        )}
      </div>

      {source && (
        <p className="mt-4 border-t border-canvas-border pt-3 text-2xs leading-relaxed text-ink-faint">
          Complaint types imported from the Greater Chennai Corporation grievance portal (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-navy"
          >
            source
          </a>
          ) on{" "}
          {new Date(source.fetchedAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric"
          })}
          .
        </p>
      )}
    </div>
  );
}
