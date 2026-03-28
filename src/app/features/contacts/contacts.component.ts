import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/supabase.service';
import { formatItalianAddressLabel, italianAddressTypeScore } from '../../core/italian-geo';

type ContactType = 'band' | 'school' | 'student';
type PaymentCadence = 'prestazione' | 'mensile';
type MonthlySettlement = 'acconto' | 'bonifico';

type ContactEntry = {
  id: string;
  type: ContactType;
  displayName: string;
  positionCity: string;
  positionAddress: string;
  phone: string;
  email: string;
  priority: number;
  averageFee: number;
  billingMode: 'in_fattura' | 'fuori_fattura';
  billingName: string;
  billingVatNumber: string;
  billingFiscalCode: string;
  billingSdi: string;
  billingPec: string;
  billingAddress: string;
  billingCity: string;
  billingZip: string;
  billingCountry: string;
  billingNotes: string;
  paymentCadence: PaymentCadence;
  monthlySettlement: MonthlySettlement;
  isMinor: boolean;
  billedToParent: boolean;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  privacyConsentAccepted: boolean;
  consentDocumentName: string;
  consentDocumentDataUrl: string;
  notes: string;
  createdAt: string;
};

type ContactAddressField = 'positionCity' | 'positionAddress' | 'billingCity' | 'billingCountry';

