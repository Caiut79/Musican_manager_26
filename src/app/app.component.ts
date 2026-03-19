import { Component, HostListener, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  isMobile = false;

  constructor(private router: Router, private themeService: ThemeService) {}

  ngOnInit() {
    this.themeService.init();
    this.checkBreakpoint();
    this.applyBodyScrollLock();
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
      // tablet + desktop: collapsed di default → hover per espandere
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
}
