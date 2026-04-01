'use client';

// ═══════════════════════════════════════════════════
//  COMMAND PALETTE CONTEXT
//  Exposes open/close state so any component in the
//  tree (TopBar button, keyboard listener in layout,
//  etc.) can trigger the palette without importing
//  the heavy modal UI.
//
//  CS Note: This is the "dependency inversion" principle
//  in practice — consumers depend on this lightweight
//  abstraction, not on the concrete <CommandPalette>.
// ═══════════════════════════════════════════════════

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

interface CommandPaletteContextValue {
  isOpen:       boolean;
  openPalette:  () => void;
  closePalette: () => void;
  togglePalette: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openPalette  = useCallback(() => setIsOpen(true),  []);
  const closePalette = useCallback(() => setIsOpen(false), []);
  const togglePalette = useCallback(() => setIsOpen(v => !v), []);

  const value = useMemo(
    () => ({ isOpen, openPalette, closePalette, togglePalette }),
    [isOpen, openPalette, closePalette, togglePalette]
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  // Build-safe fallback for pre-rendering
  return ctx || {
    isOpen: false,
    openPalette: () => {},
    closePalette: () => {},
    togglePalette: () => {},
  } as CommandPaletteContextValue;
}