import { Component, OnInit, AfterViewInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import * as L from 'leaflet';
import { Expense, ExpenseExtra } from '../../models/expense';
import { SupabaseService } from '../../core/supabase.service';

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
  result: { distanceKm: number; totalFuel: number; totalExtras: number; total: number; fuelCostPerKm: number } | null = null;
  destCoords: [number, number] | null = null;
  originCoords: [number, number] | null = null;

  private map!: L.Map;
  private markerOrigin?: L.Marker;
  private markerDest?: L.Marker;
  private routeLine?: L.Polyline;

  constructor(private fb: FormBuilder, private supabase: SupabaseService) {}

  ngOnInit() {
    this.expenses = JSON.parse(localStorage.getItem('mm_expenses') || '[]');
    const homeBase        = localStorage.getItem('mm_homeBase') || '';
    const savedPrice      = parseFloat(localStorage.getItem('mm_fuelPricePerLiter') || '1.85');
    const savedConsumption= parseFloat(localStorage.getItem('mm_vehicleConsumption') || '7.0');

    this.form = this.fb.group({
      origin:             [homeBase, Validators.required],
      destination:        ['', Validators.required],
      fuelPricePerLiter:  [savedPrice,       [Validators.required, Validators.min(0)]],
      vehicleConsumption: [savedConsumption, [Validators.required, Validators.min(0)]],
      extras: this.fb.array([]),
    });
  }

  ngAfterViewInit() {
    this.initMap();
  }

  ngOnDestroy() {
    if (this.map) { this.map.remove(); }
  }

  private initMap() {
    // Fix Leaflet default icon path issue with bundlers
    const iconDefault = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41], iconAnchor: [12, 41],
    });
    L.Marker.prototype.options.icon = iconDefault;

    this.map = L.map(this.mapEl.nativeElement).setView([41.9, 12.5], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(this.map);
  }

  get extrasArray(): FormArray {
    return this.form.get('extras') as FormArray;
  }

  addExtra() {
    this.extrasArray.push(this.fb.group({
      label:  ['', Validators.required],
      amount: [0, [Validators.required, Validators.min(0)]],
    }));
  }

  removeExtra(i: number) { this.extrasArray.removeAt(i); }

  async calculate() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.calculating = true;
    this.calcError = '';
    this.result = null;

    try {
      const v = this.form.value;
      const [oCoords, dCoords] = await Promise.all([
        this.geocode(v.origin),
        this.geocode(v.destination),
      ]);

      if (!oCoords) throw new Error(`Indirizzo di partenza non trovato: "${v.origin}"`);
      if (!dCoords) throw new Error(`Destinazione non trovata: "${v.destination}"`);

      this.originCoords = oCoords;
      this.destCoords   = dCoords;

      const distanceKm   = this.haversine(oCoords, dCoords);
      const fuelCostPerKm = +((v.vehicleConsumption / 100) * v.fuelPricePerLiter).toFixed(3);
      const totalFuel    = +(distanceKm * fuelCostPerKm * 2).toFixed(2); // A/R
      const totalExtras  = (v.extras as ExpenseExtra[]).reduce((s, e) => s + (+e.amount || 0), 0);
      const total        = +(totalFuel + totalExtras).toFixed(2);

      this.result = { distanceKm: +distanceKm.toFixed(1), totalFuel, totalExtras, total, fuelCostPerKm };

      this.updateMap(oCoords, dCoords);

      localStorage.setItem('mm_fuelPricePerLiter',  String(v.fuelPricePerLiter));
      localStorage.setItem('mm_vehicleConsumption', String(v.vehicleConsumption));

    } catch (e: unknown) {
      this.calcError = e instanceof Error ? e.message : 'Errore nel calcolo';
    } finally {
      this.calculating = false;
    }
  }

  private async geocode(query: string): Promise<[number, number] | null> {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'it' } });
    const data = await res.json();
    if (!data.length) return null;
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  }

  private haversine([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private updateMap(origin: [number, number], dest: [number, number]) {
    if (this.markerOrigin) this.map.removeLayer(this.markerOrigin);
    if (this.markerDest)   this.map.removeLayer(this.markerDest);
    if (this.routeLine)    this.map.removeLayer(this.routeLine);

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

    this.markerOrigin = L.marker(origin, { icon: greenIcon }).addTo(this.map)
      .bindPopup(`<b>Partenza:</b> ${this.form.value.origin}`).openPopup();
    this.markerDest = L.marker(dest, { icon: redIcon }).addTo(this.map)
      .bindPopup(`<b>Destinazione:</b> ${this.form.value.destination}`);

    this.routeLine = L.polyline([origin, dest], { color: '#7c3aed', weight: 3, dashArray: '8 6' }).addTo(this.map);

    const bounds = L.latLngBounds([origin, dest]);
    this.map.fitBounds(bounds, { padding: [40, 40] });
  }

  saveExpense() {
    if (!this.result || !this.destCoords) return;
    const v = this.form.value;
    const expense: Expense = {
      id:           crypto.randomUUID(),
      date:         new Date().toISOString().split('T')[0],
      origin:       v.origin,
      destination:  v.destination,
      originLat:    this.originCoords?.[0],
      originLon:    this.originCoords?.[1],
      destLat:      this.destCoords[0],
      destLon:      this.destCoords[1],
      distanceKm:   this.result.distanceKm,
      fuelCostPerKm:      this.result?.fuelCostPerKm ?? 0,
      fuelPricePerLiter:  v.fuelPricePerLiter,
      vehicleConsumption: v.vehicleConsumption,
      extras:       v.extras,
      totalFuel:    this.result.totalFuel,
      totalExtras:  this.result.totalExtras,
      totalExpense: this.result.total,
      createdAt:    new Date().toISOString(),
    };
    this.expenses.unshift(expense);
    localStorage.setItem('mm_expenses', JSON.stringify(this.expenses));
    void this.syncSupabaseExpenses();
  }

  openNavigation(app: 'waze' | 'google' | 'apple') {
    if (!this.destCoords) return;
    const [lat, lon] = this.destCoords;
    const dest = this.form.value.destination;
    const urls: Record<string, string> = {
      waze:   `https://waze.com/ul?q=${encodeURIComponent(dest)}&navigate=yes`,
      google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
      apple:  `http://maps.apple.com/?daddr=${lat},${lon}`,
    };
    window.open(urls[app], '_blank');
  }

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
}
