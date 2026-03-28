import { Injectable } from '@angular/core';
import { EventDetail } from '../models/event-detail';
import { Expense } from '../models/expense';
import { AppLicenseContext, SupabaseService } from './supabase.service';
import { LocalStorageService, LS } from './local-storage.service';

const MM_APP_SCHEMA_VERSION = '2026-03-26-mm-namespace-v1';

export interface IdentityContext {
  appKey: string;
  authUserId: string | null;
  email: string | null;
  musicianId: string | null;
  musicianCode: string | null;
  profile: Record<string, any>;
  license: AppLicenseContext | null;
  hasServerContext: boolean;
}

@Injectable({ providedIn: 'root' })
export class IdentityContextService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly ls: LocalStorageService
  ) {}

  async bootstrap(appKey = 'musician_manager'): Promise<IdentityContext | null> {
    const normalizedApp = `${appKey || 'musician_manager'}`.trim() || 'musician_manager';
    this.ls.setString(LS.LICENSE_APP, normalizedApp);
    this.ensureCurrentAppSchema();

    const authUser = await this.supabase.getCurrentUser();
    const storedAuthUserId = this.ls.getAuthUserId();
    const storedEmail = `${this.ls.getString(LS.USER_EMAIL) || ''}`.trim().toLowerCase();
    const currentEmail = `${authUser?.email || ''}`.trim().toLowerCase();
    if (authUser?.id && storedAuthUserId && storedAuthUserId !== authUser.id) {
      this.ls.clearAccountScopedData();
      this.ls.setString(LS.LICENSE_APP, normalizedApp);
    } else if (authUser?.id && !storedAuthUserId && storedEmail && currentEmail && storedEmail !== currentEmail) {
      this.ls.clearAccountScopedData();
      this.ls.setString(LS.LICENSE_APP, normalizedApp);
    }

    let resolved = await this.supabase.resolveIdentityContext(normalizedApp, authUser?.id || null);
    const email = `${resolved?.email || authUser?.email || this.ls.getString(LS.USER_EMAIL) || ''}`.trim().toLowerCase() || null;
    this.ls.setAuthIdentity(authUser?.id || null, email);

    const fallbackLicense = !resolved?.license && email
      ? await this.supabase.findActiveLicenseByEmail(normalizedApp, email, ['active', 'pending'])
      : null;
    let license = resolved?.license || fallbackLicense;

    if (license?.status === 'pending' && license?.inviteRef && authUser?.id) {
      try {
        await this.supabase.activateLicenseFromRef(license.inviteRef, normalizedApp, email || '');
        resolved = await this.supabase.resolveIdentityContext(normalizedApp, authUser.id);
        const refreshed = email
          ? await this.supabase.findActiveLicenseByEmail(normalizedApp, email, ['active', 'pending'])
          : null;
        license = resolved?.license || refreshed || license;
      } catch {}
    }

    const cachedCode = this.normalizeCode(this.ls.getAffilCode());
    const musicianCode = this.normalizeCode(
      resolved?.musicianCode ||
      license?.affiliationCode ||
      (license?.subjectType === 'musician' ? license?.subjectKey || '' : '') ||
      cachedCode
    );

    if (license?.inviteRef) this.ls.setString(LS.LICENSE_REF, license.inviteRef);
    if (musicianCode) this.ls.setAffilCode(musicianCode);

    const licenseKey = license?.inviteRef || null;
    let profile = resolved?.profile || await this.supabase.loadRegistryProfile({
      musicianCode,
      email,
      authUserId: authUser?.id || null,
      licenseKey
    });
    if (!profile && authUser?.id && (license || email)) {
      try {
        if (license?.inviteRef) {
          await this.supabase.activateLicenseFromRef(license.inviteRef, normalizedApp, email || '');
        }
        await this.supabase.syncAffiliationCodeFromLicense();
        profile = await this.supabase.loadRegistryProfile({
          musicianCode: this.normalizeCode(this.ls.getAffilCode()),
          email,
          authUserId: authUser.id,
          licenseKey
        });
      } catch {}
    }
    const mergedProfile = this.mergePreferNonEmpty(this.ls.getProfile(), profile || {});
    if (Object.keys(mergedProfile).length) {
      this.ls.setProfile(mergedProfile);
      this.writeProfilePrimitives(mergedProfile);
    }

    const musicianId = `${resolved?.musicianId || profile?.['id'] || this.ls.getString(LS.MUSICIAN_ID) || ''}`.trim() || null;
    if (musicianId) this.ls.setString(LS.MUSICIAN_ID, musicianId);
    if (musicianId) {
      await this.hydrateCaches(musicianId);
      try {
        await this.supabase.syncAllFromLocalStorage(musicianId);
      } catch {}
    }

    const hasServerContext = resolved?.canAccessApp === true || !!(license || profile);
    if (!hasServerContext && !this.hasMeaningfulProfile(this.ls.getProfile())) {
      return null;
    }

    return {
      appKey: normalizedApp,
      authUserId: resolved?.authUserId || authUser?.id || null,
      email,
      musicianId,
      musicianCode,
      profile: mergedProfile,
      license,
      hasServerContext
    };
  }

  private ensureCurrentAppSchema(): void {
    const current = `${this.ls.getString(LS.APP_SCHEMA_VERSION) || ''}`.trim();
    if (current === MM_APP_SCHEMA_VERSION) return;
    this.ls.clearOperationalData();
    this.ls.setString(LS.APP_SCHEMA_VERSION, MM_APP_SCHEMA_VERSION);
  }

  private async hydrateCaches(musicianId: string): Promise<void> {
    const profile = this.ls.getProfile();
    const firstName = `${profile['firstName'] || this.ls.getString(LS.FIRST_NAME) || ''}`.trim();
    const lastName = `${profile['lastName'] || this.ls.getString(LS.LAST_NAME) || ''}`.trim();
    const bookingSlug = `${firstName}-${lastName}`
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const affiliationCode = `${this.ls.getAffilCode() || ''}`.trim().toUpperCase();

    const [remoteEvents, remoteContacts, remoteExpenses, remoteBookingRequests, remoteSnapshot] = await Promise.all([
      this.supabase.loadEventsFromSupabase(musicianId),
      this.supabase.loadContactsFromSupabase(musicianId),
      this.supabase.loadExpensesFromSupabase(musicianId),
      this.supabase.loadBookingRequestsFromSupabase(musicianId, bookingSlug, affiliationCode),
      this.supabase.loadStateSnapshotFromSupabase(musicianId)
    ]);

    const localEvents = this.ls.getArray<EventDetail>(LS.EVENTS);
    const snapshotEvents = Array.isArray(remoteSnapshot?.['events']) ? remoteSnapshot?.['events'] as EventDetail[] : [];
    if (remoteEvents.length || snapshotEvents.length) {
      this.ls.setArray(LS.EVENTS, this.mergeByKey(this.mergeByKey(localEvents, snapshotEvents, event => `${event?.id || ''}`), remoteEvents, event => `${event?.id || ''}`));
    }

    const localContacts = this.ls.getArray<any>(LS.CONTACTS);
    const mappedContacts = remoteContacts
        .map((row: any) => row?.payload || {
          id: `${row?.source_id || row?.id || crypto.randomUUID()}`,
          type: `${row?.type || 'band'}`,
          displayName: `${row?.display_name || ''}`.trim(),
          phone: `${row?.phone || ''}`.trim(),
          email: `${row?.email || ''}`.trim(),
          priority: Number(row?.priority || 3),
          averageFee: Number(row?.average_fee || 0),
          billingMode: row?.billing_mode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
          paymentCadence: row?.payment_cadence === 'mensile' ? 'mensile' : 'prestazione',
          monthlySettlement: row?.monthly_settlement === 'bonifico' ? 'bonifico' : 'acconto',
          positionCity: `${row?.city || ''}`.trim(),
          positionAddress: `${row?.address || ''}`.trim(),
          notes: `${row?.notes || ''}`,
          createdAt: `${row?.created_at || new Date().toISOString()}`
        })
        .filter((entry: any) => !!`${entry?.displayName || ''}`.trim());
    const snapshotContacts = Array.isArray(remoteSnapshot?.['contacts']) ? remoteSnapshot?.['contacts'] as any[] : [];
    if (mappedContacts.length || snapshotContacts.length) {
      this.ls.setArray(LS.CONTACTS, this.mergeByKey(this.mergeByKey(localContacts, snapshotContacts, entry => `${entry?.id || ''}`), mappedContacts, entry => `${entry?.id || ''}`));
    }

    const localExpenses = this.ls.getArray<Expense>(LS.EXPENSES);
    const snapshotExpenses = Array.isArray(remoteSnapshot?.['expenses']) ? remoteSnapshot?.['expenses'] as Expense[] : [];
    if (remoteExpenses.length || snapshotExpenses.length) {
      this.ls.setArray(LS.EXPENSES, this.mergeByKey(this.mergeByKey(localExpenses, snapshotExpenses, expense => `${expense?.id || ''}`), remoteExpenses, expense => `${expense?.id || ''}`));
    }

    const localBookingRequests = this.ls.getArray<any>(LS.BOOKING_REQUESTS);
    const snapshotBookingRequests = Array.isArray(remoteSnapshot?.['bookingRequests']) ? remoteSnapshot?.['bookingRequests'] as any[] : [];
    if (remoteBookingRequests.length || snapshotBookingRequests.length) {
      const merged = new Map<string, any>();
      localBookingRequests.forEach(entry => merged.set(`${entry?.id || crypto.randomUUID()}`, entry));
      snapshotBookingRequests.forEach(entry => merged.set(`${entry?.id || crypto.randomUUID()}`, entry));
      remoteBookingRequests.forEach(entry => merged.set(`${entry?.id || crypto.randomUUID()}`, entry));
      this.ls.setArray(LS.BOOKING_REQUESTS, Array.from(merged.values()).sort((a, b) => `${b?.createdAt || ''}`.localeCompare(`${a?.createdAt || ''}`)));
    }

    const localConcerts = this.ls.getArray<any>(LS.CONCERTS);
    const snapshotConcerts = Array.isArray(remoteSnapshot?.['concerts']) ? remoteSnapshot?.['concerts'] as any[] : [];
    if (remoteEvents.length || snapshotConcerts.length) {
      const concerts = remoteEvents
        .filter(event => `${event?.type || ''}` === 'concert')
        .map(event => ({
          id: `${event.id || crypto.randomUUID()}`,
          title: `${event.title || ''}`.trim() || 'Concerto',
          date: `${event.date || ''}`,
          timeStart: `${event.timeStart || ''}`,
          venue: `${event.venue || ''}`.trim(),
          address: `${event.address || ''}`.trim(),
          lineupType: 'band',
          agreedFee: Number(event.grossFee || 0),
          reimbursement: 0,
          notes: `${event.notes || ''}`.trim(),
          bands: Array.isArray(event.band) ? event.band : [],
          musicians: [],
          contactId: null,
          billingMode: event.compensoType === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
          paymentCadence: 'prestazione',
          monthlySettlement: 'acconto',
          extraExpensesOutsideInvoice: true,
          executionStatus: event.status === 'cancelled' ? 'annullato' : 'da_fare',
          reimbursedAmount: 0,
          createdAt: `${event.createdAt || new Date().toISOString()}`
        }));
      this.ls.setArray(LS.CONCERTS, this.mergeByKey(this.mergeByKey(localConcerts, snapshotConcerts, concert => `${concert?.id || ''}`), concerts, concert => `${concert?.id || ''}`));
    }

    const snapshotSettings = remoteSnapshot?.['settings'];
    if (snapshotSettings && typeof snapshotSettings === 'object') {
      this.ls.set(LS.SETTINGS, this.mergePreferNonEmpty(this.ls.getSettings(), snapshotSettings));
    }
  }

  private writeProfilePrimitives(profile: Record<string, any>): void {
    const primitives: Array<[string, unknown]> = [
      [LS.FIRST_NAME, profile['firstName']],
      [LS.LAST_NAME, profile['lastName']],
      [LS.PHONE, profile['phone']],
      [LS.HOME_BASE, profile['homeBase']],
      [LS.USER_EMAIL, profile['licenseEmail']]
    ];
    primitives.forEach(([key, value]) => {
      const text = `${value ?? ''}`.trim();
      if (text) this.ls.setString(key, text);
    });
  }

  private mergePreferNonEmpty(localValue: Record<string, any>, remoteValue: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = { ...localValue };
    for (const [key, value] of Object.entries(remoteValue || {})) {
      if (this.hasMeaningfulValue(value)) {
        out[key] = value;
        continue;
      }
      if (!(key in out)) out[key] = value;
    }
    return out;
  }

  private mergeByKey<T>(localItems: T[], remoteItems: T[], getKey: (item: T) => string): T[] {
    const merged = new Map<string, T>();
    (localItems || []).forEach(item => {
      const key = getKey(item);
      if (key) merged.set(key, item);
    });
    (remoteItems || []).forEach(item => {
      const key = getKey(item);
      if (key) merged.set(key, item);
    });
    return Array.from(merged.values());
  }

  private hasMeaningfulProfile(profile: Record<string, any>): boolean {
    return Object.values(profile || {}).some(value => this.hasMeaningfulValue(value));
  }

  private hasMeaningfulValue(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return value !== null && value !== undefined;
  }

  private normalizeCode(value: string | null | undefined): string | null {
    const text = `${value || ''}`.trim().toUpperCase();
    return text || null;
  }
}
