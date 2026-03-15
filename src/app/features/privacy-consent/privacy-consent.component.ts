import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

type ContactEntry = {
  id: string;
  type: 'band' | 'school' | 'student';
  displayName: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  privacyConsentAccepted: boolean;
};

@Component({
  selector: 'app-privacy-consent',
  templateUrl: './privacy-consent.component.html',
  styleUrls: ['./privacy-consent.component.scss']
})
export class PrivacyConsentComponent implements OnInit {
  contact: ContactEntry | null = null;
  confirmed = false;
  acceptedAt = '';

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    const contacts = this.readContacts();
    this.contact = contacts.find(c => c.id === id) || null;
    if (this.contact?.privacyConsentAccepted) {
      this.confirmed = true;
      this.acceptedAt = this.readConsentDate(id);
    }
  }

  accept(): void {
    if (!this.contact) return;
    const now = new Date().toISOString();
    const contacts = this.readContacts().map(c => (
      c.id === this.contact?.id ? { ...c, privacyConsentAccepted: true } : c
    ));
    localStorage.setItem('mm_contacts', JSON.stringify(contacts));
    const consentMap = JSON.parse(localStorage.getItem('mm_parent_consents') || '{}');
    consentMap[this.contact.id] = now;
    localStorage.setItem('mm_parent_consents', JSON.stringify(consentMap));
    this.confirmed = true;
    this.acceptedAt = now;
  }

  private readContacts(): ContactEntry[] {
    const parsed = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  }

  private readConsentDate(id: string): string {
    const consentMap = JSON.parse(localStorage.getItem('mm_parent_consents') || '{}');
    return `${consentMap[id] || ''}`;
  }
}
