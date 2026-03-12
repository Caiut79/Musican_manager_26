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
  affiliationCode = '';
  allowBandInvites = true;
  sent = false;

  form = this.fb.group({
    customerName: ['', Validators.required],
    customerEmail: ['', [Validators.required, Validators.email]],
    eventDate: [''],
    eventType: ['Serata privata'],
    message: ['', Validators.required]
  });

  constructor(private fb: FormBuilder, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.musicianSlug = this.route.snapshot.paramMap.get('slug') || '';
    const firstName = localStorage.getItem('mm_firstName') || '';
    const lastName = localStorage.getItem('mm_lastName') || '';
    this.musicianName = `${firstName} ${lastName}`.trim() || 'Musicista';
    const stored = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    this.affiliationCode = stored.affiliationCode || localStorage.getItem('mm_affiliation_code') || '';
    this.allowBandInvites = stored.allowBandInvites !== false;
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const listRaw = localStorage.getItem('mm_booking_requests');
    const list = listRaw ? JSON.parse(listRaw) : [];
    list.push({
      slug: this.musicianSlug,
      musicianName: this.musicianName,
      affiliationCode: this.affiliationCode || null,
      allowBandInvites: this.allowBandInvites,
      ...this.form.value,
      createdAt: new Date().toISOString()
    });
    localStorage.setItem('mm_booking_requests', JSON.stringify(list));
    this.sent = true;
    this.form.reset({
      customerName: '',
      customerEmail: '',
      eventDate: '',
      eventType: 'Serata privata',
      message: ''
    });
  }
}
