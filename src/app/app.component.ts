import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ThemeService } from './services/theme.service';
import { NotificationService } from './core/notification.service';
import { AppNotification } from './models/notification';
import { SupabaseService } from './core/supabase.service';
import { IdentityContextService } from './core/identity-context.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  isMobile = false;

  // Notifications
  sidebarBadges: Record<string, number> = {};
  toasts: AppNotification[] = [];
  unreadNotifications = 0;
  private subs: Subscription[] = [];

  constructor(
    private router: Router,
    private themeService: ThemeService,
    private notificationService: NotificationService,
    private supabase: SupabaseService,
    private identityContext: IdentityContextService
  ) {}

  ngOnInit() {
    this.themeService.init();
    this.checkBreakpoint();
    this.applyBodyScrollLock();
    void this.bootstrapRemoteState();

    // Start notification monitoring
    this.notificationService.start();

    this.subs.push(
      this.notificationService.unreadCount$.subscribe(count => {
        this.unreadNotifications = count;
        this.sidebarBadges = { '/communication': count };
      })
    );

    this.subs.push(
      this.notificationService.notification$.subscribe(notif => {
        this.showToast(notif);
        this.requestBrowserNotification(notif);
      })
    );
  }

  ngOnDestroy(): void {
    this.notificationService.stop();
    this.subs.forEach(s => s.unsubscribe());
  }

  @HostListener('window:resize')
  onResize() {
    this.checkBreakpoint();
  }

  private checkBreakpoint() {
    const w = window.innerWidth;
    this.isMobile = w < 768;
    if (this.isMobile) {
      this.mobileMenuOpen = false;
    } else {
      this.sidebarCollapsed = true;
    }
    this.applyBodyScrollLock();
  }

  toggleSidebar() {
    if (this.isMobile) {
      this.mobileMenuOpen = !this.mobileMenuOpen;
    } else {
      this.sidebarCollapsed = !this.sidebarCollapsed;
    }
    this.applyBodyScrollLock();
  }

  closeMobileMenu() {
    this.mobileMenuOpen = false;
    this.applyBodyScrollLock();
  }

  async logout(): Promise<void> {
    try {
      await this.supabase.signOut();
    } catch {}
    const theme = localStorage.getItem('mm_theme');
    localStorage.clear();
    if (theme) localStorage.setItem('mm_theme', theme);
    this.sidebarBadges = {};
    this.toasts = [];
    this.closeMobileMenu();
    await this.router.navigateByUrl('/register');
  }

  private applyBodyScrollLock(): void {
    const locked = this.isMobile && this.mobileMenuOpen;
    document.body.classList.toggle('mm-menu-open', locked);
  }

  isPublicRoute(): boolean {
    return this.router.url.startsWith('/register')
      || this.router.url.startsWith('/book/')
      || this.router.url.startsWith('/confirm/')
      || this.router.url.startsWith('/school/')
      || this.router.url.startsWith('/privacy-consent/');
  }

  // ─── Toast ────────────────────────────────────────────────────────────────

  showToast(notif: AppNotification): void {
    this.toasts.push(notif);
    setTimeout(() => this.dismissToast(notif.id), 8000);
  }

  dismissToast(id: string): void {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  onToastClick(toast: AppNotification): void {
    this.dismissToast(toast.id);
    this.router.navigate(['/communication']);
  }

  openNotifications(): void {
    void this.router.navigate(['/communication']);
  }

  // ─── Browser notification ──────────────────────────────────────────────────

  private requestBrowserNotification(notif: AppNotification): void {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      this.showBrowserNotification(notif);
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') this.showBrowserNotification(notif);
      });
    }
  }

  private showBrowserNotification(notif: AppNotification): void {
    const n = new Notification(notif.title, {
      body: notif.message,
      icon: 'assets/mm-logo.svg',
      tag: notif.id
    });
    n.onclick = () => {
      window.focus();
      this.router.navigate(['/communication']);
      n.close();
    };
  }

  private async bootstrapRemoteState(): Promise<void> {
    try {
      await this.identityContext.bootstrap('musician_manager');
    } catch {}
  }
}
