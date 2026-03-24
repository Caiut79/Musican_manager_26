import { Component, OnInit, AfterViewInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormArray, FormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import { Expense, ExpenseExtra } from '../../models/expense';
import { EventDetail } from '../../models/event-detail';
import { SupabaseService } from '../../core/supabase.service';
import { formatItalianAddressLabel, italianAddressTypeScore, provinceCodeFromAddressLabel, provinceCodeFromText, normalizeGeoText } from '../../core/italian-geo';

type ItineraryOption = {
  id: string;
  label: string;
  distanceKm: number;
  durationMin: number;
  motorwayKm: number;
  tollOneWay: number | null;
  tollRoundTrip: number | null;
  tollProvider: 'stima';
  tollBoothsCount: number | null;
  motorwaySegments: TollSegment[];
  geometry: [number, number][];
};

type ExpenseCalculationResult = {
  distanceKm: number;
  durationMin: number;
  routeLabel: string;
  fuelCostPerKm: number;
  totalFuel: number;
  totalExtras: number;
  tollOneWay: number | null;
  tollRoundTrip: number | null;
  tollProvider: 'stima';
  tollBoothsCount: number | null;
  total: number;
};

type AddressField = 'origin' | 'destination';
type MapThemeId = 'light' | 'street' | 'dark' | 'satellite' | 'topo';
type RouteColorId = 'violet' | 'blue' | 'emerald' | 'red' | 'amber';
type ConsumptionMode = 'l_100km' | 'km_l' | 'l_km';

// ─── Toll segment for manual toll calculator ─────────────────────────────────
type TollSegment = {
  id: string;
  motorwayRef: string;
  entryBooth: string;
  exitBooth: string;
  kmMotorway: number;
  manualCost: number | null;  // null = use auto-estimate
};

// ─── Italian highway rates per vehicle class (€/km) ─────────────────────────
const TOLL_RATES: Record<string, { label: string; ratePerKm: number }> = {
  '2AxlesAuto': { label: 'Auto 2 assi',  ratePerKm: 0.085 },
  '2AxlesMoto': { label: 'Moto',         ratePerKm: 0.042 },
  '2AxlesTruck':{ label: 'Furgone ≤3.5t',ratePerKm: 0.124 },
  '3AxlesTruck':{ label: 'Camion 3 assi',ratePerKm: 0.155 },
  '4AxlesTruck':{ label: 'Camion 4 assi',ratePerKm: 0.180 },
};

@Component({
  selector: 'app-expenses',
  templateUrl: './expenses.component.html',
  styleUrls: ['./expenses.component.scss']
})
export class ExpensesComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapEl!: ElementRef;

  form!: FormGroup;
  expenses: Expense[] = [];
  calculating = false;
  calcError = '';
  result: ExpenseCalculationResult | null = null;
  itineraryOptions: ItineraryOption[] = [];
  selectedItineraryId = '';
  destCoords: [number, number] | null = null;
  originCoords: [number, number] | null = null;
  validWaypointCoords: [number, number][] = [];
  mapWaypointPickMode = false;
  showPedaggiPopup = false;
  pedaggiEntry = '';
  pedaggiExit = '';
  pedaggiCostValue: number | null = null;

  tollSegments: TollSegment[] = [];
  tollVehicleType = '2AxlesAuto';
  originSuggestions: string[] = [];
  destinationSuggestions: string[] = [];
  waypointSuggestions: string[] = [];
  activeAddressField: AddressField | null = null;
  activeWaypointIndex: number | null = null;
  fromConcertFlow = false;
  fromDashboardFlow = false;
  showAssignEventModal = false;
  assignTargetExpenseId = '';
  assignSelectedEventId = '';
  assignSuggestedEventId = '';
  assignEvents: EventDetail[] = [];
  selectedMapTheme: MapThemeId = 'light';
  selectedRouteColor: RouteColorId = 'violet';
  readonly mapThemeOptions: { id: MapThemeId; label: string }[] = [
    { id: 'light', label: 'Chiara moderna' },
    { id: 'street', label: 'Stradale classica' },
    { id: 'dark', label: 'Scura notte' },
    { id: 'satellite', label: 'Satellite' },
    { id: 'topo', label: 'Topografica' }
  ];
  readonly routeColorOptions: { id: RouteColorId; label: string; hex: string }[] = [
    { id: 'violet', label: 'Viola', hex: '#7c3aed' },
    { id: 'blue', label: 'Blu', hex: '#2563eb' },
    { id: 'emerald', label: 'Verde', hex: '#059669' },
    { id: 'red', label: 'Rosso', hex: '#e11d48' },
    { id: 'amber', label: 'Ambra', hex: '#d97706' }
  ];

  private map!: L.Map;
  private mapTileLayer?: L.TileLayer;
  private markerOrigin?: L.Marker;
  private markerDest?: L.Marker;
  private routeLine?: L.Polyline;
  private waypointMarkers: L.Marker[] = [];
  private draftWaypointMarkers: L.Marker[] = [];
  private addressSearchTimers: Partial<Record<AddressField, ReturnType<typeof setTimeout>>> = {};
  private addressSearchAborters: Partial<Record<AddressField, AbortController>> = {};
  private waypointTimer: ReturnType<typeof setTimeout> | null = null;
  private waypointAborter: AbortController | null = null;

  constructor(private fb: FormBuilder, private supabase: SupabaseService, private route: ActivatedRoute, private router: Router) {}

  ngOnInit() {
    this.expenses = this.normalizeStoredExpenses(JSON.parse(localStorage.getItem('mm_expenses') || '[]'));
    const profileSnapshot = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const homeBaseRaw = `${localStorage.getItem('mm_homeBase') || profileSnapshot?.homeBase || profileSnapshot?.residence || ''}`.trim();
    const homeBase = this.normalizeAddressTextForUi(homeBaseRaw);
    const profileFuelType = `${profileSnapshot?.vehicleFuelType || localStorage.getItem('mm_vehicle_fuel_type') || 'benzina'}`.trim().toLowerCase();
    const profileVehicleModel = `${profileSnapshot?.vehicleModel || localStorage.getItem('mm_vehicle_model') || ''}`.trim();
    const priceFallbackByFuel: Record<string, number> = {
      benzina: 1.86, diesel: 1.76, gpl: 0.76, metano: 1.52, ibrido: 1.84, elettrico: 0.62, altro: 1.85
    };
    const defaultPriceByFuel = priceFallbackByFuel[profileFuelType] ?? 1.85;
    const savedPrice       = parseFloat(localStorage.getItem('mm_fuelPricePerLiter') || `${defaultPriceByFuel}`);
    let savedConsumption = this.parseDecimalInput(localStorage.getItem('mm_vehicleConsumption') || profileSnapshot?.vehicleConsumption || 7.0);
    let savedConsumptionMode = `${localStorage.getItem('mm_vehicle_consumption_mode') || profileSnapshot?.vehicleConsumptionMode || 'l_100km'}` as ConsumptionMode;
    if (savedConsumptionMode === 'l_km') {
      savedConsumption = Number.isFinite(savedConsumption) ? +(savedConsumption * 100).toFixed(1) : 0;
      savedConsumptionMode = 'l_100km';
      localStorage.setItem('mm_vehicle_consumption_mode', 'l_100km');
      localStorage.setItem('mm_vehicleConsumption', String(savedConsumption));
    }
    const savedVehicleType = localStorage.getItem('mm_toll_vehicle_type') || localStorage.getItem('mm_tollguru_vehicle_type') || '2AxlesAuto';
    this.tollVehicleType   = savedVehicleType;
    const storedTheme = `${localStorage.getItem('mm_expenses_map_theme') || ''}` as MapThemeId;
    const rawStoredRouteColor = `${localStorage.getItem('mm_expenses_route_color') || ''}`;
    const storedRouteColor = (rawStoredRouteColor === 'rose' ? 'red' : rawStoredRouteColor) as RouteColorId;
    if (this.mapThemeOptions.some(x => x.id === storedTheme)) this.selectedMapTheme = storedTheme;
    if (this.routeColorOptions.some(x => x.id === storedRouteColor)) this.selectedRouteColor = storedRouteColor;

    this.form = this.fb.group({
      origin:             [homeBase, Validators.required],
      waypoints:          this.fb.array([]),
      destination:        ['', Validators.required],
      vehicleModel:       [profileVehicleModel],
      vehicleFuelType:    [profileFuelType || 'benzina'],
      vehicleConsumptionMode: [savedConsumptionMode === 'km_l' ? 'km_l' : 'l_100km'],
      fuelPricePerLiter:  [savedPrice,       [Validators.required, Validators.min(0)]],
      vehicleConsumption: [savedConsumption, [Validators.required, Validators.min(0)]],
      extras: this.fb.array([]),
    });
    this.applyExpenseSourceContext();
  }

  ngAfterViewInit() {
    this.initMap();
  }

  ngOnDestroy() {
    (['origin', 'destination'] as AddressField[]).forEach(field => {
      const timer = this.addressSearchTimers[field];
      if (timer) clearTimeout(timer);
      this.addressSearchAborters[field]?.abort();
    });
    if (this.waypointTimer) clearTimeout(this.waypointTimer);
    this.waypointAborter?.abort();
    if (this.map) { this.map.remove(); }
  }

  private initMap() {
    const iconDefault = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41], iconAnchor: [12, 41],
    });
    L.Marker.prototype.options.icon = iconDefault;
    this.map = L.map(this.mapEl.nativeElement, {
      worldCopyJump: true,
      minZoom: 2
    }).setView([46.5, 8.5], 5);
    this.applyMapTheme();
    this.map.on('click', (event: L.LeafletMouseEvent) => {
      if (!this.mapWaypointPickMode) return;
      void this.addWaypointFromMap(event.latlng.lat, event.latlng.lng);
    });
  }

  onMapThemeChange(theme: MapThemeId): void {
    this.selectedMapTheme = theme;
    localStorage.setItem('mm_expenses_map_theme', theme);
    this.applyMapTheme();
  }

  onRouteColorChange(colorId: RouteColorId): void {
    this.selectedRouteColor = colorId;
    localStorage.setItem('mm_expenses_route_color', colorId);
    this.routeLine?.setStyle({ color: this.routeColorHex, opacity: 0.92 });
  }

  get routeColorHex(): string {
    return this.routeColorOptions.find(x => x.id === this.selectedRouteColor)?.hex || '#7c3aed';
  }

  // ─── Form arrays ───────────────────────────────────────────────────────────
  get extrasArray(): FormArray {
    return this.form.get('extras') as FormArray;
  }

  get waypointsArray(): FormArray {
    return this.form.get('waypoints') as FormArray;
  }

  addExtra() {
    this.extrasArray.push(this.fb.group({
      label:  ['', Validators.required],
      amount: [0, [Validators.required, Validators.min(0)]],
    }));
  }

  removeExtra(i: number) { this.extrasArray.removeAt(i); }

  addWaypoint() {
    if (this.waypointsArray.length >= 5) return;
    this.waypointsArray.push(new FormControl(''));
    this.renderDraftWaypointMarkers();
  }

  removeWaypoint(i: number) {
    this.waypointsArray.removeAt(i);
    if (this.activeWaypointIndex === i) {
      this.activeWaypointIndex = null;
      this.waypointSuggestions = [];
    } else if (this.activeWaypointIndex !== null && this.activeWaypointIndex > i) {
      this.activeWaypointIndex -= 1;
    }
    this.renderDraftWaypointMarkers();
  }

  onWaypointFocus(index: number): void {
    this.activeWaypointIndex = index;
    const value = `${this.waypointsArray.at(index)?.value || ''}`.trim();
    if (value.length >= 2) this.onWaypointInput(index, value);
  }

  onWaypointInput(index: number, rawValue: string): void {
    this.activeWaypointIndex = index;
    const value = `${rawValue || ''}`.trim();
    if (this.waypointTimer) clearTimeout(this.waypointTimer);
    if (value.length < 2) {
      this.waypointSuggestions = [];
      return;
    }
    this.waypointTimer = setTimeout(() => {
      void this.fetchWaypointSuggestions(index, value);
    }, 220);
  }

  onWaypointBlur(index: number): void {
    setTimeout(() => {
      if (this.activeWaypointIndex === index) this.activeWaypointIndex = null;
      this.waypointSuggestions = [];
    }, 160);
  }

  selectWaypointSuggestion(index: number, value: string): void {
    this.waypointsArray.at(index)?.setValue(value);
    this.activeWaypointIndex = null;
    this.waypointSuggestions = [];
    this.renderDraftWaypointMarkers();
  }

  // ─── Calculate ─────────────────────────────────────────────────────────────
  async calculate() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.calculating = true;
    this.calcError = '';
    this.result = null;
    this.itineraryOptions = [];
    this.selectedItineraryId = '';
    this.validWaypointCoords = [];

    try {
      const v = this.form.value;
      const waypointAddresses: string[] = (v.waypoints as string[]).map(w => `${w || ''}`.trim()).filter(Boolean);

      const [oCoords, dCoords, ...wpResults] = await Promise.all([
        this.geocode(v.origin),
        this.geocode(v.destination),
        ...waypointAddresses.map(addr => this.geocode(addr)),
      ]);

      if (!oCoords) throw new Error(`Indirizzo di partenza non trovato: "${v.origin}"`);
      if (!dCoords) throw new Error(`Destinazione non trovata: "${v.destination}"`);

      this.originCoords = oCoords;
      this.destCoords   = dCoords;
      this.validWaypointCoords = (wpResults as ([number, number] | null)[]).filter((c): c is [number, number] => c !== null);

      const fuelCostPerKm = this.computeFuelCostPerKm(this.parseDecimalInput(v.vehicleConsumption), this.parseDecimalInput(v.fuelPricePerLiter), `${v.vehicleConsumptionMode || 'l_100km'}` as ConsumptionMode);
      const totalExtras   = (v.extras as ExpenseExtra[]).reduce((s, e) => s + (+e.amount || 0), 0);
      const routeOptions  = await this.fetchRouteAlternatives(oCoords, dCoords, this.validWaypointCoords);
      this.itineraryOptions = routeOptions.length ? routeOptions : [this.createFallbackItinerary(oCoords, dCoords)];
      const initial = this.itineraryOptions[0];
      this.applyItinerary(initial.id, fuelCostPerKm, totalExtras);

      localStorage.setItem('mm_fuelPricePerLiter',  String(v.fuelPricePerLiter));
      localStorage.setItem('mm_vehicleConsumption', String(v.vehicleConsumption));
      localStorage.setItem('mm_vehicle_consumption_mode', String(v.vehicleConsumptionMode || 'l_100km'));
      localStorage.setItem('mm_vehicle_fuel_type', String(v.vehicleFuelType || 'benzina'));
      localStorage.setItem('mm_vehicle_model', String(v.vehicleModel || ''));
      localStorage.setItem('mm_toll_vehicle_type', String(this.tollVehicleType || '2AxlesAuto'));

    } catch (e: unknown) {
      this.calcError = e instanceof Error ? e.message : 'Errore nel calcolo';
    } finally {
      this.calculating = false;
    }
  }

  selectItinerary(itineraryId: string): void {
    if (!this.itineraryOptions.length) return;
    const v = this.form.value;
    const fuelCostPerKm = this.computeFuelCostPerKm(this.parseDecimalInput(v.vehicleConsumption), this.parseDecimalInput(v.fuelPricePerLiter), `${v.vehicleConsumptionMode || 'l_100km'}` as ConsumptionMode);
    const totalExtras   = (v.extras as ExpenseExtra[]).reduce((s, e) => s + (+e.amount || 0), 0);
    this.applyItinerary(itineraryId, fuelCostPerKm, totalExtras);
  }

  get consumptionLabel(): string {
    return this.isKmPerLiterMode ? 'Consumo medio (km/l)' : 'Consumo medio (l/100 km)';
  }

  get consumptionStep(): string {
    return this.isKmPerLiterMode ? '0.5' : '0.1';
  }

  get consumptionPlaceholder(): string {
    return this.isKmPerLiterMode ? 'es. 16.5' : 'es. 6.2';
  }

  get isKmPerLiterMode(): boolean {
    return `${this.form?.value?.vehicleConsumptionMode || 'l_100km'}` === 'km_l';
  }

  onConsumptionModeChange(nextMode: ConsumptionMode): void {
    const currentMode = `${this.form.value.vehicleConsumptionMode || 'l_100km'}` as ConsumptionMode;
    const raw = this.parseDecimalInput(this.form.value.vehicleConsumption);
    this.form.patchValue({ vehicleConsumptionMode: nextMode }, { emitEvent: false });
    if (!Number.isFinite(raw) || raw <= 0) return;
    const normalizedCurrent: 'l_100km' | 'km_l' = currentMode === 'km_l' ? 'km_l' : 'l_100km';
    const normalizedNext: 'l_100km' | 'km_l' = nextMode === 'km_l' ? 'km_l' : 'l_100km';
    if (normalizedCurrent === normalizedNext) return;
    const converted = 100 / raw;
    if (!Number.isFinite(converted) || converted <= 0) return;
    this.form.patchValue({ vehicleConsumption: +converted.toFixed(normalizedNext === 'km_l' ? 2 : 1) }, { emitEvent: false });
  }

  private computeFuelCostPerKm(consumptionValue: number, fuelPricePerLiter: number, mode: ConsumptionMode): number {
    const c = this.parseDecimalInput(consumptionValue);
    const p = this.parseDecimalInput(fuelPricePerLiter);
    if (!Number.isFinite(c) || !Number.isFinite(p) || c <= 0 || p <= 0) return 0;
    if (mode === 'km_l') {
      return +(p / c).toFixed(3);
    }
    if (mode === 'l_km') return +(c * p).toFixed(3);
    return +((c / 100) * p).toFixed(3);
  }

  private parseDecimalInput(value: unknown): number {
    if (typeof value === 'number') return value;
    const normalized = `${value || ''}`.trim().replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }

  private async geocode(query: string): Promise<[number, number] | null> {
    const parsed = this.parseCoordinatesFromText(query);
    if (parsed) return parsed;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&countrycodes=it&addressdetails=1`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'it' } });
    const data = await res.json();
    if (!data.length) return null;
    const ranked = this.rankNominatimRows(data, query);
    const best = ranked[0]?.row || data[0];
    return [parseFloat(best.lat), parseFloat(best.lon)];
  }

  onAddressInput(field: AddressField, value: string): void {
    this.queueAddressSuggestions(field, value);
  }

  onAddressFocus(field: AddressField): void {
    const value = `${this.form.get(field)?.value || ''}`;
    this.queueAddressSuggestions(field, value);
  }

  onAddressBlur(field: AddressField): void {
    const current = `${this.form.get(field)?.value || ''}`.trim();
    if (current) this.form.get(field)?.setValue(this.normalizeAddressTextForUi(current), { emitEvent: false });
    setTimeout(() => {
      if (this.activeAddressField === field) this.activeAddressField = null;
      this.clearAddressSuggestions(field);
    }, 160);
  }

  selectAddressSuggestion(field: AddressField, suggestion: string): void {
    this.form.get(field)?.setValue(this.normalizeAddressTextForUi(suggestion));
    this.activeAddressField = null;
    this.clearAddressSuggestions(field);
  }

  private queueAddressSuggestions(field: AddressField, rawValue: string): void {
    const value = `${rawValue || ''}`.trim();
    const timer = this.addressSearchTimers[field];
    if (timer) clearTimeout(timer);
    if (value.length < 2) {
      this.clearAddressSuggestions(field);
      return;
    }
    this.activeAddressField = field;
    this.addressSearchTimers[field] = setTimeout(() => {
      void this.fetchAddressSuggestions(field, value);
    }, 220);
  }

  private async fetchAddressSuggestions(field: AddressField, query: string): Promise<void> {
    this.addressSearchAborters[field]?.abort();
    const controller = new AbortController();
    this.addressSearchAborters[field] = controller;
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&countrycodes=it&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'it' },
        signal: controller.signal
      });
      if (!res.ok) return;
      const rows = await res.json();
      const currentValue = `${this.form.get(field)?.value || ''}`.trim();
      if (this.normalizeAddressText(currentValue) !== this.normalizeAddressText(query)) return;
      const suggestions = this.rankNominatimRows(rows, query).slice(0, 6).map(x => x.label);
      if (field === 'origin') this.originSuggestions = suggestions;
      else this.destinationSuggestions = suggestions;
    } catch (error: any) {
      if (error?.name !== 'AbortError') this.clearAddressSuggestions(field);
    }
  }

  private clearAddressSuggestions(field: AddressField): void {
    if (field === 'origin') this.originSuggestions = [];
    else this.destinationSuggestions = [];
  }

  private normalizeAddressText(value: string): string {
    return `${value || ''}`.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private async fetchWaypointSuggestions(index: number, query: string): Promise<void> {
    this.waypointAborter?.abort();
    const controller = new AbortController();
    this.waypointAborter = controller;
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&countrycodes=it&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'it' },
        signal: controller.signal
      });
      if (!res.ok) return;
      const rows = await res.json();
      const currentValue = `${this.waypointsArray.at(index)?.value || ''}`.trim();
      if (this.normalizeAddressText(currentValue) !== this.normalizeAddressText(query)) return;
      if (this.activeWaypointIndex !== index) return;
      this.waypointSuggestions = this.rankNominatimRows(rows, query).slice(0, 6).map(x => x.label);
    } catch (error: any) {
      if (error?.name !== 'AbortError') this.waypointSuggestions = [];
    }
  }

  loadExpenseIntoConcert(): void {
    if (!this.result) return;
    const payload = {
      totalExpense: Number(this.result.total || 0),
      distanceKm: Number(this.result.distanceKm || 0),
      totalFuel: Number(this.result.totalFuel || 0),
      totalExtras: Number(this.result.totalExtras || 0),
      tollRoundTrip: Number(this.result.tollRoundTrip || 0),
      origin: `${this.form.value.origin || ''}`.trim(),
      destination: `${this.form.value.destination || ''}`.trim(),
      createdAt: new Date().toISOString()
    };
    if (this.fromDashboardFlow) {
      const contextRaw = localStorage.getItem('mm_dashboard_expense_context');
      if (!contextRaw) return;
      localStorage.setItem('mm_dashboard_expense_result', JSON.stringify(payload));
      this.router.navigate(['/dashboard'], { queryParams: { fromExpense: 'dashboard' } });
      return;
    }
    const contextRaw = localStorage.getItem('mm_concert_expense_context');
    if (!contextRaw) return;
    localStorage.setItem('mm_concert_expense_result', JSON.stringify(payload));
    this.router.navigate(['/concerts'], { queryParams: { fromExpense: '1' } });
  }

  private applyExpenseSourceContext(): void {
    const isFromConcert = this.route.snapshot.queryParamMap.get('fromConcert') === '1';
    const isFromDashboard = this.route.snapshot.queryParamMap.get('fromDashboard') === '1';
    this.fromConcertFlow = isFromConcert;
    this.fromDashboardFlow = isFromDashboard;
    if (!isFromConcert && !isFromDashboard) return;
    const contextKey = isFromDashboard ? 'mm_dashboard_expense_context' : 'mm_concert_expense_context';
    const contextRaw = localStorage.getItem(contextKey);
    if (!contextRaw) return;
    const context = JSON.parse(contextRaw || '{}');
    const draft = context?.draft || {};
    const destination = this.normalizeAddressTextForUi(`${draft.address || draft.venue || ''}`.trim());
    if (!destination) return;
    const origin = this.normalizeAddressTextForUi(`${this.form.get('origin')?.value || ''}`.trim());
    this.form.patchValue({ origin, destination });
  }

  private rankNominatimRows(rows: any[], query: string): Array<{ row: any; label: string; score: number }> {
    const normalizedQuery = this.normalizeAddressText(query);
    const seen = new Set<string>();
    const ranked: Array<{ row: any; label: string; score: number }> = [];
    for (const row of rows) {
      const label = this.formatNominatimLabel(row);
      const key = this.normalizeAddressText(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const addresstype = `${row?.addresstype || row?.type || ''}`.toLowerCase();
      const importance = Number(row?.importance || 0);
      let score = this.addressTypeScore(addresstype) + Math.max(0, Math.min(30, importance * 30));
      if (key.startsWith(normalizedQuery)) score += 40;
      else if (key.includes(normalizedQuery)) score += 20;
      ranked.push({ row, label, score });
    }
    return ranked.sort((a, b) => b.score - a.score);
  }

  private formatNominatimLabel(row: any): string {
    return formatItalianAddressLabel(row, value => this.normalizeAddressText(value));
  }

  private addressTypeScore(addresstype: string): number {
    return italianAddressTypeScore(addresstype);
  }

  toggleMapWaypointPick(): void {
    if (this.waypointsArray.length >= 5 && !this.mapWaypointPickMode) return;
    this.mapWaypointPickMode = !this.mapWaypointPickMode;
    if (!this.mapWaypointPickMode) this.renderDraftWaypointMarkers();
  }

  private async addWaypointFromMap(lat: number, lon: number): Promise<void> {
    if (this.waypointsArray.length >= 5) {
      this.mapWaypointPickMode = false;
      return;
    }
    this.addWaypoint();
    const index = this.waypointsArray.length - 1;
    const label = await this.reverseGeocode([lat, lon]);
    const value = `${lat.toFixed(6)}, ${lon.toFixed(6)}${label ? ` - ${label}` : ''}`;
    this.waypointsArray.at(index).setValue(value);
    this.mapWaypointPickMode = false;
    this.renderDraftWaypointMarkers();
  }

  private async reverseGeocode([lat, lon]: [number, number]): Promise<string> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=16`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'it' } });
      if (!res.ok) return '';
      const data = await res.json();
      return this.normalizeAddressTextForUi(formatItalianAddressLabel(data, value => this.normalizeAddressText(value)));
    } catch {
      return '';
    }
  }

  private parseCoordinatesFromText(value: string): [number, number] | null {
    const text = `${value || ''}`.trim();
    if (!text) return null;
    const match = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!match) return null;
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return [lat, lon];
  }

  private orangeMarkerIcon(): L.Icon {
    return L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
    });
  }

  private renderDraftWaypointMarkers(): void {
    if (!this.map) return;
    for (const marker of this.draftWaypointMarkers) this.map.removeLayer(marker);
    this.draftWaypointMarkers = [];
    if (this.result) return;
    const controls = this.waypointsArray.controls;
    for (let i = 0; i < controls.length; i++) {
      const value = `${controls[i].value || ''}`.trim();
      const coords = this.parseCoordinatesFromText(value);
      if (!coords) continue;
      const marker = L.marker(coords, { icon: this.orangeMarkerIcon() })
        .addTo(this.map)
        .bindPopup(`<b>Tappa ${i + 1}</b>`);
      this.draftWaypointMarkers.push(marker);
    }
  }

  private haversine([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  durationLabel(durationMin: number): string {
    const h = Math.floor(durationMin / 60);
    const m = durationMin % 60;
    if (h <= 0) return `${m} min`;
    if (m <= 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  waypointLabel(i: number): string {
    const addrs = (this.form.value.waypoints as string[]).filter(w => `${w || ''}`.trim());
    return addrs[i] || `Tappa ${i + 1}`;
  }

  private applyItinerary(itineraryId: string, fuelCostPerKm: number, totalExtras: number): void {
    const selected = this.itineraryOptions.find(x => x.id === itineraryId) || this.itineraryOptions[0];
    if (!selected || !this.originCoords || !this.destCoords) return;
    this.selectedItineraryId = selected.id;
    this.tollSegments = selected.motorwaySegments.map(seg => ({ ...seg }));
    const totalFuel  = +(selected.distanceKm * fuelCostPerKm * 2).toFixed(2);
    const tollOneWay = this.tollToolTotalOneWay;
    const tollRoundTrip = this.tollToolTotalRoundTrip;
    const total = +(totalFuel + totalExtras + tollRoundTrip).toFixed(2);
    this.result = {
      distanceKm:     selected.distanceKm,
      durationMin:    selected.durationMin,
      routeLabel:     selected.label,
      fuelCostPerKm,
      totalFuel,
      totalExtras:    +totalExtras.toFixed(2),
      tollOneWay,
      tollRoundTrip,
      tollProvider:   'stima',
      tollBoothsCount: this.countEstimatedBooths(this.tollSegments),
      total
    };
    this.updateMap(this.originCoords, this.destCoords, selected.geometry, this.validWaypointCoords);
  }

  private async fetchRouteAlternatives(
    origin: [number, number],
    dest: [number, number],
    waypoints: [number, number][] = []
  ): Promise<ItineraryOption[]> {
    const allPoints  = [origin, ...waypoints, dest];
    const coordStr   = allPoints.map(([lat, lon]) => `${lon},${lat}`).join(';');
    const hasWp      = waypoints.length > 0;
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&alternatives=${hasWp ? 'false' : 'true'}&steps=true`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data   = await res.json();
    const routes = Array.isArray(data?.routes) ? data.routes : [];
    return routes.slice(0, 3).map((route: any, index: number) => {
      const distanceKm  = +(Number(route?.distance || 0) / 1000).toFixed(1);
      const durationMin = Math.max(1, Math.round(Number(route?.duration || 0) / 60));
      const motorwaySegments = this.extractMotorwaySegments(route);
      const motorwayKm  = motorwaySegments.reduce((sum, seg) => sum + seg.kmMotorway, 0);
      const tollOneWay  = +motorwaySegments.reduce((sum, seg) => sum + this.segmentCost(seg), 0).toFixed(2);
      const tollRoundTrip = tollOneWay === null ? null : +(tollOneWay * 2).toFixed(2);
      const coordinates = Array.isArray(route?.geometry?.coordinates) ? route.geometry.coordinates : [];
      const geometry: [number, number][] = coordinates
        .map((c: any) => [Number(c[1]), Number(c[0])] as [number, number])
        .filter((c: [number, number]) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
      const label = hasWp ? `Percorso con ${waypoints.length} ${waypoints.length === 1 ? 'tappa' : 'tappe'}` : `Itinerario ${index + 1}`;
      return {
        id: `route-${index + 1}`,
        label,
        distanceKm,
        durationMin,
        motorwayKm: +motorwayKm.toFixed(1),
        tollOneWay,
        tollRoundTrip,
        tollProvider: 'stima',
        tollBoothsCount: this.countEstimatedBooths(motorwaySegments),
        motorwaySegments,
        geometry
      };
    });
  }

  private estimateMotorwayKm(route: any): number {
    const legs = Array.isArray(route?.legs) ? route.legs : [];
    let motorwayMeters = 0;
    for (const leg of legs) {
      const steps = Array.isArray(leg?.steps) ? leg.steps : [];
      for (const step of steps) {
        const text = `${step?.ref || ''} ${step?.name || ''}`.toLowerCase();
        const isMotorway = /\b([ae]\d{1,3})\b/i.test(text) || text.includes('autostrada');
        if (isMotorway) motorwayMeters += Number(step?.distance || 0);
      }
    }
    return motorwayMeters / 1000;
  }

  private extractMotorwaySegments(route: any): TollSegment[] {
    const legs = Array.isArray(route?.legs) ? route.legs : [];
    const segments: TollSegment[] = [];
    let current: { motorwayRef: string; entryBooth: string; kmMotorway: number } | null = null;
    let exitBooth = '';
    for (const leg of legs) {
      const steps = Array.isArray(leg?.steps) ? leg.steps : [];
      for (const step of steps) {
        const ref = `${step?.ref || ''}`.trim();
        const name = `${step?.name || ''}`.trim();
        const isMotorway = this.isMotorwayStep(ref, name);
        if (isMotorway) {
          const motorwayRef = this.normalizeMotorwayRef(ref, name);
          const booth = this.extractBoothFromStep(step, motorwayRef);
          if (!current) {
            current = { motorwayRef, entryBooth: booth || 'Casello entrata stimato', kmMotorway: 0 };
          } else {
            current.motorwayRef = this.mergeMotorwayRef(current.motorwayRef, motorwayRef);
          }
          current.kmMotorway += Number(step?.distance || 0) / 1000;
          exitBooth = booth || exitBooth;
          if (this.isTollBarrierStep(name) && current.kmMotorway > 0.5 && !this.sameBooth(current.entryBooth, booth)) {
            const barrierBooth = booth || 'Barriera intermedia';
            segments.push({
              id: crypto.randomUUID(),
              motorwayRef: current.motorwayRef,
              entryBooth: current.entryBooth,
              exitBooth: barrierBooth,
              kmMotorway: +current.kmMotorway.toFixed(1),
              manualCost: null
            });
            current = { motorwayRef: current.motorwayRef, entryBooth: barrierBooth, kmMotorway: 0 };
            exitBooth = '';
          }
        } else if (current) {
          segments.push({
            id: crypto.randomUUID(),
            motorwayRef: current.motorwayRef,
            entryBooth: current.entryBooth,
            exitBooth: this.extractBoothFromStep(step, current.motorwayRef) || exitBooth || 'Casello uscita stimato',
            kmMotorway: +current.kmMotorway.toFixed(1),
            manualCost: null
          });
          current = null;
          exitBooth = '';
        }
      }
    }
    if (current) {
      segments.push({
        id: crypto.randomUUID(),
        motorwayRef: current.motorwayRef,
        entryBooth: current.entryBooth,
        exitBooth: exitBooth || 'Casello uscita stimato',
        kmMotorway: +current.kmMotorway.toFixed(1),
        manualCost: null
      });
    }
    const normalized = segments.filter(seg => seg.kmMotorway > 0.5);
    return this.mergeSegmentsWithoutRealBarrier(normalized);
  }

  private isMotorwayStep(ref: string, name: string): boolean {
    const text = `${ref} ${name}`.toLowerCase();
    return /\b([ae]\d{1,3})\b/i.test(text) || text.includes('autostrada');
  }

  private normalizeMotorwayRef(ref: string, name: string): string {
    const text = `${ref} ${name}`.toUpperCase();
    const match = text.match(/\b([AE]\d{1,3})\b/);
    if (match?.[1]) return match[1];
    if (text.includes('AUTOSTRADA')) return 'AUTOSTRADA';
    return 'TRATTA';
  }

  private normalizeBoothLabel(name: string, motorwayRef: string): string {
    const clean = `${name || ''}`.replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    const compact = clean.toLowerCase();
    if (compact.includes('raccordo') || compact.includes('autostrada') || compact.includes('tangenziale') || compact.includes('strada') || compact.includes('svincolo')) return '';
    if (compact.includes('casello')) return clean;
    if (compact.includes('uscita')) return clean.replace(/uscita/i, 'Casello').trim();
    if (compact.includes('barriera')) return clean;
    if (compact.includes('stazione')) return clean;
    if (motorwayRef && clean.toUpperCase() === motorwayRef.toUpperCase()) return '';
    return '';
  }

  private extractBoothFromStep(step: any, motorwayRef: string): string {
    const candidates = [
      `${step?.destinations || ''}`.trim(),
      `${step?.name || ''}`.trim(),
      `${step?.maneuver?.instruction || ''}`.trim()
    ].filter(Boolean);
    for (const candidate of candidates) {
      const normalized = this.normalizeBoothLabel(candidate, motorwayRef);
      if (normalized) return normalized;
    }
    return '';
  }

  private mergeMotorwayRef(currentRef: string, nextRef: string): string {
    const current = `${currentRef || ''}`.trim();
    const next = `${nextRef || ''}`.trim();
    if (!next || next === 'TRATTA' || next === 'AUTOSTRADA') return current || next;
    if (!current || current === 'TRATTA' || current === 'AUTOSTRADA') return next;
    const parts = current.split('/').map(x => x.trim()).filter(Boolean);
    if (parts.includes(next)) return current;
    return `${current}/${next}`;
  }

  private isTollBarrierStep(name: string): boolean {
    const value = `${name || ''}`.toLowerCase();
    return value.includes('barriera');
  }

  private mergeSegmentsWithoutRealBarrier(segments: TollSegment[]): TollSegment[] {
    if (segments.length <= 1) return segments;
    const hasRealBarrier = segments.some(seg =>
      `${seg.entryBooth}`.toLowerCase().includes('barriera') ||
      `${seg.exitBooth}`.toLowerCase().includes('barriera')
    );
    if (hasRealBarrier) return segments;
    const first = segments[0];
    const last = segments[segments.length - 1];
    const totalKm = +segments.reduce((sum, seg) => sum + Number(seg.kmMotorway || 0), 0).toFixed(1);
    const refs = Array.from(new Set(
      segments.map(seg => `${seg.motorwayRef || ''}`.trim()).filter(Boolean)
    ));
    return [{
      id: crypto.randomUUID(),
      motorwayRef: refs.join('/'),
      entryBooth: first.entryBooth,
      exitBooth: last.exitBooth,
      kmMotorway: totalKm,
      manualCost: null
    }];
  }

  private sameBooth(a: string, b: string): boolean {
    const normalize = (value: string) => `${value || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    const left = normalize(a);
    const right = normalize(b);
    if (!left || !right) return false;
    return left === right;
  }

  private estimateTollOneWay(distanceKm: number, motorwayKm: number): number | null {
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
    if (!Number.isFinite(motorwayKm) || motorwayKm <= 1) return 0;
    const rate = TOLL_RATES[this.tollVehicleType]?.ratePerKm ?? 0.085;
    const estimated = Math.max(1.8, motorwayKm * rate + 1.5);
    return +estimated.toFixed(2);
  }

  private createFallbackItinerary(origin: [number, number], dest: [number, number]): ItineraryOption {
    const distanceKm  = +this.haversine(origin, dest).toFixed(1);
    const durationMin = Math.max(1, Math.round((distanceKm / 60) * 60));
    return {
      id: 'route-fallback',
      label: 'Itinerario diretto',
      distanceKm,
      durationMin,
      motorwayKm: 0,
      tollOneWay: 0,
      tollRoundTrip: 0,
      tollProvider: 'stima',
      tollBoothsCount: 0,
      motorwaySegments: [],
      geometry: [origin, dest]
    };
  }

  openPedaggiPopup(): void {
    const pair = this.officialTollPair();
    if (pair) {
      this.pedaggiEntry = pair.entry;
      this.pedaggiExit = pair.exit;
    } else {
      this.pedaggiEntry = `${this.form.value.origin || ''}`.trim();
      this.pedaggiExit = `${this.form.value.destination || ''}`.trim();
    }
    this.pedaggiCostValue = this.result?.tollOneWay ?? null;
    this.showPedaggiPopup = true;
  }

  closePedaggiPopup(): void {
    this.showPedaggiPopup = false;
  }

  applyPedaggiCostToRoute(): void {
    if (!this.result) return;
    const oneWay = Number(`${this.pedaggiCostValue || 0}`.toString().replace(',', '.'));
    if (!Number.isFinite(oneWay) || oneWay <= 0) return;
    const roundTrip = +(oneWay * 2).toFixed(2);
    this.result = {
      ...this.result,
      tollOneWay: +oneWay.toFixed(2),
      tollRoundTrip: roundTrip,
      tollProvider: 'stima',
      total: +(this.result.totalFuel + this.result.totalExtras + roundTrip).toFixed(2)
    };
    this.closePedaggiPopup();
  }

  openPedaggiInNewTab(): void {
    const url = this.buildPedaggiUrl();
    window.open(url, '_blank');
  }

  copyPedaggiPair(): void {
    const text = `${this.pedaggiEntry}\n${this.pedaggiExit}`.trim();
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  async pastePedaggiCost(): Promise<void> {
    if (!navigator.clipboard?.readText) return;
    try {
      const raw = (await navigator.clipboard.readText()).trim();
      if (!raw) return;
      const normalized = raw.replace(/\s/g, '').replace(',', '.');
      const match = normalized.match(/(\d+(?:\.\d+)?)/);
      if (!match) return;
      const value = Number(match[1]);
      if (!Number.isFinite(value) || value <= 0) return;
      this.pedaggiCostValue = +value.toFixed(2);
    } catch {}
  }

  private buildPedaggiUrl(): string {
    const params = new URLSearchParams();
    if (this.pedaggiEntry) params.set('partenza', this.pedaggiEntry);
    if (this.pedaggiExit) params.set('destinazione', this.pedaggiExit);
    return `https://www.infoviaggiando.it/pedaggi${params.toString() ? `?${params.toString()}` : ''}`;
  }

  private updateMap(
    origin: [number, number],
    dest: [number, number],
    geometry: [number, number][] = [],
    waypoints: [number, number][] = []
  ) {
    // Clear previous layers
    if (this.markerOrigin) this.map.removeLayer(this.markerOrigin);
    if (this.markerDest)   this.map.removeLayer(this.markerDest);
    if (this.routeLine)    this.map.removeLayer(this.routeLine);
    for (const m of this.waypointMarkers) { this.map.removeLayer(m); }
    this.waypointMarkers = [];
    for (const marker of this.draftWaypointMarkers) { this.map.removeLayer(marker); }
    this.draftWaypointMarkers = [];

    const greenIcon = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
    });
    const redIcon = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
    });
    const orangeIcon = this.orangeMarkerIcon();

    this.markerOrigin = L.marker(origin, { icon: greenIcon }).addTo(this.map)
      .bindPopup(`<b>Partenza:</b> ${this.form.value.origin}`).openPopup();
    this.markerDest = L.marker(dest, { icon: redIcon }).addTo(this.map)
      .bindPopup(`<b>Destinazione:</b> ${this.form.value.destination}`);

    // Waypoint markers
    const wpAddresses: string[] = (this.form.value.waypoints as string[]).map(w => `${w || ''}`.trim()).filter(Boolean);
    for (let i = 0; i < waypoints.length; i++) {
      const m = L.marker(waypoints[i], { icon: orangeIcon })
        .addTo(this.map)
        .bindPopup(`<b>Tappa ${i + 1}:</b> ${wpAddresses[i] || ''}`);
      this.waypointMarkers.push(m);
    }

    const path = geometry.length > 1 ? geometry : [origin, dest];
    this.routeLine = L.polyline(path, { color: this.routeColorHex, weight: 5, opacity: 0.92 }).addTo(this.map);

    const allPoints: [number, number][] = [origin, ...waypoints, dest];
    const bounds = L.latLngBounds(allPoints);
    this.map.fitBounds(bounds, { padding: [40, 40] });
  }

  private applyMapTheme(): void {
    if (!this.map) return;
    if (this.mapTileLayer) this.map.removeLayer(this.mapTileLayer);
    const config = this.resolveMapThemeConfig(this.selectedMapTheme);
    this.mapTileLayer = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom
    });
    this.mapTileLayer.addTo(this.map);
  }

  private resolveMapThemeConfig(theme: MapThemeId): { url: string; attribution: string; maxZoom: number } {
    if (theme === 'street') {
      return {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      };
    }
    if (theme === 'dark') {
      return {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '© OpenStreetMap contributors © CARTO',
        maxZoom: 19
      };
    }
    if (theme === 'satellite') {
      return {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles © Esri',
        maxZoom: 18
      };
    }
    if (theme === 'topo') {
      return {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: 'Map data: © OpenStreetMap contributors, SRTM | Style: © OpenTopoMap',
        maxZoom: 17
      };
    }
    return {
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: '© OpenStreetMap contributors © CARTO',
      maxZoom: 19
    };
  }

  // ─── Save expense ──────────────────────────────────────────────────────────
  saveExpense() {
    if (!this.result || !this.destCoords) return;
    const v = this.form.value;
    const expense: Expense = {
      id:           crypto.randomUUID(),
      date:         new Date().toISOString().split('T')[0],
      origin:       this.normalizeAddressTextForUi(`${v.origin || ''}`),
      destination:  this.normalizeAddressTextForUi(`${v.destination || ''}`),
      originLat:    this.originCoords?.[0],
      originLon:    this.originCoords?.[1],
      destLat:      this.destCoords[0],
      destLon:      this.destCoords[1],
      distanceKm:   this.result.distanceKm,
      fuelCostPerKm:      this.result?.fuelCostPerKm ?? 0,
      fuelPricePerLiter:  v.fuelPricePerLiter,
      vehicleConsumption: v.vehicleConsumption,
      vehicleConsumptionMode: (v.vehicleConsumptionMode as ConsumptionMode) || 'l_100km',
      vehicleModel: `${v.vehicleModel || ''}`.trim() || undefined,
      vehicleFuelType: `${v.vehicleFuelType || ''}`.trim() as Expense['vehicleFuelType'],
      extras:       v.extras,
      totalFuel:    this.result.totalFuel,
      totalExtras:  this.result.totalExtras,
      tollEstimatedOneWay: this.result.tollOneWay,
      tollEstimatedRoundTrip: this.result.tollRoundTrip,
      tollProvider: this.result.tollProvider,
      tollBoothsCount: this.result.tollBoothsCount,
      routeLabel: this.result.routeLabel,
      durationMin: this.result.durationMin,
      totalExpense: this.result.total,
      createdAt:    new Date().toISOString(),
    };
    this.expenses.unshift(expense);
    localStorage.setItem('mm_expenses', JSON.stringify(this.expenses));
    void this.syncSupabaseExpenses();
  }

  async reviewExpenseOnMap(expense: Expense): Promise<void> {
    const fuelPrice = Number(expense.fuelPricePerLiter || this.form.value.fuelPricePerLiter || 1.85);
    const vehicleConsumption = Number(expense.vehicleConsumption || this.form.value.vehicleConsumption || 7);
    this.form.patchValue({
      origin: this.normalizeAddressTextForUi(`${expense.origin || ''}`),
      destination: this.normalizeAddressTextForUi(`${expense.destination || ''}`),
      vehicleModel: `${expense.vehicleModel || this.form.value.vehicleModel || ''}`.trim(),
      vehicleFuelType: `${expense.vehicleFuelType || this.form.value.vehicleFuelType || 'benzina'}`,
      vehicleConsumptionMode: `${expense.vehicleConsumptionMode || this.form.value.vehicleConsumptionMode || 'l_100km'}`,
      fuelPricePerLiter: Number.isFinite(fuelPrice) ? fuelPrice : 1.85,
      vehicleConsumption: Number.isFinite(vehicleConsumption) ? vehicleConsumption : 7
    });
    this.extrasArray.clear();
    for (const ex of (expense.extras || [])) {
      this.extrasArray.push(this.fb.group({
        label: `${ex?.label || ''}`,
        amount: Number(ex?.amount || 0)
      }));
    }
    this.validWaypointCoords = [];
    this.waypointsArray.clear();
    this.result = null;

    const origin = await this.resolveExpensePoint(expense.originLat, expense.originLon, expense.origin);
    const dest = await this.resolveExpensePoint(expense.destLat, expense.destLon, expense.destination);
    if (!origin || !dest) {
      this.calcError = 'Impossibile ripristinare la mappa: mancano coordinate valide per questa spesa.';
      return;
    }

    this.originCoords = origin;
    this.destCoords = dest;
    let geometry: [number, number][] = [origin, dest];
    let motorwaySegments: TollSegment[] = [];
    try {
      const alternatives = await this.fetchRouteAlternatives(origin, dest, []);
      if (alternatives.length) {
        geometry = alternatives[0].geometry?.length ? alternatives[0].geometry : geometry;
        motorwaySegments = alternatives[0].motorwaySegments || [];
      }
    } catch {}

    this.itineraryOptions = [{
      id: `saved-${expense.id}`,
      label: `${expense.routeLabel || 'Percorso salvato'}`,
      distanceKm: Number(expense.distanceKm || 0),
      durationMin: Math.max(1, Number(expense.durationMin || 1)),
      motorwayKm: +motorwaySegments.reduce((sum, seg) => sum + Number(seg.kmMotorway || 0), 0).toFixed(1),
      tollOneWay: expense.tollEstimatedOneWay ?? 0,
      tollRoundTrip: expense.tollEstimatedRoundTrip ?? 0,
      tollProvider: 'stima',
      tollBoothsCount: expense.tollBoothsCount ?? this.countEstimatedBooths(motorwaySegments),
      motorwaySegments,
      geometry
    }];
    this.selectedItineraryId = this.itineraryOptions[0].id;
    this.tollSegments = motorwaySegments.map(seg => ({ ...seg }));
    this.result = {
      distanceKm: Number(expense.distanceKm || 0),
      durationMin: Math.max(1, Number(expense.durationMin || 1)),
      routeLabel: expense.routeLabel || 'Percorso salvato',
      fuelCostPerKm: Number(expense.fuelCostPerKm || 0),
      totalFuel: Number(expense.totalFuel || 0),
      totalExtras: Number(expense.totalExtras || 0),
      tollOneWay: expense.tollEstimatedOneWay ?? 0,
      tollRoundTrip: expense.tollEstimatedRoundTrip ?? 0,
      tollProvider: 'stima',
      tollBoothsCount: expense.tollBoothsCount ?? this.countEstimatedBooths(motorwaySegments),
      total: Number(expense.totalExpense || 0)
    };
    this.updateMap(origin, dest, geometry, []);
    this.calcError = '';
    setTimeout(() => this.map?.invalidateSize(), 80);
  }

  openAssignEventModal(expense: Expense): void {
    this.assignTargetExpenseId = expense.id;
    const allEvents: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const activeEvents = allEvents
      .filter(e => `${e?.date || ''}`.trim())
      .sort((a, b) => `${b.date || ''}`.localeCompare(`${a.date || ''}`));
    this.assignEvents = activeEvents;
    this.assignSuggestedEventId = this.suggestEventForExpense(expense, activeEvents);
    this.assignSelectedEventId = expense.eventId || this.assignSuggestedEventId || '';
    this.showAssignEventModal = true;
  }

  closeAssignEventModal(): void {
    this.showAssignEventModal = false;
    this.assignTargetExpenseId = '';
    this.assignSelectedEventId = '';
    this.assignSuggestedEventId = '';
  }

  saveExpenseEventAssignment(): void {
    if (!this.assignTargetExpenseId || !this.assignSelectedEventId) return;
    this.expenses = this.expenses.map(ex =>
      ex.id === this.assignTargetExpenseId
        ? { ...ex, eventId: this.assignSelectedEventId }
        : ex
    );
    localStorage.setItem('mm_expenses', JSON.stringify(this.expenses));
    void this.syncSupabaseExpenses();
    this.closeAssignEventModal();
  }

  eventLabelById(eventId: string): string {
    const source = this.assignEvents.length ? this.assignEvents : (JSON.parse(localStorage.getItem('mm_events') || '[]') as EventDetail[]);
    const event = source.find(e => `${e.id}` === `${eventId}`);
    if (!event) return '';
    return `${event.title || 'Evento'} • ${event.date || ''}`;
  }

  isSuggestedEvent(eventId: string): boolean {
    return !!eventId && eventId === this.assignSuggestedEventId;
  }

  formatExpenseAddress(value: string): string {
    return this.normalizeAddressTextForUi(value);
  }

  private normalizeStoredExpenses(raw: any[]): Expense[] {
    if (!Array.isArray(raw)) return [];
    const normalized = raw.map((item: any) => {
      const mode = `${item?.vehicleConsumptionMode || ''}` as ConsumptionMode;
      const consumption = Number(item?.vehicleConsumption || 0);
      if (mode === 'l_km' && Number.isFinite(consumption) && consumption > 0) {
        return {
          ...item,
          vehicleConsumptionMode: 'l_100km',
          vehicleConsumption: +(consumption * 100).toFixed(1),
          origin: this.normalizeAddressTextForUi(`${item?.origin || ''}`),
          destination: this.normalizeAddressTextForUi(`${item?.destination || ''}`)
        };
      }
      return {
        ...item,
        origin: this.normalizeAddressTextForUi(`${item?.origin || ''}`),
        destination: this.normalizeAddressTextForUi(`${item?.destination || ''}`)
      };
    });
    localStorage.setItem('mm_expenses', JSON.stringify(normalized));
    return normalized;
  }

  private normalizeAddressTextForUi(value: string): string {
    const raw = `${value || ''}`.trim();
    if (!raw) return '';
    const regionNames = new Set([
      'abruzzo', 'basilicata', 'calabria', 'campania', 'emilia romagna', 'friuli venezia giulia',
      'lazio', 'liguria', 'lombardia', 'marche', 'molise', 'piemonte', 'puglia', 'sardegna',
      'sicilia', 'toscana', 'trentino alto adige', 'umbria', 'valle d aosta', 'veneto'
    ]);
    const parts = raw.split(',').map(x => `${x || ''}`.trim()).filter(Boolean);
    const provinceCode = provinceCodeFromAddressLabel(raw);
    const compact: string[] = [];
    for (const p of parts) {
      const norm = normalizeGeoText(p);
      if (!norm) continue;
      if (norm === 'italia' || norm === 'italy') continue;
      if (regionNames.has(norm)) continue;
      if (provinceCodeFromText(p)) {
        if (provinceCode && !compact.includes(provinceCode)) compact.push(provinceCode);
        continue;
      }
      compact.push(p);
    }
    if (provinceCode && !compact.some(x => `${x}`.toUpperCase() === provinceCode)) {
      const insertAt = Math.max(1, compact.length - 1);
      compact.splice(insertAt, 0, provinceCode);
    }
    return compact.join(', ');
  }

  // ─── Navigation ────────────────────────────────────────────────────────────
  openNavigation(app: 'waze' | 'google' | 'apple') {
    if (!this.destCoords || !this.originCoords) return;
    const [dLat, dLon] = this.destCoords;
    const [oLat, oLon] = this.originCoords;
    const origin = `${oLat},${oLon}`;
    const destination = `${dLat},${dLon}`;
    const waypoints = this.validWaypointCoords.map(([lat, lon]) => `${lat},${lon}`);
    let url: string;

    if (app === 'google') {
      const params = new URLSearchParams({
        api: '1',
        origin,
        destination,
        travelmode: 'driving'
      });
      if (waypoints.length > 0) params.set('waypoints', waypoints.join('|'));
      url = `https://www.google.com/maps/dir/?${params.toString()}`;
    } else if (app === 'apple') {
      const applePath = waypoints.length > 0 ? `${waypoints.join('+to:')}+to:${destination}` : destination;
      url = `https://maps.apple.com/?saddr=${encodeURIComponent(origin)}&daddr=${encodeURIComponent(applePath)}&dirflg=d`;
    } else {
      const wazeParams = new URLSearchParams({
        ll: destination,
        q: `${this.form.value.destination || destination}`,
        navigate: 'yes',
        zoom: '17',
        utm_source: 'musican_manager'
      });
      url = `https://www.waze.com/ul?${wazeParams.toString()}`;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ─── Toll popup helper ─────────────────────────────────────────────────────

  estimateTollSegment(km: number): number {
    if (!Number.isFinite(km) || km <= 1) return 0;
    const rate = TOLL_RATES[this.tollVehicleType]?.ratePerKm ?? 0.085;
    return +Math.max(1.90, km * rate + 0.90).toFixed(2);
  }

  segmentCost(seg: TollSegment): number {
    return seg.manualCost !== null ? seg.manualCost : this.estimateTollSegment(seg.kmMotorway);
  }

  get tollToolTotalOneWay(): number {
    return +this.tollSegments.reduce((s, seg) => s + this.segmentCost(seg), 0).toFixed(2);
  }

  get tollToolTotalRoundTrip(): number {
    return +(this.tollToolTotalOneWay * 2).toFixed(2);
  }

  applyTollToResult() {
    if (!this.result || this.tollToolTotalOneWay <= 0) return;
    this.result = {
      ...this.result,
      tollOneWay:    this.tollToolTotalOneWay,
      tollRoundTrip: this.tollToolTotalRoundTrip,
      tollProvider:  'stima',
      total: +(this.result.totalFuel + this.result.totalExtras + this.tollToolTotalRoundTrip).toFixed(2)
    };
  }

  openOfficialTollPage(): void {
    const pair = this.officialTollPair();
    if (!pair) {
      window.open('https://www.infoviaggiando.it/pedaggi', '_blank');
      return;
    }
    const params = new URLSearchParams({
      partenza: pair.entry,
      destinazione: pair.exit
    });
    const targetUrl = `https://www.infoviaggiando.it/pedaggi?${params.toString()}`;
    const text = `Partenza: ${pair.entry}\nDestinazione: ${pair.exit}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    window.open(targetUrl, '_blank');
  }

  private officialTollPair(): { entry: string; exit: string } | null {
    if (!this.tollSegments.length) return null;
    const first = this.tollSegments[0];
    const last = this.tollSegments[this.tollSegments.length - 1];
    const entry = `${first.entryBooth || ''}`.trim();
    const exit = `${last.exitBooth || ''}`.trim();
    if (!entry || !exit) return null;
    const hasEstimated = [entry, exit].some(v => `${v}`.toLowerCase().includes('stimato'));
    if (hasEstimated) return null;
    return { entry, exit };
  }

  private countEstimatedBooths(segments: TollSegment[]): number {
    if (!segments.length) return 0;
    if (segments.length === 1) return 2;
    const booths = new Set<string>();
    segments.forEach(seg => {
      const entry = `${seg.entryBooth || ''}`.trim();
      const exit = `${seg.exitBooth || ''}`.trim();
      if (entry) booths.add(entry.toLowerCase());
      if (exit) booths.add(exit.toLowerCase());
    });
    return Math.max(2, booths.size);
  }

  // ─── Delete / sync ─────────────────────────────────────────────────────────
  deleteExpense(id: string) {
    this.expenses = this.expenses.filter(e => e.id !== id);
    localStorage.setItem('mm_expenses', JSON.stringify(this.expenses));
    void this.syncSupabaseExpenses();
  }

  private async syncSupabaseExpenses(): Promise<void> {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const musicianId = `${profile.id || ''}`.trim();
    if (!musicianId) return;
    try {
      await this.supabase.syncExpensesFromLocalStorage(musicianId);
    } catch {}
  }

  private async resolveExpensePoint(lat?: number, lon?: number, fallbackAddress = ''): Promise<[number, number] | null> {
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [Number(lat), Number(lon)];
    const parsed = this.parseCoordinatesFromText(`${fallbackAddress || ''}`);
    if (parsed) return parsed;
    const geocoded = await this.geocode(`${fallbackAddress || ''}`.trim());
    return geocoded || null;
  }

  private suggestEventForExpense(expense: Expense, events: EventDetail[]): string {
    const destination = this.normalizeAddressText(`${expense.destination || ''}`);
    const expenseDate = `${expense.date || ''}`.trim();
    let bestId = '';
    let bestScore = -1;
    for (const event of events) {
      let score = 0;
      const eventAddress = this.normalizeAddressText(`${event.address || ''}`);
      const eventVenue = this.normalizeAddressText(`${event.venue || ''}`);
      if (destination && eventAddress && (destination.includes(eventAddress) || eventAddress.includes(destination))) score += 45;
      if (destination && eventVenue && (destination.includes(eventVenue) || eventVenue.includes(destination))) score += 35;
      if (expenseDate && event.date === expenseDate) score += 30;
      if (expenseDate && event.date) {
        const dayDelta = Math.abs(Math.round((new Date(expenseDate).getTime() - new Date(event.date).getTime()) / 86400000));
        if (dayDelta <= 1) score += 14;
        else if (dayDelta <= 3) score += 8;
      }
      if (event.type === 'concert' || event.type === 'dj_set') score += 4;
      if (score > bestScore) {
        bestScore = score;
        bestId = event.id;
      }
    }
    return bestScore >= 24 ? bestId : '';
  }
}
