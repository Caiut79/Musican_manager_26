import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { readEventsWithBackfill, readEventsForDisplay } from '../../core/local-storage.service';

// Helper per parsing JSON sicuro da localStorage
function safeParse<T = any>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

interface CitySuggestion {
  label: string;
  city: string;
  province: string;
}

@Component({
  selector: 'app-booking-request',
  templateUrl: './booking-request.component.html',
  styleUrls: ['./booking-request.component.scss']
})
export class BookingRequestComponent implements OnInit, OnDestroy {
  musicianName = '';
  musicianSlug = '';
  affiliationCode = '';
  requestedRole: 'musician' | 'dj' | 'teacher' = 'musician';
  allowBandInvites = true;
  sent = false;
  sentCount = 0;
  error = '';
  expectedFeeLabel = '';
  expectedFeeNotes = '';
  private busySlots: { date: string; timeStart: string }[] = [];

  // City autocomplete
  citySuggestions: CitySuggestion[] = [];
  citySearching = false;
  private cityAbort: AbortController | null = null;
  private cityDebounce: ReturnType<typeof setTimeout> | null = null;

  form = this.fb.group({
    customerName: ['', Validators.required],
    bandName: [''],
    customerEmail: ['', [Validators.required, Validators.email]],
    customerPhone: [''],
    eventCity: [''],
    eventProvince: [''],
    dates: this.fb.array([this.createDateGroup()]),
    message: ['']
  });

  constructor(private fb: FormBuilder, private route: ActivatedRoute, private supabase: SupabaseService) {}

  ngOnInit(): void {
    this.musicianSlug = this.route.snapshot.paramMap.get('slug') || '';
    this.affiliationCode = `${this.route.snapshot.queryParamMap.get('code') || ''}`.trim().toUpperCase();
    const queryRole = `${this.route.snapshot.queryParamMap.get('role') || 'musician'}`.toLowerCase();
    if (queryRole === 'dj' || queryRole === 'teacher') this.requestedRole = queryRole;
    const firstName = localStorage.getItem('mm_firstName') || '';
    const lastName = localStorage.getItem('mm_lastName') || '';
    this.musicianName = `${firstName} ${lastName}`.trim() || 'Musicista';
    const stored = safeParse<any>(localStorage.getItem('mm_settings'), {});
    const roleSettings = stored?.roleSettings?.[this.requestedRole] || {};
    this.allowBandInvites = roleSettings.allowBandInvites ?? stored.allowBandInvites ?? true;
    const minFee = Number(roleSettings.minFee ?? stored.minFee ?? 0);
    const maxFee = Number(roleSettings.maxFee ?? stored.maxFee ?? 0);
    this.expectedFeeLabel = this.formatExpectedFee(minFee, maxFee);
    this.expectedFeeNotes = `${roleSettings.feeNotes ?? stored.feeNotes ?? ''}`.trim();
    this.loadBusySlots();
  }

  ngOnDestroy(): void {
    this.cityAbort?.abort();
    if (this.cityDebounce) clearTimeout(this.cityDebounce);
  }

  get dates(): FormArray {
    return this.form.get('dates') as FormArray;
  }

  createDateGroup(): FormGroup {
    return this.fb.group({
      eventDate: ['', Validators.required],
      eventTime: ['', Validators.required],
      eventType: ['Serata privata'],
      expectedCompensation: [null],
      expensesIncluded: [false]
    });
  }

  addDateSlot(): void {
    if (this.dates.length < 10) {
      this.dates.push(this.createDateGroup());
    }
  }

  removeDateSlot(i: number): void {
    if (this.dates.length > 1) {
      this.dates.removeAt(i);
    }
  }

  isSlotBusy(i: number): boolean {
    const group = this.dates.at(i) as FormGroup;
    const date = `${group.get('eventDate')?.value || ''}`.trim();
    const time = `${group.get('eventTime')?.value || ''}`.trim();
    if (!date || !time) return false;
    return this.busySlots.some(s => s.date === date && s.timeStart === time);
  }

  isDateBusy(i: number): boolean {
    const group = this.dates.at(i) as FormGroup;
    const date = `${group.get('eventDate')?.value || ''}`.trim();
    if (!date) return false;
    return this.busySlots.some(s => s.date === date);
  }

  // ─── City autocomplete ─────────────────────────────────────────────────────

  onCityInput(query: string): void {
    if (this.cityDebounce) clearTimeout(this.cityDebounce);
    this.form.patchValue({ eventProvince: '' });

    if (query.length < 2) {
      this.citySuggestions = [];
      return;
    }

    this.cityDebounce = setTimeout(() => this.searchCity(query), 350);
  }

  selectCity(s: CitySuggestion): void {
    this.form.patchValue({ eventCity: s.city, eventProvince: s.province });
    this.citySuggestions = [];
  }

