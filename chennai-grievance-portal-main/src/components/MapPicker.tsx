"use client";

/**
 * Complaint-location picker.
 *
 * Two providers behind one contract:
 *
 *   Google Maps  - used when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set. Adds
 *                  address search/autocomplete and reverse geocoding.
 *   Leaflet/OSM  - the fallback. Pin placement and dragging still work, and
 *                  ward/zone still resolve (that uses this app's own boundary
 *                  polygons, not a third party), but addresses are not looked
 *                  up, so the citizen types them.
 *
 * Invariants that matter:
 *
 *  - The pin is the complaint location. A reverse-geocode result may supply
 *    address TEXT, never coordinates: geocoders answer with the centre of a
 *    road or postcode, which would silently move the complaint off the spot
 *    the citizen marked.
 *  - Every async lookup carries the sequence number of the selection that
 *    started it. A response whose sequence is stale is dropped, so a slow
 *    reply for an old pin can never overwrite a newer one.
 *  - Geocoding runs on `dragend` / click / search commit, never on every
 *    intermediate position while the marker is moving.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Crosshair,
  Info,
  Loader2,
  MapPin,
  Search,
  X
} from "lucide-react";
import { CHENNAI_CENTER } from "@/lib/constants";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Address text a geocoder supplied. Any field may be missing. */
export interface ResolvedAddress {
  street?: string;
  locality?: string;
  area?: string;
  pincode?: string;
  formatted?: string;
}

export interface LocationSelection {
  coords: LatLng;
  address?: ResolvedAddress;
  /** How the citizen chose this point. */
  via: "map_click" | "marker_drag" | "search" | "geolocation" | "initial";
}

interface MapPickerProps {
  value: LatLng | null;
  onChange: (selection: LocationSelection) => void;
  /** Rendered under the map — used for the ward/serviceability verdict. */
  footer?: React.ReactNode;
}

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// Chennai-ish viewport. Used only to bias search results and to frame the
// initial view — never as a serviceability test. Whether a point is inside
// GCC is decided by point-in-polygon on the server.
const CHENNAI_VIEWPORT = {
  south: 12.83,
  west: 80.10,
  north: 13.25,
  east: 80.35
};

let googleLoader: Promise<void> | null = null;

