import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SupabaseService } from '../../core/supabase.service';

type CommRole = 'musician' | 'dj' | 'teacher';
type RequestStatus = 'new' | 'confirmed' | 'receipt_sent' | 'declined';

type BookingRequestEntry = {
  id: string;
  batchId: string;
  slug: string;
  musicianName: string;
  role: CommRole;
  roleLabel: string;
  affiliationCode: string | null;
  sourceType: string;
  allowBandInvites: boolean;
  customerName: string;
  bandName: string;
  customerEmail: string;
  customerPhone: string;
  eventCity: string;
  eventProvince: string;
  eventDate: string;
  eventTime: string;
  eventType: string;
  bookingCode: string;
  message: string;
  createdAt: string;
  status: RequestStatus;
  statusUpdatedAt: string | null;
  confirmedAt: string | null;
  confirmationSentAt: string | null;
  receiptSentAt: string | null;
  declinedAt: string | null;
  contactId: string | null;
  internalNotes: string;
};

type BatchGroup = {
  batchId: string;
  customerName: string;
  bandName: string;
  customerEmail: string;
  customerPhone: string;
  eventCity: string;
  eventProvince: string;
  message: string;
  role: CommRole;
  roleLabel: string;
  createdAt: string;
  requests: BookingRequestEntry[];
};

type CommunicationLogEntry = {
  id: string;
  type: string;
  data: Record<string, any>;
  createdAt: string;
};

@Component({
  selector: 'app-communication',
  templateUrl: './communication.component.html',
  styleUrls: ['./communication.component.scss']
})
export class CommunicationComponent implements OnInit {
  settingsForm!: FormGroup;
  musicianName = '';
  bookingLinks: Record<CommRole, string> = { musician: '', dj: '', teacher: '' };
  bookingSlug = '';
  activeRole: CommRole = 'musician';
  roleEnabled: Record<CommRole, boolean> = { musician: true, dj: false, teacher: false };
  copied = false;
  codeCopied = false;
  saved = false;
  affiliationCode = '';
  bookingRequests: BookingRequestEntry[] = [];
  contactsHistory: any[] = [];
  communicationHistory: CommunicationLogEntry[] = [];

  // UI state
  linkExpanded = false;
  settingsExpanded = false;
  historyTab: 'requests' | 'contacts' | 'log' = 'requests';
  replyingTo = '';
  replyMessage = '';

  readonly italianRegions = [
    'Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna',
    'Friuli Venezia Giulia', 'Lazio', 'Liguria', 'Lombardia', 'Marche',
    'Molise', 'Piemonte', 'Puglia', 'Sardegna', 'Sicilia',
    'Toscana', 'Trentino-Alto Adige', 'Umbria', "Valle d'Aosta", 'Veneto'
  ];

  constructor(private fb: FormBuilder, private supabase: SupabaseService) {}

  ngOnInit(): void {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    this.roleEnabled = {
      musician: profile?.isMusician !== false,
      dj: profile?.isDj === true,
      teacher: profile?.isTeacher === true
    };
    this.activeRole = this.firstEnabledRole();
    const firstName = localStorage.getItem('mm_firstName') || '';
    const lastName = localStorage.getItem('mm_lastName') || '';
    this.musicianName = `${firstName} ${lastName}`.trim();
    this.bookingSlug = this.slugify(`${firstName}-${lastName}`);

    const stored = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    this.affiliationCode =
      stored.affiliationCode ||
      localStorage.getItem('mm_affiliation_code') ||
      localStorage.getItem('musicianCode') ||
      '';
    this.refreshBookingLinks();
    this.settingsForm = this.fb.group({
      minFee: [stored.minFee || 0, [Validators.min(0)]],
      maxFee: [stored.maxFee || 0, [Validators.min(0)]],
      feeNotes: [stored.feeNotes || ''],
      allowBandInvites: [stored.allowBandInvites !== false],
      availWeekdays: [stored.availWeekdays !== false],
      availWeekends: [stored.availWeekends !== false],
      availTimeFrom: [stored.availTimeFrom || '18:00'],
      availTimeTo: [stored.availTimeTo || '23:59'],
      showInstrument: [stored.showInstrument !== false],
      showStyles: [stored.showStyles !== false],
      customMessage: [stored.customMessage || ''],
      departureCity: [stored.departureCity || ''],
      departureRegion: [stored.departureRegion || ''],
      searchRadiusKm: [stored.searchRadiusKm || 100]
    });
    this.loadRoleSettings(this.activeRole, stored);
    this.loadHistory();
    void this.syncBookingRequestsHistory();
  }