  private async searchCity(query: string): Promise<void> {
    this.cityAbort?.abort();
    this.cityAbort = new AbortController();
    this.citySearching = true;

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=it&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        signal: this.cityAbort.signal,
        headers: { 'Accept-Language': 'it' }
      });
      if (!res.ok) { this.citySuggestions = []; return; }
      const data: any[] = await res.json();

      const seen = new Set<string>();
      this.citySuggestions = data
        .map(r => {
          const a = r.address || {};
          const city = a.city || a.town || a.village || a.municipality || a.hamlet || '';
          const province = a.county || a.state || '';
          if (!city) return null;
          const key = `${city}|${province}`.toLowerCase();
          if (seen.has(key)) return null;
          seen.add(key);
          return { label: province ? `${city} (${province})` : city, city, province };
        })
        .filter((x): x is CitySuggestion => x !== null);
    } catch {
      this.citySuggestions = [];
    } finally {
      this.citySearching = false;
    }
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    for (let i = 0; i < this.dates.length; i++) {
      if (this.isSlotBusy(i)) {
        this.error = 'Una o più date selezionate non sono disponibili. Scegli date/orari liberi.';
        return;
      }
    }

    this.error = '';
    const base = this.form.value;
    const listRaw = localStorage.getItem('mm_booking_requests');
    const list = listRaw ? JSON.parse(listRaw) : [];
    const batchId = crypto.randomUUID();
    const dateSlots = base.dates || [];

    for (const slot of dateSlots) {
      const request = {
        id: crypto.randomUUID(),
        batchId,
        slug: this.musicianSlug,
        musicianName: this.musicianName,
        role: this.requestedRole,
        roleLabel: this.roleLabel(),
        affiliationCode: this.affiliationCode || null,
        sourceType: 'link',
        allowBandInvites: this.allowBandInvites,
        status: 'new',
        statusUpdatedAt: null,
        confirmedAt: null,
        confirmationSentAt: null,
        receiptSentAt: null,
        declinedAt: null,
        contactId: null,
        internalNotes: '',
        customerName: base.customerName,
        bandName: base.bandName || '',
        customerEmail: base.customerEmail,
        customerPhone: base.customerPhone,
        eventCity: base.eventCity || '',
        eventProvince: base.eventProvince || '',
        eventDate: slot.eventDate,
        eventTime: slot.eventTime,
        eventType: slot.eventType || 'Serata privata',
        expectedCompensation: Number(slot.expectedCompensation || 0) || null,
        expensesIncluded: !!slot.expensesIncluded,
        bookingCode: '',
        message: base.message,
        createdAt: new Date().toISOString()
      };
      list.push(request);
      try {
        await this.supabase.savePublicBookingRequest(request);
      } catch (error: any) {
        console.warn('[BookingRequest] sync remote failed:', error?.message || error);
      }
      this.logCommunicationRequest(request);
    }

    localStorage.setItem('mm_booking_requests', JSON.stringify(list));
    this.sentCount = dateSlots.length;
    this.sent = true;

    this.form.reset({ customerName: '', bandName: '', customerEmail: '', customerPhone: '', eventCity: '', eventProvince: '', message: '' });
    while (this.dates.length > 1) this.dates.removeAt(1);
    this.dates.at(0).reset({
      eventDate: '',
      eventTime: '',
      eventType: 'Serata privata',
      expectedCompensation: null,
      expensesIncluded: false
    });
  }

  roleLabel(): string {
    if (this.requestedRole === 'dj') return 'DJ';
    if (this.requestedRole === 'teacher') return 'Insegnante';
    return 'Musicista';
  }

  private loadBusySlots(): void {
    const events = readEventsForDisplay();
    if (!Array.isArray(events)) return;
    this.busySlots = events
      .filter((e: any) => `${e?.status || ''}` !== 'cancelled')
      .map((e: any) => ({ date: `${e?.date || ''}`, timeStart: `${e?.timeStart || ''}` }));
  }

  private logCommunicationRequest(request: any): void {
    const logs = safeParse<any[]>(localStorage.getItem('mm_communication_history'), []);
    const list = Array.isArray(logs) ? logs : [];
    list.unshift({
      id: crypto.randomUUID(),
      type: 'booking_request',
      data: {
        name: request.customerName,
        bandName: request.bandName,
        role: request.role,
        sourceType: request.sourceType,
        date: request.eventDate,
        eventTime: request.eventTime,
        eventCity: request.eventCity,
        expectedCompensation: request.expectedCompensation,
        expensesIncluded: request.expensesIncluded
      },
      createdAt: new Date().toISOString()
    });
    localStorage.setItem('mm_communication_history', JSON.stringify(list.slice(0, 300)));
  }

  private formatExpectedFee(min: number, max: number): string {
    if (min > 0 && max > 0) return `${min}€ – ${max}€`;
    if (min > 0) return `Da ${min}€`;
    if (max > 0) return `Fino a ${max}€`;
    return '';
  }
}
