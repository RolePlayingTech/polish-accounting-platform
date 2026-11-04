'use client';

import { useEffect, useRef, type RefObject } from 'react';

export const MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Oblicza kolejny indeks elementu w pętli focus-trap dla klawisza `Tab` / `Shift+Tab` (WCAG 2.4.3).
 */
export function cycleFocusTrapIndex(
  currentIndex: number,
  count: number,
  shiftKey: boolean,
): number {
  if (count <= 0) {
    return -1;
  }
  if (shiftKey) {
    if (currentIndex <= 0) {
      return count - 1;
    }
    return currentIndex - 1;
  }
  if (currentIndex < 0 || currentIndex >= count - 1) {
    return 0;
  }
  return currentIndex + 1;
}

/**
 * Oblicza kolejny indeks opcji dla grupy `role="radiogroup"` wg wzorca WAI-ARIA APG.
 */
export function cycleRadioGroupIndex(
  currentIndex: number,
  count: number,
  key: string,
): number | null {
  if (count <= 0) {
    return null;
  }
  const safeCurrent = currentIndex < 0 ? 0 : currentIndex;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (safeCurrent + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return (safeCurrent - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export interface FocusableNode {
  focus: () => void;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
  readonly isConnected?: boolean | undefined;
}

export interface FocusTrapContainer extends FocusableNode {
  querySelector: (selector: string) => unknown;
  querySelectorAll: (selector: string) => ArrayLike<unknown>;
}

export interface FocusTrapKeyboardEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  preventDefault: () => void;
}

export interface FocusTrapDocument {
  readonly activeElement: unknown;
  addEventListener: (type: 'keydown', listener: (event: FocusTrapKeyboardEvent) => void) => void;
  removeEventListener: (type: 'keydown', listener: (event: FocusTrapKeyboardEvent) => void) => void;
}

export interface AttachModalFocusTrapOptions {
  doc: FocusTrapDocument;
  getContainer: () => FocusTrapContainer | null;
  onClose?: (() => void) | undefined;
  isEscapeDisabled?: (() => boolean) | undefined;
}

function isFocusableNode(value: unknown): value is FocusableNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'focus' in value &&
    typeof (value as { focus?: unknown }).focus === 'function' &&
    'hasAttribute' in value &&
    typeof (value as { hasAttribute?: unknown }).hasAttribute === 'function' &&
    'getAttribute' in value &&
    typeof (value as { getAttribute?: unknown }).getAttribute === 'function'
  );
}

/**
 * Podpina pętlę zarządzania fokusem WCAG 2.4.3 do warstwy modalnej i zwraca funkcję sprzątającą,
 * która usuwa nasłuchiwanie klawiatury i przywraca fokus do elementu sprzed otwarcia.
 */
export function attachModalFocusTrap({
  doc,
  getContainer,
  isEscapeDisabled,
  onClose,
}: AttachModalFocusTrapOptions): () => void {
  const previousFocused = isFocusableNode(doc.activeElement) ? doc.activeElement : null;

  const container = getContainer();
  if (container) {
    const preferredCandidate = container.querySelector('[data-autofocus="true"]:not(:disabled)');
    const firstCandidate =
      (isFocusableNode(preferredCandidate) ? preferredCandidate : null) ??
      (() => {
        const fallback = container.querySelector(MODAL_FOCUSABLE_SELECTOR);
        return isFocusableNode(fallback) ? fallback : null;
      })();

    if (firstCandidate) {
      firstCandidate.focus();
    } else {
      container.focus();
    }
  }

  const handleKeyDown = (event: FocusTrapKeyboardEvent) => {
    if (event.key === 'Escape') {
      if (!isEscapeDisabled?.() && onClose) {
        event.preventDefault();
        onClose();
      }
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const activeContainer = getContainer();
    if (!activeContainer) {
      return;
    }

    const focusables = Array.from(activeContainer.querySelectorAll(MODAL_FOCUSABLE_SELECTOR))
      .filter(isFocusableNode)
      .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');

    if (focusables.length === 0) {
      event.preventDefault();
      activeContainer.focus();
      return;
    }

    const currentIndex = isFocusableNode(doc.activeElement)
      ? focusables.indexOf(doc.activeElement)
      : -1;
    const nextIndex = cycleFocusTrapIndex(currentIndex, focusables.length, event.shiftKey);
    const nextTarget = focusables[nextIndex];
    if (nextTarget) {
      event.preventDefault();
      nextTarget.focus();
    }
  };

  doc.addEventListener('keydown', handleKeyDown);
  return () => {
    doc.removeEventListener('keydown', handleKeyDown);
    if (previousFocused && previousFocused.isConnected !== false) {
      previousFocused.focus();
    }
  };
}

export interface UseModalFocusTrapOptions {
  open: boolean;
  onClose?: (() => void) | undefined;
  disableEscape?: boolean | undefined;
}

/**
 * Lekki hook zarządzania fokusem w warstwach modalnych (`role="dialog"` / `role="alertdialog"`):
 * - zapamiętuje aktywny element przed otwarciem i przywraca mu fokus po zamknięciu,
 * - przenosi początkowy fokus na `[data-autofocus="true"]` lub pierwszą kontrolkę interaktywną,
 * - utrzymuje cykliczny obieg `Tab` / `Shift+Tab` wewnątrz kontenera oraz obsługuje `Escape`.
 */
export function useModalFocusTrap<TElement extends HTMLElement>({
  disableEscape = false,
  onClose,
  open,
}: UseModalFocusTrapOptions): RefObject<TElement | null> {
  const containerRef = useRef<TElement | null>(null);
  const onCloseRef = useRef<(() => void) | undefined>(onClose);
  const disableEscapeRef = useRef<boolean>(disableEscape);

  useEffect(() => {
    onCloseRef.current = onClose;
    disableEscapeRef.current = disableEscape;
  }, [onClose, disableEscape]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return;
    }

    return attachModalFocusTrap({
      doc: document,
      getContainer: () => containerRef.current,
      isEscapeDisabled: () => disableEscapeRef.current,
      onClose: () => onCloseRef.current?.(),
    });
  }, [open]);

  return containerRef;
}
