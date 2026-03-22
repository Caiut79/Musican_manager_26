/**
 * AddressService
 *
 * Centralises OpenStreetMap Nominatim address-suggestion logic that was
 * previously duplicated in musician-form, concerts and dashboard components
 * (three near-identical implementations with their own AbortControllers).
 *
 * Usage:
 *   constructor(private address: AddressService) {}
 *
 *   // In template: (input)="onInput($event)"
 *   async onInput(query: string) {
 *     this.suggestions = await this.address.suggest(query);
 *   }
 *
 *   // Cancel any in-flight request when navigating away
 *   ngOnDestroy() { this.address.cancel(); }
 *
 * Coordinazione multi-componente:
 *   Each component should create its own service channel via `channel()` to
 *   ensure independent AbortController state when multiple components coexist.
 */
import { Injectable } from '@angular/core';
import { formatItalianAddressLabel, normalizeGeoText, provinceCodeFromAddressParts } from './italian-geo';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AddressSuggestion {
  label: string;
  city: string;
  province: string;
  address: string;
  lat: number;
  lon: number;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  importance: number;
  type: string;
  class: string;
  address: {
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    hamlet?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
  };
}

/** Minimum query length before hitting Nominatim. */
const MIN_QUERY_LENGTH = 3;

/** How many results to request from Nominatim. */
const RESULT_LIMIT = 8;

/**
 * Address types ranked by relevance for a musician's home-base / venue search.
 * Higher rank → appears first in results.
 */
const ADDRESS_TYPE_RANK: Record<string, number> = {
  road:            14,
  house:           14,
  residential:     14,
  street:          14,
  pedestrian:      13,
  path:            13,
  service:         13,
  unclassified:    13,
  track:           12,
  city:           10,
  town:            9,
  village:         8,
  hamlet:          8,
  municipality:    7,
  suburb:          6,
  neighbourhood:   5,
  administrative:  2,
};

// ─── AddressChannel — per-component instance ──────────────────────────────────

/**
 * An isolated channel that owns its own AbortController.
 * Components should call `this.address.channel()` once and keep the reference.
 */
export class AddressChannel {
  private controller: AbortController | null = null;

  constructor(private readonly service: AddressService) {}

  /**
   * Returns address suggestions for `query`.
   * Cancels any previous in-flight request automatically.
   * Returns `[]` for queries shorter than MIN_QUERY_LENGTH.
   */
  async suggest(query: string, options?: SuggestOptions): Promise<AddressSuggestion[]> {
    this.cancel();
    return this.service.suggest(query, { ...options, signal: this.signal() });
  }

  /** Cancel the current in-flight request (call in ngOnDestroy). */
  cancel(): void {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }

  private signal(): AbortSignal {
    this.controller = new AbortController();
    return this.controller.signal;
  }
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface SuggestOptions {
  /** ISO 3166-1 alpha-2 country codes to restrict results. Default: `['it']`. */
  countryCodes?: string[];
  /** Max number of results. Default: RESULT_LIMIT (8). */
  limit?: number;
  /** Passed internally by AddressChannel; components don't need to set this. */
  signal?: AbortSignal;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AddressService {
  /**
   * Factory: creates an independent AddressChannel with its own AbortController.
   * Each component that shows an address input should call this once.
   *
   * @example
   *   private readonly addrChannel = this.address.channel();
   *   ngOnDestroy() { this.addrChannel.cancel(); }
   */
  channel(): AddressChannel {
    return new AddressChannel(this);
  }

  /**
   * Low-level suggest — uses the provided AbortSignal (if any).
   * Prefer `AddressChannel.suggest()` in components so cancellation is automatic.
   */
  async suggest(query: string, options: SuggestOptions = {}): Promise<AddressSuggestion[]> {
    const q = (query || '').trim();
    if (q.length < MIN_QUERY_LENGTH) return [];

    const countryCodes = (options.countryCodes ?? ['it']).join(',');
    const limit        = options.limit ?? RESULT_LIMIT;

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q',              q);
    url.searchParams.set('format',         'json');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit',          String(limit));
    url.searchParams.set('countrycodes',   countryCodes);

    try {
      const res = await fetch(url.toString(), {
        signal: options.signal,
        headers: { 'Accept-Language': 'it' },
      });

      if (!res.ok) {
        console.warn('[AddressService] Nominatim HTTP', res.status);
        return [];
      }

      const raw: NominatimResult[] = await res.json();
      return this.rankAndMap(raw);
    } catch (err: any) {
      // AbortError is expected when the user keeps typing — not a real error.
      if (err?.name !== 'AbortError') {
        console.warn('[AddressService] suggest error:', err?.message ?? err);
      }
      return [];
    }
  }

  /**
   * Geocode a single free-text address.
   * Returns `null` when no match is found.
   */
  async geocode(address: string, options: SuggestOptions = {}): Promise<{ lat: number; lon: number } | null> {
    const results = await this.suggest(address, { ...options, limit: 1 });
    if (!results.length) return null;
    return { lat: results[0].lat, lon: results[0].lon };
  }

  /**
   * Geocode multiple addresses in parallel.
   * Entries that fail return `null` at their index.
   */
  async geocodeMany(
    addresses: string[],
    options: SuggestOptions = {}
  ): Promise<({ lat: number; lon: number } | null)[]> {
    return Promise.all(addresses.map(a => this.geocode(a, options)));
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private rankAndMap(results: NominatimResult[]): AddressSuggestion[] {
    return results
      .map(r => ({ result: r, score: this.rankScore(r) }))
      .sort((a, b) => b.score - a.score)
      .map(({ result: r }) => this.mapResult(r));
  }

  private rankScore(r: NominatimResult): number {
    const typeRank = ADDRESS_TYPE_RANK[r.type] ?? ADDRESS_TYPE_RANK[r.class] ?? 1;
    const importance = Number(r.importance || 0);
    // typeRank dominates; importance breaks ties within the same type
    return typeRank * 100 + importance * 10;
  }

  private mapResult(r: NominatimResult): AddressSuggestion {
    const a     = r.address;
    const city  = a.city || a.town || a.village || a.municipality || a.hamlet || a.county || '';
    const prov  = provinceCodeFromAddressParts(a);
    const road  = [a.road, a.house_number].filter(Boolean).join(' ').trim();
    const label = formatItalianAddressLabel({ address: a, name: city, addresstype: r.type, type: r.type, display_name: r.display_name }, normalizeGeoText);

    return {
      label: label || r.display_name,
      city,
      province: prov,
      address: road || label,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
    };
  }
}
