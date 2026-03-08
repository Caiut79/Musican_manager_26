import { Component, HostListener, OnInit } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  isMobile = false;

  ngOnInit() {
    this.checkBreakpoint();
    if (window.innerWidth < 1024 && window.innerWidth >= 768) {
      this.sidebarCollapsed = true;
    }
  }

  @HostListener('window:resize')
  onResize() {
    this.checkBreakpoint();
  }

  private checkBreakpoint() {
    this.isMobile = window.innerWidth < 768;
    if (!this.isMobile) {
      this.mobileMenuOpen = false;
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
}