@Component({
  selector: 'app-contacts',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contacts.component.html',
  styleUrls: ['./contacts.component.scss']
})
export class ContactsComponent implements OnInit, OnDestroy {
  contacts: ContactEntry[] = [];
  form: ContactEntry = this.defaultForm();
  saved = false;
  formError = '';
  copiedConsentId: string | null = null;
  filterType: 'all' | ContactType = 'all';
  filterPriorityMin = 1;
  filterCity = '';
  showCreateForm = false;
  syncMessage = '';
  positionCitySuggestions: string[] = [];
  positionAddressSuggestions: string[] = [];
  billingCitySuggestions: string[] = [];
  billingCountrySuggestions: string[] = [];
  private addressSearchTimers: Partial<Record<ContactAddressField, ReturnType<typeof setTimeout>>> = {};
  private addressSearchAborters: Partial<Record<ContactAddressField, AbortController>> = {};
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private supabase: SupabaseService) {}

  async ngOnInit(): Promise<void> {
    this.contacts = this.mergeInferredContacts(this.readContacts());
    this.persistContacts();
    await this.mergeSupabaseContacts();
    await this.syncContactsSafe();
    this.refreshTimer = setInterval(() => {
      void this.refreshFromSupabase();
    }, 15000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    Object.values(this.addressSearchTimers).forEach(timer => {
      if (timer) clearTimeout(timer);
    });
    Object.values(this.addressSearchAborters).forEach(controller => controller?.abort());
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    void this.refreshFromSupabase();
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      void this.refreshFromSupabase();
    }
  }

  openNewContactForm(): void {
    this.form = this.defaultForm();
    this.formError = '';
    this.showCreateForm = true;
  }

  closeNewContactForm(): void {
    this.showCreateForm = false;
  }

  saveContact(): void {
    this.formError = '';
    const name = `${this.form.displayName || ''}`.trim();
    if (!name) {
      this.formError = 'Inserisci il nome del contatto';
      return;
    }
    if (this.form.type === 'student' && this.form.isMinor) {
      const hasParentContact = `${this.form.parentPhone || ''}`.trim() || `${this.form.parentEmail || ''}`.trim();
      if (!hasParentContact) {
        this.formError = 'Per minorenne inserisci telefono o email del genitore';
        return;
      }
    }
    const next: ContactEntry = {
      id: crypto.randomUUID(),
      type: this.form.type,
      displayName: name,
      positionCity: `${this.form.positionCity || ''}`.trim(),
      positionAddress: `${this.form.positionAddress || ''}`.trim(),
      phone: `${this.form.phone || ''}`.trim(),
      email: `${this.form.email || ''}`.trim(),
      priority: this.normalizePriority(this.form.priority),
      averageFee: Number(this.form.averageFee || 0),
      billingMode: this.form.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
      billingName: `${this.form.billingName || ''}`.trim(),
      billingVatNumber: `${this.form.billingVatNumber || ''}`.trim(),
      billingFiscalCode: `${this.form.billingFiscalCode || ''}`.trim(),
      billingSdi: `${this.form.billingSdi || ''}`.trim(),
      billingPec: `${this.form.billingPec || ''}`.trim(),
      billingAddress: `${this.form.billingAddress || ''}`.trim(),
      billingCity: `${this.form.billingCity || ''}`.trim(),
      billingZip: `${this.form.billingZip || ''}`.trim(),
      billingCountry: `${this.form.billingCountry || ''}`.trim(),
      billingNotes: `${this.form.billingNotes || ''}`.trim(),
      paymentCadence: this.form.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
      monthlySettlement: this.form.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto',
      isMinor: this.form.type === 'student' ? !!this.form.isMinor : false,
      billedToParent: this.form.type === 'student' ? !!this.form.billedToParent : false,
      parentName: `${this.form.parentName || ''}`.trim(),
      parentPhone: `${this.form.parentPhone || ''}`.trim(),
      parentEmail: `${this.form.parentEmail || ''}`.trim(),
      privacyConsentAccepted: false,
      consentDocumentName: `${this.form.consentDocumentName || ''}`.trim(),
      consentDocumentDataUrl: `${this.form.consentDocumentDataUrl || ''}`,
      notes: `${this.form.notes || ''}`.trim(),
      createdAt: new Date().toISOString()
    };
    this.contacts.unshift(next);
    this.contacts = this.sortContacts(this.contacts);
    const persisted = this.persistContacts();
    void this.syncContactsSafe(!persisted);
    this.form = this.defaultForm();
    this.showCreateForm = false;
    this.saved = true;
    if (!persisted) {
      this.syncMessage = 'Contatto salvato senza cache locale stabile • disponibile via sincronizzazione remota';
    }
    setTimeout(() => (this.saved = false), 1500);
  }

  removeContact(id: string): void {
    this.contacts = this.contacts.filter(x => x.id !== id);
    const persisted = this.persistContacts();
    void this.syncContactsSafe(!persisted);
  }

  get filteredContacts(): ContactEntry[] {
    const cityNeedle = this.filterCity.trim().toLowerCase();
    return this.contacts.filter(c => {
      if (this.filterType !== 'all' && c.type !== this.filterType) return false;
      if (c.priority < this.filterPriorityMin) return false;
      if (!cityNeedle) return true;
      return (c.positionCity || '').toLowerCase().includes(cityNeedle);
    });
  }

  get pendingMinorConsentsCount(): number {
    return this.contacts.filter(c => this.canShowParentConsent(c) && !c.privacyConsentAccepted).length;
  }

  typeLabel(t: ContactType): string {
    if (t === 'band') return 'Band';
    if (t === 'school') return 'Scuola';
    return 'Allievo';
  }

  consentLink(id: string): string {
    return `${window.location.origin}/privacy-consent/${id}`;
  }

  copyConsentLink(id: string): void {
    navigator.clipboard.writeText(this.consentLink(id)).then(() => {
      this.copiedConsentId = id;
      setTimeout(() => (this.copiedConsentId = null), 1600);
    });
  }

  canShowParentConsent(c: ContactEntry): boolean {
    return c.type === 'student' && c.isMinor;
  }

  onAddressInput(field: ContactAddressField, rawValue: string): void {
    const value = `${rawValue || ''}`.trim();
    const timer = this.addressSearchTimers[field];
    if (timer) clearTimeout(timer);
    if (value.length < 2) {
      this.setAddressSuggestions(field, []);
      return;
    }
    this.addressSearchTimers[field] = setTimeout(() => {
      void this.fetchAddressSuggestions(field, value);
    }, 220);
  }

  private async fetchAddressSuggestions(field: ContactAddressField, query: string): Promise<void> {
    this.addressSearchAborters[field]?.abort();
    const controller = new AbortController();
    this.addressSearchAborters[field] = controller;
    try {
      const isCountryField = field === 'billingCountry';
      const url = isCountryField
        ? `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=7&countrycodes=it&addressdetails=1`
        : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=7&countrycodes=it&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'it' },
        signal: controller.signal
      });
      if (!res.ok) return;
      const rows = await res.json();
      const current = `${this.form[field] || ''}`.trim();
      if (this.normalizeSearch(current) !== this.normalizeSearch(query)) return;
      const suggestions = this.rankNominatimRows(rows, query, isCountryField).slice(0, 7).map(x => x.label);
      this.setAddressSuggestions(field, suggestions);
    } catch (error: any) {
      if (error?.name !== 'AbortError') this.setAddressSuggestions(field, []);
    }
  }

  private setAddressSuggestions(field: ContactAddressField, suggestions: string[]): void {
    if (field === 'positionCity') this.positionCitySuggestions = suggestions;
    if (field === 'positionAddress') this.positionAddressSuggestions = suggestions;
    if (field === 'billingCity') this.billingCitySuggestions = suggestions;
    if (field === 'billingCountry') this.billingCountrySuggestions = suggestions;
  }

  private normalizeSearch(value: string): string {
    return `${value || ''}`.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private rankNominatimRows(rows: any[], query: string, countryOnly: boolean): Array<{ label: string; score: number }> {
    const normalizedQuery = this.normalizeSearch(query);
    const seen = new Set<string>();
    const ranked: Array<{ label: string; score: number }> = [];
    for (const row of rows) {
      const label = countryOnly ? this.formatCountryLabel(row) : this.formatNominatimLabel(row);
      const key = this.normalizeSearch(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const addresstype = `${row?.addresstype || row?.type || ''}`.toLowerCase();
      const importance = Number(row?.importance || 0);
      let score = this.addressTypeScore(addresstype) + Math.max(0, Math.min(30, importance * 30));
      if (key.startsWith(normalizedQuery)) score += 40;
      else if (key.includes(normalizedQuery)) score += 20;
      ranked.push({ label, score });
    }
    return ranked.sort((a, b) => b.score - a.score);
  }

  private formatCountryLabel(row: any): string {
    const country = `${row?.address?.country || ''}`.trim();
    return country || `${row?.display_name || ''}`.trim();
  }

  private formatNominatimLabel(row: any): string {
    return formatItalianAddressLabel(row, value => this.normalizeSearch(value));
  }

  private addressTypeScore(addresstype: string): number {
    return italianAddressTypeScore(addresstype);
  }

  onConsentFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      this.form.consentDocumentDataUrl = result;
      this.form.consentDocumentName = file.name;
    };
    reader.readAsDataURL(file);
  }

  private persistContacts(): boolean {
    this.contacts = this.sortContacts(this.contacts);
    try {
      localStorage.setItem('mm_contacts', JSON.stringify(this.contacts));
      return true;
    } catch {
      return false;
    }
  }

  private readContacts(): ContactEntry[] {
    const parsed = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x: any): ContactEntry => ({
        id: `${x.id || crypto.randomUUID()}`,
        type: (x.type === 'school' || x.type === 'student' ? x.type : 'band') as ContactType,
        displayName: `${x.displayName || ''}`.trim(),
        positionCity: `${x.positionCity || ''}`.trim(),
        positionAddress: `${x.positionAddress || ''}`.trim(),
        phone: `${x.phone || ''}`.trim(),
        email: `${x.email || ''}`.trim(),
        priority: this.normalizePriority(Number(x.priority || 3)),
        averageFee: Number(x.averageFee || 0),
        billingMode: x.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
        billingName: `${x.billingName || ''}`.trim(),
        billingVatNumber: `${x.billingVatNumber || ''}`.trim(),
        billingFiscalCode: `${x.billingFiscalCode || ''}`.trim(),
        billingSdi: `${x.billingSdi || ''}`.trim(),
        billingPec: `${x.billingPec || ''}`.trim(),
        billingAddress: `${x.billingAddress || ''}`.trim(),
        billingCity: `${x.billingCity || ''}`.trim(),
        billingZip: `${x.billingZip || ''}`.trim(),
        billingCountry: `${x.billingCountry || ''}`.trim(),
        billingNotes: `${x.billingNotes || ''}`.trim(),
        paymentCadence: x.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
        monthlySettlement: x.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto',
        isMinor: !!x.isMinor,
        billedToParent: !!x.billedToParent,
        parentName: `${x.parentName || ''}`.trim(),
        parentPhone: `${x.parentPhone || ''}`.trim(),
        parentEmail: `${x.parentEmail || ''}`.trim(),
        privacyConsentAccepted: !!x.privacyConsentAccepted,
        consentDocumentName: `${x.consentDocumentName || ''}`.trim(),
        consentDocumentDataUrl: `${x.consentDocumentDataUrl || ''}`,
        notes: `${x.notes || ''}`.trim(),
        createdAt: `${x.createdAt || new Date().toISOString()}`
      }))
      .filter((x: ContactEntry) => !!x.displayName)
      .sort((a: ContactEntry, b: ContactEntry) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.displayName.localeCompare(b.displayName);
      });
  }

  private sortContacts(list: ContactEntry[]): ContactEntry[] {
    return [...list].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.displayName.localeCompare(b.displayName);
    });
  }

  private normalizeKey(type: ContactType, name: string): string {
    return `${type}::${name.trim().toLowerCase()}`;
  }

  private mergeInferredContacts(base: ContactEntry[]): ContactEntry[] {
    const current = [...base];
    const index = new Set(current.map(c => this.normalizeKey(c.type, c.displayName)));
    const addIfMissing = (entry: ContactEntry) => {
      const key = this.normalizeKey(entry.type, entry.displayName);
      if (!entry.displayName || index.has(key)) return;
      current.push(entry);
      index.add(key);
    };
    const concerts = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    if (Array.isArray(concerts)) {
      concerts.forEach((c: any) => {
        const groups = Array.isArray(c.bands) ? c.bands : [];
        groups.forEach((g: any) => {
          const name = `${g || ''}`.trim();
          if (!name) return;
          addIfMissing({
            ...this.defaultForm(),
            id: crypto.randomUUID(),
            type: 'band',
            displayName: name,
            averageFee: Number(c.agreedFee || 0),
            priority: 3,
            createdAt: `${c.createdAt || new Date().toISOString()}`
          });
        });
      });
    }
    const schools = JSON.parse(localStorage.getItem('mm_teaching_schools') || '[]');
    if (Array.isArray(schools)) {
      schools.forEach((s: any) => {
        const name = `${s.name || ''}`.trim();
        if (!name) return;
        addIfMissing({
          ...this.defaultForm(),
          id: crypto.randomUUID(),
          type: 'school',
          displayName: name,
          averageFee: Number(s.hourlyRate || 0),
          priority: 3,
          createdAt: `${s.createdAt || new Date().toISOString()}`
        });
      });
    }
    const students = JSON.parse(localStorage.getItem('mm_teaching_students') || '[]');
    if (Array.isArray(students)) {
      students.forEach((s: any) => {
        const name = `${s.fullName || ''}`.trim();
        if (!name) return;
        addIfMissing({
          ...this.defaultForm(),
          id: crypto.randomUUID(),
          type: 'student',
          displayName: name,
          priority: 3,
          createdAt: `${s.createdAt || new Date().toISOString()}`
        });
      });
    }
    return this.sortContacts(current);
  }

  private async mergeSupabaseContacts(): Promise<void> {
    const musicianId = localStorage.getItem('musicianId') || '';
    if (!musicianId) return;
    const remote = await this.supabase.loadContactsFromSupabase(musicianId);
    if (!remote.length) return;
    const merged = [...this.contacts];
    const index = new Map(merged.map((c, position) => [this.normalizeKey(c.type, c.displayName), position]));
    remote.forEach((row: any) => {
      const payload = row.payload || {};
      const normalized: ContactEntry = {
        ...this.defaultForm(),
        id: `${row.source_id || payload.id || crypto.randomUUID()}`,
        type: (row.type === 'school' || row.type === 'student' ? row.type : 'band') as ContactType,
        displayName: `${row.display_name || payload.displayName || ''}`.trim(),
        positionCity: `${row.city || payload.positionCity || ''}`.trim(),
        positionAddress: `${row.address || payload.positionAddress || ''}`.trim(),
        phone: `${row.phone || payload.phone || ''}`.trim(),
        email: `${row.email || payload.email || ''}`.trim(),
        priority: this.normalizePriority(Number(row.priority || payload.priority || 3)),
        averageFee: Number(row.average_fee || payload.averageFee || 0),
        billingMode: payload.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
        billingName: `${payload.billingName || ''}`.trim(),
        billingVatNumber: `${payload.billingVatNumber || ''}`.trim(),
        billingFiscalCode: `${payload.billingFiscalCode || ''}`.trim(),
        billingSdi: `${payload.billingSdi || ''}`.trim(),
        billingPec: `${payload.billingPec || ''}`.trim(),
        billingAddress: `${payload.billingAddress || ''}`.trim(),
        billingCity: `${payload.billingCity || ''}`.trim(),
        billingZip: `${payload.billingZip || ''}`.trim(),
        billingCountry: `${payload.billingCountry || 'Italia'}`.trim(),
        billingNotes: `${payload.billingNotes || ''}`.trim(),
        paymentCadence: payload.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
        monthlySettlement: payload.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto',
        isMinor: !!payload.isMinor,
        billedToParent: !!payload.billedToParent,
        parentName: `${payload.parentName || ''}`.trim(),
        parentPhone: `${payload.parentPhone || ''}`.trim(),
        parentEmail: `${payload.parentEmail || ''}`.trim(),
        privacyConsentAccepted: !!payload.privacyConsentAccepted,
        consentDocumentName: `${payload.consentDocumentName || ''}`.trim(),
        consentDocumentDataUrl: `${payload.consentDocumentDataUrl || ''}`,
        notes: `${row.notes || payload.notes || ''}`.trim(),
        createdAt: `${payload.createdAt || new Date().toISOString()}`
      };
      const key = this.normalizeKey(normalized.type, normalized.displayName);
      if (!normalized.displayName) return;
      const existingIndex = index.get(key);
      if (existingIndex === undefined) {
        merged.push(normalized);
        index.set(key, merged.length - 1);
        return;
      }
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...normalized,
        id: merged[existingIndex].id || normalized.id,
        createdAt: merged[existingIndex].createdAt || normalized.createdAt
      };
    });
    this.contacts = this.sortContacts(merged);
    this.persistContacts();
  }

  private async refreshFromSupabase(): Promise<void> {
    this.contacts = this.mergeInferredContacts(this.readContacts());
    await this.mergeSupabaseContacts();
  }

  private async syncContactsSafe(forceRemote = false): Promise<void> {
    const musicianId = localStorage.getItem('musicianId') || '';
    if (!musicianId) {
      this.syncMessage = 'Sync Supabase non attiva: profilo non ancora collegato';
      return;
    }
    const ok = forceRemote
      ? await this.supabase.syncContactsToSupabase(musicianId, this.contacts)
      : await this.supabase.syncContactsFromLocalStorage(musicianId);
    this.syncMessage = ok
      ? `Contatti sincronizzati con Supabase • ${this.contacts.length} salvati`
      : `Contatti salvati in questo dispositivo • accedi allo stesso account per sincronizzarli tra i dispositivi`;
  }

  private defaultForm(): ContactEntry {
    return {
      id: '',
      type: 'band',
      displayName: '',
      positionCity: '',
      positionAddress: '',
      phone: '',
      email: '',
      priority: 3,
      averageFee: 0,
      billingMode: 'fuori_fattura',
      billingName: '',
      billingVatNumber: '',
      billingFiscalCode: '',
      billingSdi: '',
      billingPec: '',
      billingAddress: '',
      billingCity: '',
      billingZip: '',
      billingCountry: 'Italia',
      billingNotes: '',
      paymentCadence: 'prestazione',
      monthlySettlement: 'acconto',
      isMinor: false,
      billedToParent: false,
      parentName: '',
      parentPhone: '',
      parentEmail: '',
      privacyConsentAccepted: false,
      consentDocumentName: '',
      consentDocumentDataUrl: '',
      notes: '',
      createdAt: ''
    };
  }

  private normalizePriority(priority: number): number {
    if (!Number.isFinite(priority)) return 3;
    return Math.max(1, Math.min(5, Math.round(priority)));
  }
}