  get bookingLink(): string {
    return this.bookingLinks[this.activeRole];
  }

  get roleLabel(): string {
    return this.roleLabelFor(this.activeRole);
  }

  get canManageArchiveHistory(): boolean {
    return this.activeRole !== 'teacher';
  }

  get activeBookingRequests(): BookingRequestEntry[] {
    if (!this.canManageArchiveHistory) return [];
    return this.bookingRequests.filter(r => r.role === this.activeRole);
  }

  get activeBatchGroups(): BatchGroup[] {
    const requests = this.activeBookingRequests;
    const map = new Map<string, BookingRequestEntry[]>();
    for (const r of requests) {
      // Group by batchId if present, otherwise by name+email+close timestamp (within 2min)
      let key = '';
      if (r.batchId && r.batchId !== r.id) {
        key = r.batchId;
      } else {
        const nameKey = `${r.customerName}|${r.customerEmail}`.toLowerCase();
        const ts = new Date(r.createdAt).getTime();
        // Find existing group within 2 minutes
        let matched = false;
        for (const [existingKey, items] of map) {
          if (existingKey.startsWith(nameKey + '@')) {
            const groupTs = new Date(items[0].createdAt).getTime();
            if (Math.abs(ts - groupTs) < 120000) {
              key = existingKey;
              matched = true;
              break;
            }
          }
        }
        if (!matched) key = `${nameKey}@${r.createdAt}`;
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const groups: BatchGroup[] = [];
    for (const [, items] of map) {
      const first = items[0];
      groups.push({
        batchId: first.batchId || first.id,
        customerName: first.customerName,
        bandName: first.bandName,
        customerEmail: first.customerEmail,
        customerPhone: first.customerPhone,
        eventCity: first.eventCity,
        eventProvince: first.eventProvince,
        message: first.message,
        role: first.role,
        roleLabel: first.roleLabel,
        createdAt: first.createdAt,
        requests: items.sort((a, b) => (a.eventDate || '').localeCompare(b.eventDate || ''))
      });
    }
    return groups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get activeContactsHistory(): any[] {
    if (!this.canManageArchiveHistory) return [];
    return this.contactsHistory.filter(contact => {
      const explicitRole = `${contact?.communicationRole || ''}`.trim().toLowerCase();
      const taggedRole = this.extractTagValue(`${contact?.notes || ''}`, 'Comunicazione').toLowerCase();
      if (explicitRole) return explicitRole === this.activeRole;
      if (taggedRole) return taggedRole === this.activeRole;
      return contact?.type !== 'student' && contact?.type !== 'school';
    });
  }

  get activeCommunicationHistory(): CommunicationLogEntry[] {
    if (!this.canManageArchiveHistory) return [];
    return this.communicationHistory.filter(log => {
      const data = log?.data || {};
      const role = `${data['role'] || data['requestRole'] || ''}`.trim().toLowerCase();
      return !role || role === this.activeRole;
    });
  }

  get pendingRequestCount(): number {
    return this.activeBookingRequests.filter(r => r.status === 'new').length;
  }

  get confirmedRequestCount(): number {
    return this.activeBookingRequests.filter(r => r.status === 'confirmed' || r.status === 'receipt_sent').length;
  }

  get requestReceiptCount(): number {
    return this.activeBookingRequests.filter(r => r.status === 'receipt_sent').length;
  }

  selectRole(role: CommRole): void {
    if (!this.roleEnabled[role] || this.activeRole === role) return;
    this.persistActiveRoleSettings();
    this.activeRole = role;
    this.loadRoleSettings(role);
    this.replyingTo = '';
  }

  copyLink(): void {
    navigator.clipboard.writeText(this.bookingLink).then(() => {
      this.copied = true;
      setTimeout(() => this.copied = false, 2000);
      this.logCommunication('copy_link', { role: this.activeRole, link: this.bookingLink });
    });
  }

  shareWhatsApp(): void {
    const msg = `Ciao! Puoi richiedere la mia disponibilità come ${this.roleLabel} qui: ${this.bookingLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    this.logCommunication('share_whatsapp', { role: this.activeRole, link: this.bookingLink });
  }

  shareNative(): void {
    if (navigator.share) {
      navigator.share({ title: `Musican Manager · ${this.roleLabel}`, text: `Richiedi disponibilità ${this.roleLabel}`, url: this.bookingLink });
      this.logCommunication('share_native', { role: this.activeRole, link: this.bookingLink });
    } else {
      this.copyLink();
    }
  }

  saveSettings(): void {
    this.persistActiveRoleSettings();
    const settings = this.settingsForm.value;
    const stored = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    const roleSettings = { ...(stored.roleSettings || {}), [this.activeRole]: settings };
    localStorage.setItem('mm_settings', JSON.stringify({
      ...stored,
      affiliationCode: this.affiliationCode,
      allowBandInvites: settings.allowBandInvites,
      departureCity: settings.departureCity,
      departureRegion: settings.departureRegion,
      searchRadiusKm: settings.searchRadiusKm,
      roleSettings
    }));
    localStorage.setItem('mm_band_invites_enabled', settings.allowBandInvites ? 'true' : 'false');
    this.saved = true;
    setTimeout(() => this.saved = false, 2500);
    this.logCommunication('save_settings', { role: this.activeRole });
  }

  copyAffiliationCode(): void {
    const value = `${this.affiliationCode || ''}`.trim();
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      this.codeCopied = true;
      setTimeout(() => this.codeCopied = false, 1800);
      this.logCommunication('copy_code', { role: this.activeRole, code: value });
    });
  }

  batchStatus(batch: BatchGroup): RequestStatus {
    if (batch.requests.every(r => r.status === 'receipt_sent')) return 'receipt_sent';
    if (batch.requests.every(r => r.status === 'confirmed' || r.status === 'receipt_sent')) return 'confirmed';
    if (batch.requests.every(r => r.status === 'declined')) return 'declined';
    if (batch.requests.some(r => r.status === 'new')) return 'new';
    return 'confirmed';
  }

  async confirmBatch(batch: BatchGroup): Promise<void> {
    for (const r of batch.requests) {
      if (r.status === 'new') await this.confirmRequest(r);
    }
  }

  declineBatch(batch: BatchGroup): void {
    for (const r of batch.requests) {
      if (r.status !== 'declined') this.declineRequest(r);
    }
  }

  async sendBatchReceipt(batch: BatchGroup): Promise<void> {
    for (const r of batch.requests) {
      if (r.status === 'new') await this.confirmRequest(r);
    }
    const body = this.composeBatchReceiptMessage(batch);
    const phone = this.normalizePhone(batch.customerPhone);
    let channel: string;
    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`, '_blank');
      channel = 'whatsapp';
    } else if (batch.customerEmail) {
      window.open(`mailto:${encodeURIComponent(batch.customerEmail)}?subject=${encodeURIComponent('Ricevuta conferma ' + this.roleLabelFor(batch.role))}&body=${encodeURIComponent(body)}`, '_self');
      channel = 'email';
    } else {
      await navigator.clipboard.writeText(body);
      channel = 'clipboard';
    }
    const now = new Date().toISOString();
    for (const r of batch.requests) {
      this.patchRequest(r.id, { status: 'receipt_sent', receiptSentAt: now, statusUpdatedAt: now });
    }
    this.logCommunication('batch_receipt_sent', {
      role: batch.role,
      batchId: batch.batchId,
      count: batch.requests.length,
      channel
    });
  }

  sendBatchReply(batch: BatchGroup, via: 'whatsapp' | 'email'): void {
    const body = this.replyMessage.trim();
    if (!body) return;
    const phone = this.normalizePhone(batch.customerPhone);
    if (via === 'whatsapp' && phone) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`, '_blank');
    } else if (via === 'email' && batch.customerEmail) {
      window.open(`mailto:${encodeURIComponent(batch.customerEmail)}?subject=${encodeURIComponent('Re: Richiesta ' + this.roleLabelFor(batch.role))}&body=${encodeURIComponent(body)}`, '_self');
    }
    this.logCommunication('reply_sent', {
      role: batch.role,
      batchId: batch.batchId,
      channel: via,
      customerName: batch.customerName
    });
    this.replyingTo = '';
    this.replyMessage = '';
  }

  toggleDateAvailability(request: BookingRequestEntry): void {
    if (request.status === 'new' || request.status === 'declined') {
      this.patchRequest(request.id, {
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        statusUpdatedAt: new Date().toISOString()
      });
      this.addToAgenda(request);
    } else {
      this.patchRequest(request.id, {
        status: 'declined',
        declinedAt: new Date().toISOString(),
        statusUpdatedAt: new Date().toISOString()
      });
      this.removeFromAgenda(request);
    }
  }

  saveInternalNotes(batch: BatchGroup, notes: string): void {
    for (const r of batch.requests) {
      this.patchRequest(r.id, { internalNotes: notes });
    }
  }

  requestStatusLabel(status: RequestStatus): string {
    if (status === 'confirmed') return 'Disponibile';
    if (status === 'receipt_sent') return 'Ricevuta inviata';
    if (status === 'declined') return 'Non disponibile';
    return 'Da gestire';
  }

  requestStatusClass(status: RequestStatus): string {
    if (status === 'confirmed') return 'status-confirmed';
    if (status === 'receipt_sent') return 'status-receipt';
    if (status === 'declined') return 'status-declined';
    return 'status-new';
  }

  hasRequestContact(request: BookingRequestEntry): boolean {
    return !!this.findContactByRequest(request);
  }

  getContactDisplay(request: BookingRequestEntry): string {
    const contact = this.findContactByRequest(request);
    return contact?.displayName || 'Non creato';
  }

  async ensureContactForRequest(request: BookingRequestEntry): Promise<void> {
    const existing = this.findContactByRequest(request);
    if (existing) {
      this.patchRequest(request.id, { contactId: existing.id });
      return;
    }
    const raw = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const list = Array.isArray(raw) ? raw : [];
    const now = new Date().toISOString();
    const created = {
      id: crypto.randomUUID(),
      type: 'band',
      displayName: `${request.customerName || 'Cliente'}`.trim(),
      positionCity: '',
      positionAddress: '',
      phone: `${request.customerPhone || ''}`.trim(),
      email: `${request.customerEmail || ''}`.trim(),
      priority: 3,
      averageFee: 0,
      billingMode: 'fuori_fattura',
      billingName: `${request.customerName || ''}`.trim(),
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
      notes: `[Comunicazione:${request.role}] [Richiesta:${request.id}] Cliente da link prenotazione • ${request.eventType || 'Evento'} • ${request.eventDate || ''} ${request.eventTime || ''}`.trim(),
      communicationRole: request.role,
      sourceRequestId: request.id,
      createdAt: now
    };
    list.unshift(created);
    localStorage.setItem('mm_contacts', JSON.stringify(list));
    await this.syncSupabaseContacts();
    this.patchRequest(request.id, { contactId: created.id });
    this.loadHistory();
    this.logCommunication('contact_created', {
      role: request.role,
      requestId: request.id,
      contactId: created.id,
      name: created.displayName
    });
  }

  async confirmRequest(request: BookingRequestEntry): Promise<void> {
    await this.ensureContactForRequest(request);
    this.patchRequest(request.id, {
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
      statusUpdatedAt: new Date().toISOString()
    });
    this.logCommunication('request_confirmed', {
      role: request.role,
      requestId: request.id,
      customerName: request.customerName
    });
  }

  declineRequest(request: BookingRequestEntry): void {
    this.patchRequest(request.id, {
      status: 'declined',
      declinedAt: new Date().toISOString(),
      statusUpdatedAt: new Date().toISOString()
    });
    this.logCommunication('request_declined', {
      role: request.role,
      requestId: request.id,
      customerName: request.customerName
    });
  }

  async sendConfirmation(request: BookingRequestEntry): Promise<void> {
    await this.confirmRequest(request);
    const channel = await this.dispatchOutboundMessage(
      request,
      'confirmation',
      `Conferma disponibilità ${this.roleLabelFor(request.role)}`
    );
    this.patchRequest(request.id, {
      status: 'confirmed',
      confirmationSentAt: new Date().toISOString(),
      statusUpdatedAt: new Date().toISOString()
    });
    this.logCommunication('confirmation_sent', {
      role: request.role,
      requestId: request.id,
      channel
    });
  }

  async sendReceipt(request: BookingRequestEntry): Promise<void> {
    if (request.status === 'new') {
      await this.confirmRequest(request);
    }
    const channel = await this.dispatchOutboundMessage(
      request,
      'receipt',
      `Ricevuta conferma ${this.roleLabelFor(request.role)}`
    );
    this.patchRequest(request.id, {
      status: 'receipt_sent',
      receiptSentAt: new Date().toISOString(),
      statusUpdatedAt: new Date().toISOString()
    });
    this.logCommunication('receipt_sent', {
      role: request.role,
      requestId: request.id,
      channel
    });
  }

  async contactViaWhatsApp(request: BookingRequestEntry): Promise<void> {
    await this.dispatchOutboundMessage(request, 'manual', 'Contatto cliente');
    this.logCommunication('contact_whatsapp', {
      role: request.role,
      requestId: request.id
    });
  }

  sendReply(request: BookingRequestEntry, via: 'whatsapp' | 'email'): void {
    const body = this.replyMessage.trim();
    if (!body) return;
    const phone = this.normalizePhone(request.customerPhone);
    if (via === 'whatsapp' && phone) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`, '_blank');
    } else if (via === 'email' && request.customerEmail) {
      window.open(`mailto:${encodeURIComponent(request.customerEmail)}?subject=${encodeURIComponent('Re: Richiesta ' + this.roleLabelFor(request.role))}&body=${encodeURIComponent(body)}`, '_self');
    }
    this.logCommunication('reply_sent', {
      role: request.role,
      requestId: request.id,
      channel: via,
      customerName: request.customerName
    });
    this.replyingTo = '';
    this.replyMessage = '';
  }

  logDotClass(type: string): string {
    if (type === 'booking_request') return 'dot-new';
    if (type === 'request_confirmed' || type === 'confirmation_sent') return 'dot-ok';
    if (type === 'request_declined') return 'dot-danger';
    if (type === 'contact_created') return 'dot-info';
    return 'dot-muted';
  }

  communicationLabel(type: string): string {
    const map: Record<string, string> = {
      booking_request: 'Nuova richiesta',
      contact_created: 'Contatto creato',
      request_confirmed: 'Richiesta confermata',
      request_declined: 'Richiesta rifiutata',
      confirmation_sent: 'Conferma inviata',
      receipt_sent: 'Ricevuta inviata',
      contact_whatsapp: 'Contatto cliente',
      reply_sent: 'Risposta inviata',
      copy_link: 'Link copiato',
      share_whatsapp: 'Link condiviso WhatsApp',
      share_native: 'Link condiviso',
      save_settings: 'Impostazioni salvate',
      copy_code: 'Codice copiato'
    };
    return map[type] || type;
  }

  roleLabelFor(role: string): string {
    if (role === 'dj') return 'DJ';
    if (role === 'teacher') return 'Insegnante';
    return 'Musicista';
  }

  private loadRoleSettings(role: CommRole, source?: any): void {
    const stored = source || JSON.parse(localStorage.getItem('mm_settings') || '{}');
    const byRole = stored?.roleSettings?.[role] || {};
    const fallback = stored || {};
    this.settingsForm.patchValue({
      minFee: byRole.minFee ?? fallback.minFee ?? 0,
      maxFee: byRole.maxFee ?? fallback.maxFee ?? 0,
      feeNotes: byRole.feeNotes ?? fallback.feeNotes ?? '',
      allowBandInvites: byRole.allowBandInvites ?? fallback.allowBandInvites ?? true,
      availWeekdays: byRole.availWeekdays ?? fallback.availWeekdays ?? true,
      availWeekends: byRole.availWeekends ?? fallback.availWeekends ?? true,
      availTimeFrom: byRole.availTimeFrom ?? fallback.availTimeFrom ?? '18:00',
      availTimeTo: byRole.availTimeTo ?? fallback.availTimeTo ?? '23:59',
      showInstrument: byRole.showInstrument ?? fallback.showInstrument ?? true,
      showStyles: byRole.showStyles ?? fallback.showStyles ?? true,
      customMessage: byRole.customMessage ?? fallback.customMessage ?? '',
      departureCity: byRole.departureCity ?? fallback.departureCity ?? '',
      departureRegion: byRole.departureRegion ?? fallback.departureRegion ?? '',
      searchRadiusKm: byRole.searchRadiusKm ?? fallback.searchRadiusKm ?? 100
    }, { emitEvent: false });
  }

  private persistActiveRoleSettings(): void {
    const stored = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    const roleSettings = { ...(stored.roleSettings || {}), [this.activeRole]: this.settingsForm.value };
    localStorage.setItem('mm_settings', JSON.stringify({
      ...stored,
      affiliationCode: this.affiliationCode,
      allowBandInvites: this.settingsForm.value.allowBandInvites,
      departureCity: this.settingsForm.value.departureCity,
      departureRegion: this.settingsForm.value.departureRegion,
      searchRadiusKm: this.settingsForm.value.searchRadiusKm,
      roleSettings
    }));
  }

  private refreshBookingLinks(): void {
    const host = window.location.origin;
    const fallback = `${host}/book/[nome-cognome-non-impostati]`;
    this.bookingLinks = {
      musician: this.buildBookingLink(host, 'musician', fallback),
      dj: this.buildBookingLink(host, 'dj', fallback),
      teacher: this.buildBookingLink(host, 'teacher', fallback)
    };
  }

  private firstEnabledRole(): CommRole {
    if (this.roleEnabled.musician) return 'musician';
    if (this.roleEnabled.dj) return 'dj';
    if (this.roleEnabled.teacher) return 'teacher';
    return 'musician';
  }

  private loadHistory(): void {
    const rawRequests = JSON.parse(localStorage.getItem('mm_booking_requests') || '[]');
    const rawContacts = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const rawLogs = JSON.parse(localStorage.getItem('mm_communication_history') || '[]');

    const requests = Array.isArray(rawRequests) ? rawRequests.map(item => this.normalizeBookingRequest(item)) : [];
    const contacts = Array.isArray(rawContacts) ? rawContacts : [];
    const logs = Array.isArray(rawLogs) ? rawLogs : [];

    localStorage.setItem('mm_booking_requests', JSON.stringify(requests));
    this.bookingRequests = requests.sort((a, b) => `${b.createdAt || ''}`.localeCompare(`${a.createdAt || ''}`));
    this.contactsHistory = [...contacts].sort((a, b) => `${b?.createdAt || ''}`.localeCompare(`${a?.createdAt || ''}`));
    this.communicationHistory = [...logs].sort((a, b) => `${b?.createdAt || ''}`.localeCompare(`${a?.createdAt || ''}`));
  }

  private normalizeBookingRequest(item: any): BookingRequestEntry {
    const role = item?.role === 'dj' || item?.role === 'teacher' ? item.role : 'musician';
    const status = item?.status === 'confirmed' || item?.status === 'receipt_sent' || item?.status === 'declined'
      ? item.status
      : 'new';
    return {
      id: `${item?.id || crypto.randomUUID()}`,
      batchId: `${item?.batchId || item?.id || crypto.randomUUID()}`,
      slug: `${item?.slug || ''}`,
      musicianName: `${item?.musicianName || ''}`,
      role,
      roleLabel: `${item?.roleLabel || this.roleLabelFor(role)}`,
      affiliationCode: item?.affiliationCode ? `${item.affiliationCode}` : null,
      sourceType: `${item?.sourceType || 'link'}`,
      allowBandInvites: item?.allowBandInvites !== false,
      customerName: `${item?.customerName || item?.name || ''}`.trim(),
      bandName: `${item?.bandName || ''}`.trim(),
      customerEmail: `${item?.customerEmail || item?.email || ''}`.trim(),
      customerPhone: `${item?.customerPhone || item?.phone || ''}`.trim(),
      eventCity: `${item?.eventCity || ''}`.trim(),
      eventProvince: `${item?.eventProvince || ''}`.trim(),
      eventDate: `${item?.eventDate || item?.date || ''}`.trim(),
      eventTime: `${item?.eventTime || ''}`.trim(),
      eventType: `${item?.eventType || ''}`.trim(),
      bookingCode: `${item?.bookingCode || ''}`.trim(),
      message: `${item?.message || ''}`.trim(),
      createdAt: `${item?.createdAt || new Date().toISOString()}`,
      status,
      statusUpdatedAt: item?.statusUpdatedAt ? `${item.statusUpdatedAt}` : null,
      confirmedAt: item?.confirmedAt ? `${item.confirmedAt}` : null,
      confirmationSentAt: item?.confirmationSentAt ? `${item.confirmationSentAt}` : null,
      receiptSentAt: item?.receiptSentAt ? `${item.receiptSentAt}` : null,
      declinedAt: item?.declinedAt ? `${item.declinedAt}` : null,
      contactId: item?.contactId ? `${item.contactId}` : null,
      internalNotes: `${item?.internalNotes || ''}`.trim()
    };
  }

  private patchRequest(requestId: string, patch: Partial<BookingRequestEntry>): void {
    const updated = this.bookingRequests.map(r => r.id === requestId ? { ...r, ...patch } : r);
    this.bookingRequests = updated.sort((a, b) => `${b.createdAt || ''}`.localeCompare(`${a.createdAt || ''}`));
    localStorage.setItem('mm_booking_requests', JSON.stringify(this.bookingRequests));
    const musicianId = `${localStorage.getItem('musicianId') || ''}`.trim();
    if (musicianId) {
      void this.supabase.syncBookingRequestsFromLocalStorage(musicianId, this.bookingSlug, this.affiliationCode);
    }
  }

  private async syncBookingRequestsHistory(): Promise<void> {
    const musicianId = `${localStorage.getItem('musicianId') || ''}`.trim();
    if (!this.bookingSlug) return;

    try {
      if (musicianId) {
        await this.supabase.syncBookingRequestsFromLocalStorage(musicianId, this.bookingSlug, this.affiliationCode);
      }
      const remote = await this.supabase.loadBookingRequestsFromSupabase(musicianId, this.bookingSlug, this.affiliationCode);
      if (!remote.length) return;
      const normalized = remote.map(item => this.normalizeBookingRequest(item));
      const merged = new Map<string, BookingRequestEntry>();
      this.bookingRequests.forEach(item => merged.set(item.id, item));
      normalized.forEach(item => merged.set(item.id, item));
      const mergedList = Array.from(merged.values()).sort((a, b) => `${b.createdAt || ''}`.localeCompare(`${a.createdAt || ''}`));
      localStorage.setItem('mm_booking_requests', JSON.stringify(mergedList));
      this.bookingRequests = mergedList;
    } catch (error: any) {
      console.warn('[Communication] sync booking requests failed:', error?.message || error);
    }
  }

  private buildBookingLink(host: string, role: CommRole, fallback: string): string {
    if (!this.bookingSlug) return fallback;
    const params = new URLSearchParams({ role });
    if (this.affiliationCode) params.set('code', this.affiliationCode);
    return `${host}/book/${this.bookingSlug}?${params.toString()}`;
  }

  private findContactByRequest(request: BookingRequestEntry): any | null {
    const contacts = this.contactsHistory;
    const linked = contacts.find(c => `${c?.id || ''}` === `${request.contactId || ''}`);
    if (linked) return linked;
    const byRequestId = contacts.find(c => `${c?.sourceRequestId || ''}` === request.id);
    if (byRequestId) return byRequestId;
    const byEmail = request.customerEmail
      ? contacts.find(c => `${c?.email || ''}`.trim().toLowerCase() === request.customerEmail.toLowerCase())
      : null;
    if (byEmail) return byEmail;
    const byPhone = request.customerPhone
      ? contacts.find(c => this.normalizePhone(`${c?.phone || ''}`) === this.normalizePhone(request.customerPhone))
      : null;
    if (byPhone) return byPhone;
    return null;
  }

  private async dispatchOutboundMessage(request: BookingRequestEntry, kind: 'confirmation' | 'receipt' | 'manual', subject: string): Promise<'whatsapp' | 'email' | 'clipboard'> {
    const body = this.composeMessage(request, kind);
    const phone = this.normalizePhone(request.customerPhone);
    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`, '_blank');
      return 'whatsapp';
    }
    if (request.customerEmail) {
      window.open(`mailto:${encodeURIComponent(request.customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_self');
      return 'email';
    }
    await navigator.clipboard.writeText(body);
    return 'clipboard';
  }

  private composeBatchReceiptMessage(batch: BatchGroup): string {
    const roleLabel = this.roleLabelFor(batch.role);
    const confirmed = batch.requests.filter(r => r.status !== 'declined');
    const declined = batch.requests.filter(r => r.status === 'declined');
    const lines = [
      `Ciao ${batch.customerName},`,
      `ecco il riepilogo delle tue richieste come ${roleLabel.toLowerCase()}.`,
      ''
    ];
    if (confirmed.length) {
      lines.push('✅ Date disponibili:');
      for (const r of confirmed) {
        lines.push(`  • ${r.eventDate || '-'} ${r.eventTime || ''} — ${r.eventType || 'Evento'}`.trim());
      }
    }
    if (declined.length) {
      lines.push('', '❌ Date non disponibili:');
      for (const r of declined) {
        lines.push(`  • ${r.eventDate || '-'} ${r.eventTime || ''} — ${r.eventType || 'Evento'}`.trim());
      }
    }
    if (batch.eventCity) {
      lines.push('', `Luogo: ${batch.eventCity}${batch.eventProvince ? ' (' + batch.eventProvince + ')' : ''}`);
    }
    lines.push('', `Grazie, ${this.musicianName || 'Musican Manager'}`);
    return lines.join('\n');
  }

  private composeMessage(request: BookingRequestEntry, kind: 'confirmation' | 'receipt' | 'manual'): string {
    const roleLabel = this.roleLabelFor(request.role);
    if (kind === 'receipt') {
      return [
        `Ciao ${request.customerName},`,
        `ti invio la ricevuta di conferma per la richiesta ${roleLabel.toLowerCase()}.`,
        `Evento: ${request.eventType || 'Evento privato'}`,
        `Data: ${request.eventDate || '-'} ${request.eventTime || ''}`.trim(),
        `Stato: conferma registrata`,
        `Grazie, ${this.musicianName || 'Musican Manager'}`
      ].join('\n');
    }
    if (kind === 'manual') {
      return [
        `Ciao ${request.customerName},`,
        `sto ricontattandoti per la tua richiesta ${roleLabel.toLowerCase()}.`,
        `Evento: ${request.eventType || 'Evento privato'}`,
        `Data: ${request.eventDate || '-'} ${request.eventTime || ''}`.trim(),
        `A presto, ${this.musicianName || 'Musican Manager'}`
      ].join('\n');
    }
    return [
      `Ciao ${request.customerName},`,
      `confermo la presa in carico della tua richiesta ${roleLabel.toLowerCase()}.`,
      `Evento: ${request.eventType || 'Evento privato'}`,
      `Data: ${request.eventDate || '-'} ${request.eventTime || ''}`.trim(),
      `Ti ricontatterò con tutti i dettagli operativi.`,
      `Grazie, ${this.musicianName || 'Musican Manager'}`
    ].join('\n');
  }

  private addToAgenda(request: BookingRequestEntry): void {
    const events = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const list = Array.isArray(events) ? events : [];
    // Avoid duplicates by requestId
    if (list.some((e: any) => `${e?.sourceRequestId || ''}` === request.id)) return;
    list.push({
      id: crypto.randomUUID(),
      sourceRequestId: request.id,
      title: `${request.eventType || 'Evento'} — ${request.customerName}${request.bandName ? ' (' + request.bandName + ')' : ''}`,
      date: request.eventDate,
      timeStart: request.eventTime,
      timeEnd: '',
      location: request.eventCity ? `${request.eventCity}${request.eventProvince ? ' (' + request.eventProvince + ')' : ''}` : '',
      city: request.eventCity,
      province: request.eventProvince,
      status: 'confirmed',
      notes: request.message || '',
      createdAt: new Date().toISOString()
    });
    localStorage.setItem('mm_events', JSON.stringify(list));
  }

  private removeFromAgenda(request: BookingRequestEntry): void {
    const events = JSON.parse(localStorage.getItem('mm_events') || '[]');
    if (!Array.isArray(events)) return;
    const filtered = events.filter((e: any) => `${e?.sourceRequestId || ''}` !== request.id);
    localStorage.setItem('mm_events', JSON.stringify(filtered));
  }

  private logCommunication(type: string, data: Record<string, unknown>): void {
    const logs = JSON.parse(localStorage.getItem('mm_communication_history') || '[]');
    const list = Array.isArray(logs) ? logs : [];
    list.unshift({
      id: crypto.randomUUID(),
      type,
      data,
      createdAt: new Date().toISOString()
    });
    localStorage.setItem('mm_communication_history', JSON.stringify(list.slice(0, 300)));
    this.communicationHistory = list.slice(0, 300);
  }

  private async syncSupabaseContacts(): Promise<void> {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const musicianId = `${profile.id || localStorage.getItem('musicianId') || ''}`.trim();
    if (!musicianId) return;
    try {
      await this.supabase.syncContactsFromLocalStorage(musicianId);
    } catch {}
  }

  private extractTagValue(notes: string, tag: string): string {
    const match = `${notes || ''}`.match(new RegExp(`\\[${tag}:([^\\]]+)\\]`, 'i'));
    return `${match?.[1] || ''}`.trim();
  }

  private normalizePhone(value: string): string {
    return `${value || ''}`.replace(/[^\d]/g, '');
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
