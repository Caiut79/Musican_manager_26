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
  }

  toggleSidebar() {
    if (this.isMobile) {
      this.mobileMenuOpen = !this.mobileMenuOpen;
    } else {
      this.sidebarCollapsed = !this.sidebarCollapsed;
    }
  }

  closeMobileMenu() {
    this.mobileMenuOpen = false;
  }

  isPublicRoute(): boolean {
    return this.router.url.startsWith('/register')
      || this.router.url.startsWith('/book/')
      || this.router.url.startsWith('/confirm/')
      || this.router.url.startsWith('/school/')
      || this.router.url.startsWith('/privacy-consent/');
  }
}