function loadGoogleMaps(key: string): Promise<void> {
  if (googleLoader) return googleLoader;
  googleLoader = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if ((window as any).google?.maps?.places) return resolve();

    const script = document.createElement("script");
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&libraries=places&region=IN&language=en`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Google Maps failed to load. Check the API key and its restrictions."));
    document.head.appendChild(script);
  });
  return googleLoader;
}

/** Maps Google address components onto the fields this form collects. */
function addressFromComponents(components: any[]): ResolvedAddress {
  const get = (type: string) => components.find((c) => c.types.includes(type))?.long_name;
  return {
    street: get("route"),
    locality:
      get("sublocality_level_1") || get("sublocality") || get("neighborhood") || undefined,
    area: get("locality") || get("administrative_area_level_3") || undefined,
    pincode: get("postal_code")
  };
}

export default function MapPicker({ value, onChange, footer }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);

  /**
   * Incremented on every new selection. An in-flight geocode compares its
   * captured value against this before applying anything.
   */
  const selectionSeq = useRef(0);

  const [provider, setProvider] = useState<"google" | "leaflet" | "loading">("loading");
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [searchText, setSearchText] = useState("");

  // Keep the latest onChange without making the map effect depend on it.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  /** Commits a selection, bumping the sequence so older lookups are ignored. */
  const commit = useCallback((coords: LatLng, via: LocationSelection["via"], address?: ResolvedAddress) => {
    selectionSeq.current += 1;
    onChangeRef.current({ coords, via, address });
    return selectionSeq.current;
  }, []);

  /** Reverse geocode for address TEXT only. Never touches the coordinates. */
  const reverseGeocode = useCallback((coords: LatLng, seq: number) => {
    if (!geocoderRef.current) return;
    setGeocoding(true);
    geocoderRef.current.geocode({ location: coords }, (results: any[], status: string) => {
      setGeocoding(false);
      // The citizen has moved on; this answer is for a location they no
      // longer have selected.
      if (seq !== selectionSeq.current) return;

      if (status !== "OK" || !results || results.length === 0) {
        setProviderNote(
          status === "ZERO_RESULTS"
            ? "No street address was found for that point. You can type the address yourself."
            : "Address lookup did not respond. The pin is still saved — you can type the address yourself."
        );
        return;
      }
      setProviderNote(null);
      const address = addressFromComponents(results[0].address_components || []);
      address.formatted = results[0].formatted_address;
      // Re-commit with address text, keeping the coordinates already chosen.
      selectionSeq.current = seq;
      onChangeRef.current({ coords, via: "map_click", address });
    });
  }, []);

  // ---------------------------------------------------------------- Google
  useEffect(() => {
    if (!GOOGLE_KEY) {
      setProvider("leaflet");
      setProviderNote(
        "Google Maps is not configured, so address search and automatic address fill are off. " +
          "Place the pin on the map and enter the address fields yourself."
      );
      return;
    }

    let cancelled = false;
    loadGoogleMaps(GOOGLE_KEY)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const g = (window as any).google;
        const start = value || CHENNAI_CENTER;

        const map = new g.maps.Map(containerRef.current, {
          center: start,
          zoom: value ? 17 : 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "greedy"
        });
        mapRef.current = map;
        geocoderRef.current = new g.maps.Geocoder();

        const marker = new g.maps.Marker({
          position: start,
          map,
          draggable: true,
          title: "Complaint location"
        });
        markerRef.current = marker;

        // Only on dragend — not on drag — so one gesture costs one lookup.
        marker.addListener("dragend", () => {
          const p = marker.getPosition();
          const coords = { lat: p.lat(), lng: p.lng() };
          const seq = commit(coords, "marker_drag");
          reverseGeocode(coords, seq);
        });

        map.addListener("click", (e: any) => {
          const coords = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          marker.setPosition(coords);
          const seq = commit(coords, "map_click");
          reverseGeocode(coords, seq);
        });

        if (searchInputRef.current) {
          const ac = new g.maps.places.Autocomplete(searchInputRef.current, {
            fields: ["geometry", "address_components", "formatted_address", "name"],
            componentRestrictions: { country: "in" },
            bounds: new g.maps.LatLngBounds(
              { lat: CHENNAI_VIEWPORT.south, lng: CHENNAI_VIEWPORT.west },
              { lat: CHENNAI_VIEWPORT.north, lng: CHENNAI_VIEWPORT.east }
            )
          });
          autocompleteRef.current = ac;
          ac.addListener("place_changed", () => {
            const place = ac.getPlace();
            if (!place?.geometry?.location) {
              setProviderNote("Pick a suggestion from the list, or click the map instead.");
              return;
            }
            // A chosen search result IS an explicit location choice, so it
            // becomes the pin. Its own address components are used directly —
            // no second lookup, and nothing stale can arrive later.
            const coords = {
              lat: place.geometry.location.lat(),
              lng: place.geometry.location.lng()
            };
            const address = addressFromComponents(place.address_components || []);
            address.formatted = place.formatted_address || place.name;
            marker.setPosition(coords);
            map.setCenter(coords);
            map.setZoom(17);
            setProviderNote(null);
            commit(coords, "search", address);
          });
        }

        setProvider("google");
        setProviderNote(null);
        if (!value) commit(start, "initial");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setProvider("leaflet");
        setProviderNote(
          err.message + " Falling back to the OpenStreetMap picker — you can still place the pin."
        );
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------------------------------------- Leaflet
  useEffect(() => {
    if (provider !== "leaflet") return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
      });

      const start = value || CHENNAI_CENTER;
      const map = L.map(containerRef.current).setView([start.lat, start.lng], value ? 16 : 13);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);

      const marker = L.marker([start.lat, start.lng], { draggable: true }).addTo(map);
      markerRef.current = marker;

      marker.on("dragend", () => {
        const p = marker.getLatLng();
        commit({ lat: p.lat, lng: p.lng }, "marker_drag");
      });
      map.on("click", (e: any) => {
        marker.setLatLng(e.latlng);
        commit({ lat: e.latlng.lat, lng: e.latlng.lng }, "map_click");
      });

      if (!value) commit(start, "initial");
    })();

    return () => {
      cancelled = true;
      if (mapRef.current && provider === "leaflet") {
        mapRef.current.remove?.();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoError("This browser cannot report your location. Place the pin on the map instead.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocating(false);
        const seq = commit(coords, "geolocation");
        if (provider === "google" && mapRef.current && markerRef.current) {
          markerRef.current.setPosition(coords);
          mapRef.current.setCenter(coords);
          mapRef.current.setZoom(17);
          reverseGeocode(coords, seq);
        } else if (mapRef.current && markerRef.current) {
          mapRef.current.setView([coords.lat, coords.lng], 16);
          markerRef.current.setLatLng([coords.lat, coords.lng]);
        }
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was declined. Place the pin on the map instead."
            : err.code === err.POSITION_UNAVAILABLE
            ? "Your location could not be determined. Place the pin on the map instead."
            : "Getting your location timed out. Place the pin on the map instead."
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  return (
    <div>
      {/* Search — Google only */}
      {provider === "google" && (
        <div className="group relative mb-2.5">
          <span className="input-affix group-focus-within:text-navy-500">
            <Search className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search for a street, landmark or area in Chennai"
            aria-label="Search for the complaint location"
            className="form-input pl-10 pr-10"
            onKeyDown={(e) => {
              // Enter would otherwise submit the complaint form.
              if (e.key === "Enter") e.preventDefault();
            }}
          />
          {searchText && (
            <button
              type="button"
              onClick={() => {
                setSearchText("");
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-faint transition hover:text-navy"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {provider === "google"
            ? "Search, click the map, or drag the pin to mark where the problem is."
            : "Click the map or drag the pin to mark where the problem is."}
        </p>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="inline-flex items-center gap-1.5 rounded-xl border border-navy-600 px-3 py-1.5 text-xs font-semibold text-navy transition hover:bg-navy-50 disabled:opacity-60"
        >
          {locating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {locating ? "Locating…" : "Use my location"}
        </button>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          style={{ height: "340px" }}
          className="overflow-hidden rounded-2xl border border-canvas-border bg-canvas"
        />
        {provider === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-canvas/80">
            <Loader2 className="h-5 w-5 animate-spin text-navy" aria-hidden="true" />
          </div>
        )}
        {geocoding && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-medium text-ink-muted shadow-soft">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Looking up the address…
          </span>
        )}
      </div>

      {value && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-ink-muted">
          <MapPin className="h-4 w-4 text-navy" aria-hidden="true" />
          Pin:{" "}
          <span className="font-mono text-ink">
            {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
          </span>
        </p>
      )}

      {geoError && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-amber-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {geoError}
        </p>
      )}
      {providerNote && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-muted">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-faint" aria-hidden="true" />
          {providerNote}
        </p>
      )}

      {footer}
    </div>
  );
}
