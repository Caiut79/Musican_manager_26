import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-communication',
  templateUrl: './communication.component.html',
  styleUrls: ['./communication.component.scss']
})
export class CommunicationComponent implements OnInit {
  settingsForm!: FormGroup;
  musicianCode = '';
  bookingLink = '';
  copied = false;
  saved = false;

  constructor(private fb: FormBuilder) {}

  ngOnInit() {
    this.musicianCode = localStorage.getItem('musicianCode') || '';

    const host = window.location.origin;
    this.bookingLink = this.musicianCode
      ? `${host}/book/${this.musicianCode}`
      : `${host}/book/[codice-non-ancora-impostato]`;

    const stored = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    this.settingsForm = this.fb.group({
      minFee:         [stored.minFee || 0,  [Validators.min(0)]],
      maxFee:         [stored.maxFee || 0,  [Validators.min(0)]],
      feeNotes:       [stored.feeNotes || ''],
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
    localStorage.setItem('mm_settings', JSON.stringify(this.settingsForm.value));
    this.saved = true;
    setTimeout(() => this.saved = false, 2500);
  }
}
