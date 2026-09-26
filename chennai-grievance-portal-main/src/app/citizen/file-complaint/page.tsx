"use client";

import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  FileText,
  ImagePlus,
  Loader2,
  MapPin,
  Info,
  PencilLine,
  ShieldAlert,
  UserRound,
  X
} from "lucide-react";
import Header from "@/components/Header";
import { CITIZEN_NAV } from "@/lib/constants";
import Footer from "@/components/Footer";
import Combobox from "@/components/Combobox";
import ComplaintTypeSelector, {
  ComplaintCategory,
  Subcomplaint,
  TaxonomySource
} from "@/components/ComplaintTypeSelector";
import type { LocationSelection } from "@/components/MapPicker";

const MapPicker = dynamic(() => import("@/components/MapPicker"), { ssr: false });

interface Zone {
  id: number;
  zone_number: number;
  zone_name: string;
  ward_start: number;
  ward_end: number;
}
interface Locality {
  id: number;
  zone_id: number;
  name: string;
}
interface Street {
  id: number;
  locality_id: number;
  name: string;
}
interface ZoneOption {
  id: number;
  zone_number: number;
  zone_name: string;
}
interface WardOption {
  wardNumber: number;
  zoneId: number;
  zoneNumber: number;
  zoneName: string;
  label: string;
  /** The single likeliest ward for the area, from the derived mapping. */
  isPrimary: boolean;
}

/** Outcome of resolving the map pin against GCC ward polygons. */
type WardVerdict =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "resolved";
      wardNumber: number;
      zoneId: number | null;
      zoneName: string | null;
      ambiguous: boolean;
      candidateWards: number[] | null;
      provenance: { sourceLabel: string | null; official: boolean; fetchedAt: string | null };
    }
  | { status: "outside_boundary"; message: string }
  | { status: "unavailable"; message: string };

/**
 * GCC's own form offers these street types. Kept separate from the street
 * name so "Anna" + "Salai" is not stored as one opaque string.
 */
const STREET_TYPES = [
  "Street", "Road", "Main Road", "Cross Street", "Avenue", "Lane",
  "Salai", "Nagar", "Colony", "Extension", "High Road", "Bazaar", "Other"
];

const STEPS = [
  { label: "Your Details", icon: UserRound },
  { label: "Location", icon: MapPin },
  { label: "Type", icon: Building2 },
  { label: "Details", icon: FileText }
];

