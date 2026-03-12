import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-communication',
  templateUrl: './communication.component.html',
  styleUrls: ['./communication.component.scss']
})
export class CommunicationComponent implements OnInit {
  settingsForm!: FormGroup;
  musicianName = '';
  bookingLink = '';
  bookingSlug = '';
  copied = false;
  codeCopied = false;
  saved = false;
  affiliationCode = '';

  constructor(private fb: FormBuilder) {}

  ngOnInit() {
    const firstName = localStorage.getItem('mm_firstName') || '';
    const lastName = localStorage.getItem('mm_lastName') || '';
    this.musicianName = `${firstName} ${lastName}`.trim();
    this.bookingSlug = this.slugify(`${firstName}-${lastName}`);

    const host = window.location.origin;
    this.bookingLink = this.bookingSlug
      ? `${host}/book/${this.bookingSlug}`
      : `${host}/book/[nome-cognome-non-impostati]`;

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
  }

  copyLink() {
    navigator.clipboard.writeText(this.bookingLink).then(() => {
      this.copied = true;
      setTimeout(() => this.copied = false, 2000);
    });
  }

  shareWhatsApp() {
    const msg = `Ciao! Puoi richiedere la mia disponibilità per la tua serata qui: ${this.bookingLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }

  shareNative() {
    if (navigator.share) {
      navigator.share({ title: 'Musicista', text: 'Richiedi il musicista', url: this.bookingLink });
    } else {
      this.copyLink();
    }
  }

  saveSettings() {
    const settings = this.settingsForm.value;
    localStorage.setItem('mm_settings', JSON.stringify({ ...settings, affiliationCode: this.affiliationCode }));
    localStorage.setItem('mm_band_invites_enabled', settings.allowBandInvites ? 'true' : 'false');
    this.saved = true;
    setTimeout(() => this.saved = false, 2500);
  }

  copyAffiliationCode() {
    const value = `${this.affiliationCode || ''}`.trim();
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      this.codeCopied = true;
      setTimeout(() => this.codeCopied = false, 1800);
    });
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
