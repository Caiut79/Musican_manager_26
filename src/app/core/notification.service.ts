import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { AppNotification } from '../models/notification';

@Injectable({ providedIn: 'root' })
export class NotificationService {

  readonly notification$ = new Subject<AppNotification>();
  readonly unreadCount$ = new Subject<number>();

  private lastSeenCount = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private storageHandler = (e: StorageEvent) => this.onStorageChange(e);

  constructor(private zone: NgZone) {}

  /** Call once from AppComponent.ngOnInit */
  start(): void {
    this.lastSeenCount = this.currentRequestCount();
    this.emitUnread();

    // Cross-tab detection via StorageEvent
    window.addEventListener('storage', this.storageHandler);

    // Same-tab polling (StorageEvent only fires in OTHER tabs)
    this.zone.runOutsideAngular(() => {
      this.pollTimer = setInterval(() => {
        this.zone.run(() => this.checkForNew());
      }, 5_000);
    });
  }

  stop(): void {
    window.removeEventListener('storage', this.storageHandler);
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  markAllRead(): void {
    this.lastSeenCount = this.currentRequestCount();
    localStorage.setItem('mm_notif_last_seen', `${this.lastSeenCount}`);
    this.emitUnread();
  }

  /** Number of pending (status=new) booking requests */
  get pendingCount(): number {
    const raw = JSON.parse(localStorage.getItem('mm_booking_requests') || '[]');
    if (!Array.isArray(raw)) return 0;
    return raw.filter((r: any) => `${r?.status || ''}` === 'new').length;
  }

  private onStorageChange(e: StorageEvent): void {
    if (e.key === 'mm_booking_requests') {
      this.zone.run(() => this.checkForNew());
    }
  }

  private checkForNew(): void {
    const current = this.currentRequestCount();
    if (current > this.lastSeenCount) {
      const diff = current - this.lastSeenCount;
      for (let i = 0; i < diff; i++) {
        const newest = this.getNewestRequest(i);
        this.notification$.next({
          id: crypto.randomUUID(),
          type: 'booking_request',
          title: 'Nuova richiesta!',
          message: newest
            ? `${newest.customerName || 'Cliente'} — ${newest.eventType || 'Evento'} · ${this.formatDate(newest.eventDate)}`
            : 'Hai ricevuto una nuova richiesta di disponibilità',
          read: false,
          createdAt: new Date().toISOString(),
          data: newest ? { requestId: newest.id } : {}
        });
      }
      this.lastSeenCount = current;
      localStorage.setItem('mm_notif_last_seen', `${current}`);
    }
    this.emitUnread();
  }

  private emitUnread(): void {
    this.unreadCount$.next(this.pendingCount);
  }

  private currentRequestCount(): number {
    const raw = JSON.parse(localStorage.getItem('mm_booking_requests') || '[]');
    return Array.isArray(raw) ? raw.length : 0;
  }

  private getNewestRequest(offset: number): any | null {
    const raw = JSON.parse(localStorage.getItem('mm_booking_requests') || '[]');
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const sorted = [...raw].sort((a, b) => `${b?.createdAt || ''}`.localeCompare(`${a?.createdAt || ''}`));
    return sorted[offset] || sorted[0];
  }

  private formatDate(d: string): string {
    if (!d) return '';
    try {
      const [y, m, day] = d.split('-');
      return `${day}/${m}/${y}`;
    } catch {
      return d;
    }
  }
}
