import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

type CommRole = 'musician' | 'dj' | 'teacher';

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
  bookingRequests: any[] = [];
  contactsHistory: any[] = [];
  communicationHistory: any[] = [];

  constructor(private fb: FormBuilder) {}

  ngOnInit() {
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

    const host = window.location.origin;
    const fallback = `${host}/book/[nome-cognome-non-impostati]`;
    this.bookingLinks = {
      musician: this.bookingSlug ? `${host}/book/${this.bookingSlug}?role=musician` : fallback,
      dj: this.bookingSlug ? `${host}/book/${this.bookingSlug}?role=dj` : fallback,
      teacher: this.bookingSlug ? `${host}/book/${this.bookingSlug}?role=teacher` : fallback
    };

    const stored = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    this.affiliationCode =
      stored.affiliationCode ||
      localStorage.getItem('mm_affiliation_code') ||
      localStorage.getItem('musicianCode') ||
      '';
    this.settingsForm = this.fb.group({
      minFee:         [stored.minFee || 0,  [Validators.min(0)]],
      maxFee:         [stored.maxFee || 0,  [Validators.min(0)]],
      feeNotes:       [stored.feeNotes || ''],
      allowBandInvites:[stored.allowBandInvites !== false],
      availWeekdays:  [stored.availWeekdays !== false],
      availWeekends:  [stored.availWeekends !== false],
      availTimeFrom:  [stored.availTimeFrom || '18:00'],
      availTimeTo:    [stored.availTimeTo || '23:59'],
      showInstrument: [stored.showInstrument !== false],
      showStyles:     [stored.showStyles !== false],
      customMessage:  [stored.customMessage || ''],
    });
    this.loadRoleSettings(this.activeRole, stored);
    this.loadHistory();
  }

  get bookingLink(): string {
    return this.bookingLinks[this.activeRole];
  }

  get roleLabel(): string {
    if (this.activeRole === 'dj') return 'DJ';
    if (this.activeRole === 'teacher') return 'Insegnante';
    return 'Musicista';
  }

  selectRole(role: CommRole): void {
    if (!this.roleEnabled[role] || this.activeRole === role) return;
    this.persistActiveRoleSettings();
    this.activeRole = role;
    this.loadRoleSettings(role);
  }

  copyLink() {
    navigator.clipboard.writeText(this.bookingLink).then(() => {
      this.copied = true;
      setTimeout(() => this.copied = false, 2000);
      this.logCommunication('copy_link', { role: this.activeRole, link: this.bookingLink });
    });
  }

  shareWhatsApp() {
    const msg = `Ciao! Puoi richiedere la mia disponibilità come ${this.roleLabel} qui: ${this.bookingLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    this.logCommunication('share_whatsapp', { role: this.activeRole, link: this.bookingLink });
  }

  shareNative() {
    if (navigator.share) {
      navigator.share({ title: `Musican Manager · ${this.roleLabel}`, text: `Richiedi disponibilità ${this.roleLabel}`, url: this.bookingLink });
      this.logCommunication('share_native', { role: this.activeRole, link: this.bookingLink });
    } else {
      this.copyLink();
    }
  }

  saveSettings() {
    this.persistActiveRoleSettings();
    const settings = this.settingsForm.value;
    const stored = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    const roleSettings = { ...(stored.roleSettings || {}), [this.activeRole]: settings };
    localStorage.setItem('mm_settings', JSON.stringify({
      ...stored,
      affiliationCode: this.affiliationCode,
      allowBandInvites: settings.allowBandInvites,
      roleSettings
    }));
    localStorage.setItem('mm_band_invites_enabled', settings.allowBandInvites ? 'true' : 'false');
    this.saved = true;
    setTimeout(() => this.saved = false, 2500);
    this.logCommunication('save_settings', { role: this.activeRole });
  }

  copyAffiliationCode() {
    const value = `${this.affiliationCode || ''}`.trim();
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      this.codeCopied = true;
      setTimeout(() => this.codeCopied = false, 1800);
      this.logCommunication('copy_code', { code: value });
    });
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
      customMessage: byRole.customMessage ?? fallback.customMessage ?? ''
    }, { emitEvent: false });
  }

  private persistActiveRoleSettings(): void {
    const stored = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    const roleSettings = { ...(stored.roleSettings || {}), [this.activeRole]: this.settingsForm.value };
    localStorage.setItem('mm_settings', JSON.stringify({
      ...stored,
      affiliationCode: this.affiliationCode,
      allowBandInvites: this.settingsForm.value.allowBandInvites,
      roleSettings
    }));
  }

  private firstEnabledRole(): CommRole {
    if (this.roleEnabled.musician) return 'musician';
    if (this.roleEnabled.dj) return 'dj';
    if (this.roleEnabled.teacher) return 'teacher';
    return 'musician';
  }

  private loadHistory(): void {
    const requests = JSON.parse(localStorage.getItem('mm_booking_requests') || '[]');
    const contacts = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const logs = JSON.parse(localStorage.getItem('mm_communication_history') || '[]');
    this.bookingRequests = Array.isArray(requests) ? [...requests].sort((a, b) => `${b?.createdAt || ''}`.localeCompare(`${a?.createdAt || ''}`)) : [];
    this.contactsHistory = Array.isArray(contacts) ? [...contacts].sort((a, b) => `${b?.createdAt || ''}`.localeCompare(`${a?.createdAt || ''}`)) : [];
    this.communicationHistory = Array.isArray(logs) ? [...logs].sort((a, b) => `${b?.createdAt || ''}`.localeCompare(`${a?.createdAt || ''}`)) : [];
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
    this.communicationHistory = list.slice(0, 30);
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