export default function FileComplaintPage() {
  const [me, setMe] = useState<any>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  /**
   * Details the profile is missing that a complaint needs; asked once, then
   * saved. Starts as "all missing" so that a profile which fails to load shows
   * the input fields rather than an empty, un-fillable summary.
   */
  const [missingDetails, setMissingDetails] = useState<string[]>([
    "firstName",
    "gender",
    "streetAddress",
    "mobileNumber"
  ]);
  const [savingProfile, setSavingProfile] = useState(false);

  const [step, setStep] = useState(1);

  // Step 1: personal details
  const [initials, setInitials] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [personEmail, setPersonEmail] = useState("");

  // Step 2: location (verified GCC Area -> Locality -> Street)
  const [zones, setZones] = useState<ZoneOption[]>([]);


  const [zoneId, setZoneId] = useState("");

  // Street is always entered manually; the GCC street list is no longer used.
  const manualStreetMode = true;
  const [manualStreetName, setManualStreetName] = useState("");
  const [streetType, setStreetType] = useState("");
  const [locationPincode, setLocationPincode] = useState("");
  const [specificLocation, setSpecificLocation] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Ward: resolved from the map pin where possible, otherwise chosen.
  const [wards, setWards] = useState<WardOption[]>([]);
  const [wardsFiltered, setWardsFiltered] = useState(false);
  const [wardConfidence, setWardConfidence] = useState<"verified" | "derived" | null>(null);
  const [suggestedWard, setSuggestedWard] = useState<number | null>(null);
  const [wardNotice, setWardNotice] = useState<string | null>(null);
  const [wardNumber, setWardNumber] = useState("");
  const [wardSource, setWardSource] = useState<"map_boundary" | "user_selected" | "">("");
  const [wardVerdict, setWardVerdict] = useState<WardVerdict>({ status: "idle" });

  /**
   * Address fields the citizen typed into themselves. Map autofill skips them
   * until the citizen explicitly picks a different location, at which point
   * the new address wins and this resets.
   */
  const editedFields = useRef<Set<string>>(new Set());
  /** Guards against a slow ward lookup landing after a newer pin was placed. */
  const wardSeq = useRef(0);
  /** Which fields the map filled in, so the form can say so. */
  const [autofilled, setAutofilled] = useState<Set<string>>(new Set());

  // Step 3: GCC complaint category / subcomplaint
  const [categories, setCategories] = useState<ComplaintCategory[]>([]);
  const [taxonomySource, setTaxonomySource] = useState<TaxonomySource | null>(null);
  const [taxonomyLoading, setTaxonomyLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedSubtype, setSelectedSubtype] = useState<Subcomplaint | null>(null);
  const [otherDescription, setOtherDescription] = useState("");
  /** Set once the citizen edits the title, so retyping the type stops overwriting it. */
  const [titleEdited, setTitleEdited] = useState(false);

  // Step 4: details
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ complaintCode: string; department: string; complaintType: string } | null>(null);

  const selectedWard = wards.find((w) => String(w.wardNumber) === wardNumber) || null;

  useEffect(() => {
    async function init() {
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        setMe(meData.user);
        setPersonEmail(meData.user.email);

        const profileRes = await fetch("/api/profile");
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          const profile = profileData.profile;
          if (profile) {
            setFirstName(profile.firstName || "");
            setLastName(profile.lastName || "");
            setGender(profile.gender || "");
            setPincode(profile.pincode || "");
            setStreetAddress(profile.doorNoAndStreet || "");
            setMobileNumber(profile.mobileNumber || "");

            // A complaint needs these four. Anything already on the profile is
            // never asked for again.
            const missing: string[] = [];
            if (!profile.firstName) missing.push("firstName");
            if (!profile.gender) missing.push("gender");
            if (!profile.doorNoAndStreet) missing.push("streetAddress");
            if (!profile.mobileNumber) missing.push("mobileNumber");
            setMissingDetails(missing);
          } else {
            setMissingDetails(["firstName", "gender", "streetAddress", "mobileNumber"]);
            // Deliberately NOT prefilling the complaint's area/ward/street from
            // the profile: those describe where the citizen lives, and the
            // complaint location is a separate fact they must state for the
            // issue being reported.
          }
        }
      }
      setCheckedSession(true);
    }
    init();

    fetch("/api/locations/zones")
      .then((r) => r.json())
      .then((d) => setZones(d.zones || []))
      .catch(() => setZones([]));

    fetch("/api/complaint-taxonomy")
      .then((r) => r.json())
      .then((d) => {
        setCategories(d.categories || []);
        setTaxonomySource(d.source || null);
      })
      .catch(() => {
        setCategories([]);
      })
      .finally(() => setTaxonomyLoading(false));
  }, []);



  /**
   * Wards of the selected zone. zone_wards is an exact mapping derived from the
   * ward polygons themselves, so unlike the old area-based filter this list is
   * not an estimate.
   */
  useEffect(() => {
    let stale = false;
    fetch(`/api/locations/wards${zoneId ? "?zoneId=" + zoneId : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (stale) return;
        setWards(d.wards || []);
        setWardsFiltered(Boolean(d.filtered));
        setWardConfidence(d.confidence ?? null);
        setWardNotice(d.notice || null);
        setSuggestedWard(d.suggestedWard ?? null);
      })
      .catch(() => {
        if (!stale) setWards([]);
      });
    return () => {
      stale = true;
    };
  }, [zoneId]);



  /** Marks a field as citizen-edited so map autofill leaves it alone. */
  function markEdited(field: string) {
    editedFields.current.add(field);
  }

  /**
   * Applies a map selection.
   *
   * The pin coordinates are stored exactly as chosen — a reverse-geocode
   * result only contributes address TEXT, never position. An explicit new
   * selection is allowed to replace previously autofilled address text and
   * clears the manual-edit marks, which is what "until the user explicitly
   * selects a different location" means; the `initial` selection that merely
   * centres the map on Chennai does neither.
   */
  const handleMapSelection = useCallback(
    (sel: LocationSelection) => {
      setCoords(sel.coords);

      const explicit = sel.via !== "initial";
      if (explicit && sel.address) {
        editedFields.current.clear();
        const filled = new Set<string>();
        const { street, pincode } = sel.address;

        if (street) filled.add("street");
        if (pincode && /^\d{6}$/.test(pincode)) filled.add("pincode");
        setAutofilled(filled);
        // Only the complaint-location fields are touched. The complainant's own
        // address and PIN code in step 1 are never overwritten from the map.
        if (street && !editedFields.current.has("manualStreetName")) {
          setManualStreetName(street);
        }
        if (pincode && /^\d{6}$/.test(pincode)) {
          setLocationPincode(pincode);
        }
        if (sel.address.formatted && !editedFields.current.has("specificLocation")) {
          setSpecificLocation((prev) => prev || sel.address!.formatted!);
        }
      }

      if (!explicit) return;

      // Resolve the ward from the pin. Each lookup carries a sequence number so
      // a slow reply for an older pin cannot overwrite a newer verdict.
      const seq = ++wardSeq.current;
      setWardVerdict({ status: "checking" });
      fetch(`/api/locations/resolve-ward?lat=${sel.coords.lat}&lng=${sel.coords.lng}`)
        .then((r) => r.json())
        .then((d) => {
          if (seq !== wardSeq.current) return;
          if (d.status === "resolved") {
            // The pin gives the zone exactly, via the ward polygon it fell in.
            if (d.zoneId) {
              setZoneId(String(d.zoneId));
              setAutofilled((prev) => new Set([...prev, "zone"]));
            }
            setWardVerdict({
              status: "resolved",
              wardNumber: d.wardNumber,
              zoneId: d.zoneId ?? null,
              zoneName: d.zoneName ?? null,
              ambiguous: Boolean(d.ambiguous),
              candidateWards: d.candidateWards ?? null,
              provenance: {
                sourceLabel: d.provenance?.sourceLabel ?? null,
                official: Boolean(d.provenance?.official),
                fetchedAt: d.provenance?.fetchedAt ?? null
              }
            });
            // Autofill only when the boundary data gave a single answer.
            if (!d.ambiguous) {
              setWardNumber(String(d.wardNumber));
              setWardSource("map_boundary");
            }
          } else if (d.status === "outside_boundary") {
            setWardVerdict({ status: "outside_boundary", message: d.message });
            setWardNumber("");
            setWardSource("");
          } else {
            setWardVerdict({ status: "unavailable", message: d.message });
          }
        })
        .catch(() => {
          if (seq !== wardSeq.current) return;
          setWardVerdict({
            status: "unavailable",
            message:
              "The ward could not be checked just now. Please choose the ward yourself."
          });
        });
    },
    []
  );

  /**
   * Persists details the citizen had to supply here, so the next complaint
   * prefills them instead of asking again.
   */
  async function saveDetailsToProfile(): Promise<boolean> {
    if (missingDetails.length === 0) return true;
    setSavingProfile(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          gender: gender || null,
          doorNoAndStreet: streetAddress || null,
          pincode: pincode || null,
          mobileNumber: mobileNumber || null
        })
      });
      if (res.ok) setMissingDetails([]);
      // A failed save is not worth blocking the complaint over — the details
      // are still submitted with it, they just were not remembered.
      return true;
    } catch {
      return true;
    } finally {
      setSavingProfile(false);
    }
  }

  function goToStep(n: number) {
    setSubmitError(null);
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validateDetails(): string | null {
    if (!firstName.trim()) return "First name is required.";
    if (!gender) return "Please select a gender.";
    if (!streetAddress.trim()) return "Your address is required.";
    if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
      return "Enter a valid 10-digit mobile number.";
    }
    if (pincode && !/^\d{6}$/.test(pincode)) {
      return "Enter a valid 6-digit PIN code, or leave it blank.";
    }
    return null;
  }

  function validateLocation(): string | null {
    if (!zoneId) return "Please select the zone.";
    if (!manualStreetName.trim()) return "Please enter the street name.";
    if (wardVerdict.status === "outside_boundary") {
      return wardVerdict.message;
    }
    if (!wardNumber) {
      return wardVerdict.status === "checking"
        ? "Still checking which ward the pin falls in — one moment."
        : "Please select the ward, or place a pin on the map to determine it.";
    }
    if (locationPincode && !/^\d{6}$/.test(locationPincode)) {
      return "Enter a valid 6-digit PIN code for the location, or leave it blank.";
    }
    return null;
  }

  function validateType(): string | null {
    if (!selectedCategoryId) return "Please select a complaint type.";
    if (!selectedSubtype) return "Please select a complaint sub type.";
    const cat = categories.find((c) => c.id === selectedCategoryId);
    if (cat && cat.name.trim().toLowerCase() === "other" && !otherDescription.trim()) {
      return "Please describe the complaint so it can be routed to a department.";
    }
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!title.trim()) {
      setSubmitError("Complaint title is required.");
      return;
    }
    if (!description.trim()) {
      setSubmitError("Complaint details are required.");
      return;
    }

    setSubmitting(true);
    try {
      let mediaPath: string | undefined;
      if (mediaFile) {
        const formData = new FormData();
        formData.append("media", mediaFile);
        const mediaRes = await fetch("/api/complaints/media", { method: "POST", body: formData });
        const mediaData = await mediaRes.json();
        if (!mediaRes.ok) {
          setSubmitError(mediaData.error || "Failed to upload attachment.");
          setSubmitting(false);
          return;
        }
        mediaPath = mediaData.mediaPath;
      }

      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initials,
          firstName,
          lastName,
          gender,
          streetAddress,
          pincode,
          mobileNumber: mobileNumber || null,
          phoneNumber: phoneNumber || null,
          email: personEmail || null,
          zoneId: Number(zoneId),
          gccStreetId: null,
          manualStreetName: manualStreetName.trim(),
          streetType: streetType || null,
          wardNumber: Number(wardNumber),
          wardSource: wardSource || "user_selected",
          locationPincode: locationPincode || null,
          specificLocation,
          // The pin the citizen placed, never a geocoder's approximation.
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          complaintSubtypeId: selectedSubtype ? selectedSubtype.id : null,
          otherDescription: otherDescription || null,
          title,
          description,
          mediaPath,
          isAnonymous
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || "Failed to submit complaint.");
        setSubmitting(false);
        return;
      }
      setResult(data);
      setStep(5);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSubmitError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForNewComplaint() {
    setResult(null);
    setTitle("");
    setDescription("");
    setMediaFile(null);
    setIsAnonymous(false);
    setSelectedSubtype(null);
    setSelectedCategoryId(null);
    setOtherDescription("");
    setTitleEdited(false);
    setSpecificLocation("");
    setLocationPincode("");
    setManualStreetName("");
    setStreetType("");
    setAutofilled(new Set());
    setWardVerdict({ status: "idle" });
    setWardSource("");
    editedFields.current.clear();
    setCoords(null);
    goToStep(1);
  }

  if (!checkedSession) {
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
        <Header homeHref="/citizen" nav={CITIZEN_NAV} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
          <div className="skeleton mb-3 h-8 w-56" />
          <div className="skeleton mb-8 h-4 w-72" />
          <div className="card space-y-4">
            <div className="skeleton h-5 w-48" />
            <div className="grid grid-cols-3 gap-4">
              <div className="skeleton h-11" />
              <div className="skeleton h-11" />
              <div className="skeleton h-11" />
            </div>
            <div className="skeleton h-11" />
            <div className="skeleton h-11" />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header userName={me?.email} homeHref="/citizen" nav={CITIZEN_NAV} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <Link
            href="/citizen"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-subtle transition hover:text-navy"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to dashboard
          </Link>
          <h1 className="mt-3 text-[1.75rem] font-extrabold leading-tight text-ink sm:text-[2rem]">
            File a Complaint
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Public Grievance Redressal &mdash; Greater Chennai Corporation
          </p>
        </div>

        {/* Stepper */}
        {step < 5 && (
          <ol className="mb-8 flex items-start">
            {STEPS.map((s, idx) => {
              const n = idx + 1;
              const done = step > n;
              const current = step === n;
              const Icon = s.icon;
              return (
                <li key={s.label} className="flex flex-1 flex-col items-center">
                  <div className="flex w-full items-center">
                    <span
                      className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                        idx === 0 ? "bg-transparent" : done || current ? "bg-navy" : "bg-canvas-border"
                      }`}
                    />
                    <span
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border-2 text-xs font-bold transition-all duration-300 ease-spring ${
                        done
                          ? "border-navy bg-navy text-white"
                          : current
                            ? "scale-110 border-navy bg-white text-navy shadow-glow"
                            : "border-canvas-border bg-white text-ink-faint"
                      }`}
                    >
                      {done ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-4 w-4" />}
                    </span>
                    <span
                      className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                        idx === STEPS.length - 1 ? "bg-transparent" : done ? "bg-navy" : "bg-canvas-border"
                      }`}
                    />
                  </div>
                  <span
                    className={`mt-2 text-center text-[11px] font-semibold leading-tight transition-colors ${
                      current ? "text-navy" : done ? "text-ink-muted" : "text-ink-faint"
                    }`}
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {/* STEP 1: WHO IS REPORTING */}
        {step === 1 && (
          <div className="card animate-fade-up">
            <div className="mb-6 flex items-start gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy">
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-ink">Your Details</h2>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {missingDetails.length === 0
                    ? "Taken from your profile — you only enter these once."
                    : "Fields marked * are required. They are saved to your profile, so you will not be asked again."}
                </p>
              </div>
            </div>

            {/* Everything already known: shown, not re-asked */}
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-2xl border border-canvas-border bg-canvas p-4 sm:grid-cols-3">
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Name</dt>
                <dd className="mt-0.5 truncate text-sm font-semibold text-ink">
                  {[firstName, lastName].filter(Boolean).join(" ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Email</dt>
                <dd className="mt-0.5 truncate text-sm text-ink">{personEmail || "—"}</dd>
              </div>
              <div>
                <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Mobile</dt>
                <dd className="mt-0.5 truncate text-sm text-ink">{mobileNumber || "\u2014"}</dd>
              </div>
              {!missingDetails.includes("gender") && (
                <div>
                  <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Gender</dt>
                  <dd className="mt-0.5 text-sm text-ink">{gender || "—"}</dd>
                </div>
              )}
              {!missingDetails.includes("streetAddress") && (
                <div className="col-span-2">
                  <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Your address</dt>
                  <dd className="mt-0.5 truncate text-sm text-ink">
                    {streetAddress || "—"}
                    {pincode ? ` · ${pincode}` : ""}
                  </dd>
                </div>
              )}
            </dl>

            <p className="mt-2.5 text-xs text-ink-muted">
              Something out of date?{" "}
              <Link href="/profile" className="font-semibold text-navy hover:underline">
                Update it in your profile
              </Link>
              .
            </p>

            {/* Only the genuinely missing pieces are asked for */}
            {missingDetails.length > 0 && (
              <div className="mt-6 border-t border-canvas-border pt-5">
                <p className="mb-4 flex items-start gap-1.5 text-sm text-ink-muted">
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-faint" aria-hidden="true" />
                  These are missing from your profile. Fill them in once and future complaints
                  will use them automatically.
                </p>

                {missingDetails.includes("firstName") && (
                  <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="form-label" htmlFor="fname">First name <span className="text-red-600">*</span></label>
                      <input id="fname" required className="form-input" value={firstName}
                        onChange={(e) => setFirstName(e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="lname">
                        Last name <span className="normal-case text-ink-faint">(optional)</span>
                      </label>
                      <input id="lname" className="form-input" value={lastName}
                        onChange={(e) => setLastName(e.target.value)} />
                    </div>
                  </div>
                )}

                {missingDetails.includes("gender") && (
                  <div className="mb-5">
                    <span className="form-label">Gender <span className="text-red-600">*</span></span>
                    <div className="flex flex-wrap gap-2">
                      {["Male", "Female", "Transgender"].map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setGender(g)}
                          aria-pressed={gender === g}
                          className={gender === g ? "chip-active" : "chip-idle"}
                        >
                          {gender === g && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {missingDetails.includes("streetAddress") && (
                  <div className="mb-5">
                    <label className="form-label" htmlFor="streetAddr">
                      Your address <span className="text-red-600">*</span> <span className="normal-case text-ink-faint">(where you live, not the problem location)</span>
                    </label>
                    <input id="streetAddr" required className="form-input" value={streetAddress}
                      onChange={(e) => setStreetAddress(e.target.value)} />
                  </div>
                )}

                {missingDetails.includes("mobileNumber") && (
                  <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="form-label" htmlFor="cmobile">
                        Mobile number<span className="text-red-600">*</span>
                      </label>
                      <input id="cmobile" inputMode="numeric" maxLength={10} required className="form-input"
                        value={mobileNumber}
                        onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, ""))} />
                      <p className="form-hint">10 digits, so the department can reach you.</p>
                    </div>
                    <div>
                      <label className="form-label" htmlFor="cpincode">
                        Your PIN code <span className="normal-case text-ink-faint">(optional)</span>
                      </label>
                      <input id="cpincode" inputMode="numeric" maxLength={6} className="form-input"
                        value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {submitError && (
              <p className="form-error mt-4">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {submitError}
              </p>
            )}

            <div className="mt-7 flex justify-between border-t border-canvas-border pt-5">
              <Link href="/citizen" className="btn-secondary">Cancel</Link>
              <button
                type="button"
                disabled={savingProfile}
                className="btn-primary group"
                onClick={async () => {
                  const err = validateDetails();
                  if (err) { setSubmitError(err); return; }
                  await saveDetailsToProfile();
                  goToStep(2);
                }}
              >
                {savingProfile ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Saving&hellip;
                  </>
                ) : (
                  <>
                    Next: Location
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-spring group-hover:translate-x-0.5" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: LOCATION */}
        {step === 2 && (
          <div className="card animate-fade-up">
            <div className="mb-6 flex items-start gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy">
                <MapPin className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-ink">Complaint Location</h2>
                <p className="mt-0.5 text-sm text-ink-muted">Where exactly is the issue?</p>
              </div>
            </div>

            {/* ---- Map first: pinning fills in what it can ---- */}
            <div className="mb-6">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="form-label mb-0">Point to the problem on the map</span>
                <span className="text-xs text-ink-faint">Optional &mdash; you can type the details instead</span>
              </div>
              <MapPicker
                value={coords}
                onChange={handleMapSelection}
                footer={
                  <div className="mt-3">
                    {wardVerdict.status === "checking" && (
                      <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Checking which ward this falls in&hellip;
                      </p>
                    )}
                    {wardVerdict.status === "resolved" && (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
                        <p className="flex items-start gap-2 text-sm text-emerald-900">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" aria-hidden="true" />
                          <span>
                            Inside <span className="font-bold">Ward {wardVerdict.wardNumber}</span>
                            {wardVerdict.zoneName ? ` · ${wardVerdict.zoneName} zone` : ""}.
                            {wardVerdict.ambiguous && (
                              <>
                                {" "}The boundary data returns more than one ward here
                                {wardVerdict.candidateWards
                                  ? ` (${wardVerdict.candidateWards.join(", ")})`
                                  : ""}
                                , so please confirm the ward below.
                              </>
                            )}
                          </span>
                        </p>
                        <p className="mt-2 border-t border-emerald-200 pt-2 text-2xs leading-relaxed text-emerald-800">
                          Ward determined by point-in-polygon against{" "}
                          {wardVerdict.provenance.sourceLabel || "ward boundary data"}.
                          {!wardVerdict.provenance.official &&
                            " This is a community dataset, not an official Corporation publication — an officer confirms the ward during processing."}
                        </p>
                      </div>
                    )}
                    {wardVerdict.status === "outside_boundary" && (
                      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3.5">
                        <p className="flex items-start gap-2 text-sm text-red-800">
                          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                          <span>{wardVerdict.message}</span>
                        </p>
                      </div>
                    )}
                    {wardVerdict.status === "unavailable" && (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
                        <p className="flex items-start gap-2 text-sm text-amber-800">
                          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                          <span>
                            {wardVerdict.message} The pin is still saved with your complaint, and
                            the ward you select will be used as-is.
                          </span>
                        </p>
                      </div>
                    )}
                    {autofilled.size > 0 && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
                        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-ink-faint" aria-hidden="true" />
                        Filled in from the map: {Array.from(autofilled).join(", ")}. Check them below
                        and correct anything that looks wrong.
                      </p>
                    )}
                  </div>
                }
              />
            </div>

            {/* ---- Address details ---- */}
            <div className="mb-3 flex items-center gap-2 border-t border-canvas-border pt-5">
              <span className="text-sm font-bold text-ink">Address details</span>
              <span className="text-xs text-ink-faint">
                {coords ? "Confirm or correct these" : "Fill these in, or drop a pin above"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="form-label" htmlFor="zone">
                  Zone<span className="text-red-600">*</span>
                </label>
                <Combobox
                  id="zone"
                  required
                  noun="zone"
                  options={zones.map((z) => ({
                    value: String(z.id),
                    label: `Zone ${z.zone_number} \u2014 ${z.zone_name}`
                  }))}
                  value={zoneId}
                  onChange={setZoneId}
                  loading={zones.length === 0}
                />
                {autofilled.has("zone") && (
                  <p className="mt-1.5 inline-flex items-start gap-1.5 text-xs text-emerald-700">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    Set from the map pin.
                  </p>
                )}
              </div>

              {/* Street is typed in. GCC's street list covers only part of the
                  city and repeats names heavily, so a free text field is more
                  reliable than picking from it. */}
              <div>
                <label className="form-label" htmlFor="manualStreet">
                  Street<span className="text-red-600">*</span>
                </label>
                <input
                  id="manualStreet"
                  required
                  maxLength={255}
                  className="form-input"
                  placeholder="e.g. Gandhi Nagar 2nd Cross"
                  value={manualStreetName}
                  onChange={(e) => {
                    markEdited("manualStreetName");
                    setManualStreetName(e.target.value);
                  }}
                />
                <p className="form-hint">Street name only &mdash; pick the type separately.</p>
              </div>

              {true && (

                <div>
                  <label className="form-label" htmlFor="streetType">Street type</label>
                  <select
                    id="streetType"
                    className="form-input"
                    value={streetType}
                    onChange={(e) => setStreetType(e.target.value)}
                  >
                    <option value="">Select type (optional)</option>
                    {STREET_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="form-label" htmlFor="ward">
                  Ward<span className="text-red-600">*</span>
                </label>
                <Combobox
                  id="ward"
                  required
                  noun="ward"
                  options={wards.map((w) => ({
                    value: String(w.wardNumber),
                    // Number and zone together, so the ward is identifiable
                    // without knowing the numbering by heart.
                    label: `Ward ${w.wardNumber} — ${w.zoneName}`,
                    hint: `Zone ${w.zoneNumber}`
                  }))}
                  value={wardNumber}
                  onChange={(v) => {
                    setWardNumber(v);
                    setWardSource(v ? "user_selected" : "");
                  }}
                  loading={wards.length === 0}
                />
                {wardSource === "map_boundary" && selectedWard ? (
                  <p className="mt-1.5 inline-flex items-start gap-1.5 text-xs text-emerald-700">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    Determined from the map pin.
                  </p>
                ) : (
                  wardNotice && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-muted">
                      <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-ink-faint" aria-hidden="true" />
                      {wardNotice}
                    </p>
                  )
                )}
              </div>

              <div>
                <label className="form-label" htmlFor="locationPincode">
                  PIN code of this location <span className="normal-case text-ink-faint">(optional)</span>
                </label>
                <input
                  id="locationPincode"
                  inputMode="numeric"
                  maxLength={6}
                  className="form-input"
                  value={locationPincode}
                  onChange={(e) => {
                    markEdited("locationPincode");
                    setLocationPincode(e.target.value.replace(/\D/g, ""));
                  }}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="form-label" htmlFor="specificLoc">
                  Specific location <span className="normal-case text-ink-faint">(door no. / landmark)</span>
                </label>
                <input
                  id="specificLoc"
                  className="form-input"
                  value={specificLocation}
                  onChange={(e) => {
                    markEdited("specificLocation");
                    setSpecificLocation(e.target.value);
                  }}
                />
              </div>
            </div>

            {submitError && (
              <p className="form-error mt-4">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {submitError}
              </p>
            )}

            <div className="mt-7 flex justify-between border-t border-canvas-border pt-5">
              <button type="button" className="btn-secondary" onClick={() => goToStep(1)}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>
              <button
                type="button"
                className="btn-primary group"
                onClick={() => {
                  const err = validateLocation();
                  if (err) { setSubmitError(err); return; }
                  goToStep(3);
                }}
              >
                Next: Type
                <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-spring group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: DEPARTMENT + TYPE */}
        {step === 3 && (
          <div className="card animate-fade-up">
            <div className="mb-6 flex items-start gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy">
                <Building2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-ink">Complaint Type</h2>
                <p className="mt-0.5 text-sm text-ink-muted">
                  Choose one complaint type from the Corporation&apos;s official list.
                </p>
              </div>
            </div>

            <ComplaintTypeSelector
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              onSelectCategory={setSelectedCategoryId}
              otherDescription={otherDescription}
              onOtherDescriptionChange={setOtherDescription}
              selectedId={selectedSubtype ? selectedSubtype.id : null}
              loading={taxonomyLoading}
              source={taxonomySource}
              onSelect={(sub) => {
                setSelectedSubtype(sub);
                // Autofill the title from the chosen subcomplaint, but never
                // over a title the citizen has already written.
                if (sub && !titleEdited) setTitle(sub.label);
                if (!sub && !titleEdited) setTitle("");
              }}
            />

            {submitError && (
              <p className="form-error mt-4">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {submitError}
              </p>
            )}

            <div className="mt-7 flex justify-between border-t border-canvas-border pt-5">
              <button type="button" className="btn-secondary" onClick={() => goToStep(2)}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>
              <button
                type="button"
                className="btn-primary group"
                onClick={() => {
                  const err = validateType();
                  if (err) { setSubmitError(err); return; }
                  goToStep(4);
                }}
              >
                Next: Details
                <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-spring group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: COMPLAINT DETAILS */}
        {step === 4 && (
          <form className="card animate-fade-up" onSubmit={handleSubmit} noValidate>
            <div className="mb-6 flex items-start gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-ink">Complaint Details</h2>
                <p className="mt-0.5 text-sm text-ink-muted">Describe the issue and attach evidence.</p>
              </div>
            </div>

            <div className="mb-5">
              <label className="form-label" htmlFor="ctitle">Complaint Title</label>
              <input id="ctitle" required maxLength={200} className="form-input"
                placeholder="Short summary of the issue"
                value={title}
                onChange={(e) => {
                  // Editing the title detaches it from the complaint type, so
                  // changing the type later no longer overwrites these words.
                  setTitleEdited(true);
                  setTitle(e.target.value);
                }} />
              {selectedSubtype && !titleEdited && (
                <p className="form-hint">
                  Filled in from the complaint type you chose. Edit it freely &mdash; that will not
                  change the selected type.
                </p>
              )}
            </div>

            <div className="mb-5">
              <label className="form-label" htmlFor="cdesc">Details of Complaint</label>
              <textarea id="cdesc" required rows={5} maxLength={400} className="form-input"
                placeholder="What is the problem, since when, and how is it affecting people?"
                value={description} onChange={(e) => setDescription(e.target.value)} />
              <p className={`mt-1.5 text-right text-xs tabular-nums ${description.length > 360 ? "text-gold-600" : "text-ink-faint"}`}>
                {description.length}/400
              </p>
            </div>

            <div className="mb-5">
              <span className="form-label">Photograph / Video <span className="normal-case text-ink-faint">(optional, max 10MB)</span></span>
              {mediaFile ? (
                <div className="flex items-center gap-3 rounded-xl border border-navy-200 bg-navy-50 p-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white text-navy">
                    <ImagePlus className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{mediaFile.name}</p>
                    <p className="text-xs text-ink-subtle">{(mediaFile.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMediaFile(null)}
                    aria-label="Remove attachment"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-white hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="media"
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-canvas-border bg-canvas px-4 py-7 text-center transition-colors hover:border-navy-300 hover:bg-navy-50/50"
                >
                  <ImagePlus className="h-6 w-6 text-ink-faint" aria-hidden="true" />
                  <span className="text-sm font-medium text-ink-muted">
                    Click to upload a photo or video
                  </span>
                  <span className="text-xs text-ink-faint">JPG, PNG or MP4 &middot; up to 10MB</span>
                  <input id="media" type="file" accept="image/jpeg,image/png,video/mp4" className="sr-only"
                    onChange={(e) => setMediaFile(e.target.files?.[0] || null)} />
                </label>
              )}
            </div>

            <label className="mb-6 flex cursor-pointer items-start gap-3 rounded-xl border border-canvas-border bg-canvas p-3.5 text-sm text-ink-muted transition hover:border-navy-200">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-navy" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
              <span>
                <span className="font-medium text-ink">File anonymously</span> &mdash; your name and contact
                details will be hidden from department officers.
              </span>
            </label>

            {submitError && (
              <div role="alert" className="alert-error mb-5 animate-scale-in">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex justify-between border-t border-canvas-border pt-5">
              <button type="button" className="btn-secondary" onClick={() => goToStep(3)} disabled={submitting}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Submitting...
                  </>
                ) : (
                  <>
                    Submit Complaint
                    <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* STEP 5: CONFIRMATION */}
        {step === 5 && result && (
          <div className="card animate-scale-in text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/50">
              <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-bold text-ink">Complaint Registered</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
              Your complaint has been registered in the Public Grievance Redressal Portal of GCC. Use your
              Complaint Number to check its status at any time.
            </p>

            <div className="mx-auto mt-6 max-w-sm overflow-hidden rounded-2xl border border-canvas-border">
              <div className="border-b border-canvas-border bg-navy-50 px-5 py-4">
                <p className="text-2xs font-semibold uppercase tracking-wide text-navy-600">Complaint Number</p>
                <p className="mt-1 font-mono text-xl font-bold tracking-tight text-navy">{result.complaintCode}</p>
              </div>
              <dl className="grid grid-cols-2 divide-x divide-canvas-border bg-white text-left">
                <div className="px-5 py-3.5">
                  <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Department</dt>
                  <dd className="mt-0.5 text-sm font-medium text-ink">{result.department}</dd>
                </div>
                <div className="px-5 py-3.5">
                  <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">Type</dt>
                  <dd className="mt-0.5 text-sm font-medium text-ink">{result.complaintType}</dd>
                </div>
              </dl>
            </div>

            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/citizen/track-complaints" className="btn-primary group">
                Track Status
                <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-spring group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
              <button type="button" className="btn-secondary" onClick={resetForNewComplaint}>
                File Another Complaint
              </button>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
