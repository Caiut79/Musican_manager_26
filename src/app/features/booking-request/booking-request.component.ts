import { Component, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-booking-request',
  templateUrl: './booking-request.component.html',
  styleUrls: ['./booking-request.component.scss']
})
export class BookingRequestComponent implements OnInit {
  musicianName = '';
  musicianSlug = '';
  requestedRole: 'musician' | 'dj' | 'teacher' = 'musician';
  affiliationCode = '';
  allowBandInvites = true;
  sent = false;
  error = '';

  form = this.fb.group({
    customerName: ['', Validators.required],
    customerEmail: ['', [Validators.required, Validators.email]],
    eventDate: ['', Validators.required],
    eventTime: ['', Validators.required],
    eventType: ['Serata privata'],
    bookingCode: [''],
    message: ['', Validators.required]
  });

  constructor(private fb: FormBuilder, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.musicianSlug = this.route.snapshot.paramMap.get('slug') || '';
    const queryRole = `${this.route.snapshot.queryParamMap.get('role') || 'musician'}`.toLowerCase();
    if (queryRole === 'dj' || queryRole === 'teacher') this.requestedRole = queryRole;
    const firstName = localStorage.getItem('mm_firstName') || '';
    const lastName = localStorage.getItem('mm_lastName') || '';
    this.musicianName = `${firstName} ${lastName}`.trim() || 'Musicista';
    const stored = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    this.affiliationCode = stored.affiliationCode || localStorage.getItem('mm_affiliation_code') || '';
    const roleSettings = stored?.roleSettings?.[this.requestedRole] || {};
    this.allowBandInvites = roleSettings.allowBandInvites ?? stored.allowBandInvites ?? true;
    if (this.affiliationCode) this.form.patchValue({ bookingCode: this.affiliationCode });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const selectedDate = `${this.form.value.eventDate || ''}`.trim();
    const selectedTime = `${this.form.value.eventTime || ''}`.trim();
    if (selectedDate && selectedTime && this.isSharedSlotBusy(selectedDate, selectedTime)) {
      this.error = 'Orario non disponibile: agenda già occupata nello stesso slot';
      return;
    }
    this.error = '';
    const sourceType = `${this.form.value.bookingCode || ''}`.trim().toUpperCase() === `${this.affiliationCode || ''}`.trim().toUpperCase()
      ? 'codice'
      : 'link';
    const listRaw = localStorage.getItem('mm_booking_requests');
    const list = listRaw ? JSON.parse(listRaw) : [];
    const request = {
      slug: this.musicianSlug,
      musicianName: this.musicianName,
      role: this.requestedRole,
      roleLabel: this.roleLabel(),
      affiliationCode: this.affiliationCode || null,
      sourceType,
      allowBandInvites: this.allowBandInvites,
      ...this.form.value,
      createdAt: new Date().toISOString()
    };
    list.push(request);
    localStorage.setItem('mm_booking_requests', JSON.stringify(list));
    this.logCommunicationRequest(request);
    this.sent = true;
    this.form.reset({
      customerName: '',
      customerEmail: '',
      eventDate: '',
      eventTime: '',
      eventType: 'Serata privata',
      bookingCode: this.affiliationCode || '',
      message: ''
    });
  }

  roleLabel(): string {
    if (this.requestedRole === 'dj') return 'DJ';
    if (this.requestedRole === 'teacher') return 'Insegnante';
    return 'Musicista';
  }

  private isSharedSlotBusy(date: string, timeStart: string): boolean {
    const events = JSON.parse(localStorage.getItem('mm_events') || '[]');
    if (!Array.isArray(events)) return false;
    return events.some((event: any) => {
      if (`${event?.status || ''}` === 'cancelled') return false;
      return (`${event?.date || ''}` === date) && (`${event?.timeStart || ''}` === timeStart);
    });
  }

  private logCommunicationRequest(request: any): void {
    const logs = JSON.parse(localStorage.getItem('mm_communication_history') || '[]');
    const list = Array.isArray(logs) ? logs : [];
    list.unshift({
      id: crypto.randomUUID(),
      type: 'booking_request',
      data: {
        name: request.customerName,
        role: request.role,
        sourceType: request.sourceType,
        date: request.eventDate,
        eventTime: request.eventTime
      },
      createdAt: new Date().toISOString()
    });
    localStorage.setItem('mm_communication_history', JSON.stringify(list.slice(0, 300)));
  }
}
