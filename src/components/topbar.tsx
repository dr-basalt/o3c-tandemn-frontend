'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';
import { Search, Menu, X, User, CreditCard, BarChart3, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TopbarProps {
  onSearchFocus?: () => void;
}

export function Topbar({ onSearchFocus }: TopbarProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const navItems = [
    { href: '/chat', label: 'Playground' },
    { href: '/models', label: 'Models' },
    { href: '/batch-inference', label: 'Batch Inference' },
    { href: '/keys', label: 'API Keys' },
    // Combined Credits & Metrics into My Account dropdown
    // { href: '/credits', label: 'Credits' },
    // { href: '/metrics', label: 'Metrics' },
    // Settings page - commented out as requested
    // { href: '/settings', label: 'Settings' }
  ];

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link href="https://www.ori3com.cloud" className="flex items-center space-x-3 group">
              <img src="/cute-logo-1.png" alt="O3C" className="h-8 w-8" />
              <span className="font-semibold text-lg text-foreground transition-colors hover:text-accent group-hover:text-accent">O3C</span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-6">
              {navItems.map((item) => {
                const isActive = isMounted && pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'text-accent'
                        : 'text-muted-foreground hover:text-accent'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              
              {/* My Account Dropdown */}
            <SignedIn>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-primary/90 hover:text-white transition-colors duration-200">
                      <User className="h-4 w-4 mr-2" />
                      My Account
                      <ChevronDown className="h-4 w-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem asChild>
                      <Link href="/credits" className="flex items-center w-full">
                        <CreditCard className="h-4 w-4 mr-2" />
                        Credits & Billing
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/metrics" className="flex items-center w-full">
                        <BarChart3 className="h-4 w-4 mr-2" />
                        Usage Metrics
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
              </DropdownMenu>
            </SignedIn>
            </nav>

            {/* Right Side - User Menu */}
            <div className="flex items-center space-x-4">
              {/* Desktop User Menu */}
              <div className="hidden md:block">
            <SignedIn>
                  <UserButton 
                    appearance={{
                      elements: {
                        avatarBox: "h-8 w-8 rounded-full"
                      }
                    }}
                  />
            </SignedIn>
            <SignedOut>
                  <SignInButton mode="modal">
                    <Button variant="outline" className="px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/90 hover:text-white hover:border-primary">
                      Sign In
                    </Button>
                  </SignInButton>
            </SignedOut>
              </div>

              {/* Mobile Menu Button */}
              <div className="md:hidden flex items-center space-x-2">
            <SignedIn>
                  <UserButton 
                    appearance={{
                      elements: {
                        avatarBox: "h-8 w-8 rounded-full"
                      }
                    }}
                  />
            </SignedIn>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="h-9 w-9 hover:text-accent"
                >
                  {isMobileMenuOpen ? (
                    <X className="h-5 w-5" />
                  ) : (
                    <Menu className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 top-16 z-40 md:hidden">
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
          <div className="relative bg-background border-b shadow-lg">
            {/* Mobile Navigation */}
            <nav className="px-4 pt-8 pb-4 space-y-1">
              {navItems.map((item) => {
                const isActive = isMounted && pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center px-4 py-3 text-sm font-medium transition-colors ${
                      isActive
                        ? 'text-accent'
                        : 'text-muted-foreground hover:text-accent'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                );
              })}
              
              {/* Mobile My Account Section */}
              <SignedIn>
                <>
                  <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    My Account
                  </div>
                  <Link
                    href="/credits"
                    className={`flex items-center px-4 py-3 text-sm font-medium transition-colors ${
                      isMounted && pathname === '/credits'
                        ? 'text-accent'
                        : 'text-muted-foreground hover:text-accent'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <CreditCard className="h-4 w-4 mr-3" />
                    Credits & Billing
                  </Link>
                  <Link
                    href="/metrics"
                    className={`flex items-center px-4 py-3 text-sm font-medium transition-colors ${
                      isMounted && pathname === '/metrics'
                        ? 'text-accent'
                        : 'text-muted-foreground hover:text-accent'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <BarChart3 className="h-4 w-4 mr-3" />
                    Usage Metrics
                  </Link>
                </>
              </SignedIn>
            </nav>

            {/* Mobile Sign In */}
            <SignedOut>
              <div className="p-4 border-t">
                <SignInButton mode="modal">
                  <Button variant="outline" className="w-full" onClick={() => setIsMobileMenuOpen(false)}>
                    Sign In
                  </Button>
                </SignInButton>
              </div>
            </SignedOut>
          </div>
        </div>
      )}
    </>
  );
}
