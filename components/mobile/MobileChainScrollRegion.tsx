"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  CHAIN_SCROLL_FADE_LEFT_CLASS,
  CHAIN_SCROLL_FADE_RIGHT_CLASS,
  CHAIN_SCROLL_HINT_CLASS,
  CHAIN_SCROLL_REGION_CLASS,
} from "@/components/mobileStandards";

type MobileChainScrollRegionProps = {
  children: ReactNode;
};

/**
 * Horizontal scroll shell for the chain visualisation.
 * Mobile-only hint and edge fades; no changes to chain rendering.
 */
export function MobileChainScrollRegion({
  children,
}: MobileChainScrollRegionProps) {
  const scrollRef =
    useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] =
    useState(false);
  const [showRightFade, setShowRightFade] =
    useState(false);
  const [isScrollable, setIsScrollable] =
    useState(false);

  useEffect(() => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    function updateScrollState() {
      const scrollElement = scrollRef.current;

      if (!scrollElement) {
        return;
      }

      const {
        scrollLeft,
        scrollWidth,
        clientWidth,
      } = scrollElement;
      const canScroll =
        scrollWidth > clientWidth + 1;

      setIsScrollable(canScroll);
      setShowLeftFade(
        canScroll && scrollLeft > 4
      );
      setShowRightFade(
        canScroll &&
          scrollLeft <
            scrollWidth - clientWidth - 4
      );
    }

    updateScrollState();

    element.addEventListener(
      "scroll",
      updateScrollState,
      { passive: true }
    );

    const resizeObserver =
      new ResizeObserver(updateScrollState);
    resizeObserver.observe(element);

    return () => {
      element.removeEventListener(
        "scroll",
        updateScrollState
      );
      resizeObserver.disconnect();
    };
  }, [children]);

  return (
    <div>
      {isScrollable ? (
        <p
          className={CHAIN_SCROLL_HINT_CLASS}
          aria-hidden="true"
        >
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true">←</span>
            Swipe to view chain
            <span aria-hidden="true">→</span>
          </span>
        </p>
      ) : null}

      <div className="relative">
        {showLeftFade ? (
          <div
            className={CHAIN_SCROLL_FADE_LEFT_CLASS}
            aria-hidden="true"
          />
        ) : null}

        {showRightFade ? (
          <div
            className={CHAIN_SCROLL_FADE_RIGHT_CLASS}
            aria-hidden="true"
          />
        ) : null}

        <div
          ref={scrollRef}
          className={CHAIN_SCROLL_REGION_CLASS}
          tabIndex={0}
          role="region"
          aria-label="Property chain. Scroll horizontally to explore all chain positions."
        >
          {children}
        </div>
      </div>
    </div>
  );
}
