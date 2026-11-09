'use client';

import { createContext, useContext, type ReactNode } from 'react';

const RuntimeModeAllowSyntheticContext = createContext<boolean>(true);

export interface RuntimeModeProviderProps {
  readonly allowSyntheticLogin: boolean;
  readonly children: ReactNode;
}

export function RuntimeModeProvider({
  allowSyntheticLogin,
  children,
}: RuntimeModeProviderProps) {
  return (
    <RuntimeModeAllowSyntheticContext.Provider value={allowSyntheticLogin}>
      {children}
    </RuntimeModeAllowSyntheticContext.Provider>
  );
}

export function useAllowSyntheticLogin(): boolean {
  return useContext(RuntimeModeAllowSyntheticContext);
}
